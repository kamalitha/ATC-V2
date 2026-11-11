<?php
declare(strict_types=1);

// ── Response DTOs ─────────────────────────────────────────────────────────────
// These replace the old plain-property classes in the legacy class.moe_service.php
// (D:\ATC Source\atc-portal\services\moe\class.moe_service.php). Property names —
// including the legacy typos "TranasctionAmount" and "LicenseExpityDate" — are kept
// byte-for-byte: MOE's consuming system is built against this exact WSDL contract,
// so "fixing" the spelling would break a live external integration. All Arabic
// strings are now proper UTF-8 literals instead of \xNN hex escapes.

final class IDLRequestStatusBindingView
{
    public string $EntityName           = '';
    public string $ServiceGLCode        = '';
    public string $ServiceID            = '';
    public string $ServiceNameEnglish   = '';
    public string $ServiceNameArabic    = '';
    public string $TransactionDateTime  = '';
    public string $TranasctionAmount    = ''; // sic — legacy contract typo, kept intentionally
    public string $VATTransaction       = '';
    public string $URN                  = '';
    public string $TransactionType      = '';
    public string $Instrument           = '';
    public string $Currency             = '';
    public string $EmiratesID           = '';
    public string $Nationality          = '';
    public string $Name                 = '';
    public string $Status               = '';
    public string $RejectReason         = '';
    public string $TotalTransactionAmount = '';
    public string $VATAmount            = '';
    public string $LicenseIssueDate     = '';
    public string $LicenseExpityDate    = ''; // sic — legacy contract typo, kept intentionally
    public string $ErrorCode            = '';
    public string $ErrorMessage         = '';
    public string $ErrorMessage_AR      = '';

    public function toArray(): array { return (array) $this; }
}

final class CPDRequestStatusBindingView
{
    public string $EntityName           = '';
    public string $ServiceGLCode        = '';
    public string $ServiceID            = '';
    public string $ServiceNameEnglish   = '';
    public string $ServiceNameArabic    = '';
    public string $TransactionDateTime  = '';
    public string $TranasctionAmount    = ''; // sic — legacy contract typo, kept intentionally
    public string $VATTransaction       = '';
    public string $URN                  = '';
    public string $TransactionType      = '';
    public string $Instrument           = '';
    public string $Currency             = '';
    public string $EmiratesID           = '';
    public string $Nationality          = '';
    public string $Name                 = '';
    public string $Status               = '';
    public string $RejectReason         = '';

    public string $TrafficFileNo        = '';
    public string $RegistrationNo       = '';
    public string $VehicleMake          = '';
    public string $VehicleModel         = '';
    public string $BodyType             = '';
    public string $YearOfManufacture    = '';
    public string $Color                = '';
    public string $ChassisNo            = '';
    public string $EngineNo             = '';
    public string $NoOfSeats            = '';
    public string $NoOfCylinders        = '';

    public string $TotalTransactionAmount = '';
    public string $VATAmount            = '';
    public string $LicenseIssueDate     = '';
    public string $LicenseExpityDate    = ''; // sic — legacy contract typo, kept intentionally
    public string $ErrorCode            = '';
    public string $ErrorMessage         = '';
    public string $ErrorMessage_AR      = '';

    public function toArray(): array { return (array) $this; }
}
