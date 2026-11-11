<?php
declare(strict_types=1);

// ── MOE Service — Business Logic ──────────────────────────────────────────────
// Direct port of MOEService::_getIDLDataForMOE() / _getCPDDataOfBusAndTrucksForMOE()
// / _getCPDDataOfOtherTypesForMOE() from the legacy service
// (D:\ATC Source\atc-portal\services\moe\class.moe_service.php) — same field
// mapping, same hardcoded figures (170.00/8.50 IDL totals, flat 50 CPD transaction
// amount, 364-day validity window), same "Rejected => 0 else 10" IDL amount rule.
// No dependencies on v3 portal classes. All DB access goes via MoeRepository.

final class MoeService
{
    // ── IDL ───────────────────────────────────────────────────────────────────

    public function getIDLDataForMOE(string $startDate, string $endDate): array
    {
        try {
            $rows = MoeRepository::getIDLDataForMOE($startDate, $endDate);

            if (!$rows) {
                $o = new IDLRequestStatusBindingView();
                $o->ErrorCode    = '404';
                $o->ErrorMessage = 'No Records available for given parameters';
                $o->ErrorMessage_AR = 'لا توجد سجلات متاحة لمعلمات معينة';
                return [$o->toArray()];
            }

            return array_map(fn (array $row) => $this->buildIDLView($row)->toArray(), $rows);
        } catch (\PDOException $e) {
            return [$this->idlDbError($e)->toArray()];
        } catch (\Throwable $e) {
            return [$this->idlGeneralError($e)->toArray()];
        }
    }

    // Error-path array items must still satisfy the WSDL's ArrayOfIDLRequestStatusBindingView
    // shape — a generic ServiceStatus object (used by the non-array MOI/RTA operations this
    // pattern was copied from) has no EntityName etc., and PHP's native SoapServer throws
    // "SOAP-ERROR: Encoding: object has no 'EntityName' property" trying to serialize one
    // against that complexType. So errors here are IDLRequestStatusBindingView instances too,
    // with only the Error* fields populated — exactly like the "no records" case above.
    private function idlDbError(\Throwable $e): IDLRequestStatusBindingView
    {
        MoeLogger::error('DB error: ' . $e->getMessage());
        $o = new IDLRequestStatusBindingView();
        $o->ErrorCode       = '001';
        $o->ErrorMessage    = 'Error occured in the data layer.Additional Error info: ' . $e->getMessage();
        $o->ErrorMessage_AR = ' حدث خطأ في طبقة البيانات. معلومات خطأ إضافية' . $e->getMessage();
        return $o;
    }

    private function idlGeneralError(\Throwable $e): IDLRequestStatusBindingView
    {
        MoeLogger::error('Error: ' . $e->getMessage());
        $o = new IDLRequestStatusBindingView();
        $o->ErrorCode       = '002';
        $o->ErrorMessage    = 'Unspecified Error occured.Additional Error info: ' . $e->getMessage();
        $o->ErrorMessage_AR = 'حدث خطأ غير محدد. معلومات خطأ إضافية' . $e->getMessage();
        return $o;
    }

    private function buildIDLView(array $row): IDLRequestStatusBindingView
    {
        $o = new IDLRequestStatusBindingView();

        $o->EntityName         = 'Ministry of Energy and Infrastructure';
        $o->ServiceGLCode      = '142220';
        $o->ServiceID          = '1024121882';
        $o->ServiceNameEnglish = 'Issue International Driving License';
        $o->ServiceNameArabic  = 'إصدار رخصة قيادة دولية IDL لكل رخصة ';

        // Legacy used a loose `== ''` check, which (unlike a strict comparison) also
        // catches a NULL payment_method and falls back to 'CASH' — replicate that with
        // an explicit null/empty check instead of relying on loose-comparison quirks.
        $paymentMethod = (string) ($row['payment_method'] ?? '');
        if ($paymentMethod === '') $paymentMethod = 'CASH';

        $o->TransactionDateTime = (string) $row['issued_date'];

        $paidAmount = $row['status'] === 'Rejected' ? '0' : '10';

        $o->TranasctionAmount = $paidAmount;
        $o->VATTransaction    = '0';
        $o->URN               = (string) $row['request_id'];
        $o->TransactionType   = 'Purchase';
        $o->Instrument        = $paymentMethod;
        $o->Currency          = 'AED';

        $o->EmiratesID  = (string) $row['emirates_id'];
        $o->Nationality = (string) $row['nationality'];
        $o->Name        = trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? ''));
        $o->Status      = (string) $row['status'];
        $o->RejectReason = (string) ($row['reject_reason'] ?? '');

        $o->TotalTransactionAmount = '170.00';
        $o->VATAmount              = '8.50';
        $o->LicenseIssueDate       = date('Y-m-d', strtotime((string) $row['issued_date']));
        $o->LicenseExpityDate      = date('Y-m-d', strtotime((string) $row['issued_date'] . ' + 364 days'));

        return $o;
    }

    // ── CPD ───────────────────────────────────────────────────────────────────

    public function getCPDDataOfBusAndTrucksForMOE(string $startDate, string $endDate): array
    {
        return $this->getCPDDataForMOE($startDate, $endDate, busAndTrucks: true);
    }

    public function getCPDDataOfOtherTypesForMOE(string $startDate, string $endDate): array
    {
        return $this->getCPDDataForMOE($startDate, $endDate, busAndTrucks: false);
    }

    private function getCPDDataForMOE(string $startDate, string $endDate, bool $busAndTrucks): array
    {
        try {
            $rows = MoeRepository::getCPDDataForMOE($startDate, $endDate, $busAndTrucks);

            if (!$rows) {
                $o = new CPDRequestStatusBindingView();
                $o->ErrorCode    = '404';
                $o->ErrorMessage = 'No Records available for given parameters';
                $o->ErrorMessage_AR = 'لا توجد سجلات متاحة لمعلمات معينة';
                return [$o->toArray()];
            }

            return array_map(
                fn (array $row) => $this->buildCPDView($row, $busAndTrucks)->toArray(),
                $rows,
            );
        } catch (\PDOException $e) {
            return [$this->cpdDbError($e)->toArray()];
        } catch (\Throwable $e) {
            return [$this->cpdGeneralError($e)->toArray()];
        }
    }

    // See idlDbError()/idlGeneralError() above for why these can't be a generic
    // ServiceStatus object.
    private function cpdDbError(\Throwable $e): CPDRequestStatusBindingView
    {
        MoeLogger::error('DB error: ' . $e->getMessage());
        $o = new CPDRequestStatusBindingView();
        $o->ErrorCode       = '001';
        $o->ErrorMessage    = 'Error occured in the data layer.Additional Error info: ' . $e->getMessage();
        $o->ErrorMessage_AR = ' حدث خطأ في طبقة البيانات. معلومات خطأ إضافية' . $e->getMessage();
        return $o;
    }

    private function cpdGeneralError(\Throwable $e): CPDRequestStatusBindingView
    {
        MoeLogger::error('Error: ' . $e->getMessage());
        $o = new CPDRequestStatusBindingView();
        $o->ErrorCode       = '002';
        $o->ErrorMessage    = 'Unspecified Error occured.Additional Error info: ' . $e->getMessage();
        $o->ErrorMessage_AR = 'حدث خطأ غير محدد. معلومات خطأ إضافية' . $e->getMessage();
        return $o;
    }

    private function buildCPDView(array $row, bool $busAndTrucks): CPDRequestStatusBindingView
    {
        $o = new CPDRequestStatusBindingView();

        $o->EntityName    = 'Ministry of Energy and Infrastructure';
        $o->ServiceGLCode = '142201';
        $o->ServiceID     = '1024121881';

        if ($busAndTrucks) {
            $o->ServiceNameEnglish = 'Issue Passage Card For Trucks and Buses';
            $o->ServiceNameArabic  = 'إصدار بطاقة مرور للشاحنات وحافلات الركاب لكل بطاقة ';
        } else {
            $o->ServiceNameEnglish = 'Issue CPD';
            $o->ServiceNameArabic  = 'إصدار دفتر مرور للمركبات الخاصة CPD لكل دفتر ';
        }

        $totalFees = (float) $row['booking_fee'] + (float) $row['extra_fees'];

        $o->TransactionDateTime = (string) $row['issued_datetime'];
        $o->TranasctionAmount   = '50';
        $o->VATTransaction      = '0';
        $o->URN                 = (string) $row['request_id'];
        $o->TransactionType     = 'Purchase';
        $o->Instrument          = (string) $row['method_of_payment'];
        $o->Currency             = 'AED';

        $o->EmiratesID  = (string) $row['emirates_id'];
        $o->Nationality = (string) $row['nationality'];
        $o->Name        = (string) $row['full_name'];
        $o->Status      = (string) $row['cpd_status'];

        $o->TrafficFileNo     = (string) $row['mulkiya_no'];
        $o->RegistrationNo    = (string) $row['registration_no'];
        $o->VehicleMake       = (string) $row['vehicle_make'];
        $o->VehicleModel      = (string) $row['vehicle_model'];
        $o->BodyType          = (string) $row['body_type'];
        $o->YearOfManufacture = (string) $row['manuf_year'];
        $o->Color             = (string) $row['color'];
        $o->ChassisNo         = (string) $row['chassis_no'];
        $o->EngineNo          = (string) $row['engine_no'];
        $o->NoOfSeats         = (string) $row['no_of_seats'];
        $o->NoOfCylinders     = (string) $row['no_of_cylinders'];

        $o->TotalTransactionAmount = number_format($totalFees + (float) $row['vat_amount'], 2, '.', '');
        $o->VATAmount              = number_format((float) $row['vat_amount'], 2, '.', '');
        $o->LicenseIssueDate       = date('Y-m-d', strtotime((string) $row['issued_datetime']));
        $o->LicenseExpityDate      = date('Y-m-d', strtotime((string) $row['issued_datetime'] . ' + 364 days'));

        return $o;
    }
}
