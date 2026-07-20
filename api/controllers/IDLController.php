<?php
declare(strict_types=1);

class IDLController
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * GET /api/idl/requests/{id}/documents
     * Returns the filenames of any previously uploaded documents for this request.
     */
    public function getDocuments(array $params, array $body, array $query): void
    {
        $autoId  = (int)$params['id'];
        $dir     = API_ROOT . DIRECTORY_SEPARATOR . Config::UPLOADS_DIR . DIRECTORY_SEPARATOR . $autoId;

        // Maps output filename stem → JS input slot key
        $stemToSlot = [
            'dl_front'    => 'dl_front',
            'dl_back'     => 'dl_back',
            'em_id_front' => 'eid_front',
            'em_id_back'  => 'eid_back',
            'passport'    => 'passport_photo',
            'signature'   => 'signature',
        ];

        $docs = [];
        if (is_dir($dir)) {
            foreach ($stemToSlot as $stem => $slot) {
                foreach (['jpg', 'png'] as $ext) {
                    $file = $dir . DIRECTORY_SEPARATOR . $stem . '.' . $ext;
                    if (file_exists($file)) {
                        // Return a URL the browser can fetch via the documents/serve endpoint
                        $docs[$slot] = "/api/idl/requests/{$autoId}/documents/{$stem}.{$ext}";
                        break;
                    }
                }
            }
        }

        Response::success($docs);
    }

    /**
     * GET /api/idl/requests/{id}/documents/{filename}
     * Serves a single uploaded document image.
     */
    public function serveDocument(array $params, array $body, array $query): void
    {
        $autoId   = (int)$params['id'];
        $filename = basename($params['filename'] ?? '');   // prevent path traversal

        // Only allow known stems with jpg/png extensions
        if (!preg_match('/^(dl_front|dl_back|em_id_front|em_id_back|passport|signature)\.(jpg|png)$/', $filename)) {
            Response::notFound('Document not found');
        }

        $filePath = API_ROOT . DIRECTORY_SEPARATOR
                  . Config::UPLOADS_DIR . DIRECTORY_SEPARATOR
                  . $autoId . DIRECTORY_SEPARATOR
                  . $filename;

        if (!file_exists($filePath)) {
            Response::notFound('Document not found');
        }

        $ext      = pathinfo($filename, PATHINFO_EXTENSION);
        $mimeType = $ext === 'png' ? 'image/png' : 'image/jpeg';

        header('Content-Type: ' . $mimeType);
        header('Content-Length: ' . filesize($filePath));
        header('Cache-Control: private, max-age=3600');
        readfile($filePath);
        exit;
    }

    // ── Document uploads ──────────────────────────────────────────────────────

    /**
     * POST /api/idl/requests/{id}/documents
     *
     * Accepts multipart/form-data with up to 6 image files.
     * Files are validated (jpg/png, max 2 MB), then written to:
     *   {API_ROOT}/appointment-requests/{auto_id}/{slot}.{ext}
     *
     * Slot names: dl_front, dl_back, em_id_front, em_id_back, passport, signature
     */
    public function uploadDocuments(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];

        // Verify request exists
        $exists = $this->db->scalar('SELECT COUNT(*) FROM mn_idl_requests WHERE auto_id=?', [$autoId]);
        if (!$exists) Response::notFound('IDL request not found');

        // Slot → final filename stem mapping (matches data-doc keys in JS)
        $slotMap = [
            'dl_front'      => 'dl_front',
            'dl_back'       => 'dl_back',
            'eid_front'     => 'em_id_front',
            'eid_back'      => 'em_id_back',
            'passport_photo'=> 'passport',
            'signature'     => 'signature',
        ];
        $allowedMimes = ['image/jpeg' => 'jpg', 'image/png' => 'png'];
        $maxBytes     = Config::UPLOAD_MAX_BYTES;

        $destDir = API_ROOT . DIRECTORY_SEPARATOR
                 . Config::UPLOADS_DIR . DIRECTORY_SEPARATOR
                 . $autoId;

        if (!is_dir($destDir)) {
            mkdir($destDir, 0755, recursive: true);
        }

        $saved  = [];
        $errors = [];

        foreach ($slotMap as $inputSlot => $filenameStem) {
            if (!isset($_FILES[$inputSlot]) || $_FILES[$inputSlot]['error'] === UPLOAD_ERR_NO_FILE) {
                continue;
            }

            $file = $_FILES[$inputSlot];

            if ($file['error'] !== UPLOAD_ERR_OK) {
                $errors[$inputSlot] = 'Upload error code ' . $file['error'];
                continue;
            }

            if ($file['size'] > $maxBytes) {
                $errors[$inputSlot] = 'File exceeds 2 MB limit';
                continue;
            }

            // Validate MIME from actual file content (not browser-reported type)
            $finfo    = new \finfo(FILEINFO_MIME_TYPE);
            $mimeType = $finfo->file($file['tmp_name']);

            if (!array_key_exists($mimeType, $allowedMimes)) {
                $errors[$inputSlot] = 'Only JPG and PNG files are accepted';
                continue;
            }

            $ext      = $allowedMimes[$mimeType];
            $destFile = $destDir . DIRECTORY_SEPARATOR . $filenameStem . '.' . $ext;

            // Remove any previous version with a different extension
            foreach (['jpg', 'png'] as $oldExt) {
                $old = $destDir . DIRECTORY_SEPARATOR . $filenameStem . '.' . $oldExt;
                if (file_exists($old) && $old !== $destFile) unlink($old);
            }

            if (!move_uploaded_file($file['tmp_name'], $destFile)) {
                $errors[$inputSlot] = 'Failed to save file';
                continue;
            }

            $saved[$inputSlot] = $filenameStem . '.' . $ext;
        }

        if (!empty($errors) && empty($saved)) {
            Response::error('All uploads failed', 422, $errors);
        }

        $this->logEvent('UPLOAD_DOCS', $autoId, implode(', ', array_keys($saved)));

        Response::success([
            'saved'  => $saved,
            'errors' => $errors,
            'dir'    => Config::UPLOADS_DIR . '/' . $autoId,
        ], empty($errors) ? 'Documents saved' : 'Some documents saved (see errors)');
    }

    // ── Aramex / Delivery report ──────────────────────────────────────────────

    public function aramexReport(array $params, array $body, array $query): void
    {
        $v        = Validator::make($query);
        $dateFrom = $v->get('date_from', date('Y-m-d'));
        $dateTo   = $v->get('date_to',   date('Y-m-d'));
        $format   = $v->get('format', 'json');

        $page = $v->int('page', 1);

        Validator::make(['date_from' => $dateFrom, 'date_to' => $dateTo])
            ->date('date_from')
            ->date('date_to')
            ->validate();

        $sql = "SELECT
                CONCAT(iru.first_name, ' ', iru.last_name)               AS customer_name,
                r.air_bill_no,
                iru.address_in_uae                                        AS address,
                u.mobile_no                                               AS phone_no,
                r.idl_no,
                CASE r.delivery_option
                    WHEN 'pick_from_office' THEN 'Pick Up'
                    WHEN 'send_to_address'  THEN 'Deliver'
                    ELSE r.delivery_option
                END                                                       AS delivery_method
             FROM mn_idl_requests r
             JOIN  mn_idl_request_user iru ON r.auto_id            = iru.request_auto_id
             JOIN  mn_users u              ON r.belonging_user_id  = u.user_id
             WHERE r.idl_no        != ''
               AND r.request_status = 4
               AND r.paid_status    = 1
               AND DATE(r.issued_date) BETWEEN ? AND ?
               AND r.request_type  IN ('ONLINE', 'WEBSITE', 'MOI')
             ORDER BY r.issued_date DESC";

        $binds = [$dateFrom, $dateTo];

        if ($format === 'excel') {
            $this->exportAramexReportCsv($this->db->query($sql, $binds), $dateFrom, $dateTo);
        }

        $result          = $this->db->paginate($sql, $binds, $page, 20);
        Response::success($result);
    }

    private function exportAramexReportCsv(array $rows, string $dateFrom, string $dateTo): never
    {
        $filename = "Aramex_Sales_Report_{$dateFrom}_to_{$dateTo}.csv";
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Pragma: no-cache');

        $out = fopen('php://output', 'wb');
        fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM for Excel

        fputcsv($out, [
            'Customer Name', 'Airway Bill No', 'Address', 'Phone No', 'IDL No', 'Delivery Method',
        ]);

        foreach ($rows as $row) {
            fputcsv($out, [
                $row['customer_name']   ?? '',
                $row['air_bill_no']     ?? '',
                $row['address']         ?? '',
                $row['phone_no']        ?? '',
                $row['idl_no']          ?? '',
                $row['delivery_method'] ?? '',
            ]);
        }
        fclose($out);
        exit;
    }

    // ── Empost / Delivery report ──────────────────────────────────────────────

    public function empostReport(array $params, array $body, array $query): void
    {
        $v      = Validator::make($query);
        $date   = $v->get('date', date('Y-m-d'));
        $format = $v->get('format', 'json');
        $page   = $v->int('page', 1);

        Validator::make(['date' => $date])->date('date')->validate();

        $sql = "SELECT
                CONCAT(iru.first_name, ' ', iru.last_name)  AS customer_name,
                r.air_bill_no,
                iru.address_in_uae                          AS address,
                u.mobile_no,
                r.idl_no,
                CASE r.delivery_option
                    WHEN 'pick_from_office' THEN 'Pick Up'
                    WHEN 'send_to_address'  THEN 'Deliver'
                    ELSE r.delivery_option
                END                                         AS delivery_method,
                r.issued_date
             FROM mn_idl_requests r
             JOIN mn_idl_request_user iru ON r.auto_id    = iru.request_auto_id
             JOIN mn_users u              ON iru.user_id  = u.user_id
             WHERE r.idl_no        != ''
               AND r.request_status = 4
               AND r.paid_status    = 1
               AND DATE(r.issued_date) = ?
               AND r.request_type  IN ('ONLINE', 'WEBSITE', 'MOI')
             ORDER BY r.issued_date DESC";

        $binds = [$date];

        if ($format === 'excel') {
            $this->exportEmpostReportCsv($this->db->query($sql, $binds), $date);
        }

        $result = $this->db->paginate($sql, $binds, $page, 20);
        Response::success($result);
    }

    private function exportEmpostReportCsv(array $rows, string $date): never
    {
        $filename = "Empost_Sales_Report_{$date}.csv";
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Pragma: no-cache');

        $out = fopen('php://output', 'wb');
        fwrite($out, "\xEF\xBB\xBF");

        fputcsv($out, ['Customer Name', 'Airway Bill No', 'Address', 'Phone No', 'IDL No', 'Delivery Method']);

        foreach ($rows as $row) {
            fputcsv($out, [
                $row['customer_name']   ?? '',
                $row['air_bill_no']     ?? '',
                $row['address']         ?? '',
                $row['phone_no']        ?? '',
                $row['idl_no']          ?? '',
                $row['delivery_method'] ?? '',
            ]);
        }
        fclose($out);
        exit;
    }

    // ── MOE Report ────────────────────────────────────────────────────────────

    public function moeReport(array $params, array $body, array $query): void
    {
        $v        = Validator::make($query);
        $dateFrom = $v->get('date_from', date('Y-m-d'));
        $dateTo   = $v->get('date_to',   date('Y-m-d'));
        $dataType = $v->get('data_type', 'idl');
        $format   = $v->get('format', 'json');
        $page     = $v->int('page', 1);

        Validator::make(['date_from' => $dateFrom, 'date_to' => $dateTo])
            ->date('date_from')
            ->date('date_to')
            ->validate();

        $allRows = match ($dataType) {
            'idl'        => $this->moeIDLData($dateFrom, $dateTo),
            'cpd_trucks' => $this->moeCPDData($dateFrom, $dateTo, 'trucks'),
            'cpd_other'  => $this->moeCPDData($dateFrom, $dateTo, 'other'),
            default      => Response::error('Invalid data_type', 400),
        };

        if ($format === 'excel') {
            $this->exportMoeReportCsv($allRows, $dataType, $dateFrom, $dateTo);
        }

        // Manual pagination over the merged result set
        $total   = count($allRows);
        $perPage = 20;
        $page    = max(1, $page);
        $offset  = ($page - 1) * $perPage;
        $pages   = (int) ceil($total / $perPage);
        $pageData= array_slice($allRows, $offset, $perPage);

        Response::success([
            'data'     => $pageData,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
            'pages'    => $pages,
            'revenue'  => array_sum(array_column($allRows, 'total_amount')),
        ]);
    }

    private function moeIDLData(string $dateFrom, string $dateTo): array
    {
        // IDL Data — fixes vs original:
        //  1. June 31 doesn't exist — corrected cutoff date to 2023-06-30
        //  2. mn_idl_request_user has no user_id — joined mn_users via r.belonging_user_id
        //  3. DATE() instead of CAST(... AS DATE) for cleaner comparison
        //  4. Removed redundant STR_TO_DATE wrappers on literal comparison
        $cutoff = '2023-06-30';

        // Part 1 — Online applications
        $sql1 = "SELECT
                    r.request_id, r.payment_method, r.issued_date,
                    iru.first_name, iru.last_name,
                    em.emirate, u.mobile_no, r.total_amount,
                    s.status, r.reject_reason, iru.emirates_id,
                    n.nationality, r.idl_no, r.idl_booklet_no,
                    r.order_ref_no, r.paid_date
                 FROM mn_idl_requests r
                 JOIN mn_idl_request_user iru ON r.auto_id            = iru.request_auto_id
                 JOIN mn_emirates em           ON iru.emirate          = em.emirate_id
                 JOIN mn_users u               ON r.belonging_user_id  = u.user_id
                 JOIN mn_idl_status s          ON r.request_status     = s.status_id
                 JOIN mn_nationalities n       ON iru.nationality      = n.nationality_id
                 WHERE r.request_type      = 'ONLINE'
                   AND r.request_status    IN (3, 4)
                   AND DATE(r.paid_date)   > ?
                   AND DATE(r.issued_date) BETWEEN ? AND ?";

        // Part 2 — Distributor branch applications (branches 19, 6, 7, 5)
        $sql2 = "SELECT
                    r.request_id, r.payment_method, r.issued_date,
                    iru.first_name, iru.last_name,
                    em.emirate, u.mobile_no, r.total_amount,
                    s.status, r.reject_reason, iru.emirates_id,
                    n.nationality, r.idl_no, r.idl_booklet_no,
                    r.order_ref_no, r.paid_date
                 FROM mn_idl_requests r
                 JOIN mn_idl_request_user iru       ON r.auto_id              = iru.request_auto_id
                 JOIN mn_emirates em                ON iru.emirate             = em.emirate_id
                 JOIN mn_users u                    ON r.belonging_user_id    = u.user_id
                 JOIN mn_idl_status s               ON r.request_status       = s.status_id
                 JOIN mn_nationalities n            ON iru.nationality        = n.nationality_id
                 JOIN mn_idl_distributor_branch_users dbu
                                                    ON dbu.belonging_user_id = r.requested_by
                 JOIN mn_idl_distributor_branches db ON dbu.branch_id        = db.branch_auto_id
                 JOIN mn_idl_distributors d          ON d.distributor_id     = db.distributor_id
                 WHERE db.branch_auto_id  IN (19, 6, 7, 5)
                   AND r.request_status   IN (3, 4)
                   AND DATE(r.paid_date)  > ?
                   AND DATE(r.issued_date) BETWEEN ? AND ?";

        $part1 = $this->db->query($sql1, [$cutoff, $dateFrom, $dateTo]);
        $part2 = $this->db->query($sql2, [$cutoff, $dateFrom, $dateTo]);

        return array_merge($part1, $part2);
    }

    private function moeCPDData(string $dateFrom, string $dateTo, string $segment): array
    {
        // Optimisations vs original query:
        //  1. June 31 doesn't exist — corrected cutoff date to 2023-06-30
        //  2. DATE() instead of STR_TO_DATE wrapper — no function call on the literal
        //  3. issued_datetime range uses a plain BETWEEN on the datetime column directly
        //     (no wrapping function so the index on issued_datetime can be used)
        //  4. body_type filter separated by segment (trucks = Bus/Truck, other = everything else)
        //  5. Explicit table aliases for all column references to avoid ambiguity
        //  6. mn_users JOIN removed — all needed user data comes from mn_cpd_request_user

        $cutoff = '2023-06-30';

        $bodyTypeFilter = $segment === 'trucks'
            ? "AND r.body_type IN ('Bus', 'Truck')"
            : "AND r.body_type NOT IN ('Bus', 'Truck')";

        $sql = "SELECT
                    r.request_id,
                    r.booking_fee,
                    r.extra_fees,
                    r.vat_amount,
                    r.method_of_payment,
                    DATE(ic.issued_datetime)                               AS issued_date,
                    c.carnet_no,
                    n.nationality,
                    cu.emirates_id,
                    CONCAT(cu.first_name, ' ', cu.last_name)              AS full_name,
                    r.mulkiya_no,
                    r.registration_no,
                    r.vehicle_make,
                    r.vehicle_model,
                    r.body_type,
                    r.manuf_year,
                    r.color,
                    r.chassis_no,
                    r.engine_no,
                    r.no_of_seats,
                    r.no_of_cylinders,
                    s.status                                               AS cpd_status
                 FROM mn_cpd_requests r
                 JOIN mn_cpd_request_user cu   ON r.auto_id              = cu.request_auto_id
                 JOIN mn_nationalities n        ON cu.nationality_id      = n.nationality_id
                 JOIN mn_cpd_statuses s         ON r.request_status       = s.carnet_status_id
                 JOIN mn_cpd_issued_carnets ic  ON r.auto_id              = ic.request_id
                 JOIN mn_cpd_carnets c          ON ic.carnet_id           = c.carnet_id
                 WHERE c.carnet_no            != ''
                   AND r.request_type         IN ('CALL_CENTER', 'ONLINE')
                   AND DATE(ic.issued_datetime) > ?
                   AND ic.issued_datetime      BETWEEN ? AND ?
                   {$bodyTypeFilter}
                 ORDER BY r.auto_id DESC";

        return $this->db->query($sql, [$cutoff, $dateFrom, $dateTo]);
    }

    private function exportMoeReportCsv(array $rows, string $dataType, string $dateFrom, string $dateTo): never
    {
        if ($dataType === 'idl') {
            $this->exportMoeIdlXlsx($rows, $dateFrom, $dateTo);
        }

        // CPD — export as CSV (same column order as MOE_CPD_COLS in JS)
        $typeLabel = $dataType === 'cpd_trucks' ? 'CPD_Trucks_Buses' : 'CPD_Other';
        $filename  = "MOE_Report_{$typeLabel}_{$dateFrom}_to_{$dateTo}.csv";
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Pragma: no-cache');

        $out = fopen('php://output', 'wb');
        fwrite($out, "\xEF\xBB\xBF");

        fputcsv($out, [
            'Request ID', 'Issued Date', 'Carnet No', 'Full Name', 'Emirates ID',
            'Nationality', 'Booking Fee', 'Extra Fees', 'VAT Amount', 'Payment Method',
            'Mulkiya No', 'Registration No', 'Vehicle Make', 'Vehicle Model',
            'Body Type', 'Manuf Year', 'Color', 'Chassis No', 'Engine No',
            'No of Seats', 'No of Cylinders', 'Status',
        ]);

        foreach ($rows as $row) {
            fputcsv($out, [
                $row['request_id']      ?? '',
                $row['issued_date']     ?? '',
                $row['carnet_no']       ?? '',
                $row['full_name']       ?? '',
                $row['emirates_id']     ?? '',
                $row['nationality']     ?? '',
                $row['booking_fee']     ?? '',
                $row['extra_fees']      ?? '',
                $row['vat_amount']      ?? '',
                $row['method_of_payment'] ?? '',
                $row['mulkiya_no']      ?? '',
                $row['registration_no'] ?? '',
                $row['vehicle_make']    ?? '',
                $row['vehicle_model']   ?? '',
                $row['body_type']       ?? '',
                $row['manuf_year']      ?? '',
                $row['color']           ?? '',
                $row['chassis_no']      ?? '',
                $row['engine_no']       ?? '',
                $row['no_of_seats']     ?? '',
                $row['no_of_cylinders'] ?? '',
                $row['cpd_status']      ?? '',
            ]);
        }
        fclose($out);
        exit;
    }

    private function exportMoeIdlXlsx(array $rows, string $dateFrom, string $dateTo): never
    {
        if (!class_exists('ZipArchive')) {
            // Fallback: plain CSV matching the column order
            $this->exportMoeIdlCsvFallback($rows, $dateFrom, $dateTo);
        }

        // Build a minimal XLSX using PHP's built-in ZipArchive + XML
        // This avoids requiring openpyxl/composer dependencies on the server
        $tmpFile = tempnam(sys_get_temp_dir(), 'moe_') . '.xlsx';
        $this->buildMoeXlsx($rows, $tmpFile);

        $filename = "MOE_Report_IDL_{$dateFrom}_to_{$dateTo}.xlsx";
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($tmpFile));
        header('Pragma: no-cache');
        readfile($tmpFile);
        unlink($tmpFile);
        exit;
    }

    private function buildMoeXlsx(array $rows, string $destFile): void
    {
        // Shared strings table (SST) — collect all string values
        $sst    = [];
        $sstIdx = [];

        $addStr = static function (mixed $val) use (&$sst, &$sstIdx): int {
            $s = (string)$val;
            if (!isset($sstIdx[$s])) {
                $sstIdx[$s] = count($sst);
                $sst[]      = $s;
            }
            return $sstIdx[$s];
        };

        // Metadata rows (B=col2, C=col3 in 1-based)
        $meta = [
            ['EntityName',       'Ministry of Energy and Infrastructure'],
            ['ServiceGLCode',    '142220'],
            ['ServiceID',        '1024121882'],
            ['ServiceNameEnglish','Issue International Driving License'],
            ['ServiceNameArabic', 'إصدار رخصة قيادة دولية IDL لكل رخصة'],
        ];

        // Column headers (row 7, starting at col B)
        $headers = [
            'TransactionDateTime', 'TranasctionAmount', 'VATTransaction', 'URN',
            'TransactionType', 'Instrument', 'Currency', 'EmiratesID',
            'Nationality', 'Name', 'Status', 'RejectReason',
            'IDL No', 'Booklet No', 'Telr Reference',
        ];

        // Pre-register strings
        foreach ($meta as [$k, $v]) { $addStr($k); $addStr($v); }
        foreach ($headers as $h)    { $addStr($h); }
        foreach ($rows as $row) {
            foreach ([
                $row['paid_date']      ?? '',
                $row['request_id']     ?? '',
                'Purchase',
                $row['payment_method'] ?? '',
                'AED',
                (string)($row['emirates_id']    ?? ''),
                $row['nationality']    ?? '',
                trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? '')),
                $row['status']         ?? '',
                $row['reject_reason']  ?? '',
                $row['idl_no']         ?? '',
                (string)($row['idl_booklet_no'] ?? ''),
                $row['order_ref_no']   ?? '',
            ] as $s) { $addStr((string)$s); }
        }

        // Build SST XML
        $sstXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            . ' count="' . count($sst) . '" uniqueCount="' . count($sst) . '">';
        foreach ($sst as $s) {
            $sstXml .= '<si><t xml:space="preserve">' . htmlspecialchars($s, ENT_XML1, 'UTF-8') . '</t></si>';
        }
        $sstXml .= '</sst>';

        // Helper: cell reference
        $col = static fn(int $c): string => $c <= 26
            ? chr(64 + $c)
            : chr(64 + intdiv($c - 1, 26)) . chr(65 + ($c - 1) % 26);

        // Helper: shared-string cell
        $sc = static fn(int $r, int $c, int $idx): string =>
            '<c r="' . $col($c) . $r . '" t="s"><v>' . $idx . '</v></c>';

        // Helper: numeric cell
        $nc = static fn(int $r, int $c, mixed $v): string =>
            '<c r="' . $col($c) . $r . '"><v>' . (is_numeric($v) ? $v : 0) . '</v></c>';

        // Build sheet rows
        $sheetRows = '';

        // Rows 1–5: metadata (cols B=2, C=3)
        foreach ($meta as $ri => [$k, $v]) {
            $r = $ri + 1;
            $sheetRows .= '<row r="' . $r . '">'
                . $sc($r, 2, $sstIdx[$k])
                . $sc($r, 3, $sstIdx[$v])
                . '</row>';
        }
        // Row 6: empty (omitted — empty rows don't need XML)

        // Row 7: column headers starting at col B (col 2)
        $sheetRows .= '<row r="7">';
        foreach ($headers as $hi => $h) {
            $sheetRows .= $sc(7, $hi + 2, $sstIdx[$h]);
        }
        $sheetRows .= '</row>';

        // Data rows starting at row 8
        foreach ($rows as $di => $row) {
            $r         = $di + 8;
            $paidDate  = (string)($row['paid_date']      ?? '');
            $amount    = $row['total_amount']             ?? 0;
            $reqId     = (string)($row['request_id']     ?? '');
            $payMethod = (string)($row['payment_method'] ?? '');
            $eid       = (string)($row['emirates_id']    ?? '');
            $nat       = (string)($row['nationality']    ?? '');
            $name      = trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? ''));
            $status    = (string)($row['status']         ?? '');
            $reject    = (string)($row['reject_reason']  ?? '');
            $idlNo     = (string)($row['idl_no']         ?? '');
            $booklet   = (string)($row['idl_booklet_no'] ?? '');
            $telrRef   = (string)($row['order_ref_no']   ?? '');

            $sheetRows .= '<row r="' . $r . '">'
                . $sc($r, 2,  $sstIdx[$paidDate])   // TransactionDateTime
                . $nc($r, 3,  $amount)               // TranasctionAmount
                . $nc($r, 4,  0)                     // VATTransaction
                . $sc($r, 5,  $sstIdx[$reqId])       // URN
                . $sc($r, 6,  $sstIdx['Purchase'])   // TransactionType
                . $sc($r, 7,  $sstIdx[$payMethod])   // Instrument
                . $sc($r, 8,  $sstIdx['AED'])        // Currency
                . $sc($r, 9,  $sstIdx[$eid])         // EmiratesID
                . $sc($r, 10, $sstIdx[$nat])         // Nationality
                . $sc($r, 11, $sstIdx[$name])        // Name
                . $sc($r, 12, $sstIdx[$status])      // Status
                . $sc($r, 13, $sstIdx[$reject])      // RejectReason
                . $sc($r, 14, $sstIdx[$idlNo])       // IDL No
                . $sc($r, 15, $sstIdx[$booklet])     // Booklet No
                . $sc($r, 16, $sstIdx[$telrRef])     // Telr Reference
                . '</row>';
        }

        $sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<sheetData>' . $sheetRows . '</sheetData></worksheet>';

        // Minimal OOXML structure
        $contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml"  ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml"         ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            . '<Override PartName="/xl/sharedStrings.xml"    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            . '</Types>';

        $relsRoot = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            . '</Relationships>';

        $workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            . ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheets><sheet name="MOE Report-IDL" sheetId="1" r:id="rId1"/></sheets>'
            . '</workbook>';

        $wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"        Target="worksheets/sheet1.xml"/>'
            . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"    Target="sharedStrings.xml"/>'
            . '</Relationships>';

        $zip = new \ZipArchive();
        $zip->open($destFile, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml',          $contentTypes);
        $zip->addFromString('_rels/.rels',                  $relsRoot);
        $zip->addFromString('xl/workbook.xml',              $workbook);
        $zip->addFromString('xl/_rels/workbook.xml.rels',   $wbRels);
        $zip->addFromString('xl/worksheets/sheet1.xml',     $sheetXml);
        $zip->addFromString('xl/sharedStrings.xml',         $sstXml);
        $zip->close();
    }

    private function exportMoeIdlCsvFallback(array $rows, string $dateFrom, string $dateTo): never
    {
        // Fallback when ZipArchive not available — flat CSV with metadata header
        $filename = "MOE_Report_IDL_{$dateFrom}_to_{$dateTo}.csv";
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Pragma: no-cache');
        $out = fopen('php://output', 'wb');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, ['', 'EntityName',        'Ministry of Energy and Infrastructure']);
        fputcsv($out, ['', 'ServiceGLCode',      '142220']);
        fputcsv($out, ['', 'ServiceID',          '1024121882']);
        fputcsv($out, ['', 'ServiceNameEnglish', 'Issue International Driving License']);
        fputcsv($out, ['', 'ServiceNameArabic',  'إصدار رخصة قيادة دولية IDL لكل رخصة']);
        fputcsv($out, []);
        fputcsv($out, ['', 'TransactionDateTime','TranasctionAmount','VATTransaction','URN',
            'TransactionType','Instrument','Currency','EmiratesID','Nationality',
            'Name','Status','RejectReason','IDL No','Booklet No','Telr Reference']);
        foreach ($rows as $row) {
            fputcsv($out, ['',
                $row['paid_date']      ?? '',
                $row['total_amount']   ?? 0,
                0,
                $row['request_id']     ?? '',
                'Purchase',
                $row['payment_method'] ?? '',
                'AED',
                $row['emirates_id']    ?? '',
                $row['nationality']    ?? '',
                trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? '')),
                $row['status']         ?? '',
                $row['reject_reason']  ?? '',
                $row['idl_no']         ?? '',
                $row['idl_booklet_no'] ?? '',
                $row['order_ref_no']   ?? '',
            ]);
        }
        fclose($out);
        exit;
    }

    // ── Sales Report ──────────────────────────────────────────────────────────

    public function salesReport(array $params, array $body, array $query): void
    {
        $v        = Validator::make($query);
        $dateFrom = $v->get('date_from', date('Y-m-d'));
        $dateTo   = $v->get('date_to',   date('Y-m-d'));
        $format   = $v->get('format', 'json');
        $page     = $v->int('page', 1);

        Validator::make(['date_from' => $dateFrom, 'date_to' => $dateTo])
            ->date('date_from')
            ->date('date_to')
            ->validate();

        $sql = "SELECT
                r.request_type,
                r.idl_no,
                r.idl_booklet_no,
                r.issued_date,
                r.total_amount,
                r.request_status,
                iru.first_name,
                iru.last_name,
                iru.place_of_birth,
                iru.dob,
                iru.po_box,
                iru.sex,
                iru.license_no,
                iru.nationality AS nationality_id,
                u.email,
                u.mobile_no,
                n.nationality,
                s.status        AS status_label,
                CONCAT(isu.first_name, ' ', isu.last_name) AS issued_by,
                d.distributor_name,
                db.branch_name
             FROM mn_idl_requests r
             JOIN  mn_idl_request_user iru ON r.auto_id            = iru.request_auto_id
             LEFT JOIN mn_users u          ON r.belonging_user_id  = u.user_id
             LEFT JOIN mn_users isu        ON r.processed_by       = isu.user_id
             LEFT JOIN mn_nationalities n  ON iru.nationality      = n.nationality_id
             LEFT JOIN mn_idl_status s     ON r.request_status     = s.status_id
             LEFT JOIN mn_idl_distributor_branch_users dbu ON dbu.belonging_user_id = r.requested_by
             LEFT JOIN mn_idl_distributor_branches db ON dbu.branch_id = db.branch_auto_id
             LEFT JOIN mn_idl_distributors d  ON d.distributor_id  = db.distributor_id
             WHERE DATE(r.paid_date) BETWEEN ? AND ?
               AND r.request_status IN (2, 3, 4, 5)
             ORDER BY r.paid_date DESC";

        $binds = [$dateFrom, $dateTo];

        if ($format === 'excel') {
            $this->exportSalesReportCsv($this->db->query($sql, $binds), $dateFrom, $dateTo);
        }

        $result  = $this->db->paginate($sql, $binds, $page, 20);
        $allRows = $this->db->query($sql, $binds);

        $result['revenue'] = array_sum(array_column($allRows, 'total_amount'));
        Response::success($result);
    }

    private function exportSalesReportCsv(array $rows, string $dateFrom, string $dateTo): never
    {
        $filename = "IDL_Sales_Report_{$dateFrom}_to_{$dateTo}.csv";
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Pragma: no-cache');

        $out = fopen('php://output', 'wb');
        // BOM for Excel UTF-8 compatibility
        fwrite($out, "\xEF\xBB\xBF");

        fputcsv($out, [
            'Request Type', 'IDL No', 'Booklet No', 'First Name', 'Last Name',
            'Nationality', 'Date of Birth', 'Sex', 'Place of Birth', 'PO Box',
            'License No', 'Issued Date', 'Amount (AED)', 'Status',
            'Email', 'Mobile', 'Issued By', 'Distributor', 'Branch',
        ]);

        foreach ($rows as $row) {
            fputcsv($out, [
                $row['request_type']    ?? '',
                $row['idl_no']          ?? '',
                $row['idl_booklet_no']  ?? '',
                $row['first_name']      ?? '',
                $row['last_name']       ?? '',
                $row['nationality']     ?? '',
                $row['dob']             ?? '',
                $row['sex']             ?? '',
                $row['place_of_birth']  ?? '',
                $row['po_box']          ?? '',
                $row['license_no']      ?? '',
                $row['issued_date']     ?? '',
                $row['total_amount']    ?? '',
                $row['status_label']    ?? '',
                $row['email']           ?? '',
                $row['mobile_no']       ?? '',
                $row['issued_by']       ?? '',
                $row['distributor_name'] ?? '',
                $row['branch_name']     ?? '',
            ]);
        }
        fclose($out);
        exit;
    }

    // ── Telr Payment Verification ─────────────────────────────────────────────

    public function telrVerify(array $params, array $body, array $query): void
    {
        // Check session for the cart ID stored at initiation
        $cartId   = $_SESSION['telr_cart_id']    ?? null;
        $autoId   = $_SESSION['telr_request_id'] ?? null;
        $module   = $_SESSION['telr_module']     ?? 'IDL';

        Logger::info("telrVerify called: cartId={$cartId} autoId={$autoId} module={$module} session_id=" . session_id());

        if (!$cartId) {
            Response::error('no_session', 403);
            return;
        }

        // For CPD_RETURN, autoId is not required
        if ($module !== 'CPD_RETURN' && !$autoId) {
            Response::error('no_session', 403);
            return;
        }

        // Delegate to CPD verify if the session was started by a CPD payment
        if ($module === 'CPD') {
            (new CPDController())->telrVerify($params, $body, $query);
            return;
        }

        // Delegate to CPD return verify if the session was started by a CPD return payment
        if ($module === 'CPD_RETURN') {
            (new CPDController())->telrVerifyReturn($params, $body, $query);
            return;
        }

        // Fetch the IDL request
        $req = $this->db->queryOne(
            "SELECT auto_id, belonging_user_id, paid_status, order_ref_no
             FROM mn_idl_requests
             WHERE auto_id = ? AND is_active = 1 AND telr_cart_id = ?",
            [(int)$autoId, $cartId],
        );

        if (!$req) {
            unset($_SESSION['telr_cart_id'], $_SESSION['telr_request_id']);
            Response::notFound('No matching IDL request found');
        }

        // Only the request owner can verify
        if ((int)$req['belonging_user_id'] !== Auth::id()) {
            Response::forbidden('Access denied');
        }

        // Already paid — clear session and return success
        if ((int)$req['paid_status'] === 1) {
            unset($_SESSION['telr_cart_id'], $_SESSION['telr_request_id'], $_SESSION['telr_module']);
            Response::success(['already_paid' => true, 'auto_id' => $req['auto_id']], 'Payment already recorded');
            return;
        }

        // Verify with Telr using the order_ref stored at initiation
        $orderRef   = $req['order_ref_no'];
        $postfields = json_encode([
            'method'  => 'check',
            'store'   => Config::TELR_STORE_ID,
            'authkey' => Config::TELR_AUTH_KEY,
            'order'   => ['ref' => $orderRef],
        ]);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL,            'https://secure.telr.com/gateway/order.json');
        curl_setopt($ch, CURLOPT_POST,           true);
        curl_setopt($ch, CURLOPT_POSTFIELDS,     $postfields);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER,     [
            'Content-type: application/json',
            'Content-length: ' . strlen($postfields),
        ]);
        curl_setopt($ch, CURLOPT_TIMEOUT,        30);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);

        $serverOutput = curl_exec($ch);
        $curlError    = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            Response::serverError('Payment verification failed: ' . $curlError);
        }

        $ipgOutput = json_decode($serverOutput, true);
        $status    = $ipgOutput['order']['status']['code']     ?? null;
        $telrRef   = $ipgOutput['order']['transaction']['ref'] ?? null;

        // Status 3 = authorised/paid
        if ((int)$status === 3) {
            $this->db->execute(
                "UPDATE mn_idl_requests
                 SET paid_status=1, paid_date=NOW(), order_ref_no=?
                 WHERE auto_id=?",
                [$telrRef ?? $orderRef, (int)$autoId],
            );

            // Clear session — prevents re-use on refresh
            unset($_SESSION['telr_cart_id'], $_SESSION['telr_request_id'], $_SESSION['telr_module']);

            $this->logEvent('TELR_PAID', (int)$autoId, $telrRef ?? $orderRef);

            Response::success([
                'paid'     => true,
                'auto_id'  => (int)$autoId,
                'telr_ref' => $telrRef,
            ], 'Payment verified and recorded');
        } else {
            $statusText = $ipgOutput['order']['status']['text'] ?? 'Unknown';
            $statusCode = $ipgOutput['order']['status']['code'] ?? 'null';
            Response::error("Payment not confirmed — status code: {$statusCode}, text: {$statusText}, raw: " . json_encode($ipgOutput), 402);
        }
    }

    // ── Telr Payment Initiation ───────────────────────────────────────────────

    public function telrInit(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];

        // Fetch request + applicant details
        $req = $this->db->queryOne(
            "SELECT r.auto_id, r.request_id, r.total_amount, r.belonging_user_id, r.paid_status,
                    iru.first_name, iru.last_name,
                    u.email, iru.address_in_uae AS address
             FROM mn_idl_requests r
             JOIN mn_idl_request_user iru ON iru.request_auto_id = r.auto_id
             JOIN mn_users u              ON u.user_id           = r.belonging_user_id
             WHERE r.auto_id = ?",
            [$autoId],
        );

        if (!$req) Response::notFound('IDL request not found');

        // Only the request owner or IDL-module staff may (re)initiate payment
        $user    = Auth::user();
        $isOwner = (int)$req['belonging_user_id'] === Auth::id();
        $isStaff = in_array((int)$user['user_type'], Auth::MODULE_ACCESS['idl'], true);
        if (!$isOwner && !$isStaff) {
            Response::forbidden('Access denied');
        }

        if ((int)$req['paid_status'] === 1) {
            Response::error('This IDL request has already been paid for', 409);
        }

        $cartId = (string)time();

        // Initiate Telr order
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL,            'https://secure.telr.com/gateway/order.json');
        curl_setopt($ch, CURLOPT_POST,           true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
            'ivp_method'   => 'create',
            'ivp_store'    => Config::TELR_STORE_ID,
            'ivp_authkey'  => Config::TELR_AUTH_KEY,
            'ivp_amount'   => $req['total_amount'],
            'ivp_currency' => Config::TELR_CURRENCY,
            'ivp_test'     => Config::TELR_TEST,
            'ivp_cart'     => $cartId,
            'ivp_desc'     => 'IDP - International Driving Permit',
            'return_auth'  => Config::telrReturnUrl(),
            'return_decl'  => Config::telrDeclineUrl(),
            'return_can'   => Config::telrCancelUrl(),
            'bill_fname'   => $req['first_name'] ?? '',
            'bill_sname'   => $req['last_name']  ?? '',
            'bill_email'   => $req['email']      ?? '',
            'bill_addr1'   => $req['address']    ?? '',
        ]));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER,     ['Expect:']);
        curl_setopt($ch, CURLOPT_TIMEOUT,        30);

        // SSL: use system CA bundle if available, otherwise disable verification in test mode only
        $caBundle = ini_get('curl.cainfo') ?: (PHP_OS_FAMILY === 'Windows'
            ? 'C:/Windows/System32/curl-ca-bundle.crt'
            : '/etc/ssl/certs/ca-certificates.crt');

        if (file_exists($caBundle)) {
            curl_setopt($ch, CURLOPT_CAINFO,          $caBundle);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER,  true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST,  2);
        } elseif (Config::TELR_TEST === '1') {
            // Dev/test environment without a CA bundle — disable peer verification
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        } else {
            Response::serverError('SSL CA bundle not found — cannot connect to payment gateway securely');
        }

        $serverOutput = curl_exec($ch);
        $curlError    = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            Response::serverError('Payment gateway connection failed: ' . $curlError);
        }

        $ipgOutput = json_decode($serverOutput, true);

        if (empty($ipgOutput['order']['url'])) {
            $errorMsg = $ipgOutput['error']['message'] ?? $serverOutput;
            Response::serverError('Payment gateway error: ' . $errorMsg);
        }

        // Save order ref (needed for check API), cart ID and payment method on the request
        // $ipgOutput['order']['ref'] is the reference used for the check/verify call
        // $ipgOutput['trace'] is a Telr transaction trace (different field)
        $orderRef = $ipgOutput['order']['ref'] ?? '';
        $this->db->execute(
            'UPDATE mn_idl_requests SET order_ref_no=?, telr_cart_id=?, payment_method=? WHERE auto_id=?',
            [$orderRef, $cartId, 'CREDIT_CARD', $autoId],
        );

        // Store cartId in session so payment-success can verify and clear it
        $_SESSION['telr_cart_id']      = $cartId;
        $_SESSION['telr_request_id']   = $autoId;

        $this->logEvent('TELR_INIT', $autoId, $ipgOutput['trace'] ?? $cartId);

        Response::success([
            'redirect_url' => $ipgOutput['order']['url'],
            'cart_id'      => $cartId,
            'trace'        => $ipgOutput['trace'] ?? null,
        ], 'Payment session created');
    }

    // ── Receipt ───────────────────────────────────────────────────────────────

    public function createReceipt(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];

        $req = $this->db->queryOne(
            'SELECT auto_id, request_id, total_amount FROM mn_idl_requests WHERE auto_id=?',
            [$autoId],
        );
        if (!$req) Response::notFound('IDL request not found');

        // Return existing receipt if one already exists — no duplicates
        $existing = $this->db->queryOne(
            'SELECT receipt_id, receipt_no FROM mn_idl_receipts WHERE request_id=?',
            [$autoId],
        );
        if ($existing) {
            Response::success($existing, 'Receipt already exists');
            return;
        }

        // Insert then update receipt_no with real auto_id (format: REC/DDMMYYYY/auto_id)
        $receiptId = $this->db->insert(
            "INSERT INTO mn_idl_receipts (receipt_no, request_id, receipt_total, created_by, created_datetime)
             VALUES ('PENDING', ?, ?, ?, NOW())",
            [$autoId, $req['total_amount'], Auth::id()],
        );

        $receiptNo = sprintf('REC/%s/%d', date('dmY'), $receiptId);
        $this->db->execute(
            'UPDATE mn_idl_receipts SET receipt_no=? WHERE receipt_id=?',
            [$receiptNo, $receiptId],
        );

        $this->logEvent('PRINT_RECEIPT', $autoId, $receiptNo);
        Response::success(['receipt_id' => $receiptId, 'receipt_no' => $receiptNo], 'Receipt created');
    }

    public function getReceipt(array $params, array $body, array $query): void
    {
        $autoId  = (int)$params['id'];

        $receipt = $this->db->queryOne(
            "SELECT rc.receipt_id, rc.receipt_no, rc.receipt_total, rc.created_datetime,
                    r.request_id, r.total_amount, r.delivery_option,
                    CONCAT(iru.first_name,' ',iru.last_name) AS customer_name
             FROM mn_idl_receipts rc
             JOIN mn_idl_requests r       ON r.auto_id           = rc.request_id
             JOIN mn_idl_request_user iru ON iru.request_auto_id = r.auto_id
             WHERE rc.request_id = ?
             ORDER BY rc.receipt_id DESC LIMIT 1",
            [$autoId],
        );

        if (!$receipt) Response::notFound('Receipt not found');
        Response::success($receipt);
    }

    public function idlConfig(array $params, array $body, array $query): void
    {
        Response::success([
            'idl_amount'    => Config::IDL_AMOUNT,
            'admin_fee'     => Config::IDL_ADMIN_FEE,
            'delivery_fee'  => Config::DELIVERY_FEE,
        ]);
    }

    /**
     * IDL Fee + Administration Fee + (Delivery Fee when delivered) + VAT 5% on
     * (IDL Fee + Delivery Fee) — the Administration Fee is VAT-exempt.
     */
    private function calcIdlTotal(string $deliveryOption): float
    {
        $isDelivery  = in_array($deliveryOption, ['send_to_address', 'home_delivery'], true);
        $deliveryFee = $isDelivery ? Config::DELIVERY_FEE : 0.0;
        $vat         = round((Config::IDL_AMOUNT + $deliveryFee) * 0.05, 2);

        return Config::IDL_AMOUNT + Config::IDL_ADMIN_FEE + $deliveryFee + $vat;
    }

    public function myRequests(array $params, array $body, array $query): void
    {
        $userId = Auth::id();
        $page   = max(1, (int)($query['page'] ?? 1));

        $result = $this->db->paginate(
            "SELECT r.auto_id, r.request_id, r.request_type, r.requested_datetime,
                    r.total_amount, r.paid_status, r.idl_no, r.request_status,
                    s.status AS status_label
             FROM mn_idl_requests r
             LEFT JOIN mn_idl_status s ON s.status_id = r.request_status
             WHERE r.belonging_user_id = ? AND r.is_active = 1
             ORDER BY r.auto_id DESC",
            [$userId], $page,
        );

        Response::success($result);
    }

    // ── Search by Emirates ID ─────────────────────────────────────────────────

    public function searchByEid(array $params, array $body, array $query): void
    {
        $eid = trim($query['eid'] ?? '');
        if ($eid === '') {
            Response::error('Emirates ID is required', 422);
        }

        // Find the most recent request for this Emirates ID, joining all applicant fields
        $row = $this->db->queryOne(
            "SELECT
                r.auto_id                                                AS last_request_auto_id,
                iru.first_name, iru.last_name, iru.nationality, iru.sex, iru.dob,
                iru.emirates_id, iru.address_in_uae, iru.po_box, iru.city,
                iru.home_country_address, iru.license_no, iru.place_of_birth,
                iru.place_of_issue, iru.issued_date, iru.expiry_date,
                iru.type_of_dl, iru.emirate, iru.first_idl,
                u.email, u.mobile_no
             FROM mn_idl_request_user iru
             JOIN mn_idl_requests r      ON r.auto_id           = iru.request_auto_id
             JOIN mn_users u             ON r.belonging_user_id = u.user_id
             WHERE iru.emirates_id = ?
             ORDER BY r.auto_id DESC
             LIMIT 1",
            [$eid],
        );

        if ($row === null) {
            Response::error('Emirates ID not found', 404);
        }

        Response::success($row);
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    public function stats(array $params, array $body, array $query): void
    {
        // Fetch all stats in one pass using conditional aggregation
        $row = $this->db->queryOne(
            "SELECT
                COUNT(*)                                                              AS total,
                SUM(request_status IN (1,2))                                          AS pending,
                SUM(request_status = 4)                                               AS issued,
                SUM(request_status = 3)                                               AS rejected,
                SUM(request_status = 7)                                               AS cancelled,
                SUM(MONTH(requested_datetime)=MONTH(NOW()) AND YEAR(requested_datetime)=YEAR(NOW())) AS this_month,
                COALESCE(SUM(CASE WHEN paid_status=1 THEN total_amount ELSE 0 END),0) AS revenue
             FROM mn_idl_requests WHERE is_active=1",
        );

        $total      = (int)   ($row['total']      ?? 0);
        $pending    = (int)   ($row['pending']     ?? 0);
        $issued     = (int)   ($row['issued']      ?? 0);
        $rejected   = (int)   ($row['rejected']    ?? 0);
        $cancelled  = (int)   ($row['cancelled']   ?? 0);
        $this_month = (int)   ($row['this_month']  ?? 0);
        $revenue    = (float) ($row['revenue']     ?? 0);

        // Pending count broken down by request_type — one query, all types
        $typeRows = $this->db->query(
            "SELECT request_type, COUNT(*) AS cnt
             FROM mn_idl_requests
             WHERE request_status IN (1,2) AND is_active=1
             GROUP BY request_type",
        );
        $by_type = [];
        foreach ($typeRows as $r) {
            $by_type[$r['request_type']] = (int)$r['cnt'];
        }

        Response::success(compact('total','pending','issued','rejected','cancelled','this_month','revenue','by_type'));
    }

    public function chartData(array $params, array $body, array $query): void
    {
        // Monthly IDL requests for the last 12 months
        $monthly = $this->db->query(
            "SELECT DATE_FORMAT(requested_datetime, '%Y-%m') AS month,
                    COUNT(*)                                  AS count,
                    COALESCE(SUM(total_amount),0)             AS revenue
             FROM mn_idl_requests
             WHERE is_active=1
               AND requested_datetime >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
             GROUP BY month
             ORDER BY month ASC",
        );

        // Status distribution
        $statusDist = $this->db->query(
            "SELECT s.status AS label, COUNT(r.auto_id) AS count
             FROM mn_idl_requests r
             LEFT JOIN mn_idl_status s ON s.status_id = r.request_status
             WHERE r.is_active=1
             GROUP BY r.request_status, s.status
             ORDER BY r.request_status ASC",
        );

        // Request type breakdown
        $typeDist = $this->db->query(
            "SELECT request_type AS label, COUNT(*) AS count
             FROM mn_idl_requests
             WHERE is_active=1
             GROUP BY request_type
             ORDER BY count DESC",
        );

        // CPD monthly (last 12 months)
        $cpdMonthly = $this->db->query(
            "SELECT DATE_FORMAT(requested_datetime, '%Y-%m') AS month,
                    COUNT(*)                                  AS count
             FROM mn_cpd_requests
             WHERE requested_datetime >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
             GROUP BY month
             ORDER BY month ASC",
        );

        Response::success(compact('monthly', 'statusDist', 'typeDist', 'cpdMonthly'));
    }

    // ── List ──────────────────────────────────────────────────────────────────

    public function index(array $params, array $body, array $query): void
    {
        $v            = Validator::make($query);
        $page         = $v->int('page', 1);
        $search       = trim($v->get('search', ''));
        $type         = $v->get('type', '');
        $roleId       = Auth::roleId();
        $isIDLOfficer = in_array($roleId, [8, 22, 23, 24, 25], true);
        $statusParam  = $v->get('status', '');

        [$where, $binds] = $this->buildFilters($search, $statusParam, $type, $isIDLOfficer, $roleId);

        $dataSql = "SELECT r.auto_id, r.request_id, r.request_type, r.request_status,
                    r.requested_datetime, r.paid_status, r.total_amount,
                    r.delivery_option, r.idl_no, r.payment_method, r.air_bill_no,
                    iru.first_name, iru.last_name,
                    iru.license_no, iru.expiry_date,
                    s.status AS status_label
             FROM mn_idl_requests r
             LEFT JOIN mn_idl_request_user iru ON iru.request_auto_id = r.auto_id
             LEFT JOIN mn_idl_status s         ON s.status_id         = r.request_status
             {$where}
             ORDER BY r.auto_id DESC";

        // COUNT — iru not needed in WHERE anymore (search uses IN() subresult)
        $countSql = "SELECT COUNT(*) FROM mn_idl_requests r {$where}";

        $result = $this->db->paginate($dataSql, $binds, $page, 20, $countSql, $binds);

        // No secondary enrichment needed — iru already has license data

        // Tell the frontend which filter is active so it can pre-select the dropdown
        if ($statusParam !== '') {
            $activeFilter = $statusParam;           // explicit filter the user chose
        } elseif ($isIDLOfficer) {
            $activeFilter = 'pending';              // default applied for IDL officer
        } else {
            $activeFilter = '';                     // no filter — admin/finance sees all
        }
        $result['active_status_filter'] = $activeFilter;

        Response::success($result);
    }

    // ── Single ────────────────────────────────────────────────────────────────

    public function show(array $params, array $body, array $query): void
    {
        $r = $this->db->queryOne(
            "SELECT r.*, iru.*,
                    u.email, u.mobile_no,
                    n.nationality,
                    iru.nationality        AS nationality_id,
                    r.issued_date          AS idl_issued_date,
                    s.status               AS status_label,
                    dt.dl_type             AS dl_type_name,
                    em.emirate             AS emirate_name,
                    poi.emirate            AS place_of_issue_name
             FROM mn_idl_requests r
             JOIN  mn_idl_request_user iru ON r.auto_id             = iru.request_auto_id
             JOIN  mn_users u              ON r.belonging_user_id   = u.user_id
             LEFT JOIN mn_nationalities n  ON iru.nationality       = n.nationality_id
             LEFT JOIN mn_idl_status s     ON r.request_status      = s.status_id
             LEFT JOIN mn_idl_dl_types dt  ON iru.type_of_dl        = dt.type_id
             LEFT JOIN mn_emirates em      ON iru.emirate           = em.emirate_id
             LEFT JOIN mn_emirates poi     ON iru.place_of_issue    = poi.emirate_id
             WHERE r.auto_id = ?",
            [$params['id']],
        );
        if ($r === null) Response::notFound('IDL request not found');

        // History log entries for this request
        $r['history'] = $this->db->query(
            "SELECT log_action, action_initiator, log_datetime, extra_params
             FROM mn_event_logs
             WHERE log_module='IDL' AND (extra_params=? OR extra_params=?)
             ORDER BY log_datetime DESC LIMIT 20",
            [$r['request_id'], (string)$r['auto_id']],
        );

        Response::success($r);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    public function store(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('delivery_option', 'payment_method')
            ->in('delivery_option', [
                'pick_from_office', 'send_to_address', 'home_delivery',
                'pick_from_dubai_office', 'pick_from_abudhabi_office',
            ])
            ->in('payment_method', ['CASH', 'CARD', 'ONLINE', 'CHEQUE', 'CREDIT_CARD'])
            ->validate();

        $officerId  = Auth::id();
        $emiratesId = trim($body['emirates_id'] ?? '');

        if ($emiratesId !== '') {
            $hold = $this->db->queryOne(
                'SELECT hold_id FROM mn_customer_holds WHERE emirates_id = ? AND is_active = 1 LIMIT 1',
                [$emiratesId],
            );
            if ($hold) Response::error('This customer has an active hold. Lift the hold before creating a new request.', 403);
        }

        // ── Resolve applicant user_id ─────────────────────────────────────────
        $newUserId = null; // track any user we create so we can roll it back on failure

        if (Auth::roleId() === 2) {
            // Public customer applying for their own IDL — they're already logged
            // in as an existing mn_users account, so never create another one.
            $userId = Auth::id();
        } else {
            // Staff-created request (e.g. IDL_Officer walk-in) — reuse an existing
            // account by email if one exists, otherwise create a new one.
            $email        = trim($body['email'] ?? '');
            $existingUser = $email !== ''
                ? $this->db->queryOne('SELECT user_id FROM mn_users WHERE email = ? LIMIT 1', [$email])
                : null;

            if ($existingUser && $existingUser['user_id']) {
                $userId = (int)$existingUser['user_id'];
            } else {
                $userId = $this->db->insert(
                    "INSERT INTO mn_users
                     (first_name, last_name, email, mobile_no, user_type, date_created, is_active)
                     VALUES (?,?,?,?,3,CURDATE(),1)",
                    [
                        $body['first_name'] ?? '',
                        $body['last_name']  ?? '',
                        $email,
                        $body['mobile_no']  ?? '',
                    ],
                );
                $newUserId = $userId; // remember for compensating delete
            }
        }

        // Queue position for walk-in roles
        $queuePosition = null;
        if (in_array(Auth::roleId(), [8, 23], true)) {
            $wf = $this->db->queryOne(
                "SELECT next_role FROM mn_workflows_actions
                 WHERE section='IDL' AND action='CREATE_REQUEST_WALKIN' LIMIT 1",
            );
            $queuePosition = $wf['next_role'] ?? null;
        }

        // Roles 8 & 23 (walk-in): cashier collects payment later → paid_status=0
        // Role 2 (public): pays via Telr online gateway → paid_status=0 until telrVerify confirms
        // All other staff roles: pre-paid → paid_status=1
        $publicRole  = Auth::roleId() === 2;
        $walkinRoles = in_array(Auth::roleId(), [8, 23], true);
        $paidStatus  = ($publicRole || $walkinRoles) ? 0 : 1;
        $typeOfDl   = $body['type_of_dl'] ?? null;
        $totalAmount = $this->calcIdlTotal($body['delivery_option']);

        $id        = null;
        $requestId = null;

        try {
            // 1. Insert into mn_idl_requests
            $id = $this->db->insert(
                "INSERT INTO mn_idl_requests
                 (request_id, request_type, belonging_user_id, requested_by, travel_insurance,
                  delivery_option, delivery_address, total_amount, paid_status,
                  requested_datetime, request_status, payment_method, is_active, booking_channel,
                  current_queue_position)
                 VALUES (?,?,?,?,?,?,?,?,?,NOW(),1,?,1,?,?)",
                [
                    'PENDING',
                    $body['request_type']     ?? 'WALKIN',
                    $userId,
                    Auth::id(),
                    $body['travel_insurance'] ?? 0,
                    $body['delivery_option'],
                    $body['delivery_address'] ?? '',
                    $totalAmount,
                    $paidStatus,
                    $body['payment_method'],
                    'OFFICER',
                    $queuePosition,
                ],
            );

            if (!$id) {
                throw new \RuntimeException('Failed to create IDL request — no ID returned');
            }

            // 2. Update request_id to the real formatted value
            $requestId = sprintf('IDL-ATC-%s/%d', date('Ymd'), $id);
            $affected  = $this->db->execute(
                'UPDATE mn_idl_requests SET request_id=? WHERE auto_id=?',
                [$requestId, $id],
            );

            if ($affected === 0) {
                throw new \RuntimeException('Failed to set request ID on IDL request');
            }

            // 3. Insert applicant snapshot into mn_idl_request_user
            $this->db->execute(
                "INSERT INTO mn_idl_request_user
                 (request_auto_id, user_id, first_name, last_name, nationality, sex, dob,
                  emirates_id, address_in_uae, po_box, city, home_country_address,
                  license_no, place_of_birth, place_of_issue, issued_date, expiry_date,
                  type_of_dl, emirate, first_idl, additional_mobile_no, additional_email,
                  registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())",
                [
                    $id,
                    $userId,
                    $body['first_name']           ?? '',
                    $body['last_name']            ?? '',
                    $body['nationality']          ?? null,
                    $body['sex']                  ?? null,
                    $body['dob']                  ?: null,
                    $emiratesId,
                    $body['address_in_uae']       ?? '',
                    $body['po_box']               ?? '',
                    $body['city']                 ?? '',
                    $body['home_country_address'] ?? '',
                    $body['license_no']           ?? '',
                    $body['place_of_birth']       ?? '',
                    $body['place_of_issue']       ?: null,
                    $body['issued_date']          ?: null,
                    $body['expiry_date']          ?: null,
                    $typeOfDl,
                    $body['emirate']              ?: null,
                    $body['first_idl']            ?? 1,
                    $body['additional_mobile_no'] ?? '',
                    $body['additional_email']     ?? '',
                ],
            );

            // 4. Event log
            $this->db->execute(
                "INSERT INTO mn_event_logs (log_module, log_action, action_initiator, log_datetime, extra_params)
                 VALUES ('IDL','CREATE',?,NOW(),?)",
                [$officerId, $requestId],
            );

        } catch (\Throwable $e) {
            // ── Compensating deletes (MyISAM has no transactions) ─────────────
            if ($id) {
                $this->db->execute('DELETE FROM mn_idl_request_user WHERE request_auto_id=?', [$id]);
                $this->db->execute('DELETE FROM mn_idl_requests WHERE auto_id=?', [$id]);
            }
            if ($newUserId) {
                $this->db->execute('DELETE FROM mn_users WHERE user_id=?', [$newUserId]);
            }

            Response::serverError('Your application could not be saved — please try again. (' . $e->getMessage() . ')');
        }

        Response::created(['auto_id' => $id, 'request_id' => $requestId]);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    public function update(array $params, array $body, array $query): void
    {
        $allowed = ['delivery_option','delivery_address','payment_method','air_bill_no','officer_comments','idl_no','idl_booklet_no'];
        $sets    = [];
        $binds   = [];

        foreach ($allowed as $f) {
            if (array_key_exists($f, $body)) {
                $sets[]  = "{$f}=?";
                $binds[] = $body[$f];
            }
        }
        if (empty($sets)) Response::error('No updatable fields provided');

        $binds[] = $params['id'];
        $this->db->execute("UPDATE mn_idl_requests SET " . implode(',', $sets) . " WHERE auto_id=?", $binds);
        Response::success(null, 'Request updated');
    }

    // ── Workflow actions ──────────────────────────────────────────────────────

    public function approve(array $params, array $body, array $query): void
    {
        $this->guardStatus($params['id'], [1, 2], 'approve');

        $current = (int)$this->db->scalar(
            'SELECT request_status FROM mn_idl_requests WHERE auto_id=?',
            [$params['id']],
        );

        if ($current === 1) {
            // Cashier accepts payment → look up next queue position from workflow
            // Action: APPROVE_REQUEST_CASHIER_WALKIN → next_role: IDL_Officer
            $wf = $this->db->queryOne(
                "SELECT next_role FROM mn_workflows_actions
                 WHERE section='IDL' AND action='APPROVE_REQUEST_CASHIER_WALKIN' LIMIT 1",
            );
            $nextQueue = $wf['next_role'] ?? null;

            $this->db->execute(
                "UPDATE mn_idl_requests
                 SET request_status=2, paid_status=1, paid_date=NOW(),
                     current_queue_position=?, processed_by=?
                 WHERE auto_id=?",
                [$nextQueue, Auth::id(), $params['id']],
            );
            $this->logEvent('CASHIER_APPROVE', $params['id']);
            Response::success(['next_queue' => $nextQueue], 'Payment accepted — request sent to IDL Officer');
        } else {
            // IDL Officer / Cashier approves paid request → status 4
            // Also update idl_no, idl_booklet_no, air_bill_no if provided
            $sets   = ['request_status=4', 'processed_by=?'];
            $binds  = [Auth::id()];

            if (!empty($body['idl_no'])) {
                $sets[]  = 'idl_no=?';
                $binds[] = $body['idl_no'];
            }
            if (!empty($body['idl_booklet_no'])) {
                $sets[]  = 'idl_booklet_no=?';
                $binds[] = $body['idl_booklet_no'];
            }
            if (!empty($body['air_bill_no'])) {
                $sets[]  = 'air_bill_no=?';
                $binds[] = $body['air_bill_no'];
            }

            $binds[] = $params['id'];
            $this->db->execute(
                'UPDATE mn_idl_requests SET ' . implode(', ', $sets) . ' WHERE auto_id=?',
                $binds,
            );
            $this->logEvent('APPROVE', $params['id']);
            Response::success(null, 'Request approved');
        }
    }

    public function reject(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('reason')->validate();
        $this->guardStatus($params['id'], [1, 2], 'reject');

        $this->db->execute(
            "UPDATE mn_idl_requests SET request_status=3, reject_reason=? WHERE auto_id=?",
            [$body['reason'], $params['id']],
        );
        $this->logEvent('REJECT', $params['id']);
        Response::success(null, 'Request rejected');
    }

    public function issue(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('idl_no', 'idl_booklet_no')->validate();

        // Check booklet not already used
        $used = (int)$this->db->scalar(
            'SELECT COUNT(*) FROM mn_idl_requests WHERE idl_booklet_no=? AND is_active=1 AND auto_id!=?',
            [$body['idl_booklet_no'], $params['id']],
        );
        if ($used > 0) Response::error('Booklet number already assigned to another request', 409);

        $this->db->execute(
            "UPDATE mn_idl_requests
             SET request_status=4, idl_no=?, idl_booklet_no=?,
                 issued_date=NOW(), paid_status=1, paid_date=NOW(), processed_by=?
             WHERE auto_id=?",
            [$body['idl_no'], $body['idl_booklet_no'], Auth::id(), $params['id']],
        );
        $this->logEvent('ISSUE', $params['id'], $body['idl_no']);

        Response::success(null, 'IDL issued successfully');
    }

    public function markDispatched(array $params, array $body, array $query): void
    {
        $this->db->execute(
            "UPDATE mn_idl_requests SET request_status=5, air_bill_no=? WHERE auto_id=?",
            [$body['air_bill_no'] ?? '', $params['id']],
        );
        $this->logEvent('DISPATCH', $params['id']);
        Response::success(null, 'Marked as dispatched');
    }

    public function cancel(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('reason')->validate();

        $this->db->execute(
            "UPDATE mn_idl_requests SET request_status=7, reject_reason=? WHERE auto_id=?",
            [$body['reason'], $params['id']],
        );
        $this->logEvent('CANCEL', $params['id']);
        Response::success(null, 'Request cancelled');
    }

    /**
     * POST /api/idl/requests/{id}/cancel-own
     * Customer self-service cancel — no staff workflow. Only the request's own
     * owner may call this, and only while it's still unpaid (status 1).
     */
    public function cancelOwn(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];

        $req = $this->db->queryOne(
            'SELECT auto_id, belonging_user_id, paid_status FROM mn_idl_requests WHERE auto_id=?',
            [$autoId],
        );
        if ($req === null) Response::notFound('IDL request not found');

        if ((int)$req['belonging_user_id'] !== Auth::id()) {
            Response::forbidden('Access denied');
        }
        if ((int)$req['paid_status'] === 1) {
            Response::error('Only an unpaid request can be cancelled directly', 409);
        }

        $this->db->execute('UPDATE mn_idl_requests SET request_status=7 WHERE auto_id=?', [$autoId]);
        $this->logEvent('CANCEL', $autoId, 'Self-service (unpaid)');

        Response::success(null, 'Request cancelled');
    }

    /**
     * POST /api/idl/requests/{id}/void
     * Voids an issued/dispatched IDL (e.g. printed in error, damaged booklet).
     * Restricted to idl_officer, and only for status 4 (Approved) or 5 (Dispatched).
     */
    public function voidRequest(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('comment')->validate();

        $autoId = (int)$params['id'];
        $user   = Auth::user();

        if (($user['role_name'] ?? '') !== 'idl_officer') {
            Response::forbidden('Access denied');
        }

        $status = $this->db->scalar('SELECT request_status FROM mn_idl_requests WHERE auto_id=?', [$autoId]);
        if ($status === null) Response::notFound('IDL request not found');
        if (!in_array((int)$status, [4, 5], true)) {
            Response::error('Only an issued or dispatched IDL can be voided', 409);
        }

        $this->db->execute(
            "UPDATE mn_idl_requests SET request_status=3, processed_by=?, idl_no='' WHERE auto_id=?",
            [Auth::id(), $autoId],
        );
        $this->db->execute(
            "INSERT INTO mn_idl_voided_requests (request_auto_id, comment, voided_by, voided_datetime)
             VALUES (?, ?, ?, NOW())",
            [$autoId, $body['comment'], Auth::id()],
        );
        $this->logEvent('VOID', $autoId, $body['comment']);

        Response::success(null, 'Request voided');
    }

    /**
     * GET /api/idl/requests/{id}/print
     * Streams a print-ready PDF of the issued IDL (physical booklet overlay).
     * Ported from the legacy application/views/idl/print-idl.phtml — restricted
     * to idl_officer, and only once the request has been issued (status 4).
     */
    public function printIdl(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];
        $user   = Auth::user();

        if (($user['role_name'] ?? '') !== 'idl_officer') {
            Response::forbidden('Access denied');
        }

        $r = $this->db->queryOne(
            "SELECT r.*, iru.*,
                    n.nationality,
                    r.issued_date AS idl_issued_date
             FROM mn_idl_requests r
             JOIN mn_idl_request_user iru ON r.auto_id = iru.request_auto_id
             LEFT JOIN mn_nationalities n ON iru.nationality = n.nationality_id
             WHERE r.auto_id = ?",
            [$autoId],
        );
        if ($r === null) Response::notFound('IDL request not found');
        if ((int)$r['request_status'] !== 4) {
            Response::error('IDL can only be printed once it has been issued', 409);
        }

        require_once API_ROOT . '/library/phpqrcode/qrlib.php';
        require_once API_ROOT . '/vendor/autoload.php';

        $imagesDir = dirname(API_ROOT) . '/public/images';
        $reqDir    = API_ROOT . '/' . Config::UPLOADS_DIR . '/' . $autoId;
        if (!is_dir($reqDir)) mkdir($reqDir, 0755, true);

        // ── Per-officer print calibration (falls back to the shared default template) ──
        $margins = $this->db->queryOne('SELECT * FROM mn_idl_user_margins WHERE user_id=?', [$user['user_id']]);
        $defaultCoordinates = '{"top_atc_string":{"x":"90","y":"34"},"issued_date":{"x":"74","y":"42"},"qr_code":{"x":"88","y":"46"},"last_name":{"x":"47","y":"86"},"first_name":{"x":"47","y":"93"},"place_of_birth":{"x":"47","y":"100"},"dob":{"x":"47","y":"107"},"city":{"x":"47","y":"113"},"sex":{"x":"47","y":"121"},"nationality":{"x":"62","y":"121"},"idl_no":{"x":"47","y":"127"},"license_no":{"x":"47","y":"136"},"center_image":{"x":"84","y":"103"},"class_A_tick":{"x":"130","y":"86"},"class_B_tick":{"x":"130","y":"91"},"class_C_tick":{"x":"130","y":"97"},"class_D_tick":{"x":"130","y":"103"},"class_E_tick_1":{"x":"130","y":"91"},"class_E_tick_2":{"x":"130","y":"108"}}';
        $coordinates = json_decode($margins['component_coordinates'] ?? $defaultCoordinates);
        $x_px = (float)($margins['left_margin'] ?? 0) * 1.333333;
        $y_px = (float)($margins['top_margin'] ?? 0) * 1.333333;

        // ── Passport photo — corrected orientation + resized to the fixed 97×135 print size ──
        $passportSrc = null;
        foreach (['jpg', 'png'] as $ext) {
            if (file_exists("$reqDir/passport.$ext")) { $passportSrc = "$reqDir/passport.$ext"; break; }
        }
        $passportPrint = $passportSrc
            ? $this->makePrintPassport($passportSrc, "$reqDir/passport_print")
            : $this->makePrintPassport("$imagesDir/user.png", "$reqDir/passport_print");

        // ── QR code — encodes the verification link for this issued IDL ──
        $printHash = $r['print_hash'];
        if (empty($printHash)) {
            $printHash = md5(time() . $autoId);
            $this->db->execute('UPDATE mn_idl_requests SET print_hash=? WHERE auto_id=?', [$printHash, $autoId]);
        }
        $qrPath = "$reqDir/qrcode.png";
        QRcode::png(Config::frontendUrl() . '/display/' . $printHash, $qrPath, '', '1.5', '5');

        // ── Build the absolute-positioned overlay segments (mirrors print-idl.phtml) ──
        $dlTypes = array_map('trim', explode(',', (string)$r['type_of_dl']));
        $tickImg = "$imagesDir/tick_black.png";

        $segments   = [];
        $segments[] = ['html' => '<img src="'.$passportPrint.'" />', 'x' => $coordinates->center_image->x + $x_px, 'y' => $coordinates->center_image->y + $y_px];

        // Legacy numeric dl_type codes (1–5) map directly to the booklet's class A–E tick positions
        $tickMap = [
            '1' => 'class_A_tick', '2' => 'class_B_tick', '3' => 'class_C_tick',
            '4' => 'class_D_tick', '5' => 'class_E_tick_2',
        ];
        foreach ($tickMap as $code => $coordKey) {
            if (in_array((string)$code, $dlTypes, true)) {
                $coord      = $coordinates->$coordKey;
                $segments[] = ['html' => '<img style="width:20px;height:20px;" src="'.$tickImg.'" />', 'x' => $coord->x + $x_px, 'y' => $coord->y + $y_px];
            }
        }

        $segments[] = ['html' => '<img src="'.$qrPath.'" />', 'x' => $coordinates->qr_code->x + $x_px, 'y' => $coordinates->qr_code->y];

        $fromName   = $r['request_type'] === 'RTA' ? 'RTA' : 'ATCUAE ONLINE';
        $segments[] = ['html' => $fromName, 'x' => $coordinates->top_atc_string->x + $x_px, 'y' => $coordinates->top_atc_string->y + $y_px];

        $issuedBasis = $r['request_type'] === 'RTA' ? $r['requested_datetime'] : $r['idl_issued_date'];
        $dateText    = 'FROM ' . date('Y-m-d', strtotime($issuedBasis)) . ' To ' . date('Y-m-d', strtotime($issuedBasis . ' + 365 day'));
        $segments[]  = ['html' => $dateText, 'x' => $coordinates->issued_date->x + $x_px, 'y' => $coordinates->issued_date->y + $y_px];

        $segments[] = ['html' => strtoupper((string)($r['last_name'] ?? '')),       'x' => $coordinates->last_name->x + $x_px,       'y' => $coordinates->last_name->y + $y_px];
        $segments[] = ['html' => strtoupper((string)($r['first_name'] ?? '')),      'x' => $coordinates->first_name->x + $x_px,      'y' => $coordinates->first_name->y + $y_px];
        $segments[] = ['html' => strtoupper((string)($r['place_of_birth'] ?? '')),  'x' => $coordinates->place_of_birth->x + $x_px,  'y' => $coordinates->place_of_birth->y + $y_px];
        $segments[] = ['html' => strtoupper((string)($r['dob'] ?? '')),             'x' => $coordinates->dob->x + $x_px,             'y' => $coordinates->dob->y + $y_px];
        $segments[] = ['html' => strtoupper((string)($r['city'] ?? '')),            'x' => $coordinates->city->x + $x_px,            'y' => $coordinates->city->y + $y_px];
        $segments[] = ['html' => strtoupper((string)($r['sex'] ?? '')),             'x' => $coordinates->sex->x + $x_px,             'y' => $coordinates->sex->y + $y_px];
        $segments[] = ['html' => strtoupper((string)($r['nationality'] ?? '')),     'x' => $coordinates->nationality->x + $x_px,     'y' => $coordinates->nationality->y + $y_px];

        $idText     = $r['request_type'] === 'RTA' ? $r['request_id'] : $r['idl_no'];
        $segments[] = ['html' => strtoupper((string)$idText),                      'x' => $coordinates->idl_no->x + $x_px,          'y' => $coordinates->idl_no->y + $y_px];
        $segments[] = ['html' => strtoupper((string)($r['license_no'] ?? '')),      'x' => $coordinates->license_no->x + $x_px,      'y' => $coordinates->license_no->y + $y_px];

        $this->logEvent('PRINT', $autoId);

        $pdf = new \TCPDF(PDF_PAGE_ORIENTATION, PDF_UNIT, PDF_PAGE_FORMAT, true, 'UTF-8', false);
        $pdf->SetCreator(PDF_CREATOR);
        $pdf->SetAuthor('');
        $pdf->SetTitle('');
        $pdf->SetSubject('');
        $pdf->SetKeywords('');
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(false);
        $pdf->SetDefaultMonospacedFont(PDF_FONT_MONOSPACED);
        $pdf->SetMargins(PDF_MARGIN_LEFT, 10, PDF_MARGIN_RIGHT);
        $pdf->SetAutoPageBreak(true, PDF_MARGIN_BOTTOM);
        $pdf->setImageScale(PDF_IMAGE_SCALE_RATIO);
        $pdf->setFontSubsetting(true);
        $pdf->SetFont('dejavusans', '', 9, '', true);
        $pdf->AddPage();

        foreach ($segments as $segment) {
            $pdf->SetFontSize($segment['font_size'] ?? 8);
            $pdf->writeHTMLCell(0, 0, $segment['x'], $segment['y'], $segment['html'], 0, 1, 0, true, '', false);
        }

        $pdf->Output(($r['idl_no'] ?: $r['request_id']) . '.pdf', 'I');
        exit;
    }

    /**
     * Corrects EXIF orientation and resizes to the fixed 97×135 print size used on the IDL overlay,
     * writing a *_print.<ext> copy alongside the source — never mutates the original upload.
     */
    private function makePrintPassport(string $sourcePath, string $targetBase): string
    {
        $info = getimagesize($sourcePath);
        $mime = $info['mime'] ?? 'image/png';
        [$createFn, $saveFn, $ext] = match ($mime) {
            'image/jpeg' => ['imagecreatefromjpeg', 'imagejpeg', 'jpg'],
            'image/png'  => ['imagecreatefrompng',  'imagepng',  'png'],
            default      => throw new RuntimeException('Unsupported passport image type'),
        };

        $img = $createFn($sourcePath);

        if ($ext === 'jpg' && function_exists('exif_read_data')) {
            $exif   = @exif_read_data($sourcePath);
            $rotate = ['3' => 180, '6' => -90, '8' => 90][(string)($exif['Orientation'] ?? '')] ?? null;
            if ($rotate !== null) {
                $img = imagerotate($img, $rotate, 0);
            }
        }

        $resized = imagecreatetruecolor(97, 135);
        imagecopyresampled($resized, $img, 0, 0, 0, 0, 97, 135, imagesx($img), imagesy($img));

        $targetPath = "$targetBase.$ext";
        if (file_exists($targetPath)) unlink($targetPath);
        $saveFn($resized, $targetPath);

        return $targetPath;
    }

    // ── Lookups ───────────────────────────────────────────────────────────────

    public function nationalities(array $params, array $body, array $query): void
    {
        $data = $this->db->query(
            'SELECT nationality_id, nationality FROM mn_nationalities ORDER BY nationality',
        );
        Response::success($data);
    }

    public function dlTypes(array $params, array $body, array $query): void
    {
        $data = $this->db->query('SELECT type_id, dl_type FROM mn_idl_dl_types ORDER BY type_id');
        Response::success($data);
    }

    public function emiratesLookup(array $params, array $body, array $query): void
    {
        $data = $this->db->query('SELECT emirate_id, emirate FROM mn_emirates ORDER BY emirate_id');
        Response::success($data);
    }

    public function statusLookup(array $params, array $body, array $query): void
    {
        $data = $this->db->query('SELECT status_id, status FROM mn_idl_status ORDER BY status_id');
        Response::success($data);
    }

    // ── Booklets ──────────────────────────────────────────────────────────────

    public function booklets(array $params, array $body, array $query): void
    {
        $data = $this->db->query(
            'SELECT booklet_id, booklet_no, serial_no, is_used, added_date FROM mn_idl_booklets ORDER BY serial_no',
        );
        Response::success($data);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function buildFilters(string $search, string $status, string $type, bool $defaultPending = false, ?int $roleId = null): array
    {
        $where = 'WHERE r.is_active=1';
        $binds = [];

        // Roles 23 (idl_cpd_walkin) and 25 (idl_cpd_cashier) can only see requests in their queue
        if ($roleId === 23 || $roleId === 25) {
            $where   .= ' AND r.current_queue_position=?';
            $binds[]  = 'IDL_CPD_Cashier';
        }

        if ($search !== '') {
            $like = '%' . $search . '%';

            // Pre-query mn_idl_request_user for name/emirates_id/license matches
            $iruIds = $this->db->query(
                "SELECT DISTINCT request_auto_id FROM mn_idl_request_user
                 WHERE first_name  LIKE ?
                    OR last_name   LIKE ?
                    OR emirates_id LIKE ?
                    OR license_no  LIKE ?",
                [$like, $like, $like, $like],
            );
            $iruAutoIds = array_column($iruIds, 'request_auto_id');

            if (!empty($iruAutoIds)) {
                $in     = implode(',', array_map('intval', $iruAutoIds));
                $where .= " AND (r.request_id LIKE ? OR r.idl_no LIKE ? OR r.auto_id IN ({$in}))";
            } else {
                $where .= " AND (r.request_id LIKE ? OR r.idl_no LIKE ?)";
            }
            array_push($binds, $like, $like);
        }

        // 'all' means explicitly override the default and show everything
        // 'pending' means explicitly request statuses 1 & 2
        // '' with $defaultPending means apply the default IN (1,2)
        if ($status === 'pending') {
            $where .= ' AND r.request_status IN (1,2)';
        } elseif ($status === 'all') {
            // No status restriction — show everything
        } elseif ($status !== '') {
            $where   .= ' AND r.request_status=?';
            $binds[]  = $status;
        } elseif ($defaultPending) {
            $where .= ' AND r.request_status IN (1,2)';
        }

        if ($type !== '' && $type !== 'all') {
            if ($type === 'ONLINE_WEBSITE') {
                $where   .= " AND r.request_type IN ('ONLINE','WEBSITE')";
            } else {
                $where   .= ' AND r.request_type=?';
                $binds[]  = $type;
            }
        }

        return [$where, $binds];
    }

    private function guardStatus(string|int $id, array $allowedStatuses, string $action): void
    {
        $current = (int)$this->db->scalar('SELECT request_status FROM mn_idl_requests WHERE auto_id=?', [$id]);
        if ($current === 0) Response::notFound('IDL request not found');
        if (!in_array($current, $allowedStatuses, true)) {
            Response::error("Cannot {$action} a request in its current status", 409);
        }
    }

    private function logEvent(string $action, string|int $id, string $extra = ''): void
    {
        $this->db->execute(
            "INSERT INTO mn_event_logs (log_module, log_action, action_initiator, log_datetime, extra_params)
             VALUES ('IDL',?,?,NOW(),?)",
            [$action, Auth::id(), $extra ?: (string)$id],
        );
    }

    private function nextSeq(): int
    {
        return (int)$this->db->scalar('SELECT COUNT(*)+1 FROM mn_idl_requests');
    }
}
