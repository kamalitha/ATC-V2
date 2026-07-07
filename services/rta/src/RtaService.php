<?php
declare(strict_types=1);

// ── RTA Service — Business Logic ──────────────────────────────────────────────
// Operation names/signatures mirror rta_service.wsdl (derived from the original
// RTA-supplied wsdl.xml contract). No dependencies on v3 portal classes.
// All DB access goes via RtaRepository.

final class RtaService
{
    private const CITY_LIST = [
        '1' => 'Dubai', '2' => 'Abu Dhabi', '3' => 'Sharjah', '4' => 'Ras al-Khaimah',
        '5' => 'Ajman', '6' => 'Fujairah', '7' => 'Umm al-Qaiwain',
    ];

    private const BODY_TYPES = [
        'Luxury', 'Station', 'Saloon', 'MotorCycle', 'Truck', 'Coupe',
        'Bus', 'Trailer', '-Coupe', '-Station', '-Saloon', 'Pickup',
    ];

    // ── IDL Methods ───────────────────────────────────────────────────────────

    public function checkIDLRequestStatus(string $clientEmiratesId): array
    {
        try {
            $emiratesId = preg_replace('/\D/', '', $clientEmiratesId);
            $row        = RtaRepository::getLatestIDLByEmiratesId($emiratesId);

            if (!$row) {
                $o               = new RTARequestStatusBindingView();
                $o->ErrorCode    = '404';
                $o->ErrorMessage = "No Records available for Emirates ID {$emiratesId}";
                return $o->toArray();
            }

            return $this->buildIDLView($row)->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function createIDLRequest(array $p): array
    {
        try {
            $emiratesId      = preg_replace('/\D/', '', $p['EmiratesID'] ?? '');
            $p['EmiratesID'] = $emiratesId;

            [$p['_first_name'], $p['_last_name']] = self::splitName($p['Name'] ?? '');

            $unpaid = RtaRepository::getUnpaidIDLByEmiratesId($emiratesId);
            if ($unpaid) {
                return ServiceStatus::error(
                    '406',
                    'System cannot accept another request as an unpaid/unprocessed request exists. (RequestID: ' . $unpaid['request_id'] . ')',
                )->toArray();
            }

            $created = RtaRepository::createIDLRequest($p);

            return ServiceStatus::success($created['auto_id'], $created['request_id'])->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function deleteIDLRequest(string $transSeq, string $emiratesId): array
    {
        try {
            $row = RtaRepository::getIDLByAutoIdForDelete($transSeq);
            if (!$row) {
                return ServiceStatus::error('404', 'Request not found')->toArray();
            }
            if ((string) $row['request_status'] !== '1') {
                return ServiceStatus::error(
                    '403',
                    'This request is already confirmed. Therefore it cannot be deleted.',
                )->toArray();
            }
            RtaRepository::deleteIDLRequest($transSeq);
            return ServiceStatus::success($transSeq, $row['request_id'])->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function updateIDLRequestPaymentStatus(string $transSeq, string $appId, string $payRef): array
    {
        try {
            date_default_timezone_set(RTA_TIMEZONE);
            RtaRepository::updateIDLField($transSeq, 'paid_status',    '1');
            RtaRepository::updateIDLField($transSeq, 'paid_date',      date('Y-m-d H:i:s'));
            RtaRepository::updateIDLField($transSeq, 'request_status', '2');
            RtaRepository::updateIDLField($transSeq, 'order_ref_no',   $payRef);
            return ServiceStatus::success($transSeq, $appId)->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    /**
     * Returns the print image as a base64 data URI string (bare string per the
     * WSDL contract — no ErrorCode field available on failure, so errors are
     * logged and an empty string is returned).
     *
     * NOTE: the full templated composition MOI's equivalent performs (template
     * image + QR code + burned-in text) needs assets (template_white.jpg,
     * tick_small.png, arial.ttf) and the QRcode class that are not present in
     * this environment. Until those are supplied, this returns the applicant's
     * stored passport photo as-is.
     */
    public function generateIDLPrint(string $applicationId, string $clientEmiratesId): string
    {
        try {
            $emiratesId = preg_replace('/\D/', '', $clientEmiratesId);
            $row        = RtaRepository::getIDLForPrint($applicationId, $emiratesId);
            if (!$row) {
                RtaLogger::error("GenerateIDLPrint: no matching request for {$applicationId} / {$emiratesId}");
                return '';
            }

            $photoPath = RTA_IDL_FILES_PATH . "/{$row['auto_id']}/passport.jpg";
            $base64    = RtaRepository::loadImageAsBase64($photoPath);
            if ($base64 === '') {
                RtaLogger::error("GenerateIDLPrint: passport photo missing for auto_id {$row['auto_id']}");
                return '';
            }
            return 'data:image/jpg;base64,' . $base64;
        } catch (\Throwable $e) {
            RtaLogger::error('GenerateIDLPrint: ' . $e->getMessage());
            return '';
        }
    }

    // ── CPD Methods ───────────────────────────────────────────────────────────

    public function createCPDRequest(array $p): array
    {
        try {
            $existing = RtaRepository::getActiveCPDByMulkiyaNo($p['MulkiyaNo'] ?? '');
            if ($existing) {
                return ServiceStatus::error(
                    '403',
                    'There is a request already processing for this vehicle Mulkiya No ' . $p['MulkiyaNo'] . ' (Request ID: ' . $existing['request_id'] . ')',
                )->toArray();
            }

            $created = RtaRepository::createCPDRequest($p);
            return ServiceStatus::success($created['auto_id'], $created['request_id'])->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function updateCPDRequestPaymentStatus(string $appId, string $bookingFee, string $payRef): array
    {
        try {
            $row = RtaRepository::getCPDByApplicationId($appId);
            if (!$row) {
                return ServiceStatus::error('001', 'Request not found')->toArray();
            }
            if ((int) $row['booking_fee_status'] === 1) {
                return ServiceStatus::error('001', 'Booking fee for this request is already paid')->toArray();
            }
            if ($row['request_type'] !== 'RTA') {
                return ServiceStatus::error('001', 'This is not an RTA request')->toArray();
            }
            RtaRepository::updateCPDPaymentStatus((string) $row['auto_id'], $bookingFee, $payRef);
            return ServiceStatus::success((string) $row['auto_id'], $appId)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    // ── Lookup Methods ────────────────────────────────────────────────────────

    public function getAllEmirates(): array
    {
        try {
            return array_map(function ($row) {
                $o                     = new EmirateItemBindingView();
                $o->Id                 = (string) $row['emirate_id'];
                $o->EnglishDescription = $row['emirate'];
                return $o->toArray();
            }, RtaRepository::getAllEmirates());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllLicenseTypes(): array
    {
        try {
            return array_map(function ($row) {
                $o                     = new LicenseTypesItemBindingView();
                $o->Id                 = (string) $row['type_id'];
                $o->EnglishDescription = $row['dl_type'];
                return $o->toArray();
            }, RtaRepository::getAllLicenseTypes());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllNationalities(): array
    {
        try {
            return array_map(function ($row) {
                $o                     = new NationalitiesItemBindingView();
                $o->Id                 = (string) $row['nationality_id'];
                $o->EnglishDescription = $row['nationality'];
                return $o->toArray();
            }, RtaRepository::getAllNationalities());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getIDLPaymentBreakup(): array
    {
        $o                   = new PaymentBreakup();
        $o->Currency         = 'AED';
        $o->ForIDPValue      = RTA_IDP_FEE;
        $o->ForDeliveryValue = RTA_DELIVERY_FEE;
        return $o->toArray();
    }

    public function getCPDCountryList(): array
    {
        try {
            return array_map(function ($row) {
                $o              = new CPDCountryItemBindingView();
                $o->CountryID   = (string) $row['nationality_id'];
                $o->CountryName = $row['nationality'];
                return $o->toArray();
            }, RtaRepository::getAllCPDCountries());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllowedVehicleTypesForCPD(): array
    {
        try {
            return array_map(function ($row) {
                $o              = new CPDVehicleTypeItemBindingView();
                $o->VehicleType = $row['vehicle_type'];
                return $o->toArray();
            }, RtaRepository::getAllCPDVehicleTypes());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllowedBodyTypesForCPD(): array
    {
        return array_map(function ($t) {
            $o       = new CPDBodyTypeItemBindingView();
            $o->Type = $t;
            return $o->toArray();
        }, self::BODY_TYPES);
    }

    public function getAvailableCitiesForCPD(): array
    {
        return array_map(function ($name) {
            $o       = new CPDCityItemBindingView();
            $o->City = $name;
            return $o->toArray();
        }, array_values(self::CITY_LIST));
    }

    public function getFeesForCPDRequest(string $countryList, string $vehicleType, string $year): array
    {
        try {
            $countryIds = array_values(array_filter(array_map('trim', explode(',', $countryList))));
            $feeRow     = RtaRepository::getBookingFeeForCountries($countryIds);
            $bookingFee = (float) ($feeRow['booking_fee'] ?? 0);

            // Guarantee amount depends on vehicle value/age rules maintained in the
            // staff portal's CPDController — not duplicated here; RTA receives the
            // booking fee only, matching the fields defined in the WSDL contract.
            $o                  = new CPDFees();
            $o->BookingFee      = (string) $bookingFee;
            $o->GuaranteeAmount = '0';
            return $o->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    private function buildIDLView(array $row): RTARequestStatusBindingView
    {
        $o                      = new RTARequestStatusBindingView();
        $o->EmiratesID          = $row['emirates_id'] ?? '';
        $o->Id                  = $row['request_id'];
        $o->IDPIssueDate        = $row['issued_date'] ?? '';
        $o->PaymentDone         = ($row['paid_status'] != '' && $row['paid_status'] != '0') ? 'True' : 'False';
        $o->Processed           = ($row['processed_by'] ?? '') !== '' ? 'True' : 'False';
        $o->TransactionSequence = (string) $row['auto_id'];
        $o->LicenseNumber       = $row['license_no'] ?? '';
        $o->Mobile              = $row['mobile_no'] ?? '';
        $o->BirthDate           = $row['dob'] ?? '';
        $o->BirthPlace          = $row['place_of_birth'] ?? '';
        $o->IssuePlace          = (string) ($row['place_of_issue'] ?? '');
        $o->ExpiryDate          = $row['expiry_date'] ?? '';
        $o->LicenseTypeId       = $row['type_of_dl'] ?? '';
        $o->FirstIDL            = ((string) ($row['first_idl'] ?? '0')) === '1' ? 'Y' : 'N';
        $o->Name                = trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? ''));
        $o->NationalityId       = (string) ($row['nationality'] ?? '');
        $o->UAEAddress          = $row['address_in_uae'] ?? '';
        $o->POBox               = $row['po_box'] ?? '';
        $o->Email               = $row['email'] ?? '';
        $o->HomeAddress         = $row['home_country_address'] ?? '';
        $o->DeliveryLicense     = ($row['delivery_option'] ?? '') === 'send_to_address' ? 'True' : 'False';

        $photoPath = RTA_IDL_FILES_PATH . "/{$row['auto_id']}/passport.jpg";
        $o->PassportPhoto = RtaRepository::loadImageAsBase64($photoPath);

        return $o;
    }

    private static function splitName(string $name): array
    {
        $parts = preg_split('/\s+/', trim($name), 2);
        return [$parts[0] ?? '', $parts[1] ?? ''];
    }
}
