<?php
declare(strict_types=1);

// ── Response DTOs ─────────────────────────────────────────────────────────────
// Field lists match rta_service.wsdl exactly (which mirrors the original
// wsdl.xml contract). Do not add fields here without adding them to the WSDL.

final class ServiceStatus
{
    public string $TransactionStatus  = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public string $TransactionSequence = '';
    public string $ApplicationID      = '';

    public static function success(string $transSeq = '', string $appId = ''): self
    {
        $o                      = new self();
        $o->TransactionStatus   = '1';
        $o->ErrorCode           = '000';
        $o->TransactionSequence = $transSeq;
        $o->ApplicationID       = $appId;
        return $o;
    }

    public static function error(string $code, string $msg): self
    {
        $o                    = new self();
        $o->TransactionStatus = '0';
        $o->ErrorCode         = $code;
        $o->ErrorMessage      = $msg;
        return $o;
    }

    public static function dbError(\Throwable $e): self
    {
        RtaLogger::error('DB error: ' . $e->getMessage());
        return self::error('001', 'Database error: ' . $e->getMessage());
    }

    public static function generalError(\Throwable $e): self
    {
        RtaLogger::error('Error: ' . $e->getMessage());
        return self::error('002', 'Unspecified error: ' . $e->getMessage());
    }

    public function toArray(): array { return (array) $this; }
}

final class RTARequestStatusBindingView
{
    public string $EmiratesID          = '';
    public string $Id                  = '';
    public string $IDPIssueDate        = '';
    public string $PaymentDone         = '';
    public string $Processed           = '';
    public string $TransactionSequence = '';
    public string $LicenseNumber       = '';
    public string $Mobile              = '';
    public string $BirthDate           = '';
    public string $BirthPlace          = '';
    public string $IssuePlace          = '';
    public string $ExpiryDate          = '';
    public string $LicenseTypeId       = '';
    public string $FirstIDL            = '';
    public string $Name                = '';
    public string $NationalityId       = '';
    public string $UAEAddress          = '';
    public string $POBox               = '';
    public string $Email               = '';
    public string $HomeAddress         = '';
    public string $DeliveryLicense     = '';
    public string $PassportPhoto       = '';
    public string $ErrorCode           = '';
    public string $ErrorMessage        = '';

    public function toArray(): array { return (array) $this; }
}

final class EmirateItemBindingView
{
    public string $ArabicDescription  = '';
    public string $EnglishDescription = '';
    public string $Id                 = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public function toArray(): array { return (array) $this; }
}

final class LicenseTypesItemBindingView
{
    public string $ArabicDescription  = '';
    public string $EnglishDescription = '';
    public string $Id                 = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public function toArray(): array { return (array) $this; }
}

final class NationalitiesItemBindingView
{
    public string $ArabicDescription  = '';
    public string $EnglishDescription = '';
    public string $Id                 = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public function toArray(): array { return (array) $this; }
}

final class PaymentBreakup
{
    public string $Currency         = '';
    public string $ForIDPValue      = '';
    public string $ForDeliveryValue = '';
    public string $ErrorCode        = '';
    public string $ErrorMessage     = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDCountryItemBindingView
{
    public string $CountryID    = '';
    public string $CountryName  = '';
    public string $ErrorCode    = '';
    public string $ErrorMessage = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDFees
{
    public string $BookingFee      = '';
    public string $GuaranteeAmount = '';
    public string $ErrorCode       = '';
    public string $ErrorMessage    = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDVehicleTypeItemBindingView
{
    public string $VehicleType  = '';
    public string $ErrorCode    = '';
    public string $ErrorMessage = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDBodyTypeItemBindingView
{
    public string $Type         = '';
    public string $ErrorCode    = '';
    public string $ErrorMessage = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDCityItemBindingView
{
    public string $City         = '';
    public string $ErrorCode    = '';
    public string $ErrorMessage = '';
    public function toArray(): array { return (array) $this; }
}
