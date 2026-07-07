<?php
declare(strict_types=1);

// ── RTA Repository — All SQL isolated here ────────────────────────────────────
// No SQL exists outside this file. All queries use positional PDO bindings.
//
// NOTE ON FILE STORAGE: RTA_IDL_FILES_PATH / RTA_CPD_FILES_PATH point at the same
// physical folders the staff portal reads from (api/appointment-requests[/cpd]),
// so documents submitted through this SOAP service show up in the officer UI.

final class RtaRepository
{
    // ── IDL ───────────────────────────────────────────────────────────────────

    public static function getUnpaidIDLByEmiratesId(string $emiratesId): ?array
    {
        return RtaDB::row(
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

    public static function getLatestIDLByEmiratesId(string $emiratesId): ?array
    {
        return RtaDB::row(
            "SELECT r.auto_id, r.request_id, r.request_status, r.request_type, r.paid_status,
                    r.processed_by, r.booking_channel, r.delivery_option,
                    r.belonging_user_id,
                    u.first_name, u.last_name, mu.email, mu.mobile_no,
                    u.dob, u.place_of_birth, u.place_of_issue, u.expiry_date,
                    u.type_of_dl, u.first_idl, u.license_no, u.nationality,
                    u.address_in_uae, u.po_box, u.home_country_address,
                    u.emirates_id, r.issued_date
             FROM mn_idl_requests r
             JOIN mn_idl_request_user u ON u.request_auto_id = r.auto_id
             JOIN mn_users mu           ON mu.user_id         = r.belonging_user_id
             WHERE REPLACE(u.emirates_id, '-', '') = ?
               AND r.is_active = 1
             ORDER BY r.auto_id DESC LIMIT 1",
            [$emiratesId],
        );
    }

    public static function getIDLByAutoIdForDelete(string $autoId): ?array
    {
        return RtaDB::row(
            "SELECT r.auto_id, r.request_id, r.request_status
             FROM mn_idl_requests r
             WHERE r.auto_id = ? AND r.is_active = 1",
            [$autoId],
        );
    }

    public static function deleteIDLRequest(string $autoId): int
    {
        return RtaDB::execute(
            "UPDATE mn_idl_requests SET is_active = 0 WHERE auto_id = ?",
            [$autoId],
        );
    }

    /** @return array{auto_id: string, request_id: string} */
    public static function createIDLRequest(array $p): array
    {
        RtaDB::beginTransaction();
        try {
            $userId = self::findOrCreateUser(
                emiratesId: $p['EmiratesID'] ?? '',
                firstName:  $p['_first_name'] ?? '',
                lastName:   $p['_last_name']  ?? '',
                email:      $p['Email']  ?? '',
                mobile:     $p['Mobile'] ?? '',
            );

            // Placeholder request_id — replaced below once auto_id is known, so the
            // label returned to the caller always matches what's actually stored
            // (a COUNT(*)-based sequence, like MOI uses, can drift from auto_id and
            // silently break any later lookup-by-ApplicationID call).
            $autoId = RtaDB::insert(
                "INSERT INTO mn_idl_requests
                 (request_id, request_type, belonging_user_id, paid_status,
                  delivery_option, travel_insurance, total_amount,
                  requested_datetime, request_status, booking_channel, is_active)
                 VALUES ('', 'RTA', ?, 0, ?, 0, 178.50, NOW(), 1, 'RTA', 1)",
                [
                    $userId,
                    ($p['DeliveryLicense'] === '1' || strtolower((string)$p['DeliveryLicense']) === 'true')
                        ? 'send_to_address' : 'pick_from_office',
                ],
            );

            $requestId = sprintf('IDL-RTA-%s/%d', date('Ymd'), $autoId);
            RtaDB::execute('UPDATE mn_idl_requests SET request_id = ? WHERE auto_id = ?', [$requestId, $autoId]);

            $acceptEmail = ($p['AcceptEmail'] === '1' || strtolower((string)$p['AcceptEmail']) === 'true') ? 1 : 0;

            RtaDB::execute(
                "INSERT INTO mn_idl_request_user
                 (request_auto_id, user_id, first_name, last_name,
                  dob, nationality, sex, emirates_id, address_in_uae, po_box,
                  home_country_address, license_no, place_of_birth, place_of_issue,
                  issued_date, expiry_date, type_of_dl, emirate, first_idl,
                  subscribe_to_newsletter, registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())",
                [
                    $autoId, $userId,
                    $p['_first_name'], $p['_last_name'],
                    self::toSqlDate($p['BirthDate'] ?? ''),
                    $p['NationalityId'] ?: null, $p['Sex'], $p['EmiratesID'],
                    $p['UAEAddress'], $p['POBox'], $p['HomeAddress'],
                    $p['LicenseNumber'], $p['BirthPlace'], $p['IssuePlace'] ?: null,
                    self::toSqlDate($p['IssueDate'] ?? ''),
                    self::toSqlDate($p['ExpiryDate'] ?? ''),
                    $p['LicenseTypeId'], $p['EmirateId'] ?: null, $p['FirstIDL'] ?: '0',
                    $acceptEmail,
                ],
            );

            self::saveBase64Image($p['DrivingLicenseFront'] ?? '', RTA_IDL_FILES_PATH . "/{$autoId}/dl_front.jpg");
            self::saveBase64Image($p['DrivingLicenseBack']  ?? '', RTA_IDL_FILES_PATH . "/{$autoId}/dl_back.jpg");
            self::saveBase64Image($p['PassportPhoto']       ?? '', RTA_IDL_FILES_PATH . "/{$autoId}/passport.jpg");

            RtaDB::commit();
            return ['auto_id' => $autoId, 'request_id' => $requestId];
        } catch (\Throwable $e) {
            RtaDB::rollback();
            throw $e;
        }
    }

    public static function updateIDLField(string $autoId, string $field, string $value): void
    {
        // Whitelist allowed fields to prevent SQL injection
        $allowed = ['paid_status', 'paid_date', 'request_status', 'order_ref_no'];
        if (!in_array($field, $allowed, true)) {
            throw new \InvalidArgumentException("Field '$field' is not updatable via RTA service");
        }
        RtaDB::execute(
            "UPDATE mn_idl_requests SET `{$field}` = ? WHERE auto_id = ?",
            [$value, $autoId],
        );
    }

    public static function getIDLForPrint(string $requestId, string $emiratesId): ?array
    {
        return RtaDB::row(
            "SELECT r.auto_id, r.request_id, r.request_type, r.belonging_user_id,
                    u.first_name, u.last_name, u.emirates_id
             FROM mn_idl_requests r
             JOIN mn_idl_request_user u ON u.request_auto_id = r.auto_id
             WHERE r.request_id = ?
               AND REPLACE(u.emirates_id, '-', '') = ?
               AND r.is_active = 1
             LIMIT 1",
            [$requestId, $emiratesId],
        );
    }

    // ── CPD ───────────────────────────────────────────────────────────────────

    public static function getActiveCPDByMulkiyaNo(string $mulkiyaNo): ?array
    {
        return RtaDB::row(
            "SELECT r.auto_id, r.request_id
             FROM mn_cpd_requests r
             WHERE r.mulkiya_no = ?
               AND r.request_status NOT IN (5, 6)
             ORDER BY r.auto_id DESC LIMIT 1",
            [$mulkiyaNo],
        );
    }

    /** @return array{auto_id: string, request_id: string} */
    public static function createCPDRequest(array $p): array
    {
        RtaDB::beginTransaction();
        try {
            $userId = self::findOrCreateUser(
                emiratesId: $p['OwnerEmiratesID'] ?? '',
                firstName:  $p['OwnerFirstName']  ?? '',
                lastName:   $p['OwnerLastName']   ?? '',
                email:      $p['OwnerEmail']      ?? '',
                mobile:     $p['OwnerPhoneNo']    ?? '',
            );

            // Placeholder request_id — replaced below once auto_id is known (see
            // the identical comment in createIDLRequest for why).
            $autoId = RtaDB::insert(
                "INSERT INTO mn_cpd_requests
                 (request_id, request_type, belonging_user_id,
                  vehicle_make, mulkiya_no,
                  chassis_no, engine_no, manuf_year, color, body_type,
                  no_of_cylinders, no_of_seats, horse_power, net_weight,
                  guarantee_amount, booking_channel, request_status,
                  information_verified, requested_datetime)
                 VALUES ('', 'RTA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RTA', 1, 0, NOW())",
                [
                    $userId,
                    $p['VehicleMake'], $p['MulkiyaNo'], $p['ChassisNo'], $p['EngineNo'],
                    $p['ManufacturingYear'] ?: null, $p['Color'], $p['BodyType'],
                    $p['NoOfCylinders'], $p['NoOfSeats'], $p['HorsePower'],
                    $p['Weight'], $p['GuaranteeAmount'] ?: 0,
                ],
            );

            $requestId = sprintf('CPD-RTA-%s/%d', date('Ymd'), $autoId);
            RtaDB::execute('UPDATE mn_cpd_requests SET request_id = ? WHERE auto_id = ?', [$requestId, $autoId]);

            RtaDB::execute(
                "INSERT INTO mn_cpd_request_user
                 (request_auto_id, user_id, first_name, last_name,
                  nationality_id, city, dob, uae_address, po_box, emirates_id,
                  registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,CURDATE())",
                [
                    $autoId, $userId,
                    $p['OwnerFirstName'], $p['OwnerLastName'],
                    $p['OwnerNationality'] ?: null, $p['OwnerCity'],
                    self::toSqlDate($p['OwnerDOB'] ?? '') ?: null, $p['OwnerAddressInUAE'],
                    $p['OwnerPOBox'], $p['OwnerEmiratesID'],
                ],
            );

            foreach (explode(',', $p['CountryList'] ?? '') as $cid) {
                $cid = trim($cid);
                if ($cid !== '') {
                    RtaDB::execute(
                        'INSERT INTO mn_cpd_request_country_list (request_id, country_id) VALUES (?,?)',
                        [$autoId, (int) $cid],
                    );
                }
            }

            $imgBase = RTA_CPD_FILES_PATH . "/{$autoId}";
            self::saveBase64Image($p['MulkiyaFrontImage'] ?? '', "{$imgBase}/cpd_mulkiya_front.jpg");
            self::saveBase64Image($p['MulkiyaBackImage']  ?? '', "{$imgBase}/cpd_mulkiya_back.jpg");
            self::saveBase64Image($p['DLFrontImage']      ?? '', "{$imgBase}/cpd_emirates_id_front.jpg");
            self::saveBase64Image($p['DLBackImage']       ?? '', "{$imgBase}/cpd_emirates_id_back.jpg");

            RtaDB::commit();
            return ['auto_id' => $autoId, 'request_id' => $requestId];
        } catch (\Throwable $e) {
            RtaDB::rollback();
            throw $e;
        }
    }

    public static function getCPDByApplicationId(string $appId): ?array
    {
        return RtaDB::row(
            "SELECT r.auto_id, r.request_id, r.request_type, r.request_status, r.booking_fee_status
             FROM mn_cpd_requests r WHERE r.request_id = ?",
            [$appId],
        );
    }

    public static function updateCPDPaymentStatus(string $autoId, string $bookingFee, string $payRef): void
    {
        date_default_timezone_set(RTA_TIMEZONE);
        RtaDB::execute(
            "UPDATE mn_cpd_requests
             SET booking_fee_status = 1, booking_fee_paid_by = 'RTA',
                 booking_fee_paid_date = NOW(), order_ref_no = ?,
                 booking_fee = ?, request_status = 2
             WHERE auto_id = ?",
            [$payRef, $bookingFee, $autoId],
        );
    }

    // ── Lookups ───────────────────────────────────────────────────────────────

    public static function getAllEmirates(): array
    {
        return RtaDB::all('SELECT emirate_id, emirate FROM mn_emirates ORDER BY emirate_id');
    }

    public static function getAllLicenseTypes(): array
    {
        return RtaDB::all('SELECT type_id, dl_type FROM mn_idl_dl_types ORDER BY type_id');
    }

    public static function getAllNationalities(): array
    {
        return RtaDB::all('SELECT nationality_id, nationality FROM mn_nationalities ORDER BY nationality_id');
    }

    public static function getAllCPDCountries(): array
    {
        return RtaDB::all('SELECT nationality_id, nationality FROM mn_nationalities ORDER BY nationality');
    }

    public static function getAllCPDVehicleTypes(): array
    {
        return RtaDB::all('SELECT vehicle_type FROM mn_cpd_vehicle_types ORDER BY vehicle_type');
    }

    public static function getBookingFeeForCountries(array $countryIds): array
    {
        if (empty($countryIds)) return ['booking_fee' => 0];
        $row = RtaDB::row(
            "SELECT booking_fee FROM mn_cpd_booking_fees
             WHERE FIND_IN_SET(?, country_list)
             LIMIT 1",
            [$countryIds[0]],
        );
        return ['booking_fee' => (float) ($row['booking_fee'] ?? 0)];
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * mn_users has no emirates_id/nationality columns — dedupe instead via the
     * request-user tables (the same approach api/controllers/IDLController.php
     * uses), and fall back to creating a bare mn_users row (user_type=2, public).
     */
    private static function findOrCreateUser(string $emiratesId, string $firstName, string $lastName, string $email, string $mobile): string
    {
        $eid = preg_replace('/\D/', '', $emiratesId);

        if ($eid !== '') {
            $existing = RtaDB::row(
                "SELECT user_id FROM mn_idl_request_user
                 WHERE REPLACE(emirates_id, '-', '') = ? AND user_id IS NOT NULL
                 ORDER BY registered_date DESC LIMIT 1",
                [$eid],
            ) ?? RtaDB::row(
                "SELECT user_id FROM mn_cpd_request_user
                 WHERE REPLACE(emirates_id, '-', '') = ? AND user_id IS NOT NULL
                 ORDER BY registered_date DESC LIMIT 1",
                [$eid],
            );
            if ($existing && $existing['user_id']) return (string) $existing['user_id'];
        }

        return RtaDB::insert(
            "INSERT INTO mn_users (first_name, last_name, email, mobile_no, user_type, date_created, is_active)
             VALUES (?, ?, ?, ?, 2, CURDATE(), 1)",
            [$firstName, $lastName, $email, $mobile],
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

    /** Converts an arbitrary incoming date string to Y-m-d, or '' if unparsable. */
    public static function toSqlDate(string $value): string
    {
        if ($value === '') return '';
        $ts = strtotime($value);
        return $ts === false ? '' : date('Y-m-d', $ts);
    }
}
