<?php
declare(strict_types=1);

class ReportController
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // ── IDL report ────────────────────────────────────────────────────────────

    public function idlReport(array $params, array $body, array $query): void
    {
        $v        = Validator::make($query);
        $dateFrom = $v->get('date_from', date('Y-m-01'));
        $dateTo   = $v->get('date_to',   date('Y-m-d'));
        $type     = $v->get('type', '');
        $status   = $v->get('status', '');

        $where  = 'WHERE r.is_active=1 AND DATE(r.requested_datetime) BETWEEN ? AND ?';
        $binds  = [$dateFrom, $dateTo];

        if ($type !== '')   { $where .= ' AND r.request_type=?';   $binds[] = $type; }
        if ($status !== '') { $where .= ' AND r.request_status=?'; $binds[] = $status; }

        $rows = $this->db->query(
            "SELECT r.request_id, r.request_type, r.requested_datetime,
                    r.idl_no, r.payment_method, r.total_amount, r.paid_status,
                    r.delivery_option, r.air_bill_no,
                    s.status AS status_label,
                    u.first_name, u.last_name, u.email, u.mobile_no,
                    n.nationality,
                    iu.license_no, iu.issued_date, iu.expiry_date
             FROM mn_idl_requests r
             LEFT JOIN mn_users u ON u.user_id = r.belonging_user_id
             LEFT JOIN mn_idl_users iu ON iu.user_id = r.belonging_user_id
             LEFT JOIN mn_nationalities n ON n.nationality_id = iu.nationality
             LEFT JOIN mn_idl_status s ON s.status_id = r.request_status
             {$where}
             ORDER BY r.auto_id DESC",
            $binds,
        );

        // Summary stats
        $summary = [
            'total'    => count($rows),
            'issued'   => count(array_filter($rows, fn($r) => $r['paid_status'] == 1)),
            'revenue'  => array_sum(array_column(array_filter($rows, fn($r) => $r['paid_status'] == 1), 'total_amount')),
            'by_type'  => $this->groupCount($rows, 'request_type'),
            'by_status'=> $this->groupCount($rows, 'status_label'),
        ];

        if ($v->get('format') === 'csv') {
            $this->exportCsv($rows, 'idl_report', [
                'request_id','request_type','first_name','last_name','email',
                'nationality','license_no','issued_date','expiry_date',
                'idl_no','payment_method','total_amount','status_label','requested_datetime',
            ]);
        }

        Response::success(['rows' => $rows, 'summary' => $summary]);
    }

    // ── CPD report ────────────────────────────────────────────────────────────

    public function cpdReport(array $params, array $body, array $query): void
    {
        $v        = Validator::make($query);
        $dateFrom = $v->get('date_from', date('Y-m-01'));
        $dateTo   = $v->get('date_to',   date('Y-m-d'));
        $status   = $v->get('status', '');
        $category = $v->get('category', '');

        $where  = 'WHERE DATE(r.requested_datetime) BETWEEN ? AND ?';
        $binds  = [$dateFrom, $dateTo];

        if ($status !== '')   { $where .= ' AND r.request_status=?';   $binds[] = $status; }
        if ($category !== '') { $where .= ' AND r.request_category=?'; $binds[] = $category; }

        $rows = $this->db->query(
            "SELECT r.request_id, r.request_category, r.request_status,
                    r.vehicle_make, r.vehicle_model, r.vehicle_no, r.chassis_no,
                    r.guarantee_amount, r.booking_fee, r.vat_amount, r.total_amount,
                    r.method_of_payment, r.carnet_no, r.requested_datetime, r.issued_datetime,
                    u.first_name, u.last_name, u.email
             FROM mn_cpd_requests r
             LEFT JOIN mn_users u ON u.user_id = r.user_id
             {$where}
             ORDER BY r.auto_id DESC",
            $binds,
        );

        $summary = [
            'total'          => count($rows),
            'total_revenue'  => array_sum(array_column($rows, 'total_amount')),
            'by_status'      => $this->groupCount($rows, 'request_status'),
            'by_category'    => $this->groupCount($rows, 'request_category'),
            'by_payment'     => $this->groupCount($rows, 'method_of_payment'),
        ];

        if ($v->get('format') === 'csv') {
            $this->exportCsv($rows, 'cpd_report', [
                'request_id','request_category','request_status',
                'first_name','last_name','email',
                'vehicle_make','vehicle_model','vehicle_no','chassis_no',
                'guarantee_amount','booking_fee','vat_amount','total_amount',
                'method_of_payment','carnet_no','requested_datetime','issued_datetime',
            ]);
        }

        Response::success(['rows' => $rows, 'summary' => $summary]);
    }

    // ── Activity log ──────────────────────────────────────────────────────────

    public function activityLog(array $params, array $body, array $query): void
    {
        $v    = Validator::make($query);
        $page = $v->int('page', 1);

        $result = $this->db->paginate(
            "SELECT log_id, log_module, log_action, action_initiator, log_datetime, extra_params
             FROM mn_event_logs ORDER BY log_id DESC",
            [], $page, 50,
        );
        Response::success($result);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function groupCount(array $rows, string $key): array
    {
        $groups = [];
        foreach ($rows as $r) {
            $val = $r[$key] ?? 'Unknown';
            $groups[$val] = ($groups[$val] ?? 0) + 1;
        }
        arsort($groups);
        return array_map(
            fn($k, $v) => ['label' => $k, 'count' => $v],
            array_keys($groups), $groups,
        );
    }

    private function exportCsv(array $rows, string $filename, array $columns): never
    {
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="' . $filename . '_' . date('Ymd_His') . '.csv"');
        header('Pragma: no-cache');

        $out = fopen('php://output', 'wb');
        fputcsv($out, $columns);
        foreach ($rows as $row) {
            $line = [];
            foreach ($columns as $col) {
                $val = $row[$col] ?? '';
                $line[] = is_string($val) ? $val : (string)$val;
            }
            fputcsv($out, $line);
        }
        fclose($out);
        exit;
    }
}
