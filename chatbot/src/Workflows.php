<?php
// ── Workflow Engine ───────────────────────────────────────────────────────────
// Each flow is a class with handle(string $phone, array &$session, string $input)
// Returning false from handle() sends the input to the Router to pick a new flow.

class Router
{
    // Route a message to the correct flow based on current session state
    public static function route(string $phone, array &$session, string $input, string $messageId): void
    {
        // Always mark message as read
        WhatsApp::markRead($messageId);

        // Global commands that work in any state
        $lower = mb_strtolower(trim($input));
        if (in_array($lower, ['hi', 'hello', 'hey', 'start', 'menu', 'مرحبا', 'السلام عليكم'])) {
            $session = ['flow' => null, 'step' => null, 'data' => [], 'last_activity' => time()];
            self::showMainMenu($phone, $session);
            return;
        }
        if (in_array($lower, ['0', 'back', 'cancel', 'exit'])) {
            $session = ['flow' => null, 'step' => null, 'data' => [], 'last_activity' => time()];
            self::showMainMenu($phone, $session);
            return;
        }

        // Dispatch to active flow
        if ($session['flow']) {
            $handled = match($session['flow']) {
                'idl_status'    => IDLStatusFlow::handle($phone, $session, $input),
                'cpd_status'    => CPDStatusFlow::handle($phone, $session, $input),
                'support'       => SupportFlow::handle($phone, $session, $input),
                'contact'       => ContactFlow::handle($phone, $session, $input),
                default         => false,
            };
            if ($handled) return;
        }

        // No active flow — interpret as main menu selection
        self::handleMainMenuInput($phone, $session, $input);
    }

    public static function showMainMenu(string $phone, array &$session): void
    {
        SessionManager::save($phone, $session);
        WhatsApp::buttons(
            $phone,
            "👋 Welcome to *ATC UAE e-Services*!\n\nHow can we help you today?",
            [
                ['id' => 'idl_status',  'title' => '🪪 IDL Status'],
                ['id' => 'cpd_status',  'title' => '🚗 CPD Status'],
                ['id' => 'support',     'title' => '🎧 Support'],
            ],
            'ATC UAE',
            'Reply with 0 anytime to return to this menu',
        );
    }

    private static function handleMainMenuInput(string $phone, array &$session, string $input): void
    {
        $flow = match(strtolower($input)) {
            'idl_status', '1' => 'idl_status',
            'cpd_status', '2' => 'cpd_status',
            'support',    '3' => 'support',
            default           => null,
        };

        if ($flow) {
            $session['flow'] = $flow;
            $session['step'] = 'start';
            $session['data'] = [];
            match($flow) {
                'idl_status' => IDLStatusFlow::handle($phone, $session, $input),
                'cpd_status' => CPDStatusFlow::handle($phone, $session, $input),
                'support'    => SupportFlow::handle($phone, $session, $input),
                default      => null,
            };
        } else {
            WhatsApp::buttons(
                $phone,
                "I didn't understand that. Please choose an option below 👇",
                [
                    ['id' => 'idl_status',  'title' => '🪪 IDL Status'],
                    ['id' => 'cpd_status',  'title' => '🚗 CPD Status'],
                    ['id' => 'support',     'title' => '🎧 Support'],
                ],
            );
        }
    }
}

// ── IDL Status Flow ───────────────────────────────────────────────────────────

class IDLStatusFlow
{
    public static function handle(string $phone, array &$session, string $input): bool
    {
        $step = $session['step'] ?? 'start';

        if ($step === 'start') {
            $session['step'] = 'ask_ref';
            SessionManager::save($phone, $session);
            WhatsApp::text(
                $phone,
                "🪪 *IDL Application Status*\n\nPlease enter your *Request ID* (e.g. IDL-ATC-20250501/1234) or your *Emirates ID* to look up your application.\n\n_Reply 0 to go back to main menu_",
            );
            return true;
        }

        if ($step === 'ask_ref') {
            $query = trim($input);

            // If input looks like a Request ID (starts with IDL-)
            if (stripos($query, 'IDL-') === 0) {
                $req = DB::getIDLByRequestId(strtoupper($query));
                if ($req) {
                    self::sendIDLDetails($phone, $req, $session);
                    return true;
                }
                WhatsApp::text($phone, "❌ No IDL application found for *{$query}*.\n\nPlease check the reference number and try again, or reply 0 to go back.");
                return true;
            }

            // If input looks like an Emirates ID (starts with 784 or contains dashes with digits)
            $eidDigits = preg_replace('/\D/', '', $query);
            if (strlen($eidDigits) >= 10 && (str_starts_with($query, '784') || str_contains($query, '-'))) {
                $row = DB::row(
                    "SELECT request_auto_id FROM mn_idl_request_user
                     WHERE REPLACE(emirates_id,'-','') = ? LIMIT 1",
                    [$eidDigits],
                );
                if (!$row) {
                    WhatsApp::text($phone, "❌ No IDL applications found for that Emirates ID.\n\nReply 0 to return to the main menu.");
                    $session['flow'] = null; $session['step'] = null;
                    SessionManager::save($phone, $session);
                    return true;
                }
                $req = DB::row(
                    "SELECT r.request_id, r.request_status, r.requested_datetime, r.idl_no,
                            r.paid_status, r.total_amount, r.delivery_option, r.air_bill_no,
                            s.status AS status_label, u.first_name, u.last_name
                     FROM mn_idl_requests r
                     LEFT JOIN mn_idl_status s ON s.status_id = r.request_status
                     LEFT JOIN mn_users u      ON u.user_id   = r.belonging_user_id
                     WHERE r.auto_id = ? AND r.is_active = 1",
                    [$row['request_auto_id']],
                );
                if ($req) self::sendIDLDetails($phone, $req, $session);
                return true;
            }

            // Try phone number lookup — find user and list their requests
            $user = DB::findUserByPhone($phone);
            if ($user) {
                $requests = DB::getIDLRequests($user['user_id']);
                self::sendIDLList($phone, $requests, $session, $user);
                return true;
            }

            // Nothing matched — ask for Emirates ID explicitly
            $session['step'] = 'ask_eid';
            SessionManager::save($phone, $session);
            WhatsApp::text($phone, "Please enter your *Emirates ID* (e.g. 784-1990-1234567-1) to look up your applications:");
            return true;
        }

        if ($step === 'ask_eid') {
            // Search by Emirates ID in mn_idl_request_user
            $eid = preg_replace('/\D/', '', $input);
            if (strlen($eid) < 10) {
                WhatsApp::text($phone, "❌ Invalid Emirates ID format. Please enter it as: 784-1990-1234567-1");
                return true;
            }
            $row = DB::row(
                "SELECT request_auto_id FROM mn_idl_request_user WHERE REPLACE(emirates_id,'-','') = ? LIMIT 1",
                [$eid],
            );
            if (!$row) {
                WhatsApp::text($phone, "❌ No IDL applications found for that Emirates ID.\n\nReply 0 to return to the main menu.");
                $session['flow'] = null; $session['step'] = null;
                SessionManager::save($phone, $session);
                return true;
            }
            $req = DB::row(
                "SELECT r.request_id, r.request_status, r.requested_datetime, r.idl_no,
                        r.paid_status, r.total_amount, r.delivery_option, r.air_bill_no,
                        s.status AS status_label, u.first_name, u.last_name
                 FROM mn_idl_requests r
                 LEFT JOIN mn_idl_status s ON s.status_id = r.request_status
                 LEFT JOIN mn_users u      ON u.user_id   = r.belonging_user_id
                 WHERE r.auto_id = ? AND r.is_active = 1",
                [$row['request_auto_id']],
            );
            if ($req) self::sendIDLDetails($phone, $req, $session);
            return true;
        }

        if ($step === 'list_select') {
            // User typed a number to select from a list
            $idx = (int)$input - 1;
            $ids = $session['data']['request_ids'] ?? [];
            if (isset($ids[$idx])) {
                $req = DB::getIDLByRequestId($ids[$idx]);
                if ($req) { self::sendIDLDetails($phone, $req, $session); return true; }
            }
            WhatsApp::text($phone, "Please enter a valid number from the list above, or reply 0 to go back.");
            return true;
        }

        return false;
    }

    private static function sendIDLList(string $phone, array $requests, array &$session, array $user): void
    {
        if (empty($requests)) {
            WhatsApp::text($phone, "❌ No IDL applications found for your account.\n\nReply 0 to return to the main menu.");
            $session['flow'] = null;
            SessionManager::save($phone, $session);
            return;
        }
        if (count($requests) === 1) {
            self::sendIDLDetails($phone, DB::getIDLByRequestId($requests[0]['request_id']), $session);
            return;
        }
        $lines = "📋 *Your IDL Applications*, {$user['first_name']}:\n\n";
        $ids   = [];
        foreach ($requests as $i => $r) {
            $lines .= ($i + 1) . ". *{$r['request_id']}*\n";
            $lines .= "   Status: {$r['status_label']}\n";
            $lines .= "   Date: " . date('d M Y', strtotime($r['requested_datetime'])) . "\n\n";
            $ids[] = $r['request_id'];
        }
        $lines .= "Reply with a number (1-" . count($requests) . ") to see details, or 0 to go back.";
        $session['step']              = 'list_select';
        $session['data']['request_ids'] = $ids;
        SessionManager::save($phone, $session);
        WhatsApp::text($phone, $lines);
    }

    private static function sendIDLDetails(string $phone, ?array $req, array &$session): void
    {
        if (!$req) {
            WhatsApp::text($phone, "❌ Application not found. Reply 0 to go back.");
            return;
        }
        $paid     = $req['paid_status'] == 1 ? '✅ Paid' : '⏳ Pending Payment';
        $idlNo    = $req['idl_no'] ? "\n🔢 *IDL No:* {$req['idl_no']}" : '';
        $tracking = '';
        if (!empty($req['air_bill_no'])) {
            $tracking = "\n📦 *Courier Tracking:*\nhttps://www.aramex.com/ae/en/track/results?source=aramex&ShipmentNumber=" . urlencode($req['air_bill_no']);
        }
        $msg = "🪪 *IDL Application Details*\n\n"
             . "📋 *Ref:* {$req['request_id']}{$idlNo}\n"
             . "👤 *Applicant:* {$req['first_name']} {$req['last_name']}\n"
             . "📊 *Status:* {$req['status_label']}\n"
             . "💳 *Payment:* {$paid}\n"
             . "💰 *Amount:* AED " . number_format($req['total_amount'], 2) . "\n"
             . "📅 *Applied:* " . date('d M Y', strtotime($req['requested_datetime']))
             . $tracking;

        $session['flow'] = null; $session['step'] = null;
        SessionManager::save($phone, $session);

        WhatsApp::buttons($phone, $msg,
            [
                ['id' => 'support',     'title' => '🎧 Raise a Ticket'],
                ['id' => 'idl_status',  'title' => '🔍 Another IDL'],
                ['id' => 'menu',        'title' => '🏠 Main Menu'],
            ],
        );
    }
}

// ── CPD Status Flow ───────────────────────────────────────────────────────────

class CPDStatusFlow
{
    public static function handle(string $phone, array &$session, string $input): bool
    {
        $step = $session['step'] ?? 'start';

        if ($step === 'start') {
            $session['step'] = 'ask_ref';
            SessionManager::save($phone, $session);
            WhatsApp::text(
                $phone,
                "🚗 *CPD Application Status*\n\nPlease enter your *CPD Request ID* (e.g. CPD-ATC-20250501/123) to check your Carnet de Passage status.\n\n_Reply 0 to go back_",
            );
            return true;
        }

        if ($step === 'ask_ref') {
            $query = strtoupper(trim($input));
            $req   = DB::getCPDByRequestId($query);
            if (!$req) {
                WhatsApp::text($phone, "❌ No CPD application found for *{$query}*.\n\nPlease check the reference and try again, or reply 0 to go back.");
                return true;
            }

            $msg = "🚗 *CPD Application Details*\n\n"
                 . "📋 *Ref:* {$req['request_id']}\n"
                 . "👤 *Applicant:* {$req['first_name']} {$req['last_name']}\n"
                 . "🚙 *Vehicle:* {$req['vehicle_make']} {$req['vehicle_model']}\n"
                 . "📊 *Status:* {$req['status_label']}\n"
                 . "💰 *Amount:* AED " . number_format($req['total_amount'], 2) . "\n"
                 . "💳 *Payment:* " . ucfirst(strtolower($req['method_of_payment'])) . "\n"
                 . "📅 *Applied:* " . date('d M Y', strtotime($req['requested_datetime']));

            $session['flow'] = null; $session['step'] = null;
            SessionManager::save($phone, $session);

            WhatsApp::buttons($phone, $msg,
                [
                    ['id' => 'support',     'title' => '🎧 Raise a Ticket'],
                    ['id' => 'cpd_status',  'title' => '🔍 Another CPD'],
                    ['id' => 'menu',        'title' => '🏠 Main Menu'],
                ],
            );
            return true;
        }

        return false;
    }
}

// ── Support Ticket Flow ───────────────────────────────────────────────────────

class SupportFlow
{
    public static function handle(string $phone, array &$session, string $input): bool
    {
        $step = $session['step'] ?? 'start';

        if ($step === 'start') {
            $session['step'] = 'ask_category';
            SessionManager::save($phone, $session);
            WhatsApp::buttons(
                $phone,
                "🎧 *Support Ticket*\n\nWhat is your enquiry related to?",
                [
                    ['id' => 'cat_idl', 'title' => '🪪 IDL'],
                    ['id' => 'cat_cpd', 'title' => '🚗 CPD'],
                    ['id' => 'cat_gen', 'title' => '❓ General'],
                ],
            );
            return true;
        }

        if ($step === 'ask_category') {
            $cat = match(strtolower($input)) {
                'cat_idl', 'idl', '1' => 'IDL',
                'cat_cpd', 'cpd', '2' => 'CPD',
                default               => 'IDL',
            };
            $session['data']['category'] = $cat;
            $session['step']             = 'ask_subject';
            SessionManager::save($phone, $session);
            WhatsApp::text($phone, "Please type a brief *subject* for your enquiry (e.g. \"Payment not processed for IDL-ATC-2025/123\"):");
            return true;
        }

        if ($step === 'ask_subject') {
            if (strlen(trim($input)) < 5) {
                WhatsApp::text($phone, "Please enter a slightly more descriptive subject (at least 5 characters).");
                return true;
            }
            $session['data']['subject'] = trim($input);
            $session['step']            = 'ask_description';
            SessionManager::save($phone, $session);
            WhatsApp::text($phone, "Please describe your issue in detail. Include any reference numbers if applicable:");
            return true;
        }

        if ($step === 'ask_description') {
            $session['data']['description'] = trim($input);
            $session['step']                = 'ask_email';
            SessionManager::save($phone, $session);
            WhatsApp::text($phone, "Please provide your *email address* so we can follow up with you:");
            return true;
        }

        if ($step === 'ask_email') {
            if (!filter_var(trim($input), FILTER_VALIDATE_EMAIL)) {
                WhatsApp::text($phone, "❌ That doesn't look like a valid email address. Please try again (e.g. name@email.com):");
                return true;
            }
            $session['data']['email'] = trim($input);
            $session['step']          = 'confirm';
            SessionManager::save($phone, $session);

            $d = $session['data'];
            WhatsApp::buttons(
                $phone,
                "📋 *Please confirm your ticket details:*\n\n"
                . "📁 *Category:* {$d['category']}\n"
                . "📌 *Subject:* {$d['subject']}\n"
                . "📝 *Description:* " . mb_substr($d['description'], 0, 100) . (strlen($d['description']) > 100 ? '...' : '') . "\n"
                . "📧 *Email:* {$d['email']}\n"
                . "📱 *Phone:* {$phone}",
                [
                    ['id' => 'confirm_yes', 'title' => '✅ Submit'],
                    ['id' => 'confirm_no',  'title' => '❌ Cancel'],
                ],
            );
            return true;
        }

        if ($step === 'confirm') {
            if (in_array(strtolower($input), ['confirm_yes', 'yes', 'submit', '1'])) {
                $d = $session['data'];
                try {
                    $ticketNo = DB::createSupportTicket([
                        'subject'     => $d['subject'],
                        'description' => $d['description'],
                        'category'    => $d['category'],
                        'phone'       => $phone,
                        'email'       => $d['email'],
                    ]);
                    $session['flow'] = null; $session['step'] = null; $session['data'] = [];
                    SessionManager::save($phone, $session);
                    WhatsApp::buttons(
                        $phone,
                        "✅ *Ticket Submitted!*\n\n"
                        . "🎫 *Ticket No:* {$ticketNo}\n\n"
                        . "Our team will contact you at {$d['email']} within 24 hours.\n\n"
                        . "Thank you for contacting ATC UAE! 🙏",
                        [
                            ['id' => 'menu', 'title' => '🏠 Main Menu'],
                        ],
                    );
                } catch (\Throwable $e) {
                    Logger::error("Ticket creation failed: " . $e->getMessage());
                    WhatsApp::text($phone, "❌ Sorry, we couldn't submit your ticket right now. Please call 800-ATC or try again later.");
                }
            } else {
                $session['flow'] = null; $session['step'] = null; $session['data'] = [];
                SessionManager::save($phone, $session);
                WhatsApp::text($phone, "Ticket cancelled. Reply *menu* to start over. 👋");
            }
            return true;
        }

        return false;
    }
}

// ── Contact Flow ──────────────────────────────────────────────────────────────

class ContactFlow
{
    public static function handle(string $phone, array &$session, string $input): bool
    {
        WhatsApp::text(
            $phone,
            "📞 *ATC UAE Contact Information*\n\n"
            . "📱 *Hotline:* 800-ATC (800-282)\n"
            . "📧 *Email:* info@atcuae.com\n"
            . "🌐 *Website:* www.atcuae.com\n"
            . "🕘 *Working Hours:* Sun–Thu, 8:00 AM – 5:00 PM\n\n"
            . "Reply *menu* to return to the main menu.",
        );
        $session['flow'] = null; $session['step'] = null;
        SessionManager::save($phone, $session);
        return true;
    }
}
