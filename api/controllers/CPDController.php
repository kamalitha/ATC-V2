<?php
declare(strict_types=1);

class CPDController
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    public function stats(array $params, array $body, array $query): void
    {
        $total    = (int)$this->db->scalar('SELECT COUNT(*) FROM mn_cpd_requests');
        $pending  = (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE current_queue_position='CPD_Officer'");
        $confirmed= (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE request_status='Confirmed'");
        $issued   = (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE request_status='Issued'");
        $returned = (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE request_status='Returned'");
        $cancelled= (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE request_status='Cancelled'");
        $revenue  = (float)$this->db->scalar(
            "SELECT COALESCE(SUM(total_amount),0) FROM mn_cpd_requests WHERE request_status IN ('Confirmed','Issued','Returned')",
        );
        $this_month = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests
             WHERE MONTH(requested_datetime)=MONTH(NOW()) AND YEAR(requested_datetime)=YEAR(NOW())",
        );
        $stock_available = (int)$this->db->scalar(
            'SELECT COUNT(*) FROM mn_cpd_carnets WHERE is_used=0 AND is_damaged=0',
        );

        $online_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests WHERE booking_channel='ONLINE' AND request_status IN ('NEW','Processing',1,2)",
        );
        $walkin_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests WHERE booking_channel='WALKIN' AND request_status IN ('NEW','Processing',1,2)",
        );

        $cashier_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests WHERE current_queue_position='IDL_CPD_Cashier'",
        );
        $idl_cashier_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_idl_requests WHERE current_queue_position='IDL_CPD_Cashier' AND is_active=1",
        );
        $cancellations_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_cancelled_requests WHERE cancelled_approved=0",
        );
        $returns_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_carnet_returns WHERE confirmed_by=0",
        );

        Response::success(compact(
            'total','pending','confirmed','issued','returned','cancelled',
            'revenue','this_month','stock_available','online_pending','walkin_pending',
            'cashier_pending','idl_cashier_pending','cancellations_pending','returns_pending',
        ));
    }

    // ── List ──────────────────────────────────────────────────────────────────

    public function index(array $params, array $body, array $query): void
    {
        $v               = Validator::make($query);
        $page            = $v->int('page', 1);
        $search          = $v->get('search', '');
        $status          = $v->get('status', '');
        $category        = $v->get('category', '');
        $bookingChannel  = $v->get('booking_channel', '');
        $queuePosition   = $v->get('queue_position', '');
        $requestType     = $v->get('request_type', '');

        [$where, $binds] = $this->buildFilters($search, $status, $category, $bookingChannel, $queuePosition, $requestType);

        $sql = "SELECT r.auto_id, r.request_id, r.request_category, r.request_status,
                    r.request_type,
                    COALESCE(s.status, r.request_status) AS status_label,
                    r.vehicle_make, r.vehicle_model, r.chassis_no,
                    r.total_amount, r.requested_datetime, r.method_of_payment,
                    u.first_name, u.last_name, u.email,
                    IF(g.request_id IS NOT NULL, 1, 0) AS has_cheque
             FROM mn_cpd_requests r
             LEFT JOIN mn_users u         ON u.user_id          = r.belonging_user_id
             LEFT JOIN mn_cpd_statuses s  ON s.carnet_status_id = r.request_status
             LEFT JOIN (SELECT DISTINCT request_id FROM mn_cpd_return_guarantee_details) g
                       ON g.request_id = r.auto_id
             {$where}
             ORDER BY r.auto_id DESC";

        $countSql = "SELECT COUNT(*) FROM mn_cpd_requests r {$where}";

        $result = $this->db->paginate($sql, $binds, $page, 20, $countSql);

        Response::success($result);
    }

    public function myRequests(array $params, array $body, array $query): void
    {
        $userId = Auth::id();
        $page   = max(1, (int)($query['page'] ?? 1));

        $result = $this->db->paginate(
            "SELECT r.auto_id, r.request_id, r.request_category, r.request_status,
                    COALESCE(s.status, r.request_status) AS status_label,
                    IFNULL(r.paid_status, 0) AS paid_status,
                    r.vehicle_make, r.vehicle_model, r.total_amount,
                    r.requested_datetime
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_statuses s ON s.carnet_status_id = r.request_status
             WHERE r.belonging_user_id = ?
             ORDER BY r.auto_id DESC",
            [$userId], $page,
        );

        Response::success($result);
    }

    // ── Single ────────────────────────────────────────────────────────────────

    public function show(array $params, array $body, array $query): void
    {
        $r = $this->db->queryOne(
            "SELECT r.*,
                    COALESCE(s.status, r.request_status) AS status_label,
                    u.email, u.mobile_no,
                    (SELECT COUNT(*) FROM mn_cpd_issued_carnets ic WHERE ic.request_id = r.auto_id) AS has_issued_carnet,
                    -- Owner details from mn_cpd_request_user (public store) with fallback to mn_cpd_users
                    COALESCE(cru.title,                cu.title)                AS title,
                    COALESCE(cru.first_name,           u.first_name)            AS first_name,
                    COALESCE(cru.last_name,            u.last_name)             AS last_name,
                    COALESCE(cru.nationality_id,       cu.nationality_id)       AS nationality_id,
                    COALESCE(cru.city,                 cu.city)                 AS city,
                    COALESCE(cru.dob,                  cu.dob)                  AS dob,
                    COALESCE(cru.emirates_id,          cu.emirates_id)          AS emirates_id,
                    COALESCE(cru.passport_no,          cu.passport_no)          AS passport_no,
                    COALESCE(cru.home_country_address, cu.home_country_address) AS home_country_address,
                    COALESCE(cru.uae_address,          cu.uae_address)          AS uae_address,
                    COALESCE(cru.po_box,               cu.po_box)               AS po_box
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_statuses     s   ON s.carnet_status_id = r.request_status
             LEFT JOIN mn_users            u   ON u.user_id          = r.belonging_user_id
             LEFT JOIN mn_cpd_request_user cru ON cru.request_auto_id = r.auto_id
             LEFT JOIN mn_cpd_users        cu  ON cu.user_id          = r.belonging_user_id
             WHERE r.auto_id=?",
            [$params['id']],
        );
        if ($r === null) Response::notFound('CPD request not found');

        $r['countries'] = $this->db->query(
            "SELECT cl.country_id, cc.nationality
             FROM mn_cpd_request_country_list cl
             JOIN mn_cpd_countries cc ON cc.nationality_id = cl.country_id
             WHERE cl.request_id=?",
            [$r['auto_id']],
        );

        $r['payments'] = $this->db->query(
            "SELECT * FROM mn_cpd_bank_guarantee_details
             WHERE request_id=? ORDER BY added_datetime DESC",
            [$r['auto_id']],
        );

        $r['issued_carnet'] = $this->db->queryOne(
            "SELECT ic.carnet_issue_id, c.carnet_no, ic.issued_datetime,
                    CONCAT(u.first_name, ' ', u.last_name) AS issued_by_name
             FROM mn_cpd_issued_carnets ic
             JOIN mn_cpd_carnets c ON c.carnet_id  = ic.carnet_id
             JOIN mn_users       u ON u.user_id    = ic.issued_by
             WHERE ic.request_id = ?
             ORDER BY ic.carnet_issue_id DESC LIMIT 1",
            [$r['auto_id']],
        );

        $r['return_guarantee'] = $this->db->queryOne(
            "SELECT beneficiary_name, cheque_no, cheque_date, bank, remarks, added_datetime
             FROM mn_cpd_return_guarantee_details
             WHERE request_id = ?
             ORDER BY guarantee_cheque_id DESC LIMIT 1",
            [$r['auto_id']],
        );

        $r['carnet_return'] = $this->db->queryOne(
            "SELECT rr.return_id, rr.remarks, rr.delivery_method, rr.return_payment_method,
                    rr.delivery_fee, rr.order_ref, rr.order_status,
                    rr.added_datetime, rr.confirmed_by, rr.confirmed_datetime,
                    rr.cus_bank_information,
                    u.first_name AS submitted_by_first, u.last_name AS submitted_by_last
             FROM mn_cpd_carnet_returns rr
             LEFT JOIN mn_users u ON u.user_id = rr.added_by
             WHERE rr.request_id = ?
             ORDER BY rr.return_id DESC LIMIT 1",
            [$r['auto_id']],
        );

        Response::success($r);
    }

    // ── Telr Payment Verification (CPD) ──────────────────────────────────────

    public function telrVerify(array $params, array $body, array $query): void
    {
        $cartId = $_SESSION['telr_cart_id']    ?? null;
        $autoId = $_SESSION['telr_request_id'] ?? null;

        if (!$cartId || !$autoId) {
            Response::error('no_session', 403);
            return;
        }

        $req = $this->db->queryOne(
            "SELECT auto_id, belonging_user_id, paid_status, order_ref_no
             FROM mn_cpd_requests
             WHERE auto_id = ? AND telr_cart_id = ?",
            [(int)$autoId, $cartId],
        );

        if (!$req) {
            unset($_SESSION['telr_cart_id'], $_SESSION['telr_request_id'], $_SESSION['telr_module']);
            Response::notFound('No matching CPD request found');
        }

        if ((int)$req['belonging_user_id'] !== Auth::id()) {
            Response::forbidden('Access denied');
        }

        // Already paid — clear session and return success
        if ((int)$req['paid_status'] === 1) {
            unset($_SESSION['telr_cart_id'], $_SESSION['telr_request_id'], $_SESSION['telr_module']);
            Response::success(['already_paid' => true, 'auto_id' => $req['auto_id']], 'Payment already recorded');
            return;
        }

        // Verify with Telr
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

        if ((int)$status === 3) {
            // Ensure payment columns exist (added via migration)
            try {
                $this->db->execute('ALTER TABLE mn_cpd_requests ADD COLUMN IF NOT EXISTS `paid_status` tinyint DEFAULT 0');
                $this->db->execute('ALTER TABLE mn_cpd_requests ADD COLUMN IF NOT EXISTS `paid_date` datetime DEFAULT NULL');
            } catch (\Throwable $e) {
                Logger::warning('CPD telrVerify column check: ' . $e->getMessage());
            }

            $this->db->execute(
                "UPDATE mn_cpd_requests
                 SET paid_status              = 1,
                     paid_date                = NOW(),
                     order_ref_no             = ?,
                     request_status           = 2,
                     guarantee_paid_online    = 1,
                     booking_fee_status       = 1,
                     booking_fee_paid_by      = 'telr',
                     booking_fee_paid_date    = NOW(),
                     current_queue_position   = 'CPD_Officer'
                 WHERE auto_id = ?",
                [$telrRef ?? $orderRef, (int)$autoId],
            );

            unset($_SESSION['telr_cart_id'], $_SESSION['telr_request_id'], $_SESSION['telr_module']);

            Logger::info("CPD payment verified: auto_id={$autoId}, ref=" . ($telrRef ?? $orderRef));

            Response::success([
                'paid'     => true,
                'auto_id'  => (int)$autoId,
                'telr_ref' => $telrRef,
            ], 'CPD payment verified and recorded');
        } else {
            $statusText = $ipgOutput['order']['status']['text'] ?? 'Unknown';
            $statusCode = $ipgOutput['order']['status']['code'] ?? 'null';
            Response::error("Payment not confirmed — status code: {$statusCode}, text: {$statusText}", 402);
        }
    }

    public function telrModuleCheck(array $params, array $body, array $query): void
    {
        Response::success(['module' => $_SESSION['telr_module'] ?? 'IDL']);
    }

    // ── Telr: Return Carnet Aramex Payment ───────────────────────────────────

    public function telrInitReturn(array $params, array $body, array $query): void
    {
        $returnId = (int) $params['id'];

        $ret = $this->db->queryOne(
            "SELECT rr.return_id, rr.delivery_fee,
                    u.first_name, u.last_name, u.email
             FROM mn_cpd_carnet_returns rr
             JOIN mn_users u ON u.user_id = rr.added_by
             WHERE rr.return_id = ?",
            [$returnId],
        );
        if (!$ret) Response::notFound('Return request not found');
        if (empty($ret['delivery_fee'])) Response::error('No Aramex fee for this return', 422);

        $cartId = (string)time();

        $postfields = http_build_query([
            'ivp_method'   => 'create',
            'ivp_store'    => Config::TELR_STORE_ID,
            'ivp_authkey'  => Config::TELR_AUTH_KEY,
            'ivp_amount'   => $ret['delivery_fee'],
            'ivp_currency' => Config::TELR_CURRENCY,
            'ivp_test'     => Config::TELR_TEST,
            'ivp_cart'     => $cartId,
            'ivp_desc'     => 'CPD Carnet Return – Aramex Delivery Fee',
            'return_auth'  => Config::telrReturnUrl(),
            'return_decl'  => Config::telrDeclineUrl(),
            'return_can'   => Config::telrCancelUrl(),
            'bill_fname'   => $ret['first_name'] ?? '',
            'bill_sname'   => $ret['last_name']  ?? '',
            'bill_email'   => $ret['email']      ?? '',
        ]);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL,            'https://secure.telr.com/gateway/order.json');
        curl_setopt($ch, CURLOPT_POST,           true);
        curl_setopt($ch, CURLOPT_POSTFIELDS,     $postfields);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER,     ['Expect:']);
        curl_setopt($ch, CURLOPT_TIMEOUT,        30);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);

        $serverOutput = curl_exec($ch);
        $curlError    = curl_error($ch);
        curl_close($ch);

        if ($curlError) Response::serverError('Payment gateway connection failed: ' . $curlError);

        $ipgOutput = json_decode($serverOutput, true);

        if (empty($ipgOutput['order']['url'])) {
            Response::serverError('Payment gateway error: ' . ($ipgOutput['error']['message'] ?? $serverOutput));
        }

        $orderRef = $ipgOutput['order']['ref'] ?? '';

        // Store order_ref and cart_id in DB for session-less verify
        $this->db->execute(
            'UPDATE mn_cpd_carnet_returns SET order_ref=?, order_status=0 WHERE return_id=?',
            [$orderRef, $returnId],
        );

        $_SESSION['telr_cart_id']   = $cartId;
        $_SESSION['telr_return_id'] = $returnId;
        $_SESSION['telr_module']    = 'CPD_RETURN';

        Response::success([
            'redirect_url' => $ipgOutput['order']['url'],
            'cart_id'      => $cartId,
        ], 'Payment session created');
    }

    public function telrVerifyReturn(array $params, array $body, array $query): void
    {
        $returnId = $_SESSION['telr_return_id'] ?? null;
        $module   = $_SESSION['telr_module']    ?? null;

        if (!$returnId || $module !== 'CPD_RETURN') {
            Response::error('no_session', 403);
            return;
        }

        $ret = $this->db->queryOne(
            'SELECT return_id, order_ref, order_status FROM mn_cpd_carnet_returns WHERE return_id=?',
            [$returnId],
        );
        if (!$ret) Response::notFound('Return request not found');

        // Already paid
        if ((int)$ret['order_status'] === 1) {
            unset($_SESSION['telr_return_id'], $_SESSION['telr_cart_id'], $_SESSION['telr_module']);
            Response::success(['already_paid' => true, 'return_id' => $returnId], 'Payment already recorded');
            return;
        }

        if (empty($ret['order_ref'])) {
            Response::error('No order reference found. Payment may not have been initiated.', 422);
        }

        $orderRef   = $ret['order_ref'];
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

        if ($curlError) Response::serverError('Payment verification failed: ' . $curlError);

        $ipgOutput  = json_decode($serverOutput, true);
        $statusCode = (int)($ipgOutput['order']['status']['code']      ?? 0);
        $telrRef    = $ipgOutput['order']['transaction']['ref']          ?? null;

        Logger::info("telrVerifyReturn return_id={$returnId} orderRef={$orderRef} statusCode={$statusCode} telrRef={$telrRef}");

        unset($_SESSION['telr_return_id'], $_SESSION['telr_cart_id'], $_SESSION['telr_module']);

        if ($statusCode === 3) {
            $this->db->execute(
                'UPDATE mn_cpd_carnet_returns SET order_status=1, order_ref=? WHERE return_id=?',
                [$telrRef ?? $orderRef, $returnId],
            );
            Response::success([
                'paid'      => true,
                'return_id' => (int)$returnId,
                'telr_ref'  => $telrRef,
            ], 'Payment verified and recorded');
        }

        $statusText = $ipgOutput['order']['status']['text'] ?? 'Unknown';
        Response::error("Payment not confirmed — status: {$statusCode} {$statusText}", 402);
    }

    // ── Telr Payment Initiation (CPD) ─────────────────────────────────────────

    public function telrInit(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];

        $req = $this->db->queryOne(
            "SELECT r.auto_id, r.request_id, r.total_amount,
                    u.first_name, u.last_name, u.email
             FROM mn_cpd_requests r
             JOIN mn_users u ON u.user_id = r.belonging_user_id
             WHERE r.auto_id = ?",
            [$autoId],
        );

        if (!$req) Response::notFound('CPD request not found');

        $cartId = (string)time();

        $postfields = http_build_query([
            'ivp_method'   => 'create',
            'ivp_store'    => Config::TELR_STORE_ID,
            'ivp_authkey'  => Config::TELR_AUTH_KEY,
            'ivp_amount'   => $req['total_amount'],
            'ivp_currency' => Config::TELR_CURRENCY,
            'ivp_test'     => Config::TELR_TEST,
            'ivp_cart'     => $cartId,
            'ivp_desc'     => 'CPD - Carnet de Passage en Douane',
            'return_auth'  => Config::telrReturnUrl(),
            'return_decl'  => Config::telrDeclineUrl(),
            'return_can'   => Config::telrCancelUrl(),
            'bill_fname'   => $req['first_name'] ?? '',
            'bill_sname'   => $req['last_name']  ?? '',
            'bill_email'   => $req['email']      ?? '',
        ]);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL,            'https://secure.telr.com/gateway/order.json');
        curl_setopt($ch, CURLOPT_POST,           true);
        curl_setopt($ch, CURLOPT_POSTFIELDS,     $postfields);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER,     ['Expect:']);
        curl_setopt($ch, CURLOPT_TIMEOUT,        30);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);

        $serverOutput = curl_exec($ch);
        $curlError    = curl_error($ch);
        curl_close($ch);

        if ($curlError) Response::serverError('Payment gateway connection failed: ' . $curlError);

        $ipgOutput = json_decode($serverOutput, true);

        if (empty($ipgOutput['order']['url'])) {
            $errorMsg = $ipgOutput['error']['message'] ?? $serverOutput;
            Response::serverError('Payment gateway error: ' . $errorMsg);
        }

        $orderRef = $ipgOutput['order']['ref'] ?? '';

        // Ensure columns exist (added via migration — run once if missing)
        try {
            $this->db->execute('ALTER TABLE mn_cpd_requests ADD COLUMN IF NOT EXISTS `order_ref_no` varchar(100) DEFAULT NULL');
            $this->db->execute('ALTER TABLE mn_cpd_requests ADD COLUMN IF NOT EXISTS `telr_cart_id` varchar(50) DEFAULT NULL');
            $this->db->execute('ALTER TABLE mn_cpd_requests ADD COLUMN IF NOT EXISTS `paid_status` tinyint DEFAULT 0');
            $this->db->execute('ALTER TABLE mn_cpd_requests ADD COLUMN IF NOT EXISTS `paid_date` datetime DEFAULT NULL');
        } catch (\Throwable $e) {
            Logger::warning('CPD telrInit column check: ' . $e->getMessage());
        }

        $this->db->execute(
            'UPDATE mn_cpd_requests SET order_ref_no=?, telr_cart_id=?, method_of_payment=? WHERE auto_id=?',
            [$orderRef, $cartId, 'CREDIT_CARD', $autoId],
        );

        $_SESSION['telr_cart_id']    = $cartId;
        $_SESSION['telr_request_id'] = $autoId;
        $_SESSION['telr_module']     = 'CPD';

        Response::success([
            'redirect_url' => $ipgOutput['order']['url'],
            'cart_id'      => $cartId,
        ], 'Payment session created');
    }

    // ── Public Store (role 2) ─────────────────────────────────────────────────

    public function publicStore(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('vehicle_make','vehicle_model','registration_no','chassis_no','manuf_year',
                       'first_name','last_name','mobile_no','email')
            ->validate();

        $userId = Auth::id();

        $eid = trim($body['emirates_id'] ?? '');
        if ($eid !== '') {
            $hold = $this->db->queryOne(
                'SELECT hold_id FROM mn_customer_holds WHERE emirates_id = ? AND is_active = 1 LIMIT 1',
                [$eid],
            );
            if ($hold) Response::error('Your account has been placed on hold. Please contact ATC for assistance.', 403);
        }

        // Update mn_users with latest contact details
        $this->db->execute(
            "UPDATE mn_users SET first_name=?, last_name=?, mobile_no=?, email=? WHERE user_id=?",
            [
                $body['first_name'],
                $body['last_name'],
                $body['mobile_no'],
                $body['email'],
                $userId,
            ],
        );

        // Insert mn_cpd_requests — use auto_id for request_id
        $id = null;
        try {
            $id = $this->db->insert(
                "INSERT INTO mn_cpd_requests
                 (request_id, request_category, belonging_user_id,
                  vehicle_make, vehicle_model, registration_no, chassis_no, engine_no,
                  manuf_year, color, body_type, no_of_cylinders, horse_power,
                  net_weight, vehicle_value, mulkiya_no, vehicle_registered_in,
                  upholstery, no_of_seats, radio, spare_tyre,
                  extra_owner1_name, extra_owner2_name,
                  additional_remarks, others1, others2,
                  uae_refree1, uae_refree2, destination_refree1, destination_refree2,
                  guarantee_amount, booking_fee, extra_fees, vat_amount, total_amount,
                  method_of_payment, booking_channel, request_status, requested_datetime)
                 VALUES ('PENDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ONLINE',1,NOW())",
                [
                    'NORMAL',
                    $userId,
                    $body['vehicle_make'],
                    $body['vehicle_model'],
                    $body['registration_no'],
                    $body['chassis_no'],
                    $body['engine_no']            ?? '',
                    (int)$body['manuf_year'],
                    $body['color']                ?? '',
                    $body['body_type']            ?? '',
                    $body['no_of_cylinders']      ?? 0,
                    $body['horse_power']          ?? 0,
                    $body['net_weight']           ?? 0,
                    $body['vehicle_value']        ?? 0,
                    $body['mulkiya_no']           ?? '',
                    $body['vehicle_registered_in']?? '',
                    $body['upholstery']           ?? '',
                    $body['no_of_seats']          ?? 0,
                    $body['radio']                ?? '',
                    $body['spare_tyre']           ?? '',
                    $body['extra_owner1_name']    ?? '',
                    $body['extra_owner2_name']    ?? '',
                    $body['additional_remarks']   ?? '',
                    $body['others1']              ?? '',
                    $body['others2']              ?? '',
                    $body['uae_refree1']          ?? '',
                    $body['uae_refree2']          ?? '',
                    $body['destination_refree1']  ?? '',
                    $body['destination_refree2']  ?? '',
                    $body['guarantee_amount']     ?? 0,
                    $body['booking_fee']          ?? 0,
                    $body['extra_fees']           ?? 0,
                    $body['vat_amount']           ?? 0,
                    $body['total_amount']         ?? 0,
                    $body['payment_method']       ?? 'CASH',
                ],
            );
            // Update request_id using the auto_id
            $requestId = sprintf('CPD-ATC-%s/%d', date('Ymd'), $id);
            $this->db->execute(
                'UPDATE mn_cpd_requests SET request_id = ? WHERE auto_id = ?',
                [$requestId, $id],
            );

            if (!$id) throw new \RuntimeException('Failed to insert CPD request');

            // Insert owner snapshot into mn_cpd_request_user
            $this->db->execute(
                "INSERT INTO mn_cpd_request_user
                 (user_id, request_auto_id, title, first_name, last_name,
                  nationality_id, city, uae_address, po_box,
                  emirates_id, passport_no, registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
                [
                    $userId,
                    $id,
                    $body['title']           ?? null,
                    $body['first_name'],
                    $body['last_name'],
                    $body['nationality']     ?? null,
                    $body['city']            ?? '',
                    $body['address']         ?? '',
                    $body['po_box']          ?? '',
                    $body['emirates_id']     ?? '',
                    $body['passport_no']     ?? '',
                ],
            );

            // Insert destination countries
            foreach ((array)($body['countries'] ?? []) as $cid) {
                $this->db->execute(
                    'INSERT INTO mn_cpd_request_country_list (request_id, country_id) VALUES (?,?)',
                    [$id, (int)$cid],
                );
            }

        } catch (\Throwable $e) {
            if ($id) {
                $this->db->execute('DELETE FROM mn_cpd_request_user WHERE request_auto_id=?', [$id]);
                $this->db->execute('DELETE FROM mn_cpd_request_country_list WHERE request_id=?', [$id]);
                $this->db->execute('DELETE FROM mn_cpd_requests WHERE auto_id=?', [$id]);
            }
            Response::serverError('Your CPD application could not be saved — ' . $e->getMessage());
        }

        $this->logEvent('CREATE', $id);
        Response::created(['auto_id' => $id, 'request_id' => $requestId]);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    // ── EID Lookup — user info + last CPD request vehicle details ─────────────

    public function searchByEid(array $params, array $body, array $query): void
    {
        $eid = preg_replace('/\D/', '', $query['eid'] ?? '');
        if (!$eid) Response::error('Emirates ID is required', 422);

        // Find user via mn_cpd_request_user (has emirates_id)
        $userRow = $this->db->queryOne(
            "SELECT u.user_id, u.first_name, u.last_name, u.email, u.mobile_no
             FROM mn_cpd_request_user cu
             JOIN mn_users u ON u.user_id = cu.user_id
             WHERE REPLACE(REPLACE(cu.emirates_id,'-',''),' ','') = ?
             ORDER BY cu.request_auto_id DESC LIMIT 1",
            [$eid],
        );

        // Get last CPD request for this user
        $lastCpd = null;
        if ($userRow) {
            $lastCpd = $this->db->queryOne(
                "SELECT r.vehicle_make, r.vehicle_model, r.vehicle_value, r.vehicle_registered_in,
                        r.body_type, r.manuf_year, r.color, r.net_weight, r.chassis_no,
                        r.engine_no, r.horse_power, r.no_of_cylinders, r.upholstery,
                        r.no_of_seats, r.radio, r.spare_tyre, r.mulkiya_no,
                        r.registration_no, r.extra_owner1_name, r.extra_owner2_name,
                        r.additional_remarks, r.others1, r.others2,
                        r.uae_refree1, r.uae_refree2, r.destination_refree1, r.destination_refree2,
                        cu.nationality_id, cu.city, cu.po_box, cu.passport_no,
                        cu.home_country_address, cu.uae_address
                 FROM mn_cpd_requests r
                 LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id = r.auto_id
                 WHERE r.belonging_user_id = ?
                 ORDER BY r.auto_id DESC LIMIT 1",
                [$userRow['user_id']],
            );
        }

        if (!$userRow && !$lastCpd) Response::notFound('No records found for this Emirates ID');

        Response::success(array_merge($userRow ?? [], $lastCpd ?? []));
    }

    public function store(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('vehicle_make','vehicle_model','registration_no','chassis_no','manuf_year','method_of_payment')
            ->numeric('vehicle_value')->numeric('guarantee_amount')->numeric('booking_fee')
            ->validate();

        // user_id: from EID lookup hidden field, or fall back to logged-in officer
        $userId = !empty($body['user_id']) ? (int)$body['user_id'] : Auth::id();

        $eid = trim($body['emirates_id'] ?? '');
        if ($eid !== '') {
            $hold = $this->db->queryOne(
                'SELECT hold_id FROM mn_customer_holds WHERE emirates_id = ? AND is_active = 1 LIMIT 1',
                [$eid],
            );
            if ($hold) Response::error('This customer has an active hold. Lift the hold before creating a new request.', 403);
        }

        // Look up queue position from workflow table
        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions
             WHERE section='CPD' AND action='CREATE_NORMAL_REQUEST_WALKIN' LIMIT 1",
        );
        $queuePosition = $wf['next_role'] ?? null;

        $this->db->beginTransaction();
        try {
            $id = $this->db->insert(
                "INSERT INTO mn_cpd_requests
                 (request_id, request_category, belonging_user_id,
                  vehicle_make, vehicle_model, registration_no, chassis_no, engine_no,
                  manuf_year, color, body_type, no_of_cylinders, horse_power,
                  net_weight, vehicle_value, mulkiya_no,
                  extra_owner1_name, extra_owner2_name,
                  guarantee_amount, booking_fee, extra_fees, vat_amount, total_amount,
                  method_of_payment, booking_channel, request_status,
                  current_queue_position, requested_datetime)
                 VALUES ('PENDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'WALKIN','NEW',?,NOW())",
                [
                    $body['request_category']   ?? 'NORMAL',
                    $userId,
                    $body['vehicle_make'],
                    $body['vehicle_model'],
                    $body['registration_no'],
                    $body['chassis_no'],
                    $body['engine_no']          ?? '',
                    $body['manuf_year'],
                    $body['color']              ?? '',
                    $body['body_type']          ?? '',
                    $body['no_of_cylinders']    ?? 0,
                    $body['horse_power']        ?? 0,
                    $body['net_weight']         ?? 0,
                    $body['vehicle_value']      ?? 0,
                    $body['mulkiya_no']         ?? '',
                    $body['extra_owner1_name']  ?? '',
                    $body['extra_owner2_name']  ?? '',
                    $body['guarantee_amount']   ?? 0,
                    $body['booking_fee']        ?? 0,
                    $body['extra_fees']         ?? 0,
                    $body['vat_amount']         ?? 0,
                    $body['total_amount']       ?? 0,
                    $body['method_of_payment'],
                    $queuePosition,
                ],
            );

            if (!$id) throw new \RuntimeException('Insert returned no ID');

            // Generate request_id using auto_id
            $requestId = sprintf('CPD-ATC-%s/%d', date('Ymd'), $id);
            $this->db->execute(
                'UPDATE mn_cpd_requests SET request_id = ? WHERE auto_id = ?',
                [$requestId, $id],
            );

            // Insert owner snapshot into mn_cpd_request_user
            $this->db->execute(
                "INSERT INTO mn_cpd_request_user
                 (user_id, request_auto_id, title, first_name, last_name,
                  nationality_id, city, uae_address, po_box,
                  emirates_id, passport_no, registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
                [
                    $userId,
                    $id,
                    $body['title']           ?? null,
                    $body['first_name']      ?? '',
                    $body['last_name']       ?? '',
                    $body['nationality']     ?? null,
                    $body['city']            ?? '',
                    $body['address']         ?? '',
                    $body['po_box']          ?? '',
                    $body['emirates_id']     ?? '',
                    $body['passport_no']     ?? '',
                ],
            );

            foreach ((array)($body['countries'] ?? []) as $cid) {
                $this->db->execute(
                    'INSERT INTO mn_cpd_request_country_list (request_id, country_id) VALUES (?,?)',
                    [$id, (int)$cid],
                );
            }

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Logger::exception($e, 'CPDController::store');
            Response::serverError('Failed to create request: ' . $e->getMessage());
        }

        $this->logEvent('CREATE', $id);
        Response::created(['auto_id' => $id, 'request_id' => $requestId]);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    public function update(array $params, array $body, array $query): void
    {
        $allowed = [
            'vehicle_make','vehicle_model','registration_no','chassis_no','engine_no',
            'manuf_year','color','body_type','no_of_cylinders','horse_power',
            'net_weight','vehicle_value','method_of_payment',
            'guarantee_amount','booking_fee','vat_amount','total_amount',
        ];
        $sets  = [];
        $binds = [];

        foreach ($allowed as $f) {
            if (array_key_exists($f, $body)) {
                $sets[]  = "{$f}=?";
                $binds[] = $body[$f];
            }
        }
        if (empty($sets)) Response::error('No updatable fields provided');

        $binds[] = $params['id'];
        $this->db->execute("UPDATE mn_cpd_requests SET " . implode(',', $sets) . " WHERE auto_id=?", $binds);
        $this->logEvent('UPDATE', $params['id']);
        Response::success(null, 'Request updated');
    }

    // ── Workflow actions ──────────────────────────────────────────────────────

    public function approve(array $params, array $body, array $query): void
    {
        $this->db->execute(
            "UPDATE mn_cpd_requests
             SET request_status='Confirmed', payment_verified_by=?, payment_verified_datetime=NOW()
             WHERE auto_id=?",
            [Auth::id(), $params['id']],
        );
        $this->logEvent('APPROVE', $params['id']);
        Response::success(null, 'CPD request confirmed');
    }

    public function reject(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('comment')->validate();

        $id      = (int) $params['id'];
        $comment = trim($body['comment']);

        // Look up next queue position from workflow table
        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions
             WHERE section='CPD' AND action='SEND_FOR_CORRECTIONS_CUSTOMER' LIMIT 1",
        );
        $queuePosition = $wf['next_role'] ?? 'Customer';

        $this->db->beginTransaction();
        try {
            // Update request: status=8, update queue position
            $this->db->execute(
                "UPDATE mn_cpd_requests
                 SET request_status = 8,
                     current_queue_position = ?
                 WHERE auto_id = ?",
                [$queuePosition, $id],
            );

            // Write comment to mn_cpd_officer_comments
            $this->db->execute(
                "INSERT INTO mn_cpd_officer_comments
                 (request_id, comment, added_by, added_datetime, read_flag)
                 VALUES (?, ?, ?, NOW(), 0)",
                [$id, $comment, Auth::id()],
            );

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Logger::exception($e, 'CPDController::reject');
            Response::serverError('Reject failed: ' . $e->getMessage());
        }

        $this->logEvent('REJECT', $id, $comment);
        Response::success(null, 'Request sent for corrections');
    }

    public function issueCarnet(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('carnet_no')->validate();

        $id      = (int) $params['id'];
        $carnetNo = $body['carnet_no'];

        $carnet = $this->db->queryOne(
            'SELECT carnet_id, is_used, is_damaged FROM mn_cpd_carnets WHERE carnet_no=?',
            [$carnetNo],
        );
        if ($carnet === null)           Response::notFound('Carnet not found');
        if ((int)$carnet['is_used'])    Response::error('Carnet already assigned to another request', 409);
        if ((int)$carnet['is_damaged']) Response::error('Carnet is marked as damaged', 409);

        // Get next queue position from workflow
        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions
             WHERE section='CPD' AND action='ISSUE_CARNET_NORMAL_REQUEST' LIMIT 1",
        );
        $nextQueue = $wf['next_role'] ?? 'CPD_Officer';

        $this->db->beginTransaction();
        try {
            // Update request: status=3, queue position
            $this->db->execute(
                "UPDATE mn_cpd_requests
                 SET request_status         = 3,
                     confirmed_by           = ?,
                     confirmed_datetime     = NOW(),
                     current_queue_position = ?
                 WHERE auto_id = ?",
                [Auth::id(), $nextQueue, $id],
            );

            // Mark carnet as used
            $this->db->execute(
                'UPDATE mn_cpd_carnets SET is_used=1 WHERE carnet_no=?',
                [$carnetNo],
            );

            // Insert issued carnet record
            $this->db->execute(
                "INSERT INTO mn_cpd_issued_carnets
                 (carnet_id, request_id, issued_datetime, issued_by, carnet_status)
                 VALUES (?, ?, NOW(), ?, 1)",
                [$carnet['carnet_id'], $id, Auth::id()],
            );

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Logger::exception($e, 'CPDController::issueCarnet');
            Response::serverError('Issue failed: ' . $e->getMessage());
        }

        $this->logEvent('ISSUE_CARNET', $id, $carnetNo);
        Response::success(null, 'Carnet issued successfully');
    }

    public function approveReturnRequest(array $params, array $body, array $query): void
    {
        $returnId = (int) $params['id'];

        // Get the return request to find the cpd request_id
        $ret = $this->db->queryOne(
            'SELECT return_id, request_id FROM mn_cpd_carnet_returns WHERE return_id = ?',
            [$returnId],
        );
        if (!$ret) Response::notFound('Return request not found');

        // Check return guarantee exists
        $guarantee = $this->db->queryOne(
            'SELECT guarantee_cheque_id FROM mn_cpd_return_guarantee_details WHERE request_id = ? LIMIT 1',
            [$ret['request_id']],
        );
        if (!$guarantee) {
            Response::error('Return Guarantee is not updated. Please contact Finance office.', 422);
        }

        $this->db->execute(
            "UPDATE mn_cpd_carnet_returns
             SET confirmed_by = 1, confirmed_datetime = ?
             WHERE return_id = ?",
            [date('Y-m-d H:i:s'), $returnId],
        );

        Response::success(null, 'Return request approved successfully');
    }

    public function indexReturnRequests(array $params, array $body, array $query): void
    {
        $v       = Validator::make($query);
        $page    = max(1, $v->int('page', 1));
        $perPage = 20;
        $offset  = ($page - 1) * $perPage;
        $search  = $v->get('search', '');
        $penalty = Config::CPD_PENALTY;

        $where = 'WHERE rr.confirmed_by = 0';
        $binds = [];

        if ($search !== '') {
            $like    = "%{$search}%";
            $where  .= ' AND (r.request_id LIKE ? OR cu.first_name LIKE ? OR cu.last_name LIKE ?)';
            array_push($binds, $like, $like, $like);
        }

        $total = (int) $this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_carnet_returns rr
             JOIN mn_cpd_requests r           ON r.auto_id          = rr.request_id
             LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id  = rr.request_id
             {$where}",
            $binds,
        );

        $rows = $this->db->query(
            "SELECT rr.return_id, rr.request_id, rr.penalty_amount,
                    rr.bank_name, rr.remarks,
                    rr.added_datetime, rr.confirmed_by, rr.received_to_office,
                    r.request_id AS cpd_request_id,
                    c.carnet_no,
                    ic.issued_datetime,
                    DATE_ADD(ic.issued_datetime, INTERVAL 364 DAY) AS expiry_date,
                    CASE WHEN rr.added_datetime > DATE_ADD(ic.issued_datetime, INTERVAL 364 DAY)
                         THEN {$penalty} ELSE 0 END AS computed_penalty,
                    cu.first_name, cu.last_name
             FROM mn_cpd_carnet_returns rr
             JOIN mn_cpd_requests r               ON r.auto_id          = rr.request_id
             LEFT JOIN mn_cpd_carnets c            ON c.carnet_id        = rr.carnet_id
             LEFT JOIN mn_cpd_issued_carnets ic    ON ic.request_id      = rr.request_id
             LEFT JOIN mn_cpd_request_user cu      ON cu.request_auto_id = rr.request_id
             {$where}
             ORDER BY rr.return_id DESC
             LIMIT {$perPage} OFFSET {$offset}",
            $binds,
        );

        Response::success([
            'data'     => $rows,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
            'pages'    => (int) ceil($total / $perPage),
        ]);
    }

    public function indexCancellations(array $params, array $body, array $query): void
    {
        $v       = Validator::make($query);
        $page    = max(1, $v->int('page', 1));
        $perPage = 20;
        $offset  = ($page - 1) * $perPage;
        $search  = $v->get('search', '');

        $where  = 'WHERE c.cancelled_approved = 0';
        $binds  = [];

        if ($search !== '') {
            $like    = "%{$search}%";
            $where  .= ' AND (r.request_id LIKE ? OR cu.first_name LIKE ? OR cu.last_name LIKE ?)';
            array_push($binds, $like, $like, $like);
        }

        $total = (int) $this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_cancelled_requests c
             JOIN mn_cpd_requests r       ON r.auto_id           = c.request_auto_id
             LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id = c.request_auto_id
             {$where}",
            $binds,
        );

        $rows = $this->db->query(
            "SELECT c.cancel_auto_id, c.request_auto_id, c.cancelled_by,
                    c.cancelled_datetime, c.cancelled_approved, c.remarks,
                    r.request_id, r.request_status,
                    cu.first_name, cu.last_name
             FROM mn_cpd_cancelled_requests c
             JOIN mn_cpd_requests r          ON r.auto_id          = c.request_auto_id
             LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id = c.request_auto_id
             {$where}
             ORDER BY c.cancel_auto_id DESC
             LIMIT {$perPage} OFFSET {$offset}",
            $binds,
        );

        Response::success([
            'data'     => $rows,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
            'pages'    => (int) ceil($total / $perPage),
        ]);
    }

    public function getCancelRequest(array $params, array $body, array $query): void
    {
        $row = $this->db->queryOne(
            "SELECT cancel_auto_id, cancelled_by, cancelled_datetime,
                    cancelled_approved, remarks
             FROM mn_cpd_cancelled_requests
             WHERE request_auto_id = ?
             ORDER BY cancel_auto_id DESC LIMIT 1",
            [(int) $params['id']],
        );
        Response::success($row);
    }

    public function getReturnCarnet(array $params, array $body, array $query): void
    {
        $row = $this->db->queryOne(
            "SELECT return_id, added_datetime, confirmed_by, remarks,
                    delivery_method, return_payment_method, order_status
             FROM mn_cpd_carnet_returns WHERE request_id = ? LIMIT 1",
            [(int) $params['id']],
        );
        Response::success($row);
    }

    // ── Public User: Return Carnet ────────────────────────────────────────────

    public function returnCarnet(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('remarks', 'delivery_option', 'payment_option')->validate();

        $id             = (int) $params['id'];
        $deliveryOption = $body['delivery_option'];
        $paymentOption  = $body['payment_option'];

        if (!in_array($deliveryOption, ['ARAMAX', 'DELIVER_BY_HAND'], true)) Response::error('Invalid delivery option', 422);
        if (!in_array($paymentOption,  ['BANK_DEPOSIT', 'COLLECT_CHEQUE'], true)) Response::error('Invalid payment option', 422);

        $req = $this->db->queryOne(
            'SELECT auto_id, belonging_user_id, request_status FROM mn_cpd_requests WHERE auto_id = ?',
            [$id],
        );
        if (!$req) Response::notFound('Request not found');
        if ((int)$req['belonging_user_id'] !== Auth::id()) Response::error('Forbidden', 403);
        if ((int)$req['request_status'] !== 3) Response::error('Carnet can only be returned for issued requests', 422);

        $existing = $this->db->queryOne(
            'SELECT return_id FROM mn_cpd_carnet_returns WHERE request_id = ? LIMIT 1',
            [$id],
        );
        if ($existing) Response::error('A return request has already been submitted for this carnet', 422);

        $issuedCarnet = $this->db->queryOne(
            'SELECT carnet_id FROM mn_cpd_issued_carnets WHERE request_id = ? ORDER BY carnet_issue_id DESC LIMIT 1',
            [$id],
        );

        $aramexFee = $deliveryOption === 'ARAMAX' ? Config::CPD_DELIVERY_FEE : null;

        $bankInfo = null;
        if ($paymentOption === 'BANK_DEPOSIT') {
            $bankInfo = json_encode([
                'bank_name'   => $body['bank_name']   ?? '',
                'account_no'  => $body['account_no']  ?? '',
                'iban'        => $body['iban']         ?? '',
                'beneficiary' => $body['beneficiary']  ?? '',
            ]);
        }

        $returnId = $this->db->insert(
            "INSERT INTO mn_cpd_carnet_returns
             (carnet_id, request_id, remarks, delivery_method, return_payment_method,
              delivery_fee, cus_bank_information, added_by, added_datetime, confirmed_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)",
            [
                $issuedCarnet['carnet_id'] ?? null,
                $id,
                $body['remarks'],
                $deliveryOption,
                $paymentOption,
                $aramexFee,
                $bankInfo,
                Auth::id(),
            ],
        );

        Response::created(['return_id' => $returnId], 'Return carnet request submitted successfully');
    }

    // ── Officer: Create Return (bypasses customer ownership check) ────────────
    public function officerReturn(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('remarks', 'delivery_option', 'payment_option')->validate();

        $id             = (int) $params['id'];
        $deliveryOption = $body['delivery_option'];
        $paymentOption  = $body['payment_option'];

        if (!in_array($deliveryOption, ['ARAMAX', 'DELIVER_BY_HAND'], true)) Response::error('Invalid delivery option', 422);
        if (!in_array($paymentOption,  ['BANK_DEPOSIT', 'COLLECT_CHEQUE'], true)) Response::error('Invalid payment option', 422);

        $req = $this->db->queryOne(
            'SELECT auto_id, request_status FROM mn_cpd_requests WHERE auto_id = ?',
            [$id],
        );
        if (!$req) Response::notFound('Request not found');
        if ((int)$req['request_status'] !== 3) Response::error('Carnet can only be returned for issued requests', 422);

        $existing = $this->db->queryOne(
            'SELECT return_id FROM mn_cpd_carnet_returns WHERE request_id = ? LIMIT 1',
            [$id],
        );
        if ($existing) Response::error('A return request has already been submitted for this carnet', 422);

        $issuedCarnet = $this->db->queryOne(
            'SELECT carnet_id FROM mn_cpd_issued_carnets WHERE request_id = ? ORDER BY carnet_issue_id DESC LIMIT 1',
            [$id],
        );

        $aramexFee = $deliveryOption === 'ARAMAX' ? Config::CPD_DELIVERY_FEE : null;

        $bankInfo = null;
        if ($paymentOption === 'BANK_DEPOSIT') {
            $bankInfo = json_encode([
                'bank_name'   => $body['bank_name']   ?? '',
                'account_no'  => $body['account_no']  ?? '',
                'iban'        => $body['iban']         ?? '',
                'beneficiary' => $body['beneficiary']  ?? '',
            ]);
        }

        $returnId = $this->db->insert(
            "INSERT INTO mn_cpd_carnet_returns
             (carnet_id, request_id, remarks, delivery_method, return_payment_method,
              delivery_fee, cus_bank_information, added_by, added_datetime, confirmed_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)",
            [
                $issuedCarnet['carnet_id'] ?? null,
                $id,
                $body['remarks'],
                $deliveryOption,
                $paymentOption,
                $aramexFee,
                $bankInfo,
                Auth::id(),
            ],
        );

        $this->logEvent('OFFICER_RETURN', $id, "return_id:{$returnId}");
        Response::created(['return_id' => $returnId], 'Return request created');
    }

    // ── Public User: Request Cancellation ────────────────────────────────────

    public function cancelRequest(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('reason')->validate();

        $id = (int) $params['id'];

        // Verify the request belongs to the logged-in user
        $req = $this->db->queryOne(
            'SELECT auto_id, belonging_user_id, request_status FROM mn_cpd_requests WHERE auto_id = ?',
            [$id],
        );
        if (!$req) Response::notFound('Request not found');
        if ((int)$req['belonging_user_id'] !== Auth::id()) Response::error('Forbidden', 403);

        // Check not already cancelled
        if ($req['request_status'] === 'Cancelled') Response::error('Request is already cancelled', 422);

        // Check if a cancellation request already exists
        $existing = $this->db->queryOne(
            'SELECT cancel_auto_id FROM mn_cpd_cancelled_requests WHERE request_auto_id = ? LIMIT 1',
            [$id],
        );
        if ($existing) Response::error('A cancellation request has already been submitted', 422);

        $this->db->execute(
            "INSERT INTO mn_cpd_cancelled_requests
             (request_auto_id, cancelled_by, cancelled_datetime, cancelled_approved, remarks)
             VALUES (?, ?, NOW(), 0, ?)",
            [$id, 'PUBLIC_USER', $body['reason']],
        );

        Response::created(null, 'Cancellation request submitted. Our team will review and contact you shortly.');
    }

    public function cancel(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('reason')->validate();

        $this->db->beginTransaction();
        try {
            $this->db->execute(
                "UPDATE mn_cpd_requests SET request_status='Cancelled' WHERE auto_id=?",
                [$params['id']],
            );
            $this->db->execute(
                "INSERT INTO mn_cpd_cancelled_requests
                 (request_auto_id, cancelled_by, cancelled_datetime, cancelled_approved, remarks)
                 VALUES (?,?,NOW(),0,?)",
                [$params['id'], Auth::roleName(), $body['reason']],
            );
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Response::serverError('Cancel failed: ' . $e->getMessage());
        }

        $this->logEvent('CANCEL', $params['id']);
        Response::success(null, 'Request cancelled');
    }

    public function markCarnetReturned(array $params, array $body, array $query): void
    {
        $r = $this->db->queryOne('SELECT carnet_no FROM mn_cpd_requests WHERE auto_id=?', [$params['id']]);
        if ($r === null) Response::notFound('Request not found');

        $this->db->beginTransaction();
        try {
            $this->db->execute(
                "UPDATE mn_cpd_requests SET request_status='Returned' WHERE auto_id=?",
                [$params['id']],
            );
            if ($r['carnet_no']) {
                $this->db->execute(
                    'UPDATE mn_cpd_carnets SET is_used=0 WHERE carnet_no=?',
                    [$r['carnet_no']],
                );
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Response::serverError('Return failed: ' . $e->getMessage());
        }

        $this->logEvent('RETURN', $params['id']);
        Response::success(null, 'Carnet returned');
    }

    // ── Lookups ───────────────────────────────────────────────────────────────

    public function carnets(array $params, array $body, array $query): void
    {
        $v        = Validator::make($query);
        $status   = $v->get('status', '');
        $loc      = $v->get('location', '');
        $carnetNo = $v->get('carnet_no', '');
        $sortBy   = in_array($v->get('sort', 'carnet_no'), ['carnet_no','carnet_type','location'], true)
                    ? $v->get('sort', 'carnet_no') : 'carnet_no';
        $sortDir  = strtoupper($v->get('dir', 'ASC')) === 'DESC' ? 'DESC' : 'ASC';

        $binds = [];
        if ($status === 'unused')       $where = 'WHERE c.is_used=0 AND c.is_damaged=0';
        elseif ($status === 'used')    $where = 'WHERE c.is_used=1';
        elseif ($status === 'damaged') $where = 'WHERE c.is_damaged=1';
        else                           $where = 'WHERE 1';

        if ($loc !== '')      { $where .= ' AND c.location_id=?';     $binds[] = $loc; }
        if ($carnetNo !== '') { $where .= ' AND c.carnet_no LIKE ?';   $binds[] = '%' . $carnetNo . '%'; }

        if ($sortBy === 'carnet_type')   $orderCol = 'c.carnet_type';
        elseif ($sortBy === 'location')  $orderCol = 'l.location';
        else                             $orderCol = 'c.carnet_no';

        $data = $this->db->query(
            "SELECT c.carnet_no, c.is_used, c.is_damaged,
                    ct.carnet_type,
                    l.location
             FROM mn_cpd_carnets c
             JOIN mn_cpd_locations    l  ON l.location_id   = c.location_id
             JOIN mn_cpd_carnet_types ct ON ct.carnet_type_id = c.carnet_type
             {$where}
             ORDER BY {$orderCol} {$sortDir}",
            $binds,
        );
        Response::success($data);
    }

    public function countries(array $params, array $body, array $query): void
    {
        Response::success($this->db->query(
            'SELECT nationality_id, nationality, emirates_id_code FROM mn_cpd_countries ORDER BY nationality',
        ));
    }

    public function guaranteeRules(array $params, array $body, array $query): void
    {
        $groups = $this->db->query(
            'SELECT group_code, group_label, fixed_amount, special_note
             FROM mn_cpd_guarantee_groups ORDER BY sort_order',
        );

        $rates = $this->db->query(
            'SELECT group_code, year_band, saloon, station, luxury
             FROM mn_cpd_guarantee_rates ORDER BY group_code, year_band',
        );

        // Check if nationality_id column exists yet (migration may not have run)
        $hasCols = $this->db->query("SHOW COLUMNS FROM mn_cpd_guarantee_countries LIKE 'nationality_id'");
        $hasNatId = !empty($hasCols);

        $countryMapSql = $hasNatId
            ? 'SELECT country_name, group_code, special_note, nationality_id FROM mn_cpd_guarantee_countries'
            : 'SELECT country_name, group_code, special_note, NULL AS nationality_id FROM mn_cpd_guarantee_countries';

        $countryMap = $this->db->query($countryMapSql);

        // Booking fees — country_list is comma-separated country IDs or names
        $bookingFees = $this->db->query(
            'SELECT booking_fee_id, country_list, booking_fee FROM mn_cpd_booking_fees',
        );

        Response::success([
            'groups'            => $groups,
            'rates'             => $rates,
            'country_map'       => $countryMap,
            'booking_fees'      => $bookingFees,
            'extra_driver_fee'  => Config::CPD_EXTRA_DRIVER_FEE,
        ]);
    }

    public function vehicleTypes(array $params, array $body, array $query): void
    {
        Response::success($this->db->query(
            'SELECT vehicle_type_id, vehicle_type FROM mn_cpd_vehicle_types ORDER BY vehicle_type',
        ));
    }

    public function locations(array $params, array $body, array $query): void
    {
        Response::success($this->db->query(
            'SELECT location_id, location FROM mn_cpd_locations ORDER BY location_id',
        ));
    }

    public function carnetTypes(array $params, array $body, array $query): void
    {
        Response::success($this->db->query(
            'SELECT carnet_type_id, carnet_type FROM mn_cpd_carnet_types ORDER BY carnet_type_id',
        ));
    }

    public function showStockRequest(array $params, array $body, array $query): void
    {
        $id = (int) $params['id'];
        $r  = $this->db->queryOne(
            "SELECT r.*, l.location AS location_name,
                    u.first_name, u.last_name
             FROM mn_cpd_branch_stock_requests r
             LEFT JOIN mn_cpd_locations l ON l.location_id = r.location
             LEFT JOIN mn_users         u ON u.user_id     = r.created_by
             WHERE r.auto_id = ?",
            [$id],
        );
        if (!$r) Response::notFound('Stock request not found');

        $r['items'] = $this->db->query(
            "SELECT i.*, ct.carnet_type
             FROM mn_cpd_branch_stock_request_items i
             LEFT JOIN mn_cpd_carnet_types ct ON ct.carnet_type_id = i.carnet_type_id
             WHERE i.request_id = ?",
            [$id],
        );
        Response::success($r);
    }

    public function approveStockRequest(array $params, array $body, array $query): void
    {
        $id = (int) $params['id'];
        $this->db->execute(
            "UPDATE mn_cpd_branch_stock_requests
             SET approval_level1 = 1,
                 approved_level1_user = ?,
                 approval_level1_datetime = ?
             WHERE auto_id = ?",
            [Auth::id(), date('Y-m-d H:i:s'), $id],
        );
        Response::success(null, 'Stock request approved');
    }

    public function rejectStockRequest(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('reason')->validate();
        $id = (int) $params['id'];
        $this->db->execute(
            "UPDATE mn_cpd_branch_stock_requests
             SET rejected_by = ?,
                 rejected_datetime = ?,
                 rejected_reason = ?,
                 approval_level1 = -1
             WHERE auto_id = ?",
            [Auth::id(), date('Y-m-d H:i:s'), $body['reason'], $id],
        );
        Response::success(null, 'Stock request rejected');
    }

    // ── Branch Stock Request — List ───────────────────────────────────────────

    public function indexStockRequests(array $params, array $body, array $query): void
    {
        $locRow = $this->db->queryOne(
            'SELECT location_id FROM mn_cpd_user_locations WHERE user_id = ? LIMIT 1',
            [Auth::id()],
        );

        if (!$locRow) {
            Response::success(['data' => [], 'total' => 0, 'page' => 1, 'per_page' => 20, 'pages' => 0]);
            return;
        }

        $locationId = (int) $locRow['location_id'];
        $page       = max(1, (int)($query['page']   ?? 1));
        $search     = trim($query['search'] ?? '');

        $where  = 'WHERE r.location = ?';
        $binds  = [$locationId];

        if ($search !== '') {
            $where  .= ' AND (r.request_id LIKE ? OR l.location LIKE ?)';
            $binds[] = "%{$search}%";
            $binds[] = "%{$search}%";
        }

        $sql = "SELECT r.auto_id, r.request_id, r.expected_delivery_date, r.created_datetime,
                       r.approval_level1, r.approval_level2, r.stock_received,
                       l.location,
                       (SELECT SUM(i.quantity)
                        FROM mn_cpd_branch_stock_request_items i
                        WHERE i.request_id = r.auto_id) AS total_carnets
                FROM mn_cpd_branch_stock_requests r
                LEFT JOIN mn_cpd_locations l ON l.location_id = r.location
                {$where}
                ORDER BY r.auto_id DESC";

        $countSql = "SELECT COUNT(*) FROM mn_cpd_branch_stock_requests r
                     LEFT JOIN mn_cpd_locations l ON l.location_id = r.location
                     {$where}";

        $result = $this->db->paginate($sql, $binds, $page, 20, $countSql, $binds);
        Response::success($result);
    }

    // ── Branch Stock Request ──────────────────────────────────────────────────

    public function storeStockRequest(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('expected_delivery_date', 'location', 'items')
            ->validate();

        $items = $body['items'] ?? [];
        if (empty($items) || !is_array($items)) {
            Response::error('At least one carnet item is required', 422);
        }

        $this->db->beginTransaction();
        try {
            // Insert header with PENDING request_id
            $autoId = $this->db->insert(
                "INSERT INTO mn_cpd_branch_stock_requests
                 (request_id, expected_delivery_date, location, description, reference,
                  created_by, created_datetime)
                 VALUES ('PENDING', ?, ?, ?, ?, ?, NOW())",
                [
                    $body['expected_delivery_date'],
                    (int) $body['location'],
                    $body['description'] ?? '',
                    $body['reference']   ?? '',
                    Auth::id(),
                ],
            );

            // Generate request_id using auto_id
            $requestId = sprintf('ATC-CPD-STREQ-%s/%d', date('Ymd'), $autoId);
            $this->db->execute(
                'UPDATE mn_cpd_branch_stock_requests SET request_id = ? WHERE auto_id = ?',
                [$requestId, $autoId],
            );

            // Insert items
            foreach ($items as $item) {
                $carnetTypeId = (int) ($item['carnet_type_id'] ?? 0);
                $quantity     = (int) ($item['quantity']      ?? 0);
                if (!$carnetTypeId || $quantity < 1) continue;

                $this->db->execute(
                    "INSERT INTO mn_cpd_branch_stock_request_items
                     (request_id, carnet_type_id, quantity)
                     VALUES (?, ?, ?)",
                    [$autoId, $carnetTypeId, $quantity],
                );
            }

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Logger::exception($e, 'CPDController::storeStockRequest');
            Response::serverError('Failed to save stock request: ' . $e->getMessage());
        }

        Response::created(['request_id' => $requestId ?? '', 'auto_id' => $autoId], 'Stock request submitted successfully');
    }

    public function statuses(array $params, array $body, array $query): void
    {
        Response::success($this->db->query(
            'SELECT carnet_status_id AS id, status FROM mn_cpd_statuses ORDER BY carnet_status_id',
        ));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function buildFilters(string $search, string $status, string $category, string $bookingChannel = '', string $queuePosition = '', string $requestType = ''): array
    {
        $where = 'WHERE 1=1';
        $binds = [];

        if ($search !== '') {
            $like = "%{$search}%";
            $where .= " AND (
                r.request_id LIKE ?
                OR r.chassis_no LIKE ?
                OR r.belonging_user_id IN (
                    SELECT user_id FROM mn_users
                    WHERE CONCAT(first_name,' ',last_name) LIKE ? OR first_name LIKE ? OR last_name LIKE ?
                )
            )";
            array_push($binds, $like, $like, $like, $like, $like);
        }
        if ($status !== '')         { $where .= ' AND r.request_status=?';           $binds[] = $status; }
        if ($category !== '')       { $where .= ' AND r.request_category=?';         $binds[] = $category; }
        if ($bookingChannel !== '') { $where .= ' AND r.booking_channel=?';          $binds[] = $bookingChannel; }
        if ($queuePosition !== '')  { $where .= ' AND r.current_queue_position=?';   $binds[] = $queuePosition; }
        if ($requestType !== '')    { $where .= ' AND r.request_type=?';             $binds[] = $requestType; }

        return [$where, $binds];
    }

    // ── Get Documents (base64) ────────────────────────────────────────────────

    public function getDocuments(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];
        $dir    = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
                . DIRECTORY_SEPARATOR . $autoId;

        $slotLabels = [
            'cpd_mulkiya_front'     => 'Traffic File Front',
            'cpd_mulkiya_back'      => 'Traffic File Back',
            'cpd_emirates_id_front' => 'Emirates ID Front',
            'cpd_emirates_id_back'  => 'Emirates ID Back',
            'cpd_passport'          => 'Passport Photo',
            'cpd_owner_visa'        => 'Visa Page',
            'cpd_trade_license'     => 'Trade License',
            'cpd_noc'               => 'NOC',
        ];

        $docs = [];
        foreach ($slotLabels as $stem => $label) {
            foreach (['jpg', 'jpeg', 'png'] as $ext) {
                $path = $dir . DIRECTORY_SEPARATOR . $stem . '.' . $ext;
                if (file_exists($path)) {
                    $mime   = $ext === 'png' ? 'image/png' : 'image/jpeg';
                    $docs[] = [
                        'stem'   => $stem,
                        'label'  => $label,
                        'base64' => 'data:' . $mime . ';base64,' . base64_encode(file_get_contents($path)),
                    ];
                    break;
                }
            }
        }

        Response::success($docs);
    }

    // ── Cashier Payment ───────────────────────────────────────────────────────

    public function pay(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('method_of_payment')->validate();

        $id     = (int) $params['id'];
        $method = strtoupper(trim($body['method_of_payment']));

        if (!in_array($method, ['CASH', 'CREDIT_CARD'], true)) {
            Response::error('Invalid payment method', 422);
        }

        // Get next queue position from workflow
        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions
             WHERE section='CPD' AND action='ACCEPT_PAYMENT_NORMAL_REQUEST_WALKIN' LIMIT 1",
        );
        $nextQueue = $wf['next_role'] ?? 'CPD_Officer';

        $this->db->execute(
            "UPDATE mn_cpd_requests
             SET booking_fee_status    = 1,
                 booking_fee_paid_by   = 'CASHIER',
                 booking_fee_paid_date = NOW(),
                 method_of_payment     = ?,
                 request_status        = 2,
                 current_queue_position = ?
             WHERE auto_id = ?",
            [$method, $nextQueue, $id],
        );

        $this->logEvent('CASHIER_PAYMENT', $id, $method);
        Response::success(null, 'Payment recorded');
    }

    // ── Print AWB — Create Aramex Shipment ────────────────────────────────────

    public function printAwb(array $params, array $body, array $query): void
    {
        $id = (int) $params['id'];

        // Get request details
        $req = $this->db->queryOne(
            "SELECT r.auto_id, r.request_id, r.method_of_payment,
                    cu.first_name, cu.last_name, cu.uae_address, cu.city,
                    u.email, u.mobile_no
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id = r.auto_id
             LEFT JOIN mn_users            u  ON u.user_id          = r.belonging_user_id
             WHERE r.auto_id = ?",
            [$id],
        );
        if (!$req) Response::notFound('Request not found');

        // Get issued carnet
        $carnet = $this->db->queryOne(
            "SELECT c.carnet_no FROM mn_cpd_issued_carnets ic
             JOIN mn_cpd_carnets c ON c.carnet_id = ic.carnet_id
             WHERE ic.request_id = ? ORDER BY ic.carnet_issue_id DESC LIMIT 1",
            [$id],
        );
        if (!$carnet) Response::error('No issued carnet found for this request', 422);

        $carnetNo = $carnet['carnet_no'];
        $fullName = trim(($req['first_name'] ?? '') . ' ' . ($req['last_name'] ?? ''));

        $data = [
            "Shipments" => [[
                "Reference1"  => "Shipment-{$carnetNo}",
                "Reference2"  => null,
                "Reference3"  => null,
                "Shipper" => [
                    "Reference1"    => "Shipment-{$carnetNo}",
                    "Reference2"    => null,
                    "AccountNumber" => ARAMAX_ACCOUNT_NO,
                    "PartyAddress"  => [
                        "Line1"               => "Al Wuheida Street",
                        "Line2"               => "Al Mamzar – Po Box 5078 Dubai",
                        "Line3"               => "",
                        "City"                => "Dubai",
                        "StateOrProvinceCode" => "",
                        "PostCode"            => "000000",
                        "CountryCode"         => "AE",
                        "Longitude"           => 0,
                        "Latitude"            => 0,
                        "BuildingNumber"      => null,
                        "BuildingName"        => null,
                        "Floor"               => null,
                        "Apartment"           => null,
                        "POBox"               => null,
                        "Description"         => null,
                    ],
                    "Contact" => [
                        "Department"      => null,
                        "PersonName"      => "EMSO",
                        "Title"           => null,
                        "CompanyName"     => "EMSO",
                        "PhoneNumber1"    => "+97142961122",
                        "PhoneNumber1Ext" => "",
                        "PhoneNumber2"    => "+97142961122",
                        "PhoneNumber2Ext" => "",
                        "FaxNumber"       => null,
                        "CellPhone"       => "+97142961122",
                        "EmailAddress"    => "",
                        "Type"            => "",
                    ],
                ],
                "Consignee" => [
                    "Reference1"    => $fullName,
                    "Reference2"    => null,
                    "AccountNumber" => null,
                    "PartyAddress"  => [
                        "Line1"               => $req['uae_address'] ?? '',
                        "Line2"               => "",
                        "Line3"               => "",
                        "City"                => $req['city'] ?? '',
                        "StateOrProvinceCode" => "DXB",
                        "PostCode"            => "",
                        "CountryCode"         => "AE",
                        "Longitude"           => 0,
                        "Latitude"            => 0,
                        "BuildingNumber"      => null,
                        "BuildingName"        => null,
                        "Floor"               => null,
                        "Apartment"           => null,
                        "POBox"               => null,
                        "Description"         => null,
                    ],
                    "Contact" => [
                        "Department"      => null,
                        "PersonName"      => $fullName,
                        "Title"           => null,
                        "CompanyName"     => $fullName,
                        "PhoneNumber1"    => $req['mobile_no'] ?? '',
                        "PhoneNumber1Ext" => "",
                        "PhoneNumber2"    => $req['mobile_no'] ?? '',
                        "PhoneNumber2Ext" => "",
                        "FaxNumber"       => null,
                        "CellPhone"       => $req['mobile_no'] ?? '',
                        "EmailAddress"    => $req['email'] ?? '',
                        "Type"            => "",
                    ],
                ],
                "ThirdParty"             => null,
                "ShippingDateTime"       => "/Date(" . (floor(microtime(true) * 1000)) . ")/",
                "DueDate"                => "/Date(" . (floor(microtime(true) * 1000)) . ")/",
                "Comments"               => null,
                "PickupLocation"         => null,
                "OperationsInstructions" => null,
                "AccountingInstrcutions" => null,
                "Details" => [
                    "Dimensions" => [
                        "Length" => 0, "Width" => 0, "Height" => 0, "Unit" => "CM",
                    ],
                    "ActualWeight"     => ["Unit" => "KG", "Value" => 0.1],
                    "ChargeableWeight" => ["Unit" => "KG", "Value" => 0],
                    "DescriptionOfGoods"   => $carnetNo,
                    "GoodsOriginCountry"   => "AE",
                    "NumberOfPieces"       => 1,
                    "ProductGroup"         => "DOM",
                    "ProductType"          => "ONP",
                    "PaymentType"          => "P",
                    "PaymentOptions"       => "ACCT",
                    "CustomsValueAmount"   => ["CurrencyCode" => "AED", "Value" => 10],
                    "CashOnDeliveryAmount" => ["CurrencyCode" => "AED", "Value" => 0],
                    "InsuranceAmount"      => ["CurrencyCode" => "AED", "Value" => 0],
                    "CashAdditionalAmount" => ["CurrencyCode" => "AED", "Value" => 0],
                    "CashAdditionalAmountDescription" => null,
                    "CollectAmount"        => ["CurrencyCode" => "AED", "Value" => 0],
                    "Services" => "",
                    "Items" => [[
                        "PackageType"       => "item",
                        "Quantity"          => 1,
                        "Weight"            => ["Unit" => "CM", "Value" => 0],
                        "Comments"          => $carnetNo,
                        "Reference"         => $carnetNo,
                        "PiecesDimensions"  => null,
                        "CommodityCode"     => null,
                        "GoodsDescription"  => null,
                        "CountryOfOrigin"   => null,
                        "CustomsValue"      => null,
                        "ContainerNumber"   => null,
                    ]],
                    "DeliveryInstructions"    => null,
                    "AdditionalProperties"    => null,
                    "ContainsDangerousGoods"  => false,
                ],
                "Attachments"        => null,
                "ForeignHAWB"        => null,
                "TransportType "     => 0,
                "PickupGUID"         => null,
                "Number"             => null,
                "ScheduledDelivery"  => null,
            ]],
            "LabelInfo"  => ["ReportID" => 9729, "ReportType" => "URL"],
            "ClientInfo" => [
                "UserName"           => ARAMAX_USERNAME,
                "Password"           => ARAMAX_PASSWORD,
                "Version"            => "v1",
                "AccountNumber"      => ARAMAX_ACCOUNT_NO,
                "AccountPin"         => ARAMAX_ACCOUNT_PIN,
                "AccountEntity"      => "DXB",
                "AccountCountryCode" => "AE",
                "Source"             => 24,
                "PreferredLanguageCode" => null,
            ],
            "Transaction" => null,
        ];

        $ch = curl_init(ARAMAX_CREATE_SHIPMENT_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($data),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 30,
        ]);
        $jsonResponse = curl_exec($ch);
        $httpCode     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError    = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            Logger::error("Aramex cURL error: {$curlError}");
            Response::serverError("Aramex connection failed: {$curlError}");
        }

        $result = json_decode($jsonResponse, true);

        // Check for Aramex-level errors
        if (!empty($result['HasErrors']) && $result['HasErrors'] === true) {
            $notifications = $result['Notifications'] ?? [];
            $message = implode('; ', array_column($notifications, 'Message'));
            Logger::error("Aramex error for request {$id}: {$message}");
            Response::error("Aramex error: {$message}", 422);
        }

        // Extract shipment number and label URL
        $shipment  = $result['Shipments'][0] ?? [];
        $airBillNo = $shipment['ID'] ?? ($shipment['Number'] ?? '');
        $labelUrl  = $result['ShipmentLabel']['LabelURL'] ?? '';

        // Save air bill number back to the request
        if ($airBillNo) {
            $this->db->execute(
                'UPDATE mn_cpd_requests SET air_bill_no = ? WHERE auto_id = ?',
                [$airBillNo, $id],
            );
        }

        Logger::info("Aramex AWB created for CPD request {$id}: airBillNo={$airBillNo}");
        Response::success([
            'air_bill_no' => $airBillNo,
            'label_url'   => $labelUrl,
            'raw'         => $result,
        ], 'AWB created successfully');
    }

    // ── Return Guarantee Cheque ───────────────────────────────────────────────

    public function getReturnCheque(array $params, array $body, array $query): void
    {
        $row = $this->db->queryOne(
            "SELECT guarantee_cheque_id, beneficiary_name, cheque_no, cheque_date, bank, remarks
             FROM mn_cpd_return_guarantee_details
             WHERE request_id = ?
             ORDER BY guarantee_cheque_id DESC LIMIT 1",
            [(int) $params['id']],
        );
        Response::success($row);
    }

    public function updateReturnCheque(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('beneficiary_name', 'cheque_no', 'cheque_date', 'bank')
            ->validate();

        $id = (int) $params['id'];

        $this->db->execute(
            "UPDATE mn_cpd_return_guarantee_details
             SET beneficiary_name = ?, cheque_no = ?, cheque_date = ?, bank = ?, remarks = ?
             WHERE request_id = ?
             ORDER BY guarantee_cheque_id DESC LIMIT 1",
            [
                $body['beneficiary_name'],
                $body['cheque_no'],
                $body['cheque_date'],
                $body['bank'],
                $body['remarks'] ?? '',
                $id,
            ],
        );

        Response::success(null, 'Return cheque details updated');
    }

    public function returnCheque(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('beneficiary_name', 'cheque_no', 'cheque_date', 'bank')
            ->validate();

        $id = (int) $params['id'];

        $this->db->execute(
            "INSERT INTO mn_cpd_return_guarantee_details
             (request_id, beneficiary_name, cheque_no, cheque_date, bank, remarks, added_datetime, status)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)",
            [
                $id,
                $body['beneficiary_name'],
                $body['cheque_no'],
                $body['cheque_date'],
                $body['bank'],
                $body['remarks'] ?? '',
            ],
        );

        Response::created(null, 'Return cheque details saved');
    }

    public function getComments(array $params, array $body, array $query): void
    {
        $rows = $this->db->query(
            "SELECT c.comment_id, c.comment, c.added_datetime,
                    u.first_name, u.last_name
             FROM mn_cpd_officer_comments c
             LEFT JOIN mn_users u ON u.user_id = c.added_by
             WHERE c.request_id = ?
             ORDER BY c.added_datetime DESC",
            [(int) $params['id']],
        );
        Response::success($rows);
    }

    // ── Public Update (corrections) ───────────────────────────────────────────

    public function publicUpdate(array $params, array $body, array $query): void
    {
        $id = (int) $params['id'];

        // Verify request belongs to this user and is in status 8 (sent for corrections)
        $req = $this->db->queryOne(
            'SELECT auto_id, request_status, belonging_user_id FROM mn_cpd_requests WHERE auto_id = ?',
            [$id],
        );
        if (!$req)                                    Response::notFound('Request not found');
        if ((int) $req['belonging_user_id'] !== Auth::id()) Response::error('Forbidden', 403);
        if ((string) $req['request_status'] !== '8') Response::error('Request is not in correction state', 422);

        // Allowed editable fields — only columns that exist in mn_cpd_request_user
        $allowed = [
            'first_name', 'last_name', 'emirates_id', 'passport_no',
            'po_box', 'city', 'uae_address', 'home_country_address',
        ];

        // Build update fields from submitted body
        $userFields = [];
        $userBinds  = [];
        foreach ($allowed as $f) {
            if (array_key_exists($f, $body)) {
                $userFields[] = "`{$f}` = ?";
                $userBinds[]  = $body[$f];
            }
        }

        // Look up queue position for CPD_Officer from workflow table
        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions
             WHERE section='CPD' AND action='CREATE_REQUEST_WALKIN' LIMIT 1",
        );
        $queuePosition = $wf['next_role'] ?? 'CPD_Officer';

        $this->db->beginTransaction();
        try {
            // Update mn_cpd_request_user with corrected owner details
            if (!empty($userFields)) {
                $userBinds[] = $id;
                $this->db->execute(
                    "UPDATE mn_cpd_request_user SET " . implode(', ', $userFields) . "
                     WHERE request_auto_id = ?",
                    $userBinds,
                );
            }

            // Update email and mobile_no in mn_users (not in mn_cpd_request_user)
            $userUpdates = [];
            $userUpdateBinds = [];
            if (!empty($body['email']))     { $userUpdates[] = 'email = ?';     $userUpdateBinds[] = $body['email']; }
            if (!empty($body['mobile_no'])) { $userUpdates[] = 'mobile_no = ?'; $userUpdateBinds[] = $body['mobile_no']; }
            if (!empty($userUpdates)) {
                $userUpdateBinds[] = $req['belonging_user_id'];
                $this->db->execute(
                    "UPDATE mn_users SET " . implode(', ', $userUpdates) . " WHERE user_id = ?",
                    $userUpdateBinds,
                );
            }

            // Set status=2 (Processing) and route back to CPD Officer queue
            $this->db->execute(
                "UPDATE mn_cpd_requests
                 SET request_status = 2,
                     current_queue_position = ?
                 WHERE auto_id = ?",
                [$queuePosition, $id],
            );

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Logger::exception($e, 'CPDController::publicUpdate');
            Response::serverError('Failed to resubmit: ' . $e->getMessage());
        }

        Response::success(null, 'Application updated and resubmitted for review');
    }

    // ── Document Upload ───────────────────────────────────────────────────────

    public function uploadDocuments(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];
        $dir    = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
                . DIRECTORY_SEPARATOR . $autoId;

        if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
            Response::serverError('Could not create upload directory');
        }

        // Maps form field name → filename stem (without extension)
        $slotMap = [
            'traffic_front'  => 'cpd_mulkiya_front',
            'traffic_back'   => 'cpd_mulkiya_back',
            'eid_front'      => 'cpd_emirates_id_front',
            'eid_back'       => 'cpd_emirates_id_back',
            'passport_photo' => 'cpd_passport',
            'visa_page'      => 'cpd_owner_visa',
            'trade_license'  => 'cpd_trade_license',
            'noc'            => 'cpd_noc',
        ];

        $saved  = [];
        $errors = [];

        foreach ($slotMap as $field => $stem) {
            if (empty($_FILES[$field]) || $_FILES[$field]['error'] === UPLOAD_ERR_NO_FILE) continue;
            $file = $_FILES[$field];
            if ($file['error'] !== UPLOAD_ERR_OK) {
                $errors[$field] = 'Upload error code ' . $file['error']; continue;
            }
            $mime = mime_content_type($file['tmp_name']);
            if (!in_array($mime, ['image/jpeg','image/png'], true)) {
                $errors[$field] = 'Only JPG/PNG accepted'; continue;
            }
            if ($file['size'] > Config::UPLOAD_MAX_BYTES) {
                $errors[$field] = 'File exceeds 2 MB'; continue;
            }
            $ext  = $mime === 'image/png' ? 'png' : 'jpg';
            $dest = $dir . DIRECTORY_SEPARATOR . $stem . '.' . $ext;
            if (move_uploaded_file($file['tmp_name'], $dest)) {
                $saved[$field] = Config::CPD_IMAGE_PATH . "/{$autoId}/{$stem}.{$ext}";
            } else {
                $errors[$field] = 'Failed to save file';
            }
        }

        Response::success(['saved' => $saved, 'errors' => $errors],
            empty($errors) ? 'Documents saved' : 'Some documents saved');
    }

    // ── Renew / Copy an existing CPD request ─────────────────────────────────

    public function renew(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('vehicle_make','vehicle_model','registration_no','chassis_no','manuf_year','method_of_payment')
            ->numeric('vehicle_value')->numeric('guarantee_amount')->numeric('booking_fee')
            ->validate();

        $sourceAutoId = (int)($body['parent_request_id'] ?? 0);
        if (!$sourceAutoId) Response::error('parent_request_id is required', 422);

        $source = $this->db->queryOne(
            'SELECT auto_id, request_id FROM mn_cpd_requests WHERE auto_id = ?',
            [$sourceAutoId],
        );
        if (!$source) Response::error('Source request not found', 404);

        $isRenew = strtolower(trim($body['renew_action'] ?? 'copy')) === 'renew';

        if ($isRenew) {
            $existingChild = $this->db->queryOne(
                'SELECT auto_id FROM mn_cpd_requests WHERE parent_request_id = ? LIMIT 1',
                [$sourceAutoId],
            );
            if ($existingChild) Response::error('This Carnet is already Renewed', 409);
        }

        $userId = !empty($body['user_id']) ? (int)$body['user_id'] : Auth::id();

        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions
             WHERE section='CPD' AND action='CREATE_NORMAL_REQUEST_WALKIN' LIMIT 1",
        );
        $queuePosition = $wf['next_role'] ?? null;

        $newId     = null;
        $requestId = null;
        $this->db->beginTransaction();
        try {
            $newId = $this->db->insert(
                "INSERT INTO mn_cpd_requests
                 (request_id, request_category, belonging_user_id,
                  vehicle_make, vehicle_model, registration_no, chassis_no, engine_no,
                  manuf_year, color, body_type, no_of_cylinders, horse_power,
                  net_weight, vehicle_value, mulkiya_no,
                  extra_owner1_name, extra_owner2_name,
                  guarantee_amount, booking_fee, extra_fees, vat_amount, total_amount,
                  method_of_payment, booking_channel, request_status,
                  current_queue_position, request_type, parent_request_id, requested_datetime)
                 VALUES ('PENDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'WALKIN',1,?,?,?,NOW())",
                [
                    $body['request_category']   ?? 'NORMAL',
                    $userId,
                    $body['vehicle_make'],
                    $body['vehicle_model'],
                    $body['registration_no'],
                    $body['chassis_no'],
                    $body['engine_no']          ?? '',
                    $body['manuf_year'],
                    $body['color']              ?? '',
                    $body['body_type']          ?? '',
                    $body['no_of_cylinders']    ?? 0,
                    $body['horse_power']        ?? 0,
                    $body['net_weight']         ?? 0,
                    $body['vehicle_value']      ?? 0,
                    $body['mulkiya_no']         ?? '',
                    $body['extra_owner1_name']  ?? '',
                    $body['extra_owner2_name']  ?? '',
                    $body['guarantee_amount']   ?? 0,
                    $body['booking_fee']        ?? 0,
                    $body['extra_fees']         ?? 0,
                    $body['vat_amount']         ?? 0,
                    $body['total_amount']       ?? 0,
                    $body['method_of_payment'],
                    $queuePosition,
                    'RENEW',
                    $sourceAutoId,
                ],
            );

            if (!$newId) throw new \RuntimeException('Insert returned no ID');

            $requestId = sprintf('CPD-ATC-%s/%d', date('Ymd'), $newId);
            $this->db->execute(
                'UPDATE mn_cpd_requests SET request_id = ? WHERE auto_id = ?',
                [$requestId, $newId],
            );

            // Owner snapshot
            $this->db->execute(
                "INSERT INTO mn_cpd_request_user
                 (user_id, request_auto_id, title, first_name, last_name,
                  nationality_id, city, uae_address, po_box,
                  emirates_id, passport_no, registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
                [
                    $userId, $newId,
                    $body['title']       ?? null,
                    $body['first_name']  ?? '',
                    $body['last_name']   ?? '',
                    $body['nationality'] ?? null,
                    $body['city']        ?? '',
                    $body['address']     ?? '',
                    $body['po_box']      ?? '',
                    $body['emirates_id'] ?? '',
                    $body['passport_no'] ?? '',
                ],
            );

            // Countries
            foreach ((array)($body['countries'] ?? []) as $cid) {
                $this->db->execute(
                    'INSERT INTO mn_cpd_request_country_list (request_id, country_id) VALUES (?,?)',
                    [$newId, (int)$cid],
                );
            }

            // Copy guarantee details (ISSUE + RETURN)
            foreach (['ISSUE', 'RETURN'] as $gType) {
                $rows = $this->db->query(
                    "SELECT cheque_no, bank, payment_reference, method_of_payment, remarks,
                            beneficiary_name, added_by, added_datetime, guarantee_type,
                            method1_amount, method2_amount
                     FROM mn_cpd_bank_guarantee_details
                     WHERE request_id = ? AND guarantee_type = ?",
                    [$sourceAutoId, $gType],
                );
                foreach ($rows as $row) {
                    $this->db->execute(
                        "INSERT INTO mn_cpd_bank_guarantee_details
                         (request_id, cheque_no, bank, payment_reference, method_of_payment, remarks,
                          beneficiary_name, added_by, added_datetime, guarantee_type,
                          method1_amount, method2_amount)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                        [
                            $newId,
                            $row['cheque_no'], $row['bank'], $row['payment_reference'],
                            $row['method_of_payment'], $row['remarks'], $row['beneficiary_name'],
                            $row['added_by'], $row['added_datetime'], $row['guarantee_type'],
                            $row['method1_amount'], $row['method2_amount'],
                        ],
                    );
                }
            }

            // For RENEW: also copy issued carnet records from parent
            if ($isRenew) {
                $carnets = $this->db->query(
                    "SELECT carnet_id, issued_datetime, issued_by, carnet_status
                     FROM mn_cpd_issued_carnets WHERE request_id = ?",
                    [$sourceAutoId],
                );
                foreach ($carnets as $c) {
                    $this->db->execute(
                        "INSERT INTO mn_cpd_issued_carnets
                         (carnet_id, request_id, issued_datetime, issued_by, carnet_status)
                         VALUES (?,?,?,?,?)",
                        [$c['carnet_id'], $newId, $c['issued_datetime'], $c['issued_by'], $c['carnet_status']],
                    );
                }
            }

            // Copy document files from source directory to new directory
            $baseDir   = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH;
            $sourceDir = $baseDir . DIRECTORY_SEPARATOR . $sourceAutoId;
            $destDir   = $baseDir . DIRECTORY_SEPARATOR . $newId;
            if (is_dir($sourceDir)) {
                if (!is_dir($destDir)) mkdir($destDir, 0755, true);
                foreach (glob($sourceDir . DIRECTORY_SEPARATOR . '*') as $file) {
                    if (is_file($file)) copy($file, $destDir . DIRECTORY_SEPARATOR . basename($file));
                }
            }

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Logger::exception($e, 'CPDController::renew');
            Response::serverError('Failed to create renew request: ' . $e->getMessage());
        }

        $action = $isRenew ? 'RENEW' : 'COPY';
        $this->logEvent($action, $newId, "source:{$source['request_id']}");
        Response::created(['auto_id' => $newId, 'request_id' => $requestId]);
    }

    // ── Search by Request ID or Carnet No (Copy/Renew) ────────────────────────

    public function searchByRef(array $params, array $body, array $query): void
    {
        $ref = trim($query['ref'] ?? '');
        if ($ref === '') Response::error('Reference is required', 422);

        $row = $this->db->queryOne(
            "SELECT mn_cpd_requests.*, mn_cpd_request_user.*, mn_users.*,
                    mn_cpd_carnets.is_damaged,
                    (SELECT count(auto_id) FROM mn_cpd_requests cr
                     WHERE cr.parent_request_id = mn_cpd_requests.auto_id) AS childs
             FROM mn_cpd_requests
             JOIN mn_cpd_issued_carnets ON mn_cpd_requests.auto_id = mn_cpd_issued_carnets.request_id
             JOIN mn_cpd_carnets        ON mn_cpd_issued_carnets.carnet_id = mn_cpd_carnets.carnet_id
             JOIN mn_cpd_request_user          ON mn_cpd_requests.auto_id=mn_cpd_request_user.request_auto_id
             JOIN mn_users              ON mn_cpd_requests.belonging_user_id = mn_users.user_id
             WHERE (mn_cpd_requests.request_id = :request_id OR mn_cpd_carnets.carnet_no = :carnet_no)",
            [':request_id' => $ref, ':carnet_no' => $ref],
        );

        if (!$row) Response::error('No request found for the given reference', 404);

        $row['countries'] = $this->db->query(
            'SELECT country_id FROM mn_cpd_request_country_list WHERE request_id = ?',
            [$row['auto_id']],
        );

        Response::success($row);
    }

    public function addClaim(array $params, array $body, array $query): void
    {
        // Multipart FormData — fields arrive in $_POST, not $body
        $requestId    = (int)($_POST['request_id']    ?? 0);
        $carnetNo     = trim($_POST['carnet_no']      ?? '');
        $claimDetails = trim($_POST['claim_details']  ?? '');

        if (!$requestId || $carnetNo === '') Response::error('request_id and carnet_no are required', 422);

        $claimId = $this->db->insert(
            'INSERT INTO mn_cpd_claims (request_id, carnet_no, claim_details, added_by, added_datetime)
             VALUES (?, ?, ?, ?, NOW())',
            [$requestId, $carnetNo, $claimDetails, Auth::id()],
        );

        // Save uploaded PDF files
        $dir = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
             . DIRECTORY_SEPARATOR . 'claims' . DIRECTORY_SEPARATOR . $claimId;

        $saved  = [];
        $errors = [];

        if (!empty($_FILES['documents'])) {
            $files = $_FILES['documents'];
            $count = is_array($files['name']) ? count($files['name']) : 1;

            // Normalise to indexed arrays whether single or multiple files sent
            if (!is_array($files['name'])) {
                foreach (['name','tmp_name','error','size','type'] as $k) $files[$k] = [$files[$k]];
            }

            if ($count > 0 && !is_dir($dir) && !mkdir($dir, 0755, true)) {
                Response::serverError('Could not create upload directory');
            }

            for ($i = 0; $i < $count; $i++) {
                if ($files['error'][$i] === UPLOAD_ERR_NO_FILE) continue;
                if ($files['error'][$i] !== UPLOAD_ERR_OK) {
                    $errors[] = "File {$files['name'][$i]}: upload error {$files['error'][$i]}"; continue;
                }
                if (!self::isPdf($files['tmp_name'][$i])) {
                    $errors[] = "File {$files['name'][$i]}: only PDF files are accepted"; continue;
                }
                if ($files['size'][$i] > 10 * 1024 * 1024) {
                    $errors[] = "File {$files['name'][$i]}: exceeds 10 MB limit"; continue;
                }
                $safeName = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $files['name'][$i]);
                $dest     = $dir . DIRECTORY_SEPARATOR . $safeName;
                if (move_uploaded_file($files['tmp_name'][$i], $dest)) {
                    $saved[] = Config::CPD_IMAGE_PATH . "/claims/{$claimId}/{$safeName}";
                } else {
                    $errors[] = "File {$files['name'][$i]}: failed to save";
                }
            }
        }

        $this->logEvent('ADD_CLAIM', $requestId, "claim_id={$claimId} carnet={$carnetNo}");

        Response::created(['claim_id' => $claimId, 'saved' => $saved, 'errors' => $errors]);
    }

    public function getClaims(array $params, array $body, array $query): void
    {
        $requestId = (int)$params['id'];

        $claims = $this->db->query(
            "SELECT c.claim_id, c.carnet_no, c.claim_details, c.added_datetime,
                    CONCAT(u.first_name,' ',u.last_name) AS added_by_name
             FROM mn_cpd_claims c
             LEFT JOIN mn_users u ON u.user_id = c.added_by
             WHERE c.request_id = ?
             ORDER BY c.claim_id DESC",
            [$requestId],
        );

        // Attach file list for each claim
        $base = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH . DIRECTORY_SEPARATOR . 'claims';
        foreach ($claims as &$claim) {
            $dir   = $base . DIRECTORY_SEPARATOR . $claim['claim_id'];
            $files = [];
            if (is_dir($dir)) {
                foreach (glob($dir . DIRECTORY_SEPARATOR . '*.pdf') as $f) {
                    $files[] = basename($f);
                }
            }
            $claim['documents'] = $files;
        }
        unset($claim);

        Response::success($claims);
    }

    public function getClaimNotes(array $params, array $body, array $query): void
    {
        $claimId = (int)$params['id'];

        $notes = $this->db->query(
            "SELECT n.note_id, n.claim_id, n.note_text, n.added_datetime,
                    CONCAT(u.first_name,' ',u.last_name) AS added_by_name
             FROM mn_cpd_claim_notes n
             LEFT JOIN mn_users u ON u.user_id = n.added_by
             WHERE n.claim_id = ?
             ORDER BY n.note_id ASC",
            [$claimId],
        );

        $base = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
              . DIRECTORY_SEPARATOR . 'claims' . DIRECTORY_SEPARATOR
              . $claimId . DIRECTORY_SEPARATOR . 'notes';

        foreach ($notes as &$note) {
            $dir   = $base . DIRECTORY_SEPARATOR . $note['note_id'];
            $files = [];
            if (is_dir($dir)) {
                foreach (glob($dir . DIRECTORY_SEPARATOR . '*.pdf') as $f) {
                    $files[] = basename($f);
                }
            }
            $note['documents'] = $files;
        }
        unset($note);

        Response::success($notes);
    }

    public function addClaimNote(array $params, array $body, array $query): void
    {
        $claimId  = (int)$params['id'];
        $noteText = trim($_POST['note_text'] ?? '');

        $noteId = $this->db->insert(
            'INSERT INTO mn_cpd_claim_notes (claim_id, note_text, added_by, added_datetime)
             VALUES (?, ?, ?, NOW())',
            [$claimId, $noteText, Auth::id()],
        );

        $saved  = [];
        $errors = [];

        if (!empty($_FILES['documents'])) {
            $files = $_FILES['documents'];
            if (!is_array($files['name'])) {
                foreach (['name','tmp_name','error','size','type'] as $k) $files[$k] = [$files[$k]];
            }
            $count = count($files['name']);
            $dir   = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
                   . DIRECTORY_SEPARATOR . 'claims' . DIRECTORY_SEPARATOR
                   . $claimId . DIRECTORY_SEPARATOR . 'notes'
                   . DIRECTORY_SEPARATOR . $noteId;

            if ($count > 0 && !is_dir($dir) && !mkdir($dir, 0755, true)) {
                Response::serverError('Could not create upload directory');
            }

            for ($i = 0; $i < $count; $i++) {
                if ($files['error'][$i] === UPLOAD_ERR_NO_FILE) continue;
                if ($files['error'][$i] !== UPLOAD_ERR_OK) {
                    $errors[] = "File {$files['name'][$i]}: upload error {$files['error'][$i]}"; continue;
                }
                if (!self::isPdf($files['tmp_name'][$i])) {
                    $errors[] = "File {$files['name'][$i]}: only PDF files are accepted"; continue;
                }
                if ($files['size'][$i] > 10 * 1024 * 1024) {
                    $errors[] = "File {$files['name'][$i]}: exceeds 10 MB limit"; continue;
                }
                $safeName = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $files['name'][$i]);
                $dest     = $dir . DIRECTORY_SEPARATOR . $safeName;
                if (move_uploaded_file($files['tmp_name'][$i], $dest)) {
                    $saved[] = $safeName;
                } else {
                    $errors[] = "File {$files['name'][$i]}: failed to save";
                }
            }
        }

        Response::created(['note_id' => $noteId, 'saved' => $saved, 'errors' => $errors]);
    }

    public function serveClaimNoteDocument(array $params, array $body, array $query): void
    {
        $claimId  = (int)$params['claim_id'];
        $noteId   = (int)$params['note_id'];
        $filename = basename($params['filename'] ?? '');

        if ($claimId < 1 || $noteId < 1 || $filename === '' || !preg_match('/\.pdf$/i', $filename)) {
            Response::notFound('Document not found');
        }

        $filePath = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
                  . DIRECTORY_SEPARATOR . 'claims' . DIRECTORY_SEPARATOR . $claimId
                  . DIRECTORY_SEPARATOR . 'notes'  . DIRECTORY_SEPARATOR . $noteId
                  . DIRECTORY_SEPARATOR . $filename;

        if (!file_exists($filePath)) Response::notFound('Document not found');

        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($filePath));
        header('Cache-Control: private, max-age=3600');
        readfile($filePath);
        exit;
    }

    public function serveClaimDocument(array $params, array $body, array $query): void
    {
        $claimId  = (int)$params['id'];
        $filename = basename($params['filename'] ?? '');

        if ($claimId < 1 || $filename === '' || !preg_match('/\.pdf$/i', $filename)) {
            Response::notFound('Document not found');
        }

        $filePath = API_ROOT . DIRECTORY_SEPARATOR
                  . Config::CPD_IMAGE_PATH . DIRECTORY_SEPARATOR
                  . 'claims' . DIRECTORY_SEPARATOR
                  . $claimId . DIRECTORY_SEPARATOR
                  . $filename;

        if (!file_exists($filePath)) Response::notFound('Document not found');

        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($filePath));
        header('Cache-Control: private, max-age=3600');
        readfile($filePath);
        exit;
    }

    public function searchClaims(array $params, array $body, array $query): void
    {
        $carnetNo = trim($query['carnet_no'] ?? '');
        if ($carnetNo === '') Response::error('Carnet No is required', 422);

        $row = $this->db->queryOne(
            "SELECT
                 c.carnet_no,
                 r.auto_id, r.request_id, r.request_status,
                 r.registration_no, r.mulkiya_no, r.vehicle_make, r.vehicle_model,
                 r.chassis_no, r.engine_no, r.color, r.manuf_year,
                 ru.first_name, ru.last_name, ru.title,
                 ru.passport_no, ru.emirates_id,
                 ru.uae_address, ru.home_country_address, ru.company_name,
                 u.mobile_no, u.email,
                 ic.issued_datetime,
                 cr.added_datetime  AS returned_datetime,
                 s.status           AS status_label
             FROM mn_cpd_carnets c
             JOIN mn_cpd_issued_carnets ic  ON ic.carnet_id       = c.carnet_id
             JOIN mn_cpd_requests r         ON r.auto_id          = ic.request_id
             JOIN mn_cpd_request_user ru    ON ru.request_auto_id = r.auto_id
             JOIN mn_users u                ON u.user_id          = r.belonging_user_id
             LEFT JOIN mn_cpd_carnet_returns cr ON cr.request_id  = r.auto_id
             LEFT JOIN mn_cpd_statuses s    ON s.carnet_status_id = r.request_status
             WHERE c.carnet_no = ?
               AND r.request_status IN (3, 4)
             LIMIT 1",
            [$carnetNo],
        );

        if (!$row) Response::error('No issued or returned carnet found for this Carnet No', 404);

        Response::success($row);
    }

    // ── Customer Holds ────────────────────────────────────────────────────────

    public function listHolds(array $params, array $body, array $query): void
    {
        $page   = max(1, (int)($query['page']   ?? 1));
        $search = trim($query['search'] ?? '');
        $sort   = $query['sort'] ?? 'placed_at';
        $dir    = strtoupper($query['dir'] ?? 'DESC') === 'ASC' ? 'ASC' : 'DESC';

        $allowedSort = ['placed_at', 'emirates_id', 'is_active'];
        if (!in_array($sort, $allowedSort, true)) $sort = 'placed_at';

        $where  = '';
        $binds  = [];
        if ($search !== '') {
            $like   = "%{$search}%";
            $where  = "WHERE h.emirates_id LIKE ?
                          OR CONCAT(COALESCE(cu.first_name,''),' ',COALESCE(cu.last_name,'')) LIKE ?
                          OR CONCAT(placed.first_name,' ',placed.last_name) LIKE ?";
            $binds  = [$like, $like, $like];
        }

        $sql = "SELECT h.hold_id, h.emirates_id, h.hold_reason, h.placed_at, h.lifted_at, h.is_active,
                       CONCAT(COALESCE(cu.first_name,''),' ',COALESCE(cu.last_name,''))   AS customer_name,
                       CONCAT(placed.first_name,' ',placed.last_name)                     AS placed_by_name,
                       CONCAT(COALESCE(lf.first_name,''),' ',COALESCE(lf.last_name,''))  AS lifted_by_name
                FROM mn_customer_holds h
                LEFT JOIN (
                    SELECT emirates_id, MIN(user_id) AS user_id
                    FROM mn_cpd_request_user
                    GROUP BY emirates_id
                ) eid_map ON eid_map.emirates_id = h.emirates_id
                LEFT JOIN mn_users cu     ON cu.user_id    = eid_map.user_id
                LEFT JOIN mn_users placed ON placed.user_id = h.placed_by
                LEFT JOIN mn_users lf     ON lf.user_id    = h.lifted_by
                {$where}
                ORDER BY h.{$sort} {$dir}";

        $countSql = "SELECT COUNT(*) FROM mn_customer_holds h {$where}";

        Response::success($this->db->paginate($sql, $binds, $page, 20, $countSql));
    }

    public function searchCustomerHold(array $params, array $body, array $query): void
    {
        $eid = trim($query['eid'] ?? '');
        if ($eid === '') Response::error('Emirates ID is required', 422);

        // Look up customer profile from CPD or IDL tables
        $profile = $this->db->queryOne(
            "SELECT u.user_id, u.first_name, u.last_name, u.email, u.mobile_no,
                    COALESCE(cru.emirates_id, iru.emirates_id) AS emirates_id
             FROM mn_users u
             LEFT JOIN mn_cpd_request_user  cru ON cru.user_id = u.user_id AND cru.emirates_id = ?
             LEFT JOIN mn_idl_request_user  iru ON iru.user_id = u.user_id AND iru.emirates_id = ?
             WHERE (cru.emirates_id = ? OR iru.emirates_id = ?)
             LIMIT 1",
            [$eid, $eid, $eid, $eid],
        );

        $activeHold = $this->db->queryOne(
            "SELECT h.hold_id, h.hold_reason, h.placed_at,
                    CONCAT(u.first_name,' ',u.last_name) AS placed_by_name
             FROM mn_customer_holds h
             LEFT JOIN mn_users u ON u.user_id = h.placed_by
             WHERE h.emirates_id = ? AND h.is_active = 1
             ORDER BY h.hold_id DESC LIMIT 1",
            [$eid],
        );

        $history = $this->db->query(
            "SELECT h.hold_id, h.hold_reason, h.placed_at, h.lifted_at, h.is_active,
                    CONCAT(p.first_name,' ',p.last_name) AS placed_by_name,
                    CONCAT(l.first_name,' ',l.last_name) AS lifted_by_name
             FROM mn_customer_holds h
             LEFT JOIN mn_users p ON p.user_id = h.placed_by
             LEFT JOIN mn_users l ON l.user_id = h.lifted_by
             WHERE h.emirates_id = ?
             ORDER BY h.hold_id DESC",
            [$eid],
        );

        Response::success([
            'emirates_id' => $eid,
            'profile'     => $profile,
            'active_hold' => $activeHold,
            'history'     => $history,
        ]);
    }

    public function placeHold(array $params, array $body, array $query): void
    {
        $eid    = trim($body['emirates_id'] ?? '');
        $reason = trim($body['reason'] ?? '');
        if ($eid === '') Response::error('Emirates ID is required', 422);

        $existing = $this->db->queryOne(
            'SELECT hold_id FROM mn_customer_holds WHERE emirates_id = ? AND is_active = 1 LIMIT 1',
            [$eid],
        );
        if ($existing) Response::error('Customer is already on hold', 409);

        $id = $this->db->insert(
            'INSERT INTO mn_customer_holds (emirates_id, hold_reason, placed_by, placed_at)
             VALUES (?, ?, ?, NOW())',
            [$eid, $reason, Auth::id()],
        );

        Response::created(['hold_id' => $id]);
    }

    public function liftHold(array $params, array $body, array $query): void
    {
        $holdId = (int)$params['id'];

        $hold = $this->db->queryOne(
            'SELECT hold_id FROM mn_customer_holds WHERE hold_id = ? AND is_active = 1',
            [$holdId],
        );
        if (!$hold) Response::notFound('Hold not found or already lifted');

        $this->db->execute(
            'UPDATE mn_customer_holds SET is_active = 0, lifted_by = ?, lifted_at = NOW() WHERE hold_id = ?',
            [Auth::id(), $holdId],
        );

        Response::success(['lifted' => true]);
    }

    private static function isPdf(string $tmpPath): bool
    {
        if (!is_file($tmpPath) || $tmpPath === '') return false;
        $fh = fopen($tmpPath, 'rb');
        if ($fh === false) return false;
        $magic = fread($fh, 4);
        fclose($fh);
        return $magic === '%PDF';
    }

    private function logEvent(string $action, $id, string $extra = ''): void
    {
        $this->db->execute(
            "INSERT INTO mn_event_logs (log_module, log_action, action_initiator, log_datetime, extra_params)
             VALUES ('CPD',?,?,NOW(),?)",
            [$action, Auth::id(), $extra ?: (string)$id],
        );
    }
}
