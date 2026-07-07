<?php
declare(strict_types=1);

/**
 * ATC MOI SOAP Service — PHP 8 SoapServer entry point
 *
 * Replaces: server.php + nusoap.php + functions.php + class.moi_service.php
 * Uses PHP's native SoapServer (ext-soap) — no external libraries.
 *
 * Deploy at: /services/moi/server.php
 * WSDL URL:  https://yourdomain.com/services/moi/server.php?wsdl
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/src/MoiLogger.php';
require_once __DIR__ . '/src/MoiDB.php';
require_once __DIR__ . '/src/MoiDTOs.php';
require_once __DIR__ . '/src/MoiRepository.php';
require_once __DIR__ . '/src/MoiService.php';

date_default_timezone_set(MOI_TIMEZONE);

// ── IP Whitelist ───────────────────────────────────────────────────────────────
if (!empty(MOI_ALLOWED_IPS)) {
    $clientIp = $_SERVER['HTTP_CLIENT_IP']
             ?? $_SERVER['HTTP_X_FORWARDED_FOR']
             ?? $_SERVER['REMOTE_ADDR']
             ?? '';
    if (!in_array($clientIp, MOI_ALLOWED_IPS, true)) {
        MoiLogger::auth("Blocked IP: {$clientIp}");
        http_response_code(403);
        exit('Access denied.');
    }
}

// ── WSDL path ──────────────────────────────────────────────────────────────────
$wsdlFile = __DIR__ . '/moi_service.wsdl';

// ── Serve WSDL on ?wsdl ────────────────────────────────────────────────────────
if (isset($_GET['wsdl']) || isset($_GET['WSDL'])) {
    header('Content-Type: text/xml; charset=utf-8');
    readfile($wsdlFile);
    exit;
}

// ── SOAP Request Handler ───────────────────────────────────────────────────────
$rawInput = file_get_contents('php://input');
MoiLogger::request("Incoming SOAP: " . substr($rawInput, 0, 300));

// Normalise the request before dispatch.
// SoapUI (and similar tools) send either an empty <Body/> or an element with an
// undeclared namespace prefix for zero-parameter operations.  PHP's SoapServer
// requires a properly-namespaced operation element inside <Body>; if it is
// missing it throws "Body without function call".  We fix it here using the
// SOAPAction HTTP header, which clients always send correctly.
$rawInput = normalizeSoapBody($rawInput);

try {
    ini_set('soap.wsdl_cache_enabled', '0');
    $server = new SoapServer($wsdlFile, [
        'encoding'     => 'UTF-8',
        'soap_version' => SOAP_1_1,
        'cache_wsdl'   => WSDL_CACHE_NONE,
    ]);

    $server->setObject(new MoiSoapHandler());
    $server->handle($rawInput);
} catch (\Throwable $e) {
    MoiLogger::error('SoapServer fatal: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: text/xml; charset=utf-8');
    echo '<?xml version="1.0" encoding="UTF-8"?>'
       . '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">'
       . '<SOAP-ENV:Body><SOAP-ENV:Fault>'
       . '<faultcode>SOAP-ENV:Server</faultcode>'
       . '<faultstring>' . htmlspecialchars($e->getMessage()) . '</faultstring>'
       . '</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>';
}

// ── Request normaliser ─────────────────────────────────────────────────────────
// Ensures the SOAP Body always contains a properly-namespaced operation element.
// Handles two broken patterns emitted by SoapUI / similar tools:
//   (a) <Body/>  — empty body for zero-parameter operations
//   (b) <enc:Op/>  — operation element with an undeclared namespace prefix
// In both cases we fall back to the SOAPAction HTTP header to identify the
// operation and inject <tns:OperationName xmlns:tns="urn:MOIService"/> into Body.
function normalizeSoapBody(string $xml): string
{
    if ($xml === '') return $xml;

    $soapNs = 'http://schemas.xmlsoap.org/soap/envelope/';
    $moiNs  = 'urn:MOIService';

    // SOAPAction may be bare ("GetAllEmirates"), quoted ('"GetAllEmirates"'),
    // or NuSOAP-style ("urn:MOIService#GetAllEmirates") — extract just the name.
    $rawAction  = trim($_SERVER['HTTP_SOAPACTION'] ?? '', '" ');
    $soapAction = strpos($rawAction, '#') !== false
        ? substr($rawAction, strrpos($rawAction, '#') + 1)
        : $rawAction;

    $dom = new DOMDocument('1.0', 'UTF-8');

    if (@$dom->loadXML($xml)) {
        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('s', $soapNs);

        $bodyList = $xpath->query('/s:Envelope/s:Body');
        if ($bodyList->length === 0) return $xml;
        $body = $bodyList->item(0);

        // Find first element child of Body
        $firstElem = null;
        foreach ($body->childNodes as $node) {
            if ($node->nodeType === XML_ELEMENT_NODE) { $firstElem = $node; break; }
        }

        // Already correctly namespaced — nothing to do
        if ($firstElem !== null && $firstElem->namespaceURI === $moiNs) return $xml;

        // Determine operation name: prefer the element's local name (handles the
        // NuSOAP/Postman pattern of <GetAllEmirates xmlns="...soap/encoding/"/>),
        // fall back to the SOAPAction header for an empty body.
        $opName = $firstElem !== null ? $firstElem->localName : $soapAction;
        if (!$opName) return $xml;

        $call = $dom->createElementNS($moiNs, 'tns:' . $opName);
        if ($firstElem !== null) {
            foreach (iterator_to_array($firstElem->childNodes) as $child) {
                $call->appendChild($child->cloneNode(true));
            }
            $body->replaceChild($call, $firstElem);
        } else {
            $body->appendChild($call);
        }

        return $dom->saveXML();
    }

    // XML unparseable (e.g. undeclared namespace prefix) — rebuild minimal envelope.
    // Only zero-parameter operations trigger this path, so no parameters are lost.
    if (!$soapAction) return $xml;
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
         . "<SOAP-ENV:Envelope xmlns:SOAP-ENV=\"{$soapNs}\">"
         . "<SOAP-ENV:Body>"
         . "<tns:{$soapAction} xmlns:tns=\"{$moiNs}\"/>"
         . "</SOAP-ENV:Body>"
         . "</SOAP-ENV:Envelope>";
}

// ── SOAP Handler — methods called by SoapServer ────────────────────────────────
// Method signatures must match the WSDL exactly.

final class MoiSoapHandler
{
    private MoiService $svc;
    public function __construct()
    {
        $this->svc = new MoiService();
    }

    // ── IDL ───────────────────────────────────────────────────────────────────

    public function GetAllMOIRequests(string $ClientEmiratesId): array
    {
        return $this->svc->getAllMOIRequests($ClientEmiratesId);
    }

    public function CheckMOIRequestStatus(string $ClientEmiratesId, string $TransactionSequence): array
    {
        return $this->svc->checkMOIRequestStatus($ClientEmiratesId, $TransactionSequence);
    }

    public function CreateMOIRequest(
        string $LicenseNumber, string $Mobile, string $BirthDate, string $BirthPlace,
        string $IssuePlace, string $IssueDate, string $ExpiryDate, string $LicenseTypeId,
        string $FirstIDL, string $FirstName, string $LastName, string $NationalityId,
        string $Sex, string $UAEAddress, string $POBox, string $Email, string $EmirateId,
        string $HomeAddress, string $DrivingLicenseFront, string $DrivingLicenseBack,
        string $PassportPhoto, string $DeliveryLicense, string $AcceptEmail,
        string $EmiratesID, string $Channel
    ): array {
        return $this->svc->createMOIRequest(compact(
            'LicenseNumber','Mobile','BirthDate','BirthPlace','IssuePlace','IssueDate',
            'ExpiryDate','LicenseTypeId','FirstIDL','FirstName','LastName','NationalityId',
            'Sex','UAEAddress','POBox','Email','EmirateId','HomeAddress',
            'DrivingLicenseFront','DrivingLicenseBack','PassportPhoto',
            'DeliveryLicense','AcceptEmail','EmiratesID','Channel',
        ));
    }

    public function DeleteMOIRequest(string $TransactionSequence, string $EmiratesID): array
    {
        return $this->svc->deleteMOIRequest($TransactionSequence, $EmiratesID);
    }

    public function UpdatePaymentStatus(string $TransactionSequence, string $ApplicationID, string $PaymentReference): array
    {
        return $this->svc->updatePaymentStatus($TransactionSequence, $ApplicationID, $PaymentReference);
    }

    public function GetIDLPrintPDFString(string $TransactionSequence): array
    {
        return $this->svc->generateIDLPrint($TransactionSequence);
    }

    public function GetAllIDLStatuses(): array
    {
        return $this->svc->getAllIDLStatuses();
    }

    // ── CPD ───────────────────────────────────────────────────────────────────

    public function CreateCPDRequest(
        string $OwnerEmiratesID, string $OwnerFirstName, string $OwnerLastName,
        string $OwnerEmail, string $OwnerPhoneNo, string $OwnerNationality, string $OwnerCity,
        string $OwnerDOB, string $OwnerAddressInUAE, string $OwnerPOBox,
        string $OwnerLIcenseNo, string $LicenseIssueDate, string $MulkiyaNo,
        string $RegistrationNo, string $MulkiyaExpiryDate, string $VehicleMake,
        string $VehicleModel, string $ManufacturingYear, string $Weight,
        string $RegisteredDate, string $Color, string $ChassisNo, string $BodyType,
        string $EngineNo, string $NoOfCylinders, string $NoOfSeats, string $HorsePower,
        string $MulkiyaFrontImage, string $MulkiyaBackImage, string $DLFrontImage,
        string $DLBackImage, string $GuaranteeAmount, string $CountryList,
        string $ExtraOwner1, string $ExtraOwner2, string $Channel
    ): array {
        return $this->svc->createCPDRequest(compact(
            'OwnerEmiratesID','OwnerFirstName','OwnerLastName','OwnerEmail','OwnerPhoneNo',
            'OwnerNationality','OwnerCity','OwnerDOB','OwnerAddressInUAE','OwnerPOBox',
            'OwnerLIcenseNo','LicenseIssueDate','MulkiyaNo','RegistrationNo',
            'MulkiyaExpiryDate','VehicleMake','VehicleModel','ManufacturingYear',
            'Weight','RegisteredDate','Color','ChassisNo','BodyType','EngineNo',
            'NoOfCylinders','NoOfSeats','HorsePower','MulkiyaFrontImage','MulkiyaBackImage',
            'DLFrontImage','DLBackImage','GuaranteeAmount','CountryList',
            'ExtraOwner1','ExtraOwner2','Channel',
        ));
    }

    public function UpdateCPDRequestPaymentStatus(string $ApplicationID, string $BookingFee, string $PaymentReference, string $GuaranteeAmount): array
    {
        return $this->svc->updateCPDRequestPaymentStatus($ApplicationID, $BookingFee, $PaymentReference, $GuaranteeAmount);
    }

    public function GetAllCPDRequests(string $ClientEmiratesId): array
    {
        return $this->svc->getAllCPDRequests($ClientEmiratesId);
    }

    public function GetSingleCPDRequestDetails(string $RequestID): array
    {
        return $this->svc->getSingleCPDRequestDetails($RequestID);
    }

    public function GetCPDCountryList(): array
    {
        return $this->svc->getCPDCountryList();
    }

    public function GetFeesForCPDRequest(string $CountryList, string $VehicleType, string $ManufacturingYear, string $ExtraOwner1 = '', string $ExtraOwner2 = ''): array
    {
        return $this->svc->getFeesForCPDRequest($CountryList, $VehicleType, $ManufacturingYear, $ExtraOwner1, $ExtraOwner2);
    }

    public function GetAllowedVehicleTypesForCPD(): array
    {
        return $this->svc->getAllowedVehicleTypesForCPD();
    }

    public function GetAllowedBodyTypesForCPD(): array
    {
        return $this->svc->getAllowedBodyTypesForCPD();
    }

    public function GetAvailableCitiesForCPD(): array
    {
        return $this->svc->getAvailableCitiesForCPD();
    }

    public function GetAllCPDStatuses(): array
    {
        return $this->svc->getAllCPDStatuses();
    }

    public function CancelCPDRequest(string $TransactionSequence, string $EmiratesID): array
    {
        return $this->svc->cancelCPDRequest($TransactionSequence, $EmiratesID);
    }

    public function UpdateCPDGuaranteeDepositSlip(string $ApplicationID, string $GuaranteeDepositCheque): array
    {
        return $this->svc->updateCPDGuaranteeDepositSlip($ApplicationID, $GuaranteeDepositCheque);
    }

    public function UpdateCPDGuarantee(string $ApplicationID, string $PaymentReference = '', string $VerificationDocument = ''): array
    {
        return $this->svc->updateCPDGuarantee($ApplicationID, $PaymentReference, $VerificationDocument);
    }

    // ── Shared Lookups ────────────────────────────────────────────────────────

    public function GetAllEmirates(): array         { return $this->svc->getAllEmirates(); }
    public function GetAllLicenseTypes(): array     { return $this->svc->getAllLicenseTypes(); }
    public function GetAllNationalities(): array    { return $this->svc->getAllNationalities(); }
    public function GetPaymentBreakup(): array      { return $this->svc->getPaymentBreakup(); }
    public function GetATCBankingDetails(): array   { return $this->svc->getATCBankingDetails(); }
}
