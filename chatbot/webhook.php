<?php
// ── ATC WhatsApp Chatbot — Webhook Entry Point ────────────────────────────────
// Deploy this file at a public HTTPS URL, e.g. https://yourdomain.com/whatsapp/webhook.php
// Configure this URL in Meta App Dashboard → WhatsApp → Configuration → Webhook

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/src/Logger.php';
require_once __DIR__ . '/src/WhatsApp.php';
require_once __DIR__ . '/src/SessionManager.php';
require_once __DIR__ . '/src/DB.php';
require_once __DIR__ . '/src/Workflows.php';

// ── Ensure directories exist ──────────────────────────────────────────────────
foreach ([SESSION_DIR, LOG_DIR] as $dir) {
    if (!is_dir($dir)) mkdir($dir, 0755, true);
}

// ── Webhook Verification (GET) ────────────────────────────────────────────────
// Meta sends a GET request to verify your webhook endpoint
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $mode      = $_GET['hub_mode']          ?? $_GET['hub.mode']          ?? '';
    $token     = $_GET['hub_verify_token']  ?? $_GET['hub.verify_token']  ?? '';
    $challenge = $_GET['hub_challenge']     ?? $_GET['hub.challenge']     ?? '';

    if ($mode === 'subscribe' && $token === WA_VERIFY_TOKEN) {
        Logger::info("Webhook verified successfully");
        http_response_code(200);
        echo $challenge;
    } else {
        Logger::error("Webhook verification failed — token mismatch");
        http_response_code(403);
        echo 'Forbidden';
    }
    exit;
}

// ── Incoming Webhook Events (POST) ────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $rawBody = file_get_contents('php://input');
    $payload = json_decode($rawBody, true);

    // Respond 200 immediately — Meta requires a fast response
    http_response_code(200);
    echo 'OK';

    // Flush output so Meta doesn't wait for processing
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    elseif (ob_get_level()) { ob_flush(); flush(); }

    if (empty($payload['entry'])) exit;

    Logger::info("Webhook received: " . $rawBody);

    foreach ($payload['entry'] as $entry) {
        foreach ($entry['changes'] ?? [] as $change) {
            if (($change['field'] ?? '') !== 'messages') continue;

            $value    = $change['value'] ?? [];
            $messages = $value['messages'] ?? [];

            foreach ($messages as $message) {
                $phone     = $message['from']  ?? '';
                $messageId = $message['id']    ?? '';
                $type      = $message['type']  ?? '';

                if (!$phone) continue;

                // Extract text from different message types
                $input = match($type) {
                    'text'        => $message['text']['body']                  ?? '',
                    'interactive' => $message['interactive']['button_reply']['id']
                                  ?? $message['interactive']['list_reply']['id']
                                  ?? '',
                    'button'      => $message['button']['payload']             ?? '',
                    default       => '',
                };

                if ($input === '' && $type !== 'text') {
                    // Unsupported message type
                    WhatsApp::markRead($messageId);
                    WhatsApp::text($phone, "Sorry, I can only process text and button replies. Please type *menu* to see your options. 😊");
                    continue;
                }

                Logger::info("Message from {$phone}: [{$type}] {$input}");

                $session = SessionManager::get($phone);
                Router::route($phone, $session, $input, $messageId);
            }

            // Log delivery status updates but don't act on them
            foreach ($value['statuses'] ?? [] as $status) {
                Logger::info("Delivery status: {$status['id']} → {$status['status']}");
            }
        }
    }
    exit;
}

http_response_code(405);
echo 'Method Not Allowed';
