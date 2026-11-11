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
        // request_status is numeric (mn_cpd_statuses.carnet_status_id: 2=Confirmed,
        // 3=Issued, 4=Returned, 6=Cancelled) — these used to compare against string
        // literals, which MySQL coerces to 0, so every count/revenue figure below
        // always matched nothing (or only rows corrupted by that same bug elsewhere).
        $confirmed= (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE request_status=2");
        $issued   = (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE request_status=3");
        $returned = (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE request_status=4");
        $cancelled= (int)$this->db->scalar("SELECT COUNT(*) FROM mn_cpd_requests WHERE request_status=6");
        $revenue  = (float)$this->db->scalar(
            "SELECT COALESCE(SUM(total_amount),0) FROM mn_cpd_requests WHERE request_status IN (2,3,4)",
        );
        $this_month = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests
             WHERE MONTH(requested_datetime)=MONTH(NOW()) AND YEAR(requested_datetime)=YEAR(NOW())",
        );
        $stock_available = (int)$this->db->scalar(
            'SELECT COUNT(*) FROM mn_cpd_carnets WHERE is_used=0 AND is_damaged=0',
        );

        $online_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests WHERE booking_channel='ONLINE' AND request_status IN (1,2)",
        );
        $walkin_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests WHERE booking_channel='WALKIN' AND request_status IN (1,2)",
        );

        $cashier_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests WHERE current_queue_position='IDL_CPD_Cashier'",
        );
        $idl_cashier_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_idl_requests WHERE current_queue_position='IDL_CPD_Cashier' AND is_active=1",
        );
        $branch_pending = (int)$this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_requests WHERE current_queue_position='CPD_Branch_Manager'",
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
            'cashier_pending','idl_cashier_pending','branch_pending','cancellations_pending','returns_pending',
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
             ORDER BY (r.paid_date IS NULL), r.paid_date DESC, r.requested_datetime DESC";

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
                    cru.sex, cru.license_no, cru.license_expiry,
                    COALESCE(cru.emirates_id,          cu.emirates_id)          AS emirates_id,
                    COALESCE(cru.passport_no,          cu.passport_no)          AS passport_no,
                    COALESCE(cru.home_country_address, cu.home_country_address) AS home_country_address,
                    COALESCE(cru.uae_address,          cu.uae_address)          AS uae_address,
                    COALESCE(cru.po_box,               cu.po_box)               AS po_box,
                    COALESCE(cru.company_name,         cu.company_name)         AS company_name,
                    n.nationality,
                    r.identity_via_uae_pass AS applicant_via_uae_pass
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_statuses     s   ON s.carnet_status_id = r.request_status
             LEFT JOIN mn_users            u   ON u.user_id          = r.belonging_user_id
             LEFT JOIN mn_cpd_request_user cru ON cru.request_auto_id = r.auto_id
             LEFT JOIN mn_cpd_users        cu  ON cu.user_id          = r.belonging_user_id
             LEFT JOIN mn_nationalities    n   ON n.nationality_id   = COALESCE(cru.nationality_id, cu.nationality_id)
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
                    rr.deposit_slip_path, rr.deposit_slip_uploaded_datetime,
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
            "SELECT auto_id, belonging_user_id, paid_status, order_ref_no,
                    security_cheque_required, security_cheque_delivery_method
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

            $this->sendCpdPaymentConfirmedEmail((int)$autoId);

            // Payment is the right trigger point for the actual Aramex pickup — not
            // creation time, so an abandoned/unpaid draft never generates a real
            // courier request. Non-fatal on failure: the citizen has already paid, so
            // an officer can arrange collection manually rather than the payment
            // confirmation itself failing over a courier booking issue.
            $securityChequeAwb = null;
            if ((int)($req['security_cheque_required'] ?? 0) === 1
                && ($req['security_cheque_delivery_method'] ?? null) === 'ARAMEX') {
                $securityChequeAwb = $this->createSecurityChequeCollectionShipment((int)$autoId);
            }

            Response::success([
                'paid'                        => true,
                'module'                      => 'CPD',
                'auto_id'                     => (int)$autoId,
                'telr_ref'                    => $telrRef,
                'security_cheque_airway_bill' => $securityChequeAwb,
            ], 'CPD payment verified and recorded');
        } else {
            $statusText = $ipgOutput['order']['status']['text'] ?? 'Unknown';
            $statusCode = $ipgOutput['order']['status']['code'] ?? 'null';
            Response::error("Payment not confirmed — status code: {$statusCode}, text: {$statusText}", 402);
        }
    }

    /**
     * Creates an Aramex shipment to collect the citizen's security cheque from their
     * own address and deliver it to the EMSO office — the reverse direction of
     * printAwb() below (which ships EMSO -> citizen for an issued carnet). Called
     * once, right after Telr payment is confirmed (see telrVerify() above), only
     * when the citizen chose Aramex collection for a destination that requires a
     * security cheque. Saves the resulting AWB onto security_cheque_airway_bill —
     * previously this field could only be filled in manually by the citizen typing
     * in a reference number they had no way of actually having.
     */
    private function createSecurityChequeCollectionShipment(int $requestId): ?string
    {
        $req = $this->db->queryOne(
            "SELECT r.auto_id, r.request_id,
                    cu.first_name, cu.last_name, cu.uae_address, cu.city,
                    u.email, u.mobile_no
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id = r.auto_id
             LEFT JOIN mn_users            u  ON u.user_id          = r.belonging_user_id
             WHERE r.auto_id = ?",
            [$requestId],
        );
        if (!$req) {
            Logger::error("Security cheque Aramex pickup — request {$requestId} not found");
            return null;
        }

        $fullName = trim(($req['first_name'] ?? '') . ' ' . ($req['last_name'] ?? ''));
        $ref      = $req['request_id'] ?: "CPD-{$requestId}";

        $data = [
            "Shipments" => [[
                "Reference1" => "SecurityCheque-{$ref}",
                "Reference2" => null,
                "Reference3" => null,
                // Reversed from printAwb() — the citizen is the shipper here (this is
                // a pickup FROM them), EMSO is the consignee receiving it. AccountNumber
                // still goes on the Shipper regardless (confirmed via a real test call,
                // 2026-10-23: Aramex rejects the shipment with "Shipment.Shipper.
                // AccountNumber - Account Entity is empty" otherwise) — Aramex ties the
                // paying-account validation to the Shipper field structurally, not to
                // whichever party happens to be EMSO.
                "Shipper" => [
                    "Reference1"    => "SecurityCheque-{$ref}",
                    "Reference2"    => null,
                    "AccountNumber" => ARAMAX_ACCOUNT_NO,
                    "PartyAddress"  => [
                        "Line1" => $req['uae_address'] ?? '', "Line2" => "", "Line3" => "",
                        "City" => $req['city'] ?? '', "StateOrProvinceCode" => "DXB", "PostCode" => "",
                        "CountryCode" => "AE", "Longitude" => 0, "Latitude" => 0,
                        "BuildingNumber" => null, "BuildingName" => null, "Floor" => null,
                        "Apartment" => null, "POBox" => null, "Description" => null,
                    ],
                    "Contact" => [
                        "Department" => null, "PersonName" => $fullName, "Title" => null,
                        "CompanyName" => $fullName, "PhoneNumber1" => $req['mobile_no'] ?? '',
                        "PhoneNumber1Ext" => "", "PhoneNumber2" => $req['mobile_no'] ?? '',
                        "PhoneNumber2Ext" => "", "FaxNumber" => null, "CellPhone" => $req['mobile_no'] ?? '',
                        "EmailAddress" => $req['email'] ?? '', "Type" => "",
                    ],
                ],
                "Consignee" => [
                    "Reference1"    => "EMSO",
                    "Reference2"    => null,
                    "AccountNumber" => null,
                    "PartyAddress"  => [
                        "Line1" => "Al Wuheida Street", "Line2" => "Al Mamzar – Po Box 5078 Dubai", "Line3" => "",
                        "City" => "Dubai", "StateOrProvinceCode" => "", "PostCode" => "000000", "CountryCode" => "AE",
                        "Longitude" => 0, "Latitude" => 0, "BuildingNumber" => null, "BuildingName" => null,
                        "Floor" => null, "Apartment" => null, "POBox" => null, "Description" => null,
                    ],
                    "Contact" => [
                        "Department" => null, "PersonName" => "EMSO", "Title" => null, "CompanyName" => "EMSO",
                        "PhoneNumber1" => "+97142961122", "PhoneNumber1Ext" => "", "PhoneNumber2" => "+97142961122",
                        "PhoneNumber2Ext" => "", "FaxNumber" => null, "CellPhone" => "+97142961122",
                        "EmailAddress" => "", "Type" => "",
                    ],
                ],
                "ThirdParty"             => null,
                "ShippingDateTime"       => "/Date(" . (floor(microtime(true) * 1000)) . ")/",
                "DueDate"                => "/Date(" . (floor(microtime(true) * 1000)) . ")/",
                "Comments"               => "Security cheque collection for CPD request {$ref}",
                "PickupLocation"         => null,
                "OperationsInstructions" => null,
                "AccountingInstrcutions" => null,
                "Details" => [
                    "Dimensions"           => ["Length" => 0, "Width" => 0, "Height" => 0, "Unit" => "CM"],
                    "ActualWeight"         => ["Unit" => "KG", "Value" => 0.1],
                    "ChargeableWeight"     => ["Unit" => "KG", "Value" => 0],
                    "DescriptionOfGoods"   => "Security Cheque",
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
                    "Services"             => "",
                    "Items" => [[
                        "PackageType" => "item", "Quantity" => 1, "Weight" => ["Unit" => "CM", "Value" => 0],
                        "Comments" => "Security Cheque", "Reference" => $ref, "PiecesDimensions" => null,
                        "CommodityCode" => null, "GoodsDescription" => null, "CountryOfOrigin" => null,
                        "CustomsValue" => null, "ContainerNumber" => null,
                    ]],
                    "DeliveryInstructions"   => null,
                    "AdditionalProperties"   => null,
                    "ContainsDangerousGoods" => false,
                ],
                "Attachments"       => null,
                "ForeignHAWB"       => null,
                "TransportType "    => 0,
                "PickupGUID"        => null,
                "Number"            => null,
                "ScheduledDelivery" => null,
            ]],
            "LabelInfo"  => ["ReportID" => 9729, "ReportType" => "URL"],
            "ClientInfo" => [
                "UserName" => ARAMAX_USERNAME, "Password" => ARAMAX_PASSWORD, "Version" => "v1",
                "AccountNumber" => ARAMAX_ACCOUNT_NO, "AccountPin" => ARAMAX_ACCOUNT_PIN,
                "AccountEntity" => "DXB", "AccountCountryCode" => "AE", "Source" => 24,
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
        $response  = curl_exec($ch);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            Logger::error("Security cheque Aramex pickup — cURL error for request {$requestId}: {$curlError}");
            return null;
        }

        // Aramex returns XML here despite the /json/ URL path — confirmed via a real
        // test call (2026-10-23). json_decode() on XML silently returns null, which
        // would make every response look error-free (HasErrors never set) while also
        // never actually extracting a real AWB — the same latent bug exists in
        // printAwb() above. Notifications can appear at the top level or nested inside
        // Shipments->ProcessedShipment (seen both ways in testing), so both are checked.
        $xml = @simplexml_load_string($response);
        if ($xml === false) {
            Logger::error("Security cheque Aramex pickup — response was not valid XML for request {$requestId}");
            return null;
        }

        $hasErrors = (string)$xml->HasErrors === 'true';
        $messages  = [];
        foreach (($xml->Notifications->Notification ?? []) as $n) {
            $messages[] = (string)$n->Message;
        }
        foreach (($xml->Shipments->ProcessedShipment ?? []) as $shipment) {
            foreach (($shipment->Notifications->Notification ?? []) as $n) {
                $messages[] = (string)$n->Message;
            }
        }
        if ($hasErrors || $messages) {
            Logger::error("Security cheque Aramex pickup — Aramex error for request {$requestId}: " . implode('; ', $messages));
            return null;
        }

        $airBillNo = (string)($xml->Shipments->ProcessedShipment->ID ?? '');
        if ($airBillNo === '') {
            Logger::error("Security cheque Aramex pickup — no AWB returned for request {$requestId}");
            return null;
        }

        $this->db->execute(
            'UPDATE mn_cpd_requests SET security_cheque_airway_bill = ? WHERE auto_id = ?',
            [$airBillNo, $requestId],
        );
        Logger::info("Security cheque Aramex pickup created for CPD request {$requestId}: AWB={$airBillNo}");
        return $airBillNo;
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
            "SELECT rr.return_id, rr.delivery_fee, rr.penalty_amount,
                    u.first_name, u.last_name, u.email
             FROM mn_cpd_carnet_returns rr
             JOIN mn_users u ON u.user_id = rr.added_by
             WHERE rr.return_id = ?",
            [$returnId],
        );
        if (!$ret) Response::notFound('Return request not found');
        if (empty($ret['delivery_fee']) && empty($ret['penalty_amount'])) {
            Response::error('No amount due for this return', 422);
        }

        $totalAmount = (float)($ret['delivery_fee'] ?? 0) + (float)($ret['penalty_amount'] ?? 0);
        $desc = ((float)($ret['penalty_amount'] ?? 0) > 0)
            ? 'CPD Carnet Return – Aramex Delivery Fee + Late Return Penalty'
            : 'CPD Carnet Return – Aramex Delivery Fee';

        $cartId = (string)time();

        $postfields = http_build_query([
            'ivp_method'   => 'create',
            'ivp_store'    => Config::TELR_STORE_ID,
            'ivp_authkey'  => Config::TELR_AUTH_KEY,
            'ivp_amount'   => $totalAmount,
            'ivp_currency' => Config::TELR_CURRENCY,
            'ivp_test'     => Config::TELR_TEST,
            'ivp_cart'     => $cartId,
            'ivp_desc'     => $desc,
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
                       'mulkiya_no',
                       'first_name','mobile_no','email',
                       'passport_no','sex',
                       'uae_refree1','uae_refree1_mobile','destination_refree1','destination_refree1_mobile',
                       'uae_refree2','uae_refree2_mobile','destination_refree2','destination_refree2_mobile')
            ->validate();
        $this->validateExtraDriversRequired($body);
        $this->validateCompanyNameRequired($body);

        $userId = Auth::id();

        $eid = trim($body['emirates_id'] ?? '');
        if ($eid !== '') {
            $hold = $this->db->queryOne(
                'SELECT hold_id FROM mn_customer_holds WHERE emirates_id = ? AND is_active = 1 LIMIT 1',
                [$eid],
            );
            if ($hold) Response::error('Your account has been placed on hold. Please contact ATC for assistance.', 403);
        }

        $paymentMethod = $body['payment_method'] ?? 'CREDIT_CARD';
        if (!in_array($paymentMethod, ['CREDIT_CARD', 'PAY_AT_OFFICE'], true)) {
            Response::error('Invalid payment method', 422);
        }

        // Credit-card requests get their queue position when Telr confirms payment (see
        // telrVerify) — a Pay at Office request skips that gateway entirely, so it needs
        // a queue position set right away or it would never appear in anyone's queue.
        // CREATE_REQUEST_PUBLIC_USER already existed in mn_workflows_actions for exactly
        // this case; it just had no caller until now.
        $queuePosition = null;
        if ($paymentMethod === 'PAY_AT_OFFICE') {
            $wf = $this->db->queryOne(
                "SELECT next_role FROM mn_workflows_actions
                 WHERE section='CPD' AND action='CREATE_REQUEST_PUBLIC_USER' LIMIT 1",
            );
            $queuePosition = $wf['next_role'] ?? 'CPD_Officer';
        }

        // ── Renewal — verify ownership of the parent Carnet and that it hasn't
        // already been renewed before allowing the new request to be linked to it
        $parentAutoId = (int)($body['parent_request_id'] ?? 0);
        if ($parentAutoId) {
            $parent = $this->db->queryOne(
                'SELECT auto_id, belonging_user_id FROM mn_cpd_requests WHERE auto_id = ?',
                [$parentAutoId],
            );
            if (!$parent) Response::notFound('Carnet to renew was not found');
            if ((int)$parent['belonging_user_id'] !== $userId) Response::forbidden('Access denied');

            $existingChild = $this->db->queryOne(
                'SELECT auto_id FROM mn_cpd_requests WHERE parent_request_id = ? LIMIT 1',
                [$parentAutoId],
            );
            if ($existingChild) Response::error('This Carnet has already been renewed', 409);
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
                 (request_id, request_category, usage_type, belonging_user_id,
                  vehicle_make, vehicle_model, registration_no, chassis_no, engine_no,
                  manuf_year, color, body_type, no_of_cylinders, horse_power,
                  net_weight, vehicle_value, mulkiya_no, vehicle_registered_in,
                  upholstery, no_of_seats, radio, spare_tyre,
                  extra_owner1_name, extra_owner1_eid, extra_owner1_passport,
                  extra_owner2_name, extra_owner2_eid, extra_owner2_passport,
                  additional_remarks, others1, others2,
                  uae_refree1, uae_refree1_mobile, uae_refree2, uae_refree2_mobile,
                  destination_refree1, destination_refree1_mobile,
                  destination_refree2, destination_refree2_mobile,
                  delivery_option, delivery_address,
                  guarantee_amount, booking_fee, processing_fee, extra_fees, vat_amount, total_amount,
                  method_of_payment, booking_channel, request_type, request_status, current_queue_position,
                  parent_request_id, requested_datetime, identity_via_uae_pass, vehicle_registered_country)
                 VALUES ('PENDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ONLINE','ONLINE',1,?,?,NOW(),?,?)",
                [
                    $parentAutoId ? 'RENEW' : 'NORMAL',
                    $body['usage_type']           ?? 'PERSONAL',
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
                    $body['extra_owner1_name']     ?? '',
                    $body['extra_owner1_eid']      ?? '',
                    $body['extra_owner1_passport'] ?? '',
                    $body['extra_owner2_name']     ?? '',
                    $body['extra_owner2_eid']      ?? '',
                    $body['extra_owner2_passport'] ?? '',
                    $body['additional_remarks']   ?? '',
                    $body['others1']              ?? '',
                    $body['others2']              ?? '',
                    $body['uae_refree1']              ?? '',
                    $body['uae_refree1_mobile']       ?? '',
                    $body['uae_refree2']              ?? '',
                    $body['uae_refree2_mobile']       ?? '',
                    $body['destination_refree1']        ?? '',
                    $body['destination_refree1_mobile'] ?? '',
                    $body['destination_refree2']        ?? '',
                    $body['destination_refree2_mobile'] ?? '',
                    $body['delivery_option']      ?? 'home_delivery',
                    $body['delivery_address']     ?? '',
                    $body['guarantee_amount']     ?? 0,
                    $body['booking_fee']          ?? 0,
                    $body['processing_fee']       ?? 0,
                    $body['extra_fees']           ?? 0,
                    $body['vat_amount']           ?? 0,
                    $body['total_amount']         ?? 0,
                    $paymentMethod,
                    $queuePosition,
                    $parentAutoId ?: null,
                    !empty($body['identity_via_uae_pass']) ? 1 : 0,
                    $body['vehicle_registered_country'] ?? '',
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
                  emirates_id, passport_no, dob, sex, license_no, license_expiry, company_name, registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
                [
                    $userId,
                    $id,
                    '',
                    $body['first_name'],
                    $body['last_name'],
                    $body['nationality']     ?? null,
                    $body['city']            ?? '',
                    $body['address']         ?? '',
                    $body['po_box']          ?? '',
                    $body['emirates_id']     ?? '',
                    $body['passport_no']     ?? '',
                    $body['dob']             ?? null,
                    $body['sex']             ?? null,
                    $body['license_no']      ?? '',
                    ($body['license_expiry'] ?? '') ?: null,
                    ($body['usage_type'] ?? '') === 'COMPANY' ? ($body['company_name'] ?? '') : null,
                ],
            );

            // Insert destination countries
            foreach ((array)($body['countries'] ?? []) as $cid) {
                $this->db->execute(
                    'INSERT INTO mn_cpd_request_country_list (request_id, country_id) VALUES (?,?)',
                    [$id, (int)$cid],
                );
            }

            $this->saveSecurityChequeSelection($id, $body);

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

    /**
     * Persists the security-cheque collection choice (Aramex/office drop-off) made at
     * application time, when the selected destination requires one. A no-op today since
     * no guarantee group has requires_security_cheque=1 yet (pending the country/amount
     * list from ATC) — see the migration.sql entry for this feature.
     */
    private function saveSecurityChequeSelection(int $requestId, array $body): void
    {
        $method = $body['security_cheque_delivery_method'] ?? null;
        if (!in_array($method, ['ARAMEX', 'OFFICE'], true)) return;

        $this->db->execute(
            'UPDATE mn_cpd_requests
             SET security_cheque_required = 1, security_cheque_delivery_method = ?,
                 security_cheque_airway_bill = ?
             WHERE auto_id = ?',
            [$method, $method === 'ARAMEX' ? ($body['security_cheque_airway_bill'] ?? null) : null, $requestId],
        );
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
                        r.registration_no,
                        r.extra_owner1_name, r.extra_owner1_eid, r.extra_owner1_passport,
                        r.extra_owner2_name, r.extra_owner2_eid, r.extra_owner2_passport,
                        r.additional_remarks, r.others1, r.others2,
                        r.uae_refree1, r.uae_refree1_mobile, r.uae_refree2, r.uae_refree2_mobile,
                        r.destination_refree1, r.destination_refree1_mobile,
                        r.destination_refree2, r.destination_refree2_mobile,
                        r.delivery_option, r.delivery_address,
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
        $this->validateExtraDriversRequired($body);
        $this->validateCompanyNameRequired($body);

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

        // Look up queue position from workflow table — Special-category walk-ins
        // route through Branch Manager approval first (CS → Branch Manager → Cashier →
        // CS); Normal-category walk-ins go straight to the Cashier.
        $isSpecial = strtoupper(trim($body['request_category'] ?? 'NORMAL')) === 'SPECIAL';
        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions
             WHERE section='CPD' AND action=? LIMIT 1",
            [$isSpecial ? 'CREATE_SPECIAL_REQUEST_WALKIN_BRANCH' : 'CREATE_NORMAL_REQUEST_WALKIN'],
        );
        $queuePosition = $wf['next_role'] ?? null;

        $this->db->beginTransaction();
        try {
            $id = $this->db->insert(
                "INSERT INTO mn_cpd_requests
                 (request_id, request_category, usage_type, belonging_user_id,
                  vehicle_make, vehicle_model, registration_no, chassis_no, engine_no,
                  manuf_year, color, body_type, no_of_cylinders, horse_power,
                  net_weight, vehicle_value, mulkiya_no,
                  extra_owner1_name, extra_owner1_eid, extra_owner1_passport,
                  extra_owner2_name, extra_owner2_eid, extra_owner2_passport,
                  uae_refree1, uae_refree1_mobile, uae_refree2, uae_refree2_mobile,
                  destination_refree1, destination_refree1_mobile,
                  destination_refree2, destination_refree2_mobile,
                  guarantee_amount, booking_fee, processing_fee, extra_fees, vat_amount, total_amount,
                  method_of_payment, booking_channel, request_type, request_status,
                  current_queue_position, requested_datetime, identity_via_uae_pass)
                 VALUES ('PENDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'WALKIN','CALL_CENTER',1,?,NOW(),?)",
                [
                    $body['request_category']   ?? 'NORMAL',
                    $body['usage_type']         ?? 'PERSONAL',
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
                    $body['extra_owner1_name']     ?? '',
                    $body['extra_owner1_eid']      ?? '',
                    $body['extra_owner1_passport'] ?? '',
                    $body['extra_owner2_name']     ?? '',
                    $body['extra_owner2_eid']      ?? '',
                    $body['extra_owner2_passport'] ?? '',
                    $body['uae_refree1']              ?? '',
                    $body['uae_refree1_mobile']       ?? '',
                    $body['uae_refree2']              ?? '',
                    $body['uae_refree2_mobile']       ?? '',
                    $body['destination_refree1']        ?? '',
                    $body['destination_refree1_mobile'] ?? '',
                    $body['destination_refree2']        ?? '',
                    $body['destination_refree2_mobile'] ?? '',
                    $body['guarantee_amount']   ?? 0,
                    $body['booking_fee']        ?? 0,
                    $body['processing_fee']     ?? 0,
                    $body['extra_fees']         ?? 0,
                    $body['vat_amount']         ?? 0,
                    $body['total_amount']       ?? 0,
                    $body['method_of_payment'],
                    $queuePosition,
                    !empty($body['identity_via_uae_pass']) ? 1 : 0,
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
                  emirates_id, passport_no, company_name, sex, license_no, license_expiry, registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
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
                    ($body['usage_type'] ?? '') === 'COMPANY' ? ($body['company_name'] ?? '') : null,
                    $body['sex']             ?? null,
                    $body['license_no']      ?? '',
                    ($body['license_expiry'] ?? '') ?: null,
                ],
            );

            foreach ((array)($body['countries'] ?? []) as $cid) {
                $this->db->execute(
                    'INSERT INTO mn_cpd_request_country_list (request_id, country_id) VALUES (?,?)',
                    [$id, (int)$cid],
                );
            }

            $this->saveSecurityChequeSelection($id, $body);

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
        // Identity fields — same UAE-PASS lock concept as IDL: not editable once the
        // applicant supplied them via UAE PASS. Emirates ID is deliberately excluded
        // (identity match key), same precedent as IDLController::update().
        $identityAllowed = ['first_name', 'last_name', 'sex', 'nationality'];
        $identitySets  = [];
        $identityBinds = [];
        foreach ($identityAllowed as $f) {
            if (array_key_exists($f, $body)) {
                $column = $f === 'nationality' ? 'nationality_id' : $f;
                $identitySets[]  = "{$column}=?";
                $identityBinds[] = $body[$f];
            }
        }
        if (!empty($identitySets)) {
            $viaUaePass = (bool) $this->db->scalar(
                'SELECT u.uaepass_uuid IS NOT NULL FROM mn_cpd_requests r
                 JOIN mn_users u ON u.user_id = r.belonging_user_id WHERE r.auto_id=?',
                [$params['id']],
            );
            if ($viaUaePass) Response::error('This applicant was verified via UAE PASS — identity fields cannot be edited', 422);

            $identityBinds[] = $params['id'];
            $this->db->execute(
                "UPDATE mn_cpd_request_user SET " . implode(',', $identitySets) . " WHERE request_auto_id=?",
                $identityBinds,
            );
        }

        if (empty($sets) && empty($identitySets)) Response::error('No updatable fields provided');

        if (!empty($sets)) {
            $binds[] = $params['id'];
            $this->db->execute("UPDATE mn_cpd_requests SET " . implode(',', $sets) . " WHERE auto_id=?", $binds);
        }
        $this->logEvent('UPDATE', $params['id']);
        Response::success(null, 'Request updated');
    }

    // ── Workflow actions ──────────────────────────────────────────────────────

    public function approve(array $params, array $body, array $query): void
    {
        $id = (int) $params['id'];

        // A Pay at Office request reaches the CPD_Officer queue unpaid (see
        // publicStore()) — CS review here means forwarding it to the Cashier to
        // actually collect the fee, not confirming a payment that hasn't happened yet.
        // Every other path (Telr-paid online, or already cashier-paid walk-ins) reaches
        // this queue with booking_fee_status already 1, so they fall through to the
        // normal confirm below.
        $req = $this->db->queryOne(
            'SELECT method_of_payment, booking_fee_status FROM mn_cpd_requests WHERE auto_id=?',
            [$id],
        );
        if ($req && $req['method_of_payment'] === 'PAY_AT_OFFICE' && (int)($req['booking_fee_status'] ?? 0) !== 1) {
            $wf = $this->db->queryOne(
                "SELECT next_role FROM mn_workflows_actions
                 WHERE section='CPD' AND action='FORWARD_PAY_AT_OFFICE_TO_CASHIER' LIMIT 1",
            );
            $nextQueue = $wf['next_role'] ?? 'IDL_CPD_Cashier';

            $this->db->execute(
                'UPDATE mn_cpd_requests SET current_queue_position = ? WHERE auto_id = ?',
                [$nextQueue, $id],
            );
            $this->logEvent('FORWARD_TO_CASHIER', $id);
            Response::success(null, 'Request forwarded to the Cashier for payment collection');
            return;
        }

        // request_status is numeric (mn_cpd_statuses.carnet_status_id) — 2 is
        // "Confirmed". The literal string 'Confirmed' used to be written here, which
        // MySQL silently coerces to 0 (no matching status), leaving the request in
        // limbo with an invalid status that no queue/list filter recognizes.
        $this->db->execute(
            "UPDATE mn_cpd_requests
             SET request_status=2, payment_verified_by=?, payment_verified_datetime=NOW()
             WHERE auto_id=?",
            [Auth::id(), $id],
        );
        $this->logEvent('APPROVE', $id);
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

        // Correction-needed email — best-effort, doesn't block the send-back itself.
        $req = $this->db->queryOne(
            "SELECT COALESCE(cru.first_name, u.first_name) AS first_name,
                    COALESCE(cru.last_name,  u.last_name)  AS last_name,
                    r.request_id, u.email
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_request_user cru ON cru.request_auto_id = r.auto_id
             LEFT JOIN mn_users u              ON u.user_id            = r.belonging_user_id
             WHERE r.auto_id = ?",
            [$id],
        );
        if ($req && !empty($req['email'])) {
            try {
                (new MailHandler())->sendBasicMailViaMailJet(
                    Config::MJ_CPD_CORRECTION_NEEDED_TEMPLATE,
                    $req['email'],
                    [
                        'customer_name' => trim(($req['first_name'] ?? '') . ' ' . ($req['last_name'] ?? '')),
                        'request_id'    => $req['request_id'] ?? '',
                        'comment'       => $comment,
                    ],
                );
            } catch (\Throwable $e) {
                Logger::error('CPD correction-needed email failed: ' . $e->getMessage());
            }
        }

        Response::success(null, 'Request sent for corrections');
    }

    /**
     * POST /api/cpd/requests/{id}/branch-approve
     * Branch Manager approval step for a Special-category walk-in request
     * (CS → Branch Manager → Cashier → CS). Forwards the request to the Cashier queue.
     */
    public function approveBranchRequest(array $params, array $body, array $query): void
    {
        $id = (int) $params['id'];

        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions
             WHERE section='CPD' AND action='APPROVE_BRANCH_MANAGER_SPECIAL_REQUEST_WALKIN' LIMIT 1",
        );
        $nextQueue = $wf['next_role'] ?? 'IDL_CPD_Cashier';

        $this->db->execute(
            "UPDATE mn_cpd_requests SET current_queue_position = ? WHERE auto_id = ?",
            [$nextQueue, $id],
        );
        $this->logEvent('BRANCH_MANAGER_APPROVE', $id);
        Response::success(null, 'Request approved and forwarded to the Cashier');
    }

    /**
     * POST /api/cpd/requests/{id}/branch-reject
     * Branch Manager sends a Special-category walk-in request back to CS with a
     * comment, without changing its status — the request stays in-flight for CS to
     * correct and resubmit for branch approval.
     */
    public function rejectBranchRequest(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('comment')->validate();

        $id      = (int) $params['id'];
        $comment = trim($body['comment']);

        $this->db->beginTransaction();
        try {
            $this->db->execute(
                "UPDATE mn_cpd_requests SET current_queue_position = 'CPD_Officer' WHERE auto_id = ?",
                [$id],
            );
            $this->db->execute(
                "INSERT INTO mn_cpd_officer_comments
                 (request_id, comment, added_by, added_datetime, read_flag)
                 VALUES (?, ?, ?, NOW(), 0)",
                [$id, $comment, Auth::id()],
            );
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Logger::exception($e, 'CPDController::rejectBranchRequest');
            Response::serverError('Reject failed: ' . $e->getMessage());
        }

        $this->logEvent('BRANCH_MANAGER_REJECT', $id, $comment);
        Response::success(null, 'Request sent back to CS');
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

        // Get the return request to find the cpd request_id and the carnet being returned
        $ret = $this->db->queryOne(
            'SELECT return_id, request_id, carnet_id, return_payment_method FROM mn_cpd_carnet_returns WHERE return_id = ?',
            [$returnId],
        );
        if (!$ret) Response::notFound('Return request not found');

        // Cheque-based returns still need the bank/cheque details captured somewhere
        // (mn_cpd_return_guarantee_details, now filled in by the CSO directly — see
        // returnCheque() — rather than a separate cheque-officer role). Online Transfer
        // returns already have their bank details on mn_cpd_carnet_returns.cus_bank_information
        // from submission, so this check no longer applies to them.
        if (in_array($ret['return_payment_method'], ['CHEQUE_DEPOSIT', 'COLLECT_CHEQUE'], true)) {
            $guarantee = $this->db->queryOne(
                'SELECT guarantee_cheque_id FROM mn_cpd_return_guarantee_details WHERE request_id = ? LIMIT 1',
                [$ret['request_id']],
            );
            if (!$guarantee) {
                Response::error('Cheque details have not been entered for this return yet.', 422);
            }
        }

        $this->db->beginTransaction();
        try {
            $this->db->execute(
                "UPDATE mn_cpd_carnet_returns
                 SET confirmed_by = 1, confirmed_datetime = ?
                 WHERE return_id = ?",
                [date('Y-m-d H:i:s'), $returnId],
            );
            // Reflect the confirmed return on the request itself — otherwise officers
            // have no list where a confirmed return is visible at all (it drops out of
            // the pending-returns queue with nowhere else to appear). Note: the carnet's
            // is_used flag is intentionally left untouched — once issued, a carnet stays
            // marked used permanently and is never freed for reissue, even after return.
            // request_status is an FK into mn_cpd_statuses — 4 = 'Returned'.
            $this->db->execute(
                'UPDATE mn_cpd_requests SET request_status=4 WHERE auto_id=?',
                [$ret['request_id']],
            );
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Response::serverError('Approval failed: ' . $e->getMessage());
        }

        $this->logEvent('RETURN', $ret['request_id']);

        // Return-approved email — best-effort, doesn't block the approval itself.
        $custReq = $this->db->queryOne(
            "SELECT COALESCE(cru.first_name, u.first_name) AS first_name,
                    COALESCE(cru.last_name,  u.last_name)  AS last_name,
                    r.request_id, r.guarantee_amount, u.email,
                    rr.penalty_amount, rr.return_amount, rr.cus_bank_information
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_request_user cru  ON cru.request_auto_id = r.auto_id
             LEFT JOIN mn_users u               ON u.user_id            = r.belonging_user_id
             LEFT JOIN mn_cpd_carnet_returns rr ON rr.return_id         = ?
             WHERE r.auto_id = ?",
            [$returnId, $ret['request_id']],
        );
        if ($custReq && !empty($custReq['email'])) {
            $bankInfo = $custReq['cus_bank_information'] ? json_decode($custReq['cus_bank_information'], true) : [];
            $returnAmount = $custReq['return_amount'] !== null && $custReq['return_amount'] !== ''
                ? (float)$custReq['return_amount']
                : (float)$custReq['guarantee_amount'] - (float)($custReq['penalty_amount'] ?? 0);
            try {
                (new MailHandler())->sendBasicMailViaMailJet(
                    Config::MJ_CPD_RETURN_APPROVED_TEMPLATE,
                    $custReq['email'],
                    [
                        'customer_name'    => trim(($custReq['first_name'] ?? '') . ' ' . ($custReq['last_name'] ?? '')),
                        'request_id'       => $custReq['request_id']            ?? '',
                        'guarantee_amount' => number_format((float)$custReq['guarantee_amount'], 2),
                        'penalty_amount'   => number_format((float)($custReq['penalty_amount'] ?? 0), 2),
                        'return_amount'    => number_format($returnAmount, 2),
                        'account_no'       => $bankInfo['account_no'] ?? '',
                        'bank_name'        => $bankInfo['bank_name']  ?? '',
                    ],
                );
            } catch (\Throwable $e) {
                Logger::error('CPD return-approved email failed: ' . $e->getMessage());
            }
        }

        Response::success(null, 'Return request approved successfully');
    }

    /**
     * PUT /api/cpd/return-requests/{id}/fine
     * Officer enters (or clears) a fine for a pending return — the return amount is
     * simply guarantee_amount minus the fine, recomputed here from the parent request's
     * stored guarantee_amount so it can't drift from whatever the client displayed.
     */
    public function saveReturnFine(array $params, array $body, array $query): void
    {
        $returnId = (int) $params['id'];
        $penalty  = isset($body['penalty_amount']) ? (float)$body['penalty_amount'] : 0.0;
        if ($penalty < 0) Response::error('Fine cannot be negative', 422);

        $ret = $this->db->queryOne(
            'SELECT rr.return_id, rr.confirmed_by, r.guarantee_amount
             FROM mn_cpd_carnet_returns rr
             JOIN mn_cpd_requests r ON r.auto_id = rr.request_id
             WHERE rr.return_id = ?',
            [$returnId],
        );
        if (!$ret) Response::notFound('Return request not found');
        if ((int)$ret['confirmed_by'] !== 0) Response::error('This return has already been approved', 422);

        $returnAmount = (float)$ret['guarantee_amount'] - $penalty;
        $this->db->execute(
            'UPDATE mn_cpd_carnet_returns SET penalty_amount=?, return_amount=? WHERE return_id=?',
            [$penalty, $returnAmount, $returnId],
        );

        Response::success(['penalty_amount' => $penalty, 'return_amount' => $returnAmount], 'Fine and return amount saved');
    }

    /**
     * POST /api/cpd/return-requests/{id}/deposit-slip
     * Officer uploads proof the guarantee deposit was banked, once the return has
     * already been approved — this is what "closes off" the return per the client's
     * described workflow. Visible to the customer afterwards via serveDepositSlip().
     */
    public function uploadDepositSlip(array $params, array $body, array $query): void
    {
        $returnId = (int) $params['id'];

        $ret = $this->db->queryOne(
            'SELECT return_id, confirmed_by FROM mn_cpd_carnet_returns WHERE return_id = ?',
            [$returnId],
        );
        if (!$ret) Response::notFound('Return request not found');
        if ((int)$ret['confirmed_by'] === 0) {
            Response::error('The return must be approved before a deposit slip can be uploaded', 422);
        }

        if (empty($_FILES['deposit_slip']) || $_FILES['deposit_slip']['error'] === UPLOAD_ERR_NO_FILE) {
            Response::error('deposit_slip file is required', 422);
        }
        $file = $_FILES['deposit_slip'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            Response::error('Upload error code ' . $file['error'], 422);
        }
        $mime = mime_content_type($file['tmp_name']);
        $extByMime = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'application/pdf' => 'pdf'];
        if (!isset($extByMime[$mime])) {
            Response::error('Only JPG, PNG or PDF files are accepted', 422);
        }
        if ($file['size'] > Config::UPLOAD_MAX_BYTES) {
            Response::error('File exceeds 2 MB', 422);
        }

        $dir = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
             . DIRECTORY_SEPARATOR . 'returns' . DIRECTORY_SEPARATOR . $returnId;
        if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
            Response::serverError('Could not create upload directory');
        }

        $ext  = $extByMime[$mime];
        $dest = $dir . DIRECTORY_SEPARATOR . 'deposit_slip.' . $ext;
        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            Response::serverError('Failed to save file');
        }

        $relativePath = "returns/{$returnId}/deposit_slip.{$ext}";
        $refNumber = trim($_POST['reference_number'] ?? '');
        $sets  = 'deposit_slip_path = ?, deposit_slip_uploaded_by = ?, deposit_slip_uploaded_datetime = NOW()';
        $binds = [$relativePath, Auth::id()];
        if ($refNumber !== '') {
            $sets   .= ', order_ref = ?';
            $binds[] = $refNumber;
        }
        $binds[] = $returnId;
        $this->db->execute(
            "UPDATE mn_cpd_carnet_returns SET {$sets} WHERE return_id = ?",
            $binds,
        );

        $this->logEvent('DEPOSIT_SLIP_UPLOADED', $ret['return_id'] ?? $returnId, "return_id={$returnId}");
        Response::success(['deposit_slip_path' => $relativePath], 'Deposit slip uploaded');
    }

    /**
     * POST /api/cpd/return-requests/{id}/notes
     * Multiple document attachments + a comment on a pending return — reuses
     * mn_cpd_officer_comments (already used by reject()) for the text, and the same
     * multi-file-upload pattern as addClaimNote() for the attachments.
     */
    public function addReturnNote(array $params, array $body, array $query): void
    {
        $returnId = (int) $params['id'];
        $comment  = trim($_POST['comment'] ?? '');

        $ret = $this->db->queryOne('SELECT return_id, request_id FROM mn_cpd_carnet_returns WHERE return_id = ?', [$returnId]);
        if (!$ret) Response::notFound('Return request not found');

        $commentId = $this->db->insert(
            'INSERT INTO mn_cpd_officer_comments (request_id, comment, added_by, added_datetime, read_flag)
             VALUES (?, ?, ?, NOW(), 0)',
            [$ret['request_id'], $comment !== '' ? $comment : '(attachment only)', Auth::id()],
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
                   . DIRECTORY_SEPARATOR . 'returns' . DIRECTORY_SEPARATOR . $returnId
                   . DIRECTORY_SEPARATOR . 'notes'   . DIRECTORY_SEPARATOR . $commentId;
            if ($count > 0 && !is_dir($dir) && !mkdir($dir, 0755, true)) {
                Response::serverError('Could not create upload directory');
            }
            for ($i = 0; $i < $count; $i++) {
                if ($files['error'][$i] === UPLOAD_ERR_NO_FILE) continue;
                if ($files['error'][$i] !== UPLOAD_ERR_OK) {
                    $errors[] = "File {$files['name'][$i]}: upload error {$files['error'][$i]}"; continue;
                }
                $mime = mime_content_type($files['tmp_name'][$i]);
                if (!in_array($mime, ['image/jpeg', 'image/png', 'application/pdf'], true)) {
                    $errors[] = "File {$files['name'][$i]}: only JPG, PNG or PDF files are accepted"; continue;
                }
                if ($files['size'][$i] > Config::UPLOAD_MAX_BYTES) {
                    $errors[] = "File {$files['name'][$i]}: exceeds file size limit"; continue;
                }
                $safeName = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $files['name'][$i]);
                if (move_uploaded_file($files['tmp_name'][$i], $dir . DIRECTORY_SEPARATOR . $safeName)) {
                    $saved[] = $safeName;
                } else {
                    $errors[] = "File {$files['name'][$i]}: failed to save";
                }
            }
        }

        $this->logEvent('RETURN_NOTE_ADDED', $ret['request_id'], "return_id={$returnId}");
        Response::created(['comment_id' => $commentId, 'saved' => $saved, 'errors' => $errors]);
    }

    /**
     * GET /api/cpd/return-requests/{id}/deposit-slip
     * Serves the uploaded slip to either the officer or the customer who owns the
     * underlying request — this is the "visible for the end user" half of the ask.
     */
    public function serveDepositSlip(array $params, array $body, array $query): void
    {
        $returnId = (int) $params['id'];
        $user     = Auth::user();

        $ret = $this->db->queryOne(
            "SELECT rr.deposit_slip_path, r.belonging_user_id
             FROM mn_cpd_carnet_returns rr
             JOIN mn_cpd_requests r ON r.auto_id = rr.request_id
             WHERE rr.return_id = ?",
            [$returnId],
        );
        if (!$ret || empty($ret['deposit_slip_path'])) Response::notFound('Deposit slip not found');

        $isOwner = (int)$ret['belonging_user_id'] === (int)($user['user_id'] ?? 0);
        $isStaff = in_array('cpd', $user['modules'] ?? [], true);
        if (!$isOwner && !$isStaff) Response::forbidden('Access denied');

        $filePath = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
                  . DIRECTORY_SEPARATOR . $ret['deposit_slip_path'];
        if (!file_exists($filePath)) Response::notFound('Deposit slip not found');

        $ext   = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
        $mimes = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'pdf' => 'application/pdf'];
        header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
        header('Content-Disposition: inline; filename="deposit_slip.' . $ext . '"');
        header('Content-Length: ' . filesize($filePath));
        header('Cache-Control: private, max-age=3600');
        readfile($filePath);
        exit;
    }

    public function indexReturnRequests(array $params, array $body, array $query): void
    {
        $v       = Validator::make($query);
        $page    = max(1, $v->int('page', 1));
        $perPage = 20;
        $offset  = ($page - 1) * $perPage;
        $search  = $v->get('search', '');
        $status  = $v->get('status', 'pending');
        $penalty = Config::CPD_PENALTY;

        // Default stays pending-only (unchanged behaviour for existing callers); the
        // officer list can now also ask for approved returns or everything, the same
        // way the main CPD Requests list offers an "All Statuses" filter.
        if ($status === 'approved')     $where = 'WHERE rr.confirmed_by != 0';
        elseif ($status === 'all')      $where = 'WHERE 1';
        else                            $where = 'WHERE rr.confirmed_by = 0';
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
            "SELECT c.cancel_auto_id, c.cancelled_by, c.cancelled_datetime,
                    c.cancelled_approved, c.cancelled_approved_by, c.refunded_amount,
                    c.charge_amount, c.remarks, r.total_amount AS original_amount
             FROM mn_cpd_cancelled_requests c
             JOIN mn_cpd_requests r ON r.auto_id = c.request_auto_id
             WHERE c.request_auto_id = ?
             ORDER BY c.cancel_auto_id DESC LIMIT 1",
            [(int) $params['id']],
        );
        Response::success($row);
    }

    public function getReturnCarnet(array $params, array $body, array $query): void
    {
        $row = $this->db->queryOne(
            "SELECT return_id, added_datetime, confirmed_by, remarks,
                    delivery_method, return_payment_method, order_status,
                    deposit_slip_path, deposit_slip_uploaded_datetime
             FROM mn_cpd_carnet_returns WHERE request_id = ? LIMIT 1",
            [(int) $params['id']],
        );
        Response::success($row);
    }

    // ── Public User: Return Carnet ────────────────────────────────────────────

    /**
     * GET /api/cpd/search-own-by-carnet
     * Customer self-service lookup — scoped to the caller's own requests only
     * (unlike the staff-facing searchByRef, which can look up any carnet).
     */
    public function searchOwnByCarnet(array $params, array $body, array $query): void
    {
        $carnetNo = trim($query['carnet_no'] ?? '');
        if ($carnetNo === '') Response::error('Carnet number is required', 422);

        $row = $this->db->queryOne(
            "SELECT r.auto_id, r.request_id, r.request_status, r.requested_datetime, r.usage_type,
                    r.vehicle_make, r.vehicle_model, r.registration_no, r.chassis_no, r.engine_no,
                    r.manuf_year, r.color, r.body_type, r.no_of_cylinders, r.horse_power,
                    r.net_weight, r.vehicle_value, r.mulkiya_no, r.vehicle_registered_in,
                    r.upholstery, r.no_of_seats, r.radio, r.spare_tyre,
                    r.extra_owner1_name, r.extra_owner2_name,
                    ru.title, ru.first_name, ru.last_name, ru.nationality_id, ru.city,
                    ru.uae_address, ru.po_box, ru.emirates_id, ru.passport_no,
                    ru.dob, ru.sex, ru.license_no, ru.license_expiry,
                    u.mobile_no, u.email,
                    c.carnet_no, c.is_damaged
             FROM mn_cpd_requests r
             JOIN mn_cpd_issued_carnets ic ON ic.request_id = r.auto_id
             JOIN mn_cpd_carnets c         ON c.carnet_id   = ic.carnet_id
             JOIN mn_cpd_request_user ru   ON ru.request_auto_id = r.auto_id
             JOIN mn_users u               ON u.user_id = r.belonging_user_id
             WHERE c.carnet_no = ? AND r.belonging_user_id = ?
             ORDER BY ic.carnet_issue_id DESC LIMIT 1",
            [$carnetNo, Auth::id()],
        );

        if (!$row) Response::notFound('No carnet found with that number on your account');

        $row['existing_return'] = $this->db->queryOne(
            'SELECT return_id, added_datetime, confirmed_by FROM mn_cpd_carnet_returns WHERE request_id = ? LIMIT 1',
            [$row['auto_id']],
        );
        $row['existing_renewal'] = $this->db->queryOne(
            'SELECT auto_id, request_id FROM mn_cpd_requests WHERE parent_request_id = ? LIMIT 1',
            [$row['auto_id']],
        );
        $row['countries'] = $this->db->query(
            'SELECT country_id FROM mn_cpd_request_country_list WHERE request_id = ?',
            [$row['auto_id']],
        );

        Response::success($row);
    }

    /**
     * GET /api/cpd/my-issued-carnets
     * All of the caller's own issued Carnets, with return/renewal status —
     * powers the public Renew/Return list screens.
     */
    public function myIssuedCarnets(array $params, array $body, array $query): void
    {
        $userId = Auth::id();

        $rows = $this->db->query(
            "SELECT t.auto_id, t.request_id, t.request_status, t.requested_datetime,
                    t.vehicle_make, t.vehicle_model, t.registration_no, t.chassis_no,
                    t.total_amount, t.carnet_no,
                    (SELECT return_id FROM mn_cpd_carnet_returns WHERE request_id = t.auto_id LIMIT 1) AS return_id,
                    (SELECT added_datetime FROM mn_cpd_carnet_returns WHERE request_id = t.auto_id LIMIT 1) AS return_added_datetime,
                    (SELECT confirmed_by FROM mn_cpd_carnet_returns WHERE request_id = t.auto_id LIMIT 1) AS return_confirmed_by,
                    (SELECT request_id FROM mn_cpd_requests WHERE parent_request_id = t.auto_id LIMIT 1) AS renewal_request_id
             FROM (
                 SELECT r.auto_id, r.request_id, r.request_status, r.requested_datetime,
                        r.vehicle_make, r.vehicle_model, r.registration_no, r.chassis_no,
                        r.total_amount, c.carnet_no,
                        ROW_NUMBER() OVER (PARTITION BY r.auto_id ORDER BY ic.carnet_issue_id DESC) AS rn
                 FROM mn_cpd_requests r
                 JOIN mn_cpd_issued_carnets ic ON ic.request_id = r.auto_id
                 JOIN mn_cpd_carnets c         ON c.carnet_id   = ic.carnet_id
                 WHERE r.belonging_user_id = ? AND r.request_status IN (3, 9)
             ) t
             WHERE t.rn = 1
             ORDER BY t.auto_id DESC",
            [$userId],
        );

        Response::success($rows);
    }

    public function returnCarnet(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('remarks', 'delivery_option', 'payment_option')->validate();

        $id             = (int) $params['id'];
        $deliveryOption = $body['delivery_option'];
        $paymentOption  = $body['payment_option'];

        if (!in_array($deliveryOption, ['ARAMAX', 'DELIVER_BY_HAND'], true)) Response::error('Invalid delivery option', 422);
        if (!in_array($paymentOption,  ['BANK_DEPOSIT', 'CHEQUE_DEPOSIT', 'COLLECT_CHEQUE'], true)) Response::error('Invalid payment option', 422);

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
            'SELECT carnet_id, issued_datetime FROM mn_cpd_issued_carnets WHERE request_id = ? ORDER BY carnet_issue_id DESC LIMIT 1',
            [$id],
        );

        $aramexFee = $deliveryOption === 'ARAMAX' ? Config::CPD_RETURN_PICKUP_FEE : null;
        // Not auto-charged — the officer enters a real fine (if any) in the Guarantee
        // Return section once reviewing the return; this is advisory-only at submission.
        $isLate = $this->calcReturnPenalty($issuedCarnet['issued_datetime'] ?? null) > 0;

        $bankInfo = null;
        if (in_array($paymentOption, ['BANK_DEPOSIT', 'CHEQUE_DEPOSIT'], true)) {
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

        Response::created(
            ['return_id' => $returnId, 'is_late' => $isLate],
            $isLate
                ? 'Return submitted — late return charges will apply as per the terms and conditions'
                : 'Return carnet request submitted successfully',
        );
    }

    /** A return is late (and incurs Config::CPD_PENALTY) once the carnet has been out for over 364 days. */
    private function calcReturnPenalty(?string $issuedDatetime): float
    {
        if (!$issuedDatetime) return 0.0;
        $isLate = strtotime($issuedDatetime) + (364 * 86400) < time();
        return $isLate ? Config::CPD_PENALTY : 0.0;
    }

    /**
     * Once any field for an extra driver is filled in, all 3 fields become required —
     * enforced server-side so this can't be bypassed by calling the API directly.
     * Mirrors the client-side check in public.js's validateCPDStep().
     */
    private function validateCompanyNameRequired(array $body): void
    {
        if (($body['usage_type'] ?? '') === 'COMPANY' && trim($body['company_name'] ?? '') === '') {
            Response::error('Company Name is required for Company Use', 422);
        }
    }

    private function validateExtraDriversRequired(array $body): void
    {
        foreach ([1, 2] as $n) {
            $name = trim($body["extra_owner{$n}_name"]     ?? '');
            $eid  = trim($body["extra_owner{$n}_eid"]      ?? '');
            $pass = trim($body["extra_owner{$n}_passport"] ?? '');
            if ($name === '' && $eid === '' && $pass === '') continue;
            $missing = [];
            if ($name === '') $missing[] = 'full name';
            if ($eid  === '') $missing[] = 'Emirates ID';
            if ($pass === '') $missing[] = 'passport number';
            if ($missing) {
                Response::error("Extra Driver {$n}: " . implode(', ', $missing) . ' required', 422);
            }
        }
    }

    // ── Officer: Create Return (bypasses customer ownership check) ────────────
    public function officerReturn(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('remarks', 'delivery_option', 'payment_option')->validate();

        $id             = (int) $params['id'];
        $deliveryOption = $body['delivery_option'];
        $paymentOption  = $body['payment_option'];

        if (!in_array($deliveryOption, ['ARAMAX', 'DELIVER_BY_HAND'], true)) Response::error('Invalid delivery option', 422);
        if (!in_array($paymentOption,  ['BANK_DEPOSIT', 'CHEQUE_DEPOSIT', 'COLLECT_CHEQUE'], true)) Response::error('Invalid payment option', 422);

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
            'SELECT carnet_id, issued_datetime FROM mn_cpd_issued_carnets WHERE request_id = ? ORDER BY carnet_issue_id DESC LIMIT 1',
            [$id],
        );

        $aramexFee = $deliveryOption === 'ARAMAX' ? Config::CPD_RETURN_PICKUP_FEE : null;
        // Not auto-charged — the officer enters a real fine (if any) in the Guarantee
        // Return section once reviewing the return; this is advisory-only at submission.
        $isLate = $this->calcReturnPenalty($issuedCarnet['issued_datetime'] ?? null) > 0;

        $bankInfo = null;
        if (in_array($paymentOption, ['BANK_DEPOSIT', 'CHEQUE_DEPOSIT'], true)) {
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
        Response::created(
            ['return_id' => $returnId, 'is_late' => $isLate],
            $isLate
                ? 'Return created — late return charges will apply as per the terms and conditions'
                : 'Return request created',
        );
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
        if ((int) $req['request_status'] === 6) Response::error('Request is already cancelled', 422);

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

    /**
     * POST /api/cpd/requests/{id}/cancel — Customer Service raises a cancellation request.
     * Per CPD Feedback 24-09-2026.docx this no longer cancels the request immediately —
     * it only creates a pending record for cpd_finance to approve/reject (mirrors the
     * public self-service cancelRequest() below). The previous behaviour here had a
     * pre-existing bug regardless: it set request_status='Cancelled' (a string) against
     * an int column, which MySQL silently coerced to 0, not the real Cancelled status (6).
     */
    public function cancel(array $params, array $body, array $query): void
    {
        $id     = (int) $params['id'];
        $reason = trim((string) ($_POST['reason'] ?? $body['reason'] ?? ''));
        if ($reason === '') Response::error('reason is required', 422);

        $status = $this->db->scalar('SELECT request_status FROM mn_cpd_requests WHERE auto_id = ?', [$id]);
        if ((int) $status === 6) Response::error('Request is already cancelled', 422);

        $existing = $this->db->queryOne(
            'SELECT cancel_auto_id FROM mn_cpd_cancelled_requests WHERE request_auto_id = ? AND cancelled_approved = 0 LIMIT 1',
            [$id],
        );
        if ($existing) Response::error('A cancellation request is already pending for this application', 422);

        $cancelId = $this->db->insert(
            "INSERT INTO mn_cpd_cancelled_requests
             (request_auto_id, cancelled_by, cancelled_datetime, cancelled_approved, remarks)
             VALUES (?,?,NOW(),0,?)",
            [$id, Auth::roleName(), $reason],
        );

        $saved = $this->saveCancelRaiseDocument($id);

        $this->logEvent('CANCEL_REQUESTED', $id);
        Response::created(['saved' => $saved], 'Cancellation request submitted for approval');
    }

    // Optional supporting document attached when the cancellation is raised (JPG/PNG/PDF).
    private function saveCancelRaiseDocument(int $requestId): ?string
    {
        $file = $_FILES['document'] ?? null;
        if ($file === null || $file['error'] === UPLOAD_ERR_NO_FILE) return null;
        if ($file['error'] !== UPLOAD_ERR_OK) Response::error('Document upload failed', 422);

        $mime = mime_content_type($file['tmp_name']);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'application/pdf'], true)) {
            Response::error('Only JPG, PNG or PDF files are accepted', 422);
        }
        if ($file['size'] > Config::UPLOAD_MAX_BYTES) Response::error('Document exceeds file size limit', 422);

        $dir = $this->cancelAttachmentsDir($requestId) . DIRECTORY_SEPARATOR . 'raise';
        if (!is_dir($dir) && !mkdir($dir, 0755, true)) Response::serverError('Could not create upload directory');

        $safeName = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $file['name']);
        if (!move_uploaded_file($file['tmp_name'], $dir . DIRECTORY_SEPARATOR . $safeName)) {
            Response::serverError('Could not save document');
        }
        return $safeName;
    }

    private function cancelAttachmentsDir(int $requestId): string
    {
        return API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH
             . DIRECTORY_SEPARATOR . 'cancellations' . DIRECTORY_SEPARATOR . $requestId;
    }

    // GET /api/cpd/requests/{id}/cancel-attachments — files raised with the cancellation and
    // files added by cpd_finance in review. Staff-only (route is auth:true, cancellations
    // are only listed to cpd staff).
    public function listCancelAttachments(array $params, array $body, array $query): void
    {
        $id   = (int) $params['id'];
        $base = $this->cancelAttachmentsDir($id);
        $items = [];

        $raiseDir = $base . DIRECTORY_SEPARATOR . 'raise';
        if (is_dir($raiseDir)) {
            foreach (array_diff(scandir($raiseDir), ['.', '..']) as $f) {
                $items[] = ['label' => 'Attached when raised', 'file' => "raise/{$f}"];
            }
        }

        $notesDir = $base . DIRECTORY_SEPARATOR . 'notes';
        if (is_dir($notesDir)) {
            foreach (array_diff(scandir($notesDir), ['.', '..']) as $cid) {
                if (!ctype_digit($cid)) continue;
                foreach (array_diff(scandir($notesDir . DIRECTORY_SEPARATOR . $cid), ['.', '..']) as $f) {
                    $items[] = ['label' => 'Added by finance', 'file' => "notes/{$cid}/{$f}"];
                }
            }
        }

        Response::success($items);
    }

    // GET /api/cpd/requests/{id}/cancel-attachments/raise/{filename}
    // GET /api/cpd/requests/{id}/cancel-attachments/notes/{commentId}/{filename}
    public function serveCancelAttachment(array $params, array $body, array $query): void
    {
        $id   = (int) $params['id'];
        $rel  = isset($params['commentId'])
            ? 'notes/' . (int) $params['commentId'] . '/' . $params['filename']
            : 'raise/' . $params['filename'];

        $base = realpath($this->cancelAttachmentsDir($id));
        $full = $base === false ? false : realpath($base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel));
        if ($full === false || !str_starts_with($full, $base . DIRECTORY_SEPARATOR) || !is_file($full)) {
            Response::notFound('Attachment not found');
        }

        header('Content-Type: ' . mime_content_type($full));
        header('Content-Disposition: inline; filename="' . basename($full) . '"');
        header('Content-Length: ' . filesize($full));
        header('Cache-Control: private, max-age=3600');
        readfile($full);
        exit;
    }

    /**
     * PUT /api/cpd/cancel-requests/{id}/approve — cpd_finance approves a pending
     * cancellation, sets the refund amount (defaults client-side to the original receipt
     * total but is editable), computes the withheld charge, and marks the request Cancelled.
     */
    public function approveCancelRequest(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('refund_amount')->numeric('refund_amount')->validate();
        $id     = (int) $params['id'];
        $refund = round((float) $body['refund_amount'], 2);
        if ($refund < 0) Response::error('Refund amount cannot be negative', 422);

        $req = $this->db->queryOne('SELECT auto_id, total_amount FROM mn_cpd_requests WHERE auto_id = ?', [$id]);
        if (!$req) Response::notFound('Request not found');

        $original = (float) $req['total_amount'];
        if ($refund > $original) Response::error('Refund amount cannot exceed the original receipt amount', 422);
        $charge = round($original - $refund, 2);

        $cancellation = $this->db->queryOne(
            'SELECT cancel_auto_id FROM mn_cpd_cancelled_requests WHERE request_auto_id = ? AND cancelled_approved = 0 ORDER BY cancel_auto_id DESC LIMIT 1',
            [$id],
        );
        if (!$cancellation) Response::error('No pending cancellation request found', 422);

        $this->db->beginTransaction();
        try {
            $this->db->execute(
                'UPDATE mn_cpd_cancelled_requests
                 SET cancelled_approved = 1, cancelled_approved_by = ?, refunded_amount = ?, charge_amount = ?
                 WHERE cancel_auto_id = ?',
                [Auth::id(), $refund, $charge, $cancellation['cancel_auto_id']],
            );
            $this->db->execute('UPDATE mn_cpd_requests SET request_status = 6 WHERE auto_id = ?', [$id]);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            Response::serverError('Approval failed: ' . $e->getMessage());
        }

        $this->logEvent('CANCEL_APPROVED', $id);
        Response::success(['refunded_amount' => $refund, 'charge_amount' => $charge], 'Cancellation approved — request marked as cancelled and refunded');
    }

    /** PUT /api/cpd/cancel-requests/{id}/reject — cpd_finance rejects a pending cancellation. */
    public function rejectCancelRequest(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('comment')->validate();
        $id = (int) $params['id'];

        $cancellation = $this->db->queryOne(
            'SELECT cancel_auto_id, remarks FROM mn_cpd_cancelled_requests WHERE request_auto_id = ? AND cancelled_approved = 0 ORDER BY cancel_auto_id DESC LIMIT 1',
            [$id],
        );
        if (!$cancellation) Response::error('No pending cancellation request found', 422);

        $remarks = trim(($cancellation['remarks'] ?? '') . "\n[Rejected] " . trim($body['comment']));

        $this->db->execute(
            "UPDATE mn_cpd_cancelled_requests
             SET cancelled_approved = 2, cancelled_approved_by = ?, remarks = ?
             WHERE cancel_auto_id = ?",
            [Auth::id(), $remarks, $cancellation['cancel_auto_id']],
        );

        $this->logEvent('CANCEL_REJECTED', $id);
        Response::success(null, 'Cancellation request rejected');
    }

    /**
     * POST /api/cpd/requests/{id}/cancel-notes — comment + optional multi-file attachment
     * on a cancellation, mirroring addReturnNote()'s exact pattern (same underlying
     * mn_cpd_officer_comments table, same JPG/PNG/PDF upload rules).
     */
    public function addCancelNote(array $params, array $body, array $query): void
    {
        $id      = (int) $params['id'];
        $comment = trim($_POST['comment'] ?? '');

        $req = $this->db->queryOne('SELECT auto_id FROM mn_cpd_requests WHERE auto_id = ?', [$id]);
        if (!$req) Response::notFound('Request not found');

        $commentId = $this->db->insert(
            'INSERT INTO mn_cpd_officer_comments (request_id, comment, added_by, added_datetime, read_flag)
             VALUES (?, ?, ?, NOW(), 0)',
            [$id, $comment !== '' ? $comment : '(attachment only)', Auth::id()],
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
                   . DIRECTORY_SEPARATOR . 'cancellations' . DIRECTORY_SEPARATOR . $id
                   . DIRECTORY_SEPARATOR . 'notes'          . DIRECTORY_SEPARATOR . $commentId;
            if ($count > 0 && !is_dir($dir) && !mkdir($dir, 0755, true)) {
                Response::serverError('Could not create upload directory');
            }
            for ($i = 0; $i < $count; $i++) {
                if ($files['error'][$i] === UPLOAD_ERR_NO_FILE) continue;
                if ($files['error'][$i] !== UPLOAD_ERR_OK) {
                    $errors[] = "File {$files['name'][$i]}: upload error {$files['error'][$i]}"; continue;
                }
                $mime = mime_content_type($files['tmp_name'][$i]);
                if (!in_array($mime, ['image/jpeg', 'image/png', 'application/pdf'], true)) {
                    $errors[] = "File {$files['name'][$i]}: only JPG, PNG or PDF files are accepted"; continue;
                }
                if ($files['size'][$i] > Config::UPLOAD_MAX_BYTES) {
                    $errors[] = "File {$files['name'][$i]}: exceeds file size limit"; continue;
                }
                $safeName = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $files['name'][$i]);
                if (move_uploaded_file($files['tmp_name'][$i], $dir . DIRECTORY_SEPARATOR . $safeName)) {
                    $saved[] = $safeName;
                } else {
                    $errors[] = "File {$files['name'][$i]}: failed to save";
                }
            }
        }

        $this->logEvent('CANCEL_NOTE_ADDED', $id);
        Response::created(['comment_id' => $commentId, 'saved' => $saved, 'errors' => $errors]);
    }

    public function markCarnetReturned(array $params, array $body, array $query): void
    {
        $r = $this->db->queryOne('SELECT carnet_no FROM mn_cpd_requests WHERE auto_id=?', [$params['id']]);
        if ($r === null) Response::notFound('Request not found');

        $this->db->beginTransaction();
        try {
            // request_status is numeric — 4 is "Returned" (mn_cpd_statuses). The
            // literal string 'Returned' used to be written here, which MySQL
            // silently coerces to 0, so a returned CPD never actually showed as
            // Returned anywhere that filters/displays by status.
            $this->db->execute(
                "UPDATE mn_cpd_requests SET request_status=4 WHERE auto_id=?",
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
        // 'available' is what the Issue Carnet modal actually sends — without this,
        // it fell through to the unfiltered branch below and listed every carnet,
        // including ones already allocated to another request.
        if (in_array($status, ['unused', 'available'], true)) $where = 'WHERE c.is_used=0 AND c.is_damaged=0';
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
            'SELECT group_code, group_label, fixed_amount, fixed_amount_uae_national,
                    motorcycle_flat_amount, special_note,
                    requires_security_cheque, security_cheque_amount
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
            'delivery_fee'      => Config::CPD_DELIVERY_FEE,
            'return_pickup_fee' => Config::CPD_RETURN_PICKUP_FEE,
            'security_cheque_collection_fee' => Config::CPD_SECURITY_CHEQUE_COLLECTION_FEE,
            'service_fee'       => Config::CPD_SERVICE_FEE,
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
        // 'all' explicitly bypasses the status restriction — request_status is numeric
        // (mn_cpd_statuses.carnet_status_id), so anything other than a real digit or
        // 'all' here would silently coerce to 0 and match nothing.
        if ($status === 'all') {
            // no restriction
        } elseif ($status !== '')  { $where .= ' AND r.request_status=?';           $binds[] = $status; }
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

        // Order matches the online wizard's own upload order (public.js) so both the
        // customer's History view and the officer's detail view show documents the
        // same way the customer originally uploaded them.
        $slotLabels = [
            'cpd_emirates_id_front' => 'Emirates ID Front',
            'cpd_emirates_id_back'  => 'Emirates ID Back',
            'cpd_dl_front'          => 'Driving License Front',
            'cpd_dl_back'           => 'Driving License Back',
            'cpd_mulkiya_front'     => 'Traffic File Front',
            'cpd_mulkiya_back'      => 'Traffic File Back',
            'cpd_passport'          => 'Passport Photo',
            'cpd_owner_visa'        => 'Visa Page',
            'cpd_trade_license'     => 'Trade License',
            'cpd_noc'               => 'NOC',
            'cpd_extra1_eid_front'  => 'Extra Driver 1 - Emirates ID Front',
            'cpd_extra1_eid_back'   => 'Extra Driver 1 - Emirates ID Back',
            'cpd_extra1_passport'   => 'Extra Driver 1 - Passport Copy',
            'cpd_extra2_eid_front'  => 'Extra Driver 2 - Emirates ID Front',
            'cpd_extra2_eid_back'   => 'Extra Driver 2 - Emirates ID Back',
            'cpd_extra2_passport'   => 'Extra Driver 2 - Passport Copy',
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

        // Get next queue position from workflow — a Special-category walk-in that has
        // already cleared Branch Manager approval uses its own action so the audit
        // trail (mn_event_logs / workflow history) distinguishes it from the Normal path.
        $category = (string) $this->db->scalar('SELECT request_category FROM mn_cpd_requests WHERE auto_id=?', [$id]);
        $wfAction = strtoupper(trim($category)) === 'SPECIAL'
            ? 'APPROVE_CASHIER_SPECIAL_REQUEST_WALKIN'
            : 'ACCEPT_PAYMENT_NORMAL_REQUEST_WALKIN';
        $wf = $this->db->queryOne(
            "SELECT next_role FROM mn_workflows_actions WHERE section='CPD' AND action=? LIMIT 1",
            [$wfAction],
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
        $this->sendCpdPaymentConfirmedEmail($id);
        Response::success(null, 'Payment recorded');
    }

    /**
     * POST /api/cpd/requests/{id}/receipt — mirrors IDLController::createReceipt(),
     * same mn_*_receipts table shape (receipt_no format REC/DDMMYYYY/auto_id) and the
     * same legacy-v3 mn_cpd_receipts table this request-level receipt history has
     * always lived in; the v2 rebuild just never wired cashier printing to it.
     */
    public function createReceipt(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];

        $req = $this->db->queryOne(
            'SELECT auto_id, request_id, total_amount FROM mn_cpd_requests WHERE auto_id=?',
            [$autoId],
        );
        if (!$req) Response::notFound('CPD request not found');

        // Return existing receipt if one already exists — no duplicates
        $existing = $this->db->queryOne(
            'SELECT receipt_id, receipt_no FROM mn_cpd_receipts WHERE request_id=?',
            [$autoId],
        );
        if ($existing) {
            Response::success($existing, 'Receipt already exists');
            return;
        }

        $receiptId = $this->db->insert(
            "INSERT INTO mn_cpd_receipts (receipt_no, request_id, receipt_total, created_by, created_datetime)
             VALUES ('PENDING', ?, ?, ?, NOW())",
            [$autoId, $req['total_amount'], Auth::id()],
        );

        $receiptNo = sprintf('REC/%s/%d', date('dmY'), $receiptId);
        $this->db->execute(
            'UPDATE mn_cpd_receipts SET receipt_no=? WHERE receipt_id=?',
            [$receiptNo, $receiptId],
        );

        $this->logEvent('PRINT_RECEIPT', $autoId, $receiptNo);
        Response::success(['receipt_id' => $receiptId, 'receipt_no' => $receiptNo], 'Receipt created');
    }

    public function getReceipt(array $params, array $body, array $query): void
    {
        $autoId = (int)$params['id'];

        $receipt = $this->db->queryOne(
            "SELECT rc.receipt_id, rc.receipt_no, rc.receipt_total, rc.created_datetime,
                    r.request_id, r.total_amount, r.delivery_option,
                    CONCAT(u.first_name,' ',u.last_name) AS customer_name
             FROM mn_cpd_receipts rc
             JOIN mn_cpd_requests r ON r.auto_id         = rc.request_id
             LEFT JOIN mn_users u   ON u.user_id          = r.belonging_user_id
             WHERE rc.request_id = ?
             ORDER BY rc.receipt_id DESC LIMIT 1",
            [$autoId],
        );

        if (!$receipt) Response::notFound('Receipt not found');
        Response::success($receipt);
    }

    /** Best-effort payment-confirmation email — never blocks the payment action itself. */
    private function sendCpdPaymentConfirmedEmail(int $autoId): void
    {
        $req = $this->db->queryOne(
            "SELECT COALESCE(cru.first_name, u.first_name) AS first_name,
                    COALESCE(cru.last_name,  u.last_name)  AS last_name,
                    r.request_id, u.email
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_request_user cru ON cru.request_auto_id = r.auto_id
             LEFT JOIN mn_users u              ON u.user_id            = r.belonging_user_id
             WHERE r.auto_id = ?",
            [$autoId],
        );
        if (!$req || empty($req['email'])) return;
        try {
            (new MailHandler())->sendBasicMailViaMailJet(
                Config::MJ_CPD_PAYMENT_CONFIRMED_TEMPLATE,
                $req['email'],
                [
                    'customer_name' => trim(($req['first_name'] ?? '') . ' ' . ($req['last_name'] ?? '')),
                    'request_id'    => $req['request_id'] ?? '',
                ],
            );
        } catch (\Throwable $e) {
            Logger::error('CPD payment-confirmation email failed: ' . $e->getMessage());
        }
    }

    // ── Mark Dispatched (home-delivery orders) — mirrors IDLController::markDispatched() ──

    public function markDispatched(array $params, array $body, array $query): void
    {
        $id = (int) $params['id'];
        $this->db->execute(
            "UPDATE mn_cpd_requests SET request_status=9, airway_bill_no=? WHERE auto_id=?",
            [$body['air_bill_no'] ?? '', $id],
        );
        $this->logEvent('DISPATCH', $id);

        $req = $this->db->queryOne(
            "SELECT COALESCE(cru.first_name, u.first_name) AS first_name,
                    COALESCE(cru.last_name,  u.last_name)  AS last_name,
                    r.request_id, r.airway_bill_no, u.email
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_request_user cru ON cru.request_auto_id = r.auto_id
             LEFT JOIN mn_users u              ON u.user_id            = r.belonging_user_id
             WHERE r.auto_id = ?",
            [$id],
        );
        if ($req && !empty($req['email'])) {
            try {
                (new MailHandler())->sendBasicMailViaMailJet(
                    Config::MJ_CPD_DISPATCHED_TEMPLATE,
                    $req['email'],
                    [
                        'customer_name' => trim(($req['first_name'] ?? '') . ' ' . ($req['last_name'] ?? '')),
                        'request_id'    => $req['request_id']     ?? '',
                        'air_bill_no'   => $req['airway_bill_no'] ?? '',
                    ],
                );
            } catch (\Throwable $e) {
                Logger::error('CPD dispatched email failed: ' . $e->getMessage());
            }
        }

        Response::success(null, 'Marked as dispatched');
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
        $response  = curl_exec($ch);
        $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            Logger::error("Aramex cURL error: {$curlError}");
            Response::serverError("Aramex connection failed: {$curlError}");
        }

        // Aramex returns XML here despite the /json/ URL path — confirmed via a real
        // test call (2026-10-23). json_decode() on XML silently returns null, which
        // meant HasErrors never actually triggered and no real AWB/label URL was ever
        // extracted here, even on a genuine success — the 'raw' field below was the
        // only thing that ever reflected real data. See
        // createSecurityChequeCollectionShipment() for the same fix applied there.
        $xml = @simplexml_load_string($response);
        if ($xml === false) {
            Logger::error("Aramex response was not valid XML for CPD request {$id}: {$response}");
            Response::serverError('Aramex returned an unexpected response format');
        }

        $hasErrors = (string)$xml->HasErrors === 'true';
        $messages  = [];
        foreach (($xml->Notifications->Notification ?? []) as $n) {
            $messages[] = (string)$n->Message;
        }
        foreach (($xml->Shipments->ProcessedShipment ?? []) as $shipment) {
            foreach (($shipment->Notifications->Notification ?? []) as $n) {
                $messages[] = (string)$n->Message;
            }
        }
        if ($hasErrors || $messages) {
            $message = implode('; ', $messages);
            Logger::error("Aramex error for request {$id}: {$message}");
            Response::error("Aramex error: {$message}", 422);
        }

        // Extract shipment number and label URL
        $processedShipment = $xml->Shipments->ProcessedShipment ?? null;
        $airBillNo = (string)($processedShipment->ID ?? '');
        $labelUrl  = (string)($processedShipment->ShipmentLabel->LabelURL ?? '');

        // Save air bill number back to the request
        if ($airBillNo) {
            $this->db->execute(
                'UPDATE mn_cpd_requests SET airway_bill_no = ? WHERE auto_id = ?',
                [$airBillNo, $id],
            );
        }

        Logger::info("Aramex AWB created for CPD request {$id}: airBillNo={$airBillNo}");
        Response::success([
            'air_bill_no' => $airBillNo,
            'label_url'   => $labelUrl,
            'raw'         => $response,
        ], 'AWB created successfully');
    }

    // ── Print Carnet ─────────────────────────────────────────────────────────
    // Ported from the legacy application's CPDManagementController::printCPDCarnet().
    // Unlike IDL's print (which uses per-officer, DB-stored, user-adjustable
    // coordinates), the CPD carnet overlay position is fixed — same static layout
    // for every officer, every time — so there's no margins/calibration screen here.
    private const CPD_PRINT_PARAMS = [
        1 => [
            'holder_address'  => ['x' => 20,  'y' => 23],
            'expiry_date'     => ['x' => 120, 'y' => 36],
            'registered_in'   => ['x' => 85,  'y' => 125],
            'registration_no' => ['x' => 140, 'y' => 125],
            'location'        => ['x' => 55,  'y' => 247],
            'date'            => ['x' => 150, 'y' => 247],
        ],
        2 => [
            'holder_address'      => ['x' => 21,  'y' => 74],
            'expiry_date1'        => ['x' => 160, 'y' => 20],
            'expiry_date2'        => ['x' => 160, 'y' => 75],
            'country_string'      => ['x' => 101, 'y' => 5],
            'registered_in'       => ['x' => 65,  'y' => 94],
            'registration_no'     => ['x' => 138, 'y' => 94],
            'manuf_year'          => ['x' => 80,  'y' => 98],
            'net_weight'          => ['x' => 85,  'y' => 102],
            'vehicle_value'       => ['x' => 75,  'y' => 106],
            'chassis_no'          => ['x' => 60,  'y' => 111],
            'vehicle_make_model1' => ['x' => 50,  'y' => 115],
            'engine_no'           => ['x' => 50,  'y' => 119],
            'vehicle_make_model2' => ['x' => 50,  'y' => 124],
            'no_of_cylinders'     => ['x' => 65,  'y' => 128],
            'horse_power'         => ['x' => 65,  'y' => 132],
            'body_type'           => ['x' => 65,  'y' => 140],
            'color'               => ['x' => 60,  'y' => 145],
            'upholstery'          => ['x' => 60,  'y' => 149],
            'no_of_seats'         => ['x' => 90,  'y' => 153],
            'radio'               => ['x' => 65,  'y' => 162],
            'spare_tyre'          => ['x' => 63,  'y' => 166],
            'others1'             => ['x' => 62,  'y' => 170],
            'others2'             => ['x' => 25,  'y' => 173],
        ],
        3 => [
            'holder_address'      => ['x' => 21,  'y' => 187],
            'expiry_date'         => ['x' => 160, 'y' => 187],
            'registered_in'       => ['x' => 60,  'y' => 207],
            'registration_no'     => ['x' => 138, 'y' => 207],
            'manuf_year'          => ['x' => 75,  'y' => 211],
            'net_weight'          => ['x' => 82,  'y' => 215],
            'vehicle_value'       => ['x' => 65,  'y' => 209],
            'chassis_no'          => ['x' => 35,  'y' => 222],
            'vehicle_make_model1' => ['x' => 40,  'y' => 225],
            'engine_no'           => ['x' => 48,  'y' => 230],
            'vehicle_make_model2' => ['x' => 40,  'y' => 235],
            'no_of_cylinders'     => ['x' => 66,  'y' => 239],
            'horse_power'         => ['x' => 57,  'y' => 243],
            'body_type'           => ['x' => 64,  'y' => 251],
            'color'               => ['x' => 50,  'y' => 255],
            'upholstery'          => ['x' => 62,  'y' => 259],
            'country_string'      => ['x' => 101, 'y' => 210],
            'no_of_seats'         => ['x' => 89,  'y' => 264],
            'radio'               => ['x' => 70,  'y' => 272],
            'spare_tyre'          => ['x' => 70,  'y' => 275],
            'others1'             => ['x' => 62,  'y' => 280],
            'others2'             => ['x' => 25,  'y' => 284],
        ],
        4 => [
            'registered_in'       => ['x' => 60,  'y' => 95],
            'manuf_year'          => ['x' => 80,  'y' => 99],
            'net_weight'          => ['x' => 90,  'y' => 103],
            'vehicle_value'       => ['x' => 60,  'y' => 105],
            'chassis_no'          => ['x' => 50,  'y' => 111],
            'vehicle_make_model1' => ['x' => 40,  'y' => 225],
            'engine_no'           => ['x' => 48,  'y' => 230],
            'vehicle_make_model2' => ['x' => 55,  'y' => 124],
            'no_of_cylinders'     => ['x' => 60,  'y' => 128],
            'horse_power'         => ['x' => 70,  'y' => 132],
            'body_type'           => ['x' => 80,  'y' => 140],
            'color'               => ['x' => 65,  'y' => 144],
            'upholstery'          => ['x' => 80,  'y' => 149],
            'no_of_seats'         => ['x' => 100, 'y' => 153],
            'radio'               => ['x' => 75,  'y' => 162],
            'spare_tyre'          => ['x' => 75,  'y' => 165],
            'others1'             => ['x' => 62,  'y' => 170],
            'others2'             => ['x' => 25,  'y' => 174],
            'registration_no'     => ['x' => 150, 'y' => 97],
        ],
        5 => [
            'country_string' => ['x' => 153, 'y' => 212],
        ],
    ];

    public function printCarnet(array $params, array $body, array $query): void
    {
        $id   = (int) $params['id'];
        $user = Auth::user();

        $req = $this->db->queryOne(
            "SELECT r.auto_id, r.request_status, r.belonging_user_id,
                    r.vehicle_registered_in, r.registration_no, r.manuf_year, r.net_weight,
                    r.vehicle_value, r.chassis_no, r.vehicle_make, r.vehicle_model, r.engine_no,
                    r.no_of_cylinders, r.horse_power, r.body_type, r.color, r.upholstery,
                    r.no_of_seats, r.radio, r.spare_tyre, r.others1, r.others2,
                    r.extra_owner1_name, r.extra_owner2_name,
                    cu.first_name, cu.last_name,
                    u.mobile_no
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id = r.auto_id
             LEFT JOIN mn_users u             ON u.user_id          = r.belonging_user_id
             WHERE r.auto_id = ?",
            [$id],
        );
        if (!$req) Response::notFound('Request not found');

        $isOwner = (int)($req['belonging_user_id'] ?? 0) === (int)($user['user_id'] ?? 0);
        $isStaff = in_array('cpd', $user['modules'] ?? [], true);
        if (!$isStaff && !$isOwner) {
            Response::forbidden('Access denied');
        }
        if ((int)$req['request_status'] !== 3) {
            Response::error('Carnet can only be printed once it has been issued', 409);
        }

        $p = self::CPD_PRINT_PARAMS;

        $expiryDate = date('Y-m-d', strtotime('+364 day'));

        $notAllowed = $this->db->query(
            "SELECT cc.nationality FROM mn_cpd_countries cc
             WHERE cc.nationality_id NOT IN (
                 SELECT country_id FROM mn_cpd_request_country_list WHERE request_id = ?
             )",
            [$id],
        );
        $countryString = '';
        foreach ($notAllowed as $row) {
            $countryString .= strtoupper((string)$row['nationality']) . '<br />';
        }

        $holderAddress = strtoupper(trim(($req['first_name'] ?? '') . ' ' . ($req['last_name'] ?? '')))
            . '<br />TEL: ' . ($req['mobile_no'] ?? '')
            . '<br />' . strtoupper((string)($req['extra_owner1_name'] ?? ''))
            . '<br />' . ($req['extra_owner2_name'] ?? '');

        $locRow = $this->db->queryOne(
            "SELECT l.location FROM mn_cpd_user_locations ul
             JOIN mn_cpd_locations l ON l.location_id = ul.location_id
             WHERE ul.user_id = ? LIMIT 1",
            [$user['user_id'] ?? 0],
        );
        $location = $locRow['location'] ?? 'Dubai';

        $vehicleMakeModel = trim(($req['vehicle_make'] ?? '') . ' ' . ($req['vehicle_model'] ?? ''));
        $today = date('Y-m-d');

        $seg = fn($html, $x, $y, $fontSize = 8) => ['html' => (string)($html ?? ''), 'x' => $x, 'y' => $y, 'font' => $fontSize];

        $segments = [];

        // ── Page 1 (cover) ──
        $segments[] = $seg($holderAddress,                        $p[1]['holder_address']['x'],  $p[1]['holder_address']['y']);
        $segments[] = $seg($expiryDate,                            $p[1]['expiry_date']['x'],     $p[1]['expiry_date']['y']);
        $segments[] = $seg($req['vehicle_registered_in'],          $p[1]['registered_in']['x'],   $p[1]['registered_in']['y']);
        $segments[] = $seg($req['registration_no'],                $p[1]['registration_no']['x'], $p[1]['registration_no']['y']);
        $segments[] = $seg($location,                              $p[1]['location']['x'],        $p[1]['location']['y']);
        $segments[] = $seg($today,                                 $p[1]['date']['x'],            $p[1]['date']['y']);

        // ── Page 2 — two panels sharing one physical page (matches legacy layout) ──
        $segments[] = ['add_page' => true];
        $segments[] = $seg($holderAddress,                         $p[2]['holder_address']['x'],      $p[2]['holder_address']['y']);
        $segments[] = $seg($expiryDate,                            $p[2]['expiry_date1']['x'],        $p[2]['expiry_date1']['y']);
        $segments[] = $seg($expiryDate,                            $p[2]['expiry_date2']['x'],        $p[2]['expiry_date2']['y']);
        $segments[] = $seg($countryString,                         $p[2]['country_string']['x'],      $p[2]['country_string']['y']);
        $segments[] = $seg($req['vehicle_registered_in'],          $p[2]['registered_in']['x'],       $p[2]['registered_in']['y']);
        $segments[] = $seg($req['registration_no'],                $p[2]['registration_no']['x'],     $p[2]['registration_no']['y']);
        $segments[] = $seg($req['manuf_year'],                     $p[2]['manuf_year']['x'],          $p[2]['manuf_year']['y']);
        $segments[] = $seg($req['net_weight'],                     $p[2]['net_weight']['x'],          $p[2]['net_weight']['y']);
        $segments[] = $seg($req['vehicle_value'],                  $p[2]['vehicle_value']['x'],       $p[2]['vehicle_value']['y']);
        $segments[] = $seg($req['chassis_no'],                     $p[2]['chassis_no']['x'],          $p[2]['chassis_no']['y']);
        $segments[] = $seg($vehicleMakeModel,                      $p[2]['vehicle_make_model1']['x'], $p[2]['vehicle_make_model1']['y']);
        $segments[] = $seg($req['engine_no'],                      $p[2]['engine_no']['x'],           $p[2]['engine_no']['y']);
        $segments[] = $seg($vehicleMakeModel,                      $p[2]['vehicle_make_model2']['x'], $p[2]['vehicle_make_model2']['y']);
        $segments[] = $seg($req['no_of_cylinders'],                $p[2]['no_of_cylinders']['x'],     $p[2]['no_of_cylinders']['y']);
        $segments[] = $seg($req['horse_power'],                    $p[2]['horse_power']['x'],         $p[2]['horse_power']['y']);
        $segments[] = $seg($req['body_type'],                      $p[2]['body_type']['x'],           $p[2]['body_type']['y']);
        $segments[] = $seg($req['color'],                          $p[2]['color']['x'],               $p[2]['color']['y']);
        $segments[] = $seg($req['upholstery'],                     $p[2]['upholstery']['x'],          $p[2]['upholstery']['y']);
        $segments[] = $seg($req['no_of_seats'],                    $p[2]['no_of_seats']['x'],         $p[2]['no_of_seats']['y']);
        $segments[] = $seg($req['radio'],                          $p[2]['radio']['x'],               $p[2]['radio']['y']);
        $segments[] = $seg($req['spare_tyre'],                     $p[2]['spare_tyre']['x'],          $p[2]['spare_tyre']['y']);
        $segments[] = $seg($req['others1'],                        $p[2]['others1']['x'],             $p[2]['others1']['y']);
        $segments[] = $seg($req['others2'],                        $p[2]['others2']['x'],             $p[2]['others2']['y']);

        $segments[] = $seg($holderAddress,                         $p[3]['holder_address']['x'],      $p[3]['holder_address']['y']);
        $segments[] = $seg($expiryDate,                            $p[3]['expiry_date']['x'],         $p[3]['expiry_date']['y']);
        $segments[] = $seg($req['vehicle_registered_in'],          $p[3]['registered_in']['x'],       $p[3]['registered_in']['y']);
        $segments[] = $seg($req['registration_no'],                $p[3]['registration_no']['x'],     $p[3]['registration_no']['y']);
        $segments[] = $seg($req['manuf_year'],                     $p[3]['manuf_year']['x'],          $p[3]['manuf_year']['y']);
        $segments[] = $seg($req['net_weight'],                     $p[3]['net_weight']['x'],          $p[3]['net_weight']['y']);
        $segments[] = $seg($req['vehicle_value'],                  $p[3]['vehicle_value']['x'],       $p[3]['vehicle_value']['y']);
        $segments[] = $seg($req['chassis_no'],                     $p[3]['chassis_no']['x'],          $p[3]['chassis_no']['y']);
        $segments[] = $seg($vehicleMakeModel,                      $p[3]['vehicle_make_model1']['x'], $p[3]['vehicle_make_model1']['y']);
        $segments[] = $seg($req['engine_no'],                      $p[3]['engine_no']['x'],           $p[3]['engine_no']['y']);
        $segments[] = $seg($vehicleMakeModel,                      $p[3]['vehicle_make_model2']['x'], $p[3]['vehicle_make_model2']['y']);
        $segments[] = $seg($req['no_of_cylinders'],                $p[3]['no_of_cylinders']['x'],     $p[3]['no_of_cylinders']['y']);
        $segments[] = $seg($req['horse_power'],                    $p[3]['horse_power']['x'],         $p[3]['horse_power']['y']);
        $segments[] = $seg($req['body_type'],                      $p[3]['body_type']['x'],           $p[3]['body_type']['y']);
        $segments[] = $seg($req['color'],                          $p[3]['color']['x'],               $p[3]['color']['y']);
        $segments[] = $seg($req['upholstery'],                     $p[3]['upholstery']['x'],          $p[3]['upholstery']['y']);
        $segments[] = $seg($countryString,                         $p[3]['country_string']['x'],      $p[3]['country_string']['y']);
        $segments[] = $seg($req['no_of_seats'],                    $p[3]['no_of_seats']['x'],         $p[3]['no_of_seats']['y']);
        $segments[] = $seg($req['radio'],                          $p[3]['radio']['x'],               $p[3]['radio']['y']);
        $segments[] = $seg($req['spare_tyre'],                     $p[3]['spare_tyre']['x'],          $p[3]['spare_tyre']['y']);
        $segments[] = $seg($req['others1'],                        $p[3]['others1']['x'],             $p[3]['others1']['y']);
        $segments[] = $seg($req['others2'],                        $p[3]['others2']['x'],             $p[3]['others2']['y']);

        // ── Page 3 ──
        $segments[] = ['add_page' => true];
        $segments[] = $seg($req['vehicle_registered_in'],          $p[4]['registered_in']['x'],       $p[4]['registered_in']['y']);
        $segments[] = $seg($req['manuf_year'],                     $p[4]['manuf_year']['x'],          $p[4]['manuf_year']['y']);
        $segments[] = $seg($req['net_weight'],                     $p[4]['net_weight']['x'],          $p[4]['net_weight']['y']);
        $segments[] = $seg($req['chassis_no'],                     $p[4]['chassis_no']['x'],          $p[4]['chassis_no']['y']);
        $segments[] = $seg($vehicleMakeModel,                      $p[4]['vehicle_make_model1']['x'], $p[4]['vehicle_make_model1']['y']);
        $segments[] = $seg($req['engine_no'],                      $p[4]['engine_no']['x'],           $p[4]['engine_no']['y']);
        $segments[] = $seg($vehicleMakeModel,                      $p[4]['vehicle_make_model2']['x'], $p[4]['vehicle_make_model2']['y']);
        $segments[] = $seg($req['no_of_cylinders'],                $p[4]['no_of_cylinders']['x'],     $p[4]['no_of_cylinders']['y']);
        $segments[] = $seg($req['horse_power'],                    $p[4]['horse_power']['x'],         $p[4]['horse_power']['y']);
        $segments[] = $seg($req['body_type'],                      $p[4]['body_type']['x'],           $p[4]['body_type']['y']);
        $segments[] = $seg($req['color'],                          $p[4]['color']['x'],               $p[4]['color']['y']);
        $segments[] = $seg($req['upholstery'],                     $p[4]['upholstery']['x'],          $p[4]['upholstery']['y']);
        $segments[] = $seg($req['no_of_seats'],                    $p[4]['no_of_seats']['x'],         $p[4]['no_of_seats']['y']);
        $segments[] = $seg($req['radio'],                          $p[4]['radio']['x'],               $p[4]['radio']['y']);
        $segments[] = $seg($req['spare_tyre'],                     $p[4]['spare_tyre']['x'],          $p[4]['spare_tyre']['y']);
        $segments[] = $seg($req['others1'],                        $p[4]['others1']['x'],             $p[4]['others1']['y']);
        $segments[] = $seg($req['others2'],                        $p[4]['others2']['x'],             $p[4]['others2']['y']);
        $segments[] = $seg($req['vehicle_value'],                  $p[4]['vehicle_value']['x'],       $p[4]['vehicle_value']['y']);
        $segments[] = $seg($req['registration_no'],                $p[4]['registration_no']['x'],     $p[4]['registration_no']['y']);

        // ── Page 4 ──
        $segments[] = ['add_page' => true];
        $segments[] = $seg($countryString,                         $p[5]['country_string']['x'],      $p[5]['country_string']['y']);

        require_once API_ROOT . '/vendor/autoload.php';

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
            if (!empty($segment['add_page'])) {
                $pdf->AddPage();
                continue;
            }
            $pdf->SetFontSize($segment['font'] ?? 8);
            $pdf->writeHTMLCell(0, 0, $segment['x'], $segment['y'], $segment['html'], 0, 1, 0, true, '', false);
        }

        $this->logEvent('PRINT_CARNET', $id);
        $pdf->Output('Carnet.pdf', 'I');
        exit;
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

        // Vehicle / delivery fields — these live directly on mn_cpd_requests, not
        // mn_cpd_request_user. A corrections request may have been sent back for a
        // vehicle-detail error, not just an owner-detail one, so both need to be editable.
        $allowedRequestFields = [
            'registration_no', 'mulkiya_no', 'vehicle_make', 'vehicle_model', 'vehicle_value',
            'vehicle_registered_in', 'body_type', 'manuf_year', 'color', 'net_weight',
            'chassis_no', 'engine_no', 'horse_power', 'no_of_cylinders',
            'delivery_option', 'delivery_address',
        ];
        $requestFields = [];
        $requestBinds  = [];
        foreach ($allowedRequestFields as $f) {
            if (array_key_exists($f, $body)) {
                $requestFields[] = "`{$f}` = ?";
                $requestBinds[]  = $body[$f];
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

            // Corrected vehicle/delivery fields, plus status=2 (Processing) and route
            // back to CPD Officer queue, in the same statement.
            $requestFields[] = 'request_status = 2';
            $requestFields[] = 'current_queue_position = ?';
            $requestBinds[]  = $queuePosition;
            $requestBinds[]  = $id;
            $this->db->execute(
                "UPDATE mn_cpd_requests SET " . implode(', ', $requestFields) . " WHERE auto_id = ?",
                $requestBinds,
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
            'dl_front'       => 'cpd_dl_front',
            'dl_back'        => 'cpd_dl_back',
            'passport_photo' => 'cpd_passport',
            'visa_page'      => 'cpd_owner_visa',
            'trade_license'  => 'cpd_trade_license',
            'noc'            => 'cpd_noc',
            'extra1_eid_front' => 'cpd_extra1_eid_front',
            'extra1_eid_back'  => 'cpd_extra1_eid_back',
            'extra1_passport'  => 'cpd_extra1_passport',
            'extra2_eid_front' => 'cpd_extra2_eid_front',
            'extra2_eid_back'  => 'cpd_extra2_eid_back',
            'extra2_passport'  => 'cpd_extra2_passport',
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

    /**
     * POST /api/cpd/requests/{id}/security-cheque — officer records receipt of the
     * additional security cheque (per-country requirement, see mn_cpd_guarantee_groups.
     * requires_security_cheque): cheque number + a scan copy.
     */
    public function updateSecurityCheque(array $params, array $body, array $query): void
    {
        $id = (int)$params['id'];
        $chequeNo = trim($_POST['cheque_no'] ?? '');
        if ($chequeNo === '') Response::error('Cheque number is required', 422);

        $req = $this->db->queryOne('SELECT auto_id FROM mn_cpd_requests WHERE auto_id = ?', [$id]);
        if (!$req) Response::notFound('Request not found');

        $scanPath = null;
        if (!empty($_FILES['scan']) && $_FILES['scan']['error'] !== UPLOAD_ERR_NO_FILE) {
            $file = $_FILES['scan'];
            if ($file['error'] !== UPLOAD_ERR_OK) Response::error('Upload error code ' . $file['error'], 422);
            $mime = mime_content_type($file['tmp_name']);
            if (!in_array($mime, ['image/jpeg', 'image/png', 'application/pdf'], true)) {
                Response::error('Only JPG, PNG or PDF files are accepted', 422);
            }
            if ($file['size'] > Config::UPLOAD_MAX_BYTES) Response::error('File exceeds size limit', 422);
            $dir = API_ROOT . DIRECTORY_SEPARATOR . Config::CPD_IMAGE_PATH . DIRECTORY_SEPARATOR . $id;
            if (!is_dir($dir) && !mkdir($dir, 0755, true)) Response::serverError('Could not create upload directory');
            $ext  = $mime === 'application/pdf' ? 'pdf' : ($mime === 'image/png' ? 'png' : 'jpg');
            $stem = 'cpd_security_cheque_scan';
            if (!move_uploaded_file($file['tmp_name'], $dir . DIRECTORY_SEPARATOR . $stem . '.' . $ext)) {
                Response::serverError('Failed to save scan file');
            }
            $scanPath = Config::CPD_IMAGE_PATH . "/{$id}/{$stem}.{$ext}";
        }

        $this->db->execute(
            'UPDATE mn_cpd_requests
             SET security_cheque_no = ?, security_cheque_received_datetime = NOW()
                 ' . ($scanPath ? ', security_cheque_scan_path = ?' : '') . '
             WHERE auto_id = ?',
            $scanPath ? [$chequeNo, $scanPath, $id] : [$chequeNo, $id],
        );

        $this->logEvent('SECURITY_CHEQUE_RECEIVED', $id);
        Response::success(null, 'Security cheque receipt recorded');
    }

    /** GET /api/cpd/requests/{id}/security-cheque-scan — serves the scan to staff only. */
    public function serveSecurityChequeScan(array $params, array $body, array $query): void
    {
        $id  = (int)$params['id'];
        $user = Auth::user();
        if (!in_array('cpd', $user['modules'] ?? [], true)) Response::forbidden('Access denied');

        $req = $this->db->queryOne('SELECT security_cheque_scan_path FROM mn_cpd_requests WHERE auto_id = ?', [$id]);
        if (!$req || empty($req['security_cheque_scan_path'])) Response::notFound('Scan not found');

        $filePath = API_ROOT . DIRECTORY_SEPARATOR . $req['security_cheque_scan_path'];
        if (!file_exists($filePath)) Response::notFound('Scan not found');

        $ext   = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
        $mimes = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'pdf' => 'application/pdf'];
        header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
        header('Content-Disposition: inline; filename="security_cheque_scan.' . $ext . '"');
        header('Content-Length: ' . filesize($filePath));
        header('Cache-Control: private, max-age=3600');
        readfile($filePath);
        exit;
    }

    /**
     * PUT /api/cpd/requests/{id}/security-cheque-return — officer records the Aramex
     * airway bill for delivering the security cheque back to the customer (during the
     * carnet return process).
     */
    public function updateSecurityChequeReturn(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('airway_bill')->validate();
        $id = (int)$params['id'];

        $req = $this->db->queryOne('SELECT auto_id FROM mn_cpd_requests WHERE auto_id = ?', [$id]);
        if (!$req) Response::notFound('Request not found');

        $this->db->execute(
            'UPDATE mn_cpd_requests SET security_cheque_return_airway_bill = ? WHERE auto_id = ?',
            [$body['airway_bill'], $id],
        );

        $this->logEvent('SECURITY_CHEQUE_RETURN_DISPATCHED', $id);
        Response::success(null, 'Security cheque return airway bill saved');
    }

    // ── Renew / Copy an existing CPD request ─────────────────────────────────

    public function renew(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('vehicle_make','vehicle_model','registration_no','chassis_no','manuf_year','method_of_payment')
            ->numeric('vehicle_value')->numeric('guarantee_amount')->numeric('booking_fee')
            ->validate();
        $this->validateExtraDriversRequired($body);

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
                 (request_id, request_category, usage_type, belonging_user_id,
                  vehicle_make, vehicle_model, registration_no, chassis_no, engine_no,
                  manuf_year, color, body_type, no_of_cylinders, horse_power,
                  net_weight, vehicle_value, mulkiya_no,
                  extra_owner1_name, extra_owner1_eid, extra_owner1_passport,
                  extra_owner2_name, extra_owner2_eid, extra_owner2_passport,
                  uae_refree1, uae_refree1_mobile, uae_refree2, uae_refree2_mobile,
                  destination_refree1, destination_refree1_mobile,
                  destination_refree2, destination_refree2_mobile,
                  guarantee_amount, booking_fee, processing_fee, extra_fees, vat_amount, total_amount,
                  method_of_payment, booking_channel, request_status,
                  current_queue_position, request_type, parent_request_id, requested_datetime)
                 VALUES ('PENDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'WALKIN',1,?,?,?,NOW())",
                [
                    $body['request_category']   ?? 'NORMAL',
                    $body['usage_type']         ?? 'PERSONAL',
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
                    $body['extra_owner1_eid']   ?? '',
                    $body['extra_owner1_passport'] ?? '',
                    $body['extra_owner2_name']  ?? '',
                    $body['extra_owner2_eid']   ?? '',
                    $body['extra_owner2_passport'] ?? '',
                    $body['uae_refree1']        ?? '',
                    $body['uae_refree1_mobile'] ?? '',
                    $body['uae_refree2']        ?? '',
                    $body['uae_refree2_mobile'] ?? '',
                    $body['destination_refree1']        ?? '',
                    $body['destination_refree1_mobile'] ?? '',
                    $body['destination_refree2']        ?? '',
                    $body['destination_refree2_mobile'] ?? '',
                    $body['guarantee_amount']   ?? 0,
                    $body['booking_fee']        ?? 0,
                    $body['processing_fee']     ?? 0,
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
                  emirates_id, passport_no, company_name, sex, license_no, license_expiry, registered_date)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
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
                    ($body['usage_type'] ?? '') === 'COMPANY' ? ($body['company_name'] ?? '') : null,
                    $body['sex']         ?? null,
                    $body['license_no']  ?? '',
                    ($body['license_expiry'] ?? '') ?: null,
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

    /**
     * GET /api/cpd/claims
     * Browsable list of all claims (previously only reachable one carnet at a time
     * via searchClaims()) — paginated and searchable by carnet no / request id / applicant.
     */
    public function indexClaims(array $params, array $body, array $query): void
    {
        $v       = Validator::make($query);
        $page    = max(1, $v->int('page', 1));
        $perPage = 20;
        $offset  = ($page - 1) * $perPage;
        $search  = $v->get('search', '');

        $where = 'WHERE 1';
        $binds = [];
        if ($search !== '') {
            $like   = "%{$search}%";
            $where .= ' AND (c.carnet_no LIKE ? OR r.request_id LIKE ? OR cu.first_name LIKE ? OR cu.last_name LIKE ?)';
            array_push($binds, $like, $like, $like, $like);
        }

        $total = (int) $this->db->scalar(
            "SELECT COUNT(*) FROM mn_cpd_claims c
             LEFT JOIN mn_cpd_requests r      ON r.auto_id           = c.request_id
             LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id  = c.request_id
             {$where}",
            $binds,
        );

        $rows = $this->db->query(
            "SELECT c.claim_id, c.request_id, c.carnet_no, c.claim_details, c.added_datetime,
                    r.request_id AS cpd_request_id,
                    cu.first_name, cu.last_name,
                    CONCAT(u.first_name,' ',u.last_name) AS added_by_name
             FROM mn_cpd_claims c
             LEFT JOIN mn_cpd_requests r      ON r.auto_id           = c.request_id
             LEFT JOIN mn_cpd_request_user cu ON cu.request_auto_id  = c.request_id
             LEFT JOIN mn_users u             ON u.user_id           = c.added_by
             {$where}
             ORDER BY c.claim_id DESC
             LIMIT {$perPage} OFFSET {$offset}",
            $binds,
        );

        Response::success([
            'data'     => $rows,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
        ]);
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
