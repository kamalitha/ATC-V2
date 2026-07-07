<?php
declare(strict_types=1);

// ── Response DTOs ─────────────────────────────────────────────────────────────
// These replace the old plain-property classes in class.moi_service.php.
// All Arabic strings are now proper UTF-8 literals instead of \xNN hex escapes.

final class ServiceStatus
{
    public string $TransactionStatus  = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public string $ErrorMessage_AR    = '';
    public string $TransactionSequence = '';
    public string $ApplicationID      = '';

    public static function success(string $transSeq = '', string $appId = ''): self
    {
        $o                     = new self();
        $o->TransactionStatus  = '1';
        $o->ErrorCode          = '000';
        $o->TransactionSequence = $transSeq;
        $o->ApplicationID      = $appId;
        return $o;
    }

    public static function error(string $code, string $msg, string $msgAR = ''): self
    {
        $o                    = new self();
        $o->TransactionStatus = '0';
        $o->ErrorCode         = $code;
        $o->ErrorMessage      = $msg;
        $o->ErrorMessage_AR   = $msgAR;
        return $o;
    }

    public static function dbError(\Throwable $e): self
    {
        MoiLogger::error('DB error: ' . $e->getMessage());
        return self::error('001', 'Database error: ' . $e->getMessage(), 'حدث خطأ في طبقة البيانات.');
    }

    public static function generalError(\Throwable $e): self
    {
        MoiLogger::error('Error: ' . $e->getMessage());
        return self::error('002', 'Unspecified error: ' . $e->getMessage(), 'حدث خطأ غير محدد.');
    }

    public function toArray(): array { return (array) $this; }
}

final class MOIRequestStatusBindingView
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
    public string $FirstName           = '';
    public string $LastName            = '';
    public string $NationalityId       = '';
    public string $Emirate             = '';
    public string $UAEAddress          = '';
    public string $POBox               = '';
    public string $Email               = '';
    public string $HomeAddress         = '';
    public string $DeliveryLicense     = '';
    public string $PassportPhoto       = '';
    public string $TransactionStatus   = '';
    public string $Channel             = '';
    public string $LicenseTypes        = '';
    public string $TrackingURL         = '';
    public string $ErrorCode           = '';
    public string $ErrorMessage        = '';
    public string $ErrorMessage_AR     = '';

    public function toArray(): array { return (array) $this; }
}

final class CPDRequestStatusBindingView
{
    public string $EmiratesID          = '';
    public string $Name                = '';
    public string $Email               = '';
    public string $MobileNo            = '';
    public string $Nationality         = '';
    public string $City                = '';
    public string $DOB                 = '';
    public string $HomeCountryAddress  = '';
    public string $UAEAddress          = '';
    public string $CompanyName         = '';
    public string $POBox               = '';
    public string $PassportNo          = '';
    public string $RequestID           = '';
    public string $MulkiyaNo           = '';
    public string $RegistrationNo      = '';
    public string $RegistrationDate    = '';
    public string $VehicleMake         = '';
    public string $VehicleModel        = '';
    public string $VehicleValue        = '';
    public string $ExtraOwner1Name     = '';
    public string $ExtraOwner2Name     = '';
    public string $BodyType            = '';
    public string $ManufaturingYear    = '';
    public string $Color               = '';
    public string $NetWeight           = '';
    public string $ChassisNo           = '';
    public string $EngineNo            = '';
    public string $HorsePower          = '';
    public string $NoOfCylinders       = '';
    public string $Uphostry            = '';
    public string $NoOfSeats           = '';
    public string $Radio               = '';
    public string $SpareTyre           = '';
    public string $AdditionalRemarks   = '';
    public string $Others1             = '';
    public string $Others2             = '';
    public string $GuranteeAmount      = '';
    public string $TotalAmount         = '';
    public string $PaymentDone         = '';
    public string $RequestCategory     = '';
    public string $DLFront             = '';
    public string $DLBack              = '';
    public string $GuaranteeDepositSlip = '';
    public string $GuaranteePaid       = '';
    public string $RequestedDateTime   = '';
    public string $Countries           = '';
    public string $Channel             = '';
    public string $TrackingURL         = '';
    public string $RequestStatus       = '';
    public string $TransactionSequence = '';
    public string $TransactionStatus   = '';
    public string $ErrorCode           = '';
    public string $ErrorMessage        = '';
    public string $ErrorMessage_AR     = '';

    public function toArray(): array { return (array) $this; }
}

final class EmirateItemBindingView
{
    public string $ArabicDescription = '';
    public string $EnglishDescription = '';
    public string $Id                 = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public string $ErrorMessage_AR    = '';
    public string $TransactionStatus  = '';
    public function toArray(): array { return (array) $this; }
}

final class LicenseTypesItemBindingView
{
    public string $ArabicDescription  = '';
    public string $EnglishDescription = '';
    public string $Id                 = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public string $ErrorMessage_AR    = '';
    public string $TransactionStatus  = '';
    public function toArray(): array { return (array) $this; }
}

final class NationalitiesItemBindingView
{
    public string $ArabicDescription  = '';
    public string $EnglishDescription = '';
    public string $Id                 = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public string $ErrorMessage_AR    = '';
    public string $TransactionStatus  = '';
    public function toArray(): array { return (array) $this; }
}

final class PaymentBreakup
{
    public string $Currency          = '';
    public string $ForIDPValue       = '';
    public string $ForDeliveryValue  = '';
    public string $ErrorCode         = '';
    public string $ErrorMessage      = '';
    public string $ErrorMessage_AR   = '';
    public string $TransactionStatus = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDCountryItemBindingView
{
    public string $CountryID          = '';
    public string $CountryName        = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public string $ErrorMessage_AR    = '';
    public string $TransactionStatus  = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDFees
{
    public string $BookingFee               = '';
    public string $BookingFeeVAT            = '';
    public string $GuaranteeAmount          = '';
    public string $GuaranteeFeeBankCharges  = '';
    public string $CourierCharges           = '';
    public string $ErrorCode                = '';
    public string $ErrorMessage             = '';
    public string $ErrorMessage_AR          = '';
    public string $TransactionStatus        = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDVehicleTypeItemBindingView
{
    public string $VehicleType      = '';
    public string $ErrorCode        = '';
    public string $ErrorMessage     = '';
    public string $ErrorMessage_AR  = '';
    public string $TransactionStatus = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDBodyTypeItemBindingView
{
    public string $Type             = '';
    public string $ErrorCode        = '';
    public string $ErrorMessage     = '';
    public string $ErrorMessage_AR  = '';
    public string $TransactionStatus = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDCityItemBindingView
{
    public string $City             = '';
    public string $City_AR          = '';
    public string $ErrorCode        = '';
    public string $ErrorMessage     = '';
    public string $ErrorMessage_AR  = '';
    public string $TransactionStatus = '';
    public function toArray(): array { return (array) $this; }
}

final class IDLStatusBindingView
{
    public string $ArabicDescription  = '';
    public string $EnglishDescription = '';
    public string $StatusID           = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public string $ErrorMessage_AR    = '';
    public function toArray(): array { return (array) $this; }
}

final class CPDStatusBindingView
{
    public string $ArabicDescription  = '';
    public string $EnglishDescription = '';
    public string $StatusID           = '';
    public string $ErrorCode          = '';
    public string $ErrorMessage       = '';
    public string $ErrorMessage_AR    = '';
    public function toArray(): array { return (array) $this; }
}

final class BankingDetails
{
    public string $AccountNumber       = '';
    public string $IBAN                = '';
    public string $BeneficiaryName     = '';
    public string $BeneficiaryAddress  = '';
    public string $Bank                = '';
    public string $BankAddress         = '';
    public string $SwiftCode           = '';
    public function toArray(): array { return (array) $this; }
}

final class IDL
{
    public string $TransactionSequence = '';
    public string $PrintString         = '';
    public string $ErrorCode           = '';
    public string $ErrorMessage        = '';
    public string $ErrorMessage_AR     = '';
    public function toArray(): array { return (array) $this; }
}
