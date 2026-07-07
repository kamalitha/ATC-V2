<?php
declare(strict_types=1);

// ── MOI Repository — All SQL isolated here ────────────────────────────────────
// No SQL exists outside this file. All queries use named/positional PDO bindings.

final class MoiRepository
{
    // ── IDL ───────────────────────────────────────────────────────────────────

    public static function getUnpaidIDLByEmiratesId(string $emiratesId): ?array
    {
        return MoiDB::row(
            "SELECT r.auto_id, r.request_id
             FROM mn_idl_requests r
             JOIN mn_idl_request_user u ON u.request_auto_id = r.auto_id
             WHERE REPLACE(u.emirates_id, '-', '') = ?
               AND r.paid_status = 0
               AND r.is_active = 1
             ORDER BY r.auto_id DESC LIMIT 1",
            [$emiratesId],
        );
    }

    public static function getAllIDLByEmiratesId(string $emiratesId): array
    {
        return MoiDB::all(
            "SELECT r.auto_id, r.request_id, r.request_status, r.paid_status,
                    r.processed_by, r.booking_channel, r.delivery_option,
                    r.air_bill_no, r.issued_date, r.belonging_user_id,
                    u.first_name, u.last_name, u.email, u.mobile_no,
                    u.dob, u.place_of_birth, u.place_of_issue, u.expiry_date,
                    u.type_of_dl, u.first_idl, u.license_no, u.nationality,
                    u.address_in_uae, u.po_box, u.home_country_address,
                    u.emirates_id,
                    e.emirate
             FROM mn_idl_requests r
             JOIN mn_idl_request_user u ON u.request_auto_id = r.auto_id
             LEFT JOIN mn_emirates e    ON e.emirate_id       = u.emirate
             WHERE REPLACE(u.emirates_id, '-', '') = ?
               AND r.is_active = 1
             ORDER BY r.auto_id DESC",
            [$emiratesId],
        );
    }

    public static function getIDLByEmiratesIdAndAutoId(string $emiratesId, string $autoId): ?array
    {
        return MoiDB::row(
            "SELECT r.auto_id, r.request_id, r.request_status, r.paid_status,
                    r.processed_by, r.booking_channel, r.delivery_option,
                    r.air_bill_no, r.issued_date, r.belonging_user_id,
                    u.first_name, u.last_name, u.email, u.mobile_no,
                    u.dob, u.place_of_birth, u.place_of_issue, u.expiry_date,
                    u.type_of_dl, u.first_idl, u.license_no, u.nationality,
                    u.address_in_uae, u.po_box, u.home_country_address,
                    u.emirates_id,
                    e.emirate
             FROM mn_idl_requests r
             JOIN mn_idl_request_user u ON u.request_auto_id = r.auto_id
             LEFT JOIN mn_emirates e    ON e.emirate_id       = u.emirate
             WHERE REPLACE(u.emirates_id, '-', '') = ?
               AND r.auto_id = ?
               AND r.is_active = 1",
            [$emiratesId, $autoId],
        );
    }

    public static function getIDLByAutoId(string $autoId): ?array
    {
        return MoiDB::row(
            "SELECT r.auto_id, r.request_id, r.request_status, r.request_type,
                    r.paid_status, r.idl_no, r.issued_date, r.print_hash,
                    r.belonging_user_id,
                    u.first_name, u.last_name, u.sex, u.dob, u.place_of_birth,
                    u.nationality, u.license_no, u.type_of_dl,
                    e.emirate AS city
             FROM mn_idl_requests r
             JOIN mn_idl_request_user u ON u.request_auto_id = r.auto_id
             LEFT JOIN mn_emirates e    ON e.emirate_id       = u.emirate
             WHERE r.auto_id = ? AND r.is_active = 1",
            [$autoId],
        );
    }

    public static function getIDLByAutoIdForDelete(string $autoId): ?array
    {
        return MoiDB::row(
            "SELECT r.auto_id, r.request_id, r.request_status
             FROM mn_idl_requests r
             WHERE r.auto_id = ? AND r.is_active = 1",
            [$autoId],
        );
    }

    public static function deleteIDLRequest(string $autoId): int
    {
        return MoiDB::execute(
            "UPDATE mn_idl_requests SET is_active = 0 WHERE auto_id = ?",
            [$autoId],
        );
    }

    public static function createIDLRequest(array $p): string
    {
        $seq       = (int) MoiDB::scalar('SELECT COUNT(*)+1 FROM mn_idl_requests');
        $requestId = sprintf('IDL-ATC-%s/%d', date('Ymd'), $seq);

        MoiDB::beginTransaction();
        try {
            // Find or create user
            $userId = self::findOrCreateUser($p);

            $autoId = MoiDB::insert(
                "INSERT INTO mn_idl_requests
                 (request_id, request_type, belonging_user_id, paid_status,
                  delivery_option, travel_insurance, total_amount,
                  requested_datetime, request_status, booking_channel, is_active)
                 VALUES (?, 'MOI', ?, 0, ?, 0, 178.50, NOW(), 1, ?, 1)",
                [
                    $requestId,
                    $userId,
                    ($p['DeliveryLicense'] === '1' || $p['DeliveryLicense'] === 'true')
                        ? 'send_to_address' : 'pick_from_office',
                    $p['Channel'] ?? 'MOBILE',
                ],
            );

            MoiDB::execute(
                "INSERT INTO mn_idl_request_user
                 (request_auto_id, user_id, first_name, last_name, email, mobile_no,
                  dob, nationality, sex, emirates_id, address_in_uae, po_box,
                  home_country_address, license_no, place_of_birth, place_of_issue,
                  issued_date, expiry_date, type_of_dl, emirate, first_idl,
                  registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
                [
                    $autoId, $userId,
                    $p['FirstName'], $p['LastName'], $p['Email'], $p['Mobile'],
                    date('Y-m-d', strtotime($p['BirthDate'])),
                    $p['NationalityId'], $p['Sex'], $p['EmiratesID'],
                    $p['UAEAddress'], $p['POBox'], $p['HomeAddress'],
                    $p['LicenseNumber'], $p['BirthPlace'], $p['IssuePlace'],
                    date('Y-m-d', strtotime($p['IssueDate'])),
                    date('Y-m-d', strtotime($p['ExpiryDate'])),
                    '0', $p['EmirateId'], $p['FirstIDL'] ?? '0',
                ],
            );

            // Save images
            self::saveBase64Image($p['DrivingLicenseFront'] ?? '', MOI_IDL_FILES_PATH . "/{$autoId}/dl_front.jpg");
            self::saveBase64Image($p['DrivingLicenseBack']  ?? '', MOI_IDL_FILES_PATH . "/{$autoId}/dl_back.jpg");
            self::saveBase64Image($p['PassportPhoto']       ?? '', MOI_IDL_FILES_PATH . "/{$autoId}/passport.jpg");

            MoiDB::commit();
            return $autoId;
        } catch (\Throwable $e) {
            MoiDB::rollback();
            throw $e;
        }
    }

    public static function updateIDLField(string $autoId, string $field, string $value): void
    {
        // Whitelist allowed fields to prevent SQL injection
        $allowed = ['paid_status','paid_date','request_status','order_ref_no','print_hash','idl_no','issued_date'];
        if (!in_array($field, $allowed, true)) {
            throw new \InvalidArgumentException("Field '$field' is not updatable via MOI service");
        }
        MoiDB::execute(
            "UPDATE mn_idl_requests SET `{$field}` = ? WHERE auto_id = ?",
            [$value, $autoId],
        );
    }

    // ── CPD ───────────────────────────────────────────────────────────────────

    public static function getActiveCPDByRegistrationNo(string $regNo): ?array
    {
        return MoiDB::row(
            "SELECT r.auto_id, r.request_id
             FROM mn_cpd_requests r
             WHERE r.registration_no = ?
               AND r.request_status NOT IN (5, 6)
             ORDER BY r.auto_id DESC LIMIT 1",
            [$regNo],
        );
    }

    public static function getAllCPDByEmiratesId(string $emiratesId): array
    {
        return MoiDB::all(
            "SELECT r.*, u.first_name, u.last_name, u.email, u.mobile_no,
                    u.nationality_id, u.city, u.dob, u.home_country_address,
                    u.uae_address, u.company_name, u.po_box, u.passport_no,
                    u.emirates_id,
                    n.nationality,
                    s.status,
                    r.airway_bill_no
             FROM mn_cpd_requests r
             JOIN mn_cpd_request_user u  ON u.request_auto_id    = r.auto_id
             JOIN mn_users mu            ON mu.user_id            = r.belonging_user_id
             LEFT JOIN mn_nationalities n ON n.nationality_id     = u.nationality_id
             JOIN mn_cpd_statuses s      ON s.carnet_status_id    = r.request_status
             WHERE u.emirates_id = ?
             ORDER BY r.auto_id DESC",
            [$emiratesId],
        );
    }

    public static function getSingleCPDByRequestId(string $requestId): ?array
    {
        return MoiDB::row(
            "SELECT r.*, u.first_name, u.last_name, u.email, u.mobile_no,
                    u.nationality_id, u.city, u.dob, u.home_country_address,
                    u.uae_address, u.company_name, u.po_box, u.passport_no,
                    u.emirates_id,
                    n.nationality,
                    s.status,
                    r.airway_bill_no
             FROM mn_cpd_requests r
             JOIN mn_cpd_request_user u  ON u.request_auto_id    = r.auto_id
             LEFT JOIN mn_nationalities n ON n.nationality_id     = u.nationality_id
             JOIN mn_cpd_statuses s      ON s.carnet_status_id    = r.request_status
             WHERE r.request_id = ?",
            [$requestId],
        );
    }

    public static function getCPDByAutoId(string $autoId): ?array
    {
        return MoiDB::row(
            "SELECT r.auto_id, r.request_id, r.request_status, r.request_type,
                    r.booking_fee_status, r.cheque_no
             FROM mn_cpd_requests r WHERE r.auto_id = ?",
            [$autoId],
        );
    }

    public static function getCPDByAutoIdAndEmiratesId(string $autoId, string $emiratesId): ?array
    {
        return MoiDB::row(
            "SELECT r.auto_id, r.request_id, r.request_status, r.request_type
             FROM mn_cpd_requests r
             JOIN mn_cpd_request_user u ON u.request_auto_id = r.auto_id
             WHERE r.auto_id = ? AND u.emirates_id = ?",
            [$autoId, $emiratesId],
        );
    }

    public static function getCPDByApplicationId(string $appId): ?array
    {
        return MoiDB::row(
            "SELECT r.auto_id, r.request_id, r.request_type, r.request_status,
                    r.booking_fee_status, r.cheque_no
             FROM mn_cpd_requests r WHERE r.request_id = ?",
            [$appId],
        );
    }

    public static function createCPDRequest(array $p): string
    {
        $seq       = (int) MoiDB::scalar('SELECT COUNT(*)+1 FROM mn_cpd_requests');
        $requestId = sprintf('CPD-ATC-%s/%d', date('Ymd'), $seq);

        MoiDB::beginTransaction();
        try {
            $userId = self::findOrCreateUser([
                'Email'         => $p['OwnerEmail'],
                'FirstName'     => $p['OwnerFirstName'],
                'LastName'      => $p['OwnerLastName'],
                'Mobile'        => $p['OwnerPhoneNo'],
                'EmiratesID'    => $p['OwnerEmiratesID'],
                'NationalityId' => $p['OwnerNationality'],
            ]);

            $autoId = MoiDB::insert(
                "INSERT INTO mn_cpd_requests
                 (request_id, request_type, belonging_user_id,
                  vehicle_make, vehicle_model, registration_no, mulkiya_no,
                  chassis_no, engine_no, manuf_year, color, body_type,
                  no_of_cylinders, no_of_seats, horse_power, net_weight,
                  extra_owner1_name, extra_owner2_name,
                  guarantee_amount, booking_channel, request_status,
                  information_verified, requested_datetime)
                 VALUES (?, 'MOI', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NOW())",
                [
                    $requestId, $userId,
                    $p['VehicleMake'], $p['VehicleModel'], $p['RegistrationNo'],
                    $p['MulkiyaNo'], $p['ChassisNo'], $p['EngineNo'],
                    $p['ManufacturingYear'], $p['Color'], $p['BodyType'],
                    $p['NoOfCylinders'], $p['NoOfSeats'], $p['HorsePower'],
                    $p['Weight'], $p['ExtraOwner1'] ?? '', $p['ExtraOwner2'] ?? '',
                    $p['GuaranteeAmount'] ?? 0,
                    $p['Channel'] ?? 'MOI', 1,
                ],
            );

            MoiDB::execute(
                "INSERT INTO mn_cpd_request_user
                 (request_auto_id, user_id, first_name, last_name, email, mobile_no,
                  nationality_id, city, dob, uae_address, po_box, license_no,
                  emirates_id, registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
                [
                    $autoId, $userId,
                    $p['OwnerFirstName'], $p['OwnerLastName'], $p['OwnerEmail'],
                    $p['OwnerPhoneNo'], $p['OwnerNationality'], $p['OwnerCity'],
                    $p['OwnerDOB'] ?? null, $p['OwnerAddressInUAE'],
                    $p['OwnerPOBox'], $p['OwnerLIcenseNo'], $p['OwnerEmiratesID'],
                ],
            );

            // Country list
            foreach (explode(',', $p['CountryList'] ?? '') as $cid) {
                $cid = trim($cid);
                if ($cid !== '') {
                    MoiDB::execute(
                        'INSERT INTO mn_cpd_request_country_list (request_id, country_id) VALUES (?,?)',
                        [$autoId, (int) $cid],
                    );
                }
            }

            // Images
            $imgBase = MOI_CPD_FILES_PATH . "/{$autoId}";
            self::saveBase64Image($p['MulkiyaFrontImage'] ?? '', "{$imgBase}/cpd_mulkiya_front.jpg");
            self::saveBase64Image($p['MulkiyaBackImage']  ?? '', "{$imgBase}/cpd_mulkiya_back.jpg");
            self::saveBase64Image($p['DLFrontImage']      ?? '', "{$imgBase}/cpd_emirates_id_front.jpg");
            self::saveBase64Image($p['DLBackImage']       ?? '', "{$imgBase}/cpd_emirates_id_back.jpg");

            MoiDB::commit();
            return $autoId;
        } catch (\Throwable $e) {
            MoiDB::rollback();
            throw $e;
        }
    }

    public static function updateCPDPaymentStatus(string $autoId, string $bookingFee, string $payRef, string $guaranteeAmount): void
    {
        date_default_timezone_set(MOI_TIMEZONE);
        MoiDB::execute(
            "UPDATE mn_cpd_requests
             SET booking_fee_status = 1, booking_fee_paid_by = 'MOI',
                 booking_fee_paid_date = NOW(), order_ref_no = ?,
                 guarantee_amount = ?, request_status = 2
             WHERE auto_id = ?",
            [$payRef, $guaranteeAmount, $autoId],
        );
    }

    public static function cancelCPDRequest(string $autoId): void
    {
        MoiDB::execute(
            "UPDATE mn_cpd_requests SET request_status = 6 WHERE auto_id = ?",
            [$autoId],
        );
    }

    public static function saveGuaranteeDepositSlip(string $autoId, string $base64Image): void
    {
        $dir = MOI_CPD_FILES_PATH . "/{$autoId}";
        self::saveBase64Image($base64Image, "{$dir}/guarantee_deposit_slip.jpg");
    }

    public static function getExternalGuaranteeDetails(string $autoId): ?array
    {
        return MoiDB::row(
            "SELECT ext_guarantee_auto_id, information_verified
             FROM mn_cpd_external_guarantee
             WHERE request_auto_id = ? ORDER BY ext_guarantee_auto_id DESC LIMIT 1",
            [$autoId],
        );
    }

    public static function insertExternalGuaranteeDetails(string $autoId, string $paymentRef): void
    {
        MoiDB::execute(
            "INSERT INTO mn_cpd_external_guarantee (request_auto_id, payment_ref, created_at)
             VALUES (?, ?, NOW())",
            [$autoId, $paymentRef],
        );
    }

    public static function saveGuaranteeVerificationDoc(string $autoId, string $base64Image): void
    {
        $dir = MOI_CPD_FILES_PATH . "/{$autoId}";
        self::saveBase64Image($base64Image, "{$dir}/payment_verification.jpg");
    }

    public static function getCountriesForRequest(string $autoId): array
    {
        return MoiDB::all(
            "SELECT country_id AS nationality_id FROM mn_cpd_request_country_list WHERE request_id = ?",
            [$autoId],
        );
    }

    // ── Lookups ───────────────────────────────────────────────────────────────

    public static function getAllEmirates(): array
    {
        return MoiDB::all('SELECT emirate_id, emirate FROM mn_emirates ORDER BY emirate_id');
    }

    public static function getAllLicenseTypes(): array
    {
        return MoiDB::all('SELECT type_id, dl_type FROM mn_dl_types ORDER BY type_id');
    }

    public static function getAllNationalities(): array
    {
        return MoiDB::all('SELECT nationality_id, nationality FROM mn_nationalities ORDER BY nationality_id');
    }

    public static function getAllIDLStatuses(): array
    {
        return MoiDB::all('SELECT status_id, status FROM mn_idl_status ORDER BY status_id');
    }

    public static function getAllCPDStatuses(): array
    {
        return MoiDB::all('SELECT carnet_status_id, status FROM mn_cpd_statuses ORDER BY carnet_status_id');
    }

    public static function getAllCPDCountries(): array
    {
        return MoiDB::all(
            'SELECT nationality_id, nationality FROM mn_nationalities ORDER BY nationality',
        );
    }

    public static function getAllCPDVehicleTypes(): array
    {
        return MoiDB::all('SELECT vehicle_type FROM mn_cpd_vehicle_types ORDER BY vehicle_type');
    }

    public static function getVATPercentage(): float
    {
        $row = MoiDB::row('SELECT tax_percentage FROM mn_tax_rates WHERE is_active = 1 LIMIT 1');
        return (float) ($row['tax_percentage'] ?? 5.0);
    }

    public static function getBookingFeeForCountries(array $countryIds, string $vehicleType, string $year): array
    {
        // Booking fee: find rows matching country_list CSV
        $placeholders = implode(',', array_fill(0, count($countryIds), '?'));
        $row = MoiDB::row(
            "SELECT booking_fee FROM mn_cpd_booking_fees
             WHERE FIND_IN_SET(?, country_list)
             LIMIT 1",
            [$countryIds[0] ?? 0],
        );
        return ['booking_fee' => (float) ($row['booking_fee'] ?? 0)];
    }

    public static function updateIDLPrintHash(string $autoId, string $hash): void
    {
        MoiDB::execute(
            'UPDATE mn_idl_requests SET print_hash = ? WHERE auto_id = ?',
            [$hash, $autoId],
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static function findOrCreateUser(array $p): string
    {
        $eid  = preg_replace('/\D/', '', $p['EmiratesID'] ?? '');
        $existing = MoiDB::row(
            'SELECT user_id FROM mn_users WHERE REPLACE(emirates_id, \'-\', \'\') = ? LIMIT 1',
            [$eid],
        );
        if ($existing) return (string) $existing['user_id'];

        return MoiDB::insert(
            "INSERT INTO mn_users (email, first_name, last_name, mobile_no, emirates_id,
              nationality, user_type, is_active, registered_date)
             VALUES (?, ?, ?, ?, ?, ?, 2, 1, CURDATE())",
            [
                $p['Email']         ?? '',
                $p['FirstName']     ?? '',
                $p['LastName']      ?? '',
                $p['Mobile']        ?? '',
                $p['EmiratesID']    ?? '',
                $p['NationalityId'] ?? null,
            ],
        );
    }

    public static function saveBase64Image(string $base64, string $targetPath): void
    {
        if ($base64 === '') return;
        $dir = dirname($targetPath);
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        $data = base64_decode(preg_replace('/^data:image\/\w+;base64,/', '', $base64));
        if ($data !== false) file_put_contents($targetPath, $data);
    }

    public static function loadImageAsBase64(string $path): string
    {
        if (file_exists($path) && is_file($path)) {
            return base64_encode(file_get_contents($path));
        }
        return '';
    }

    public static function findGuaranteeDepositSlip(string $autoId): string
    {
        $base = MOI_CPD_FILES_PATH . "/{$autoId}/guarantee_deposit_slip";
        foreach (['.jpg', '.png', '.jpeg'] as $ext) {
            if (file_exists($base . $ext)) return self::loadImageAsBase64($base . $ext);
        }
        return '';
    }
}
