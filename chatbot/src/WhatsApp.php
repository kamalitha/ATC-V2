<?php
// ── WhatsApp Cloud API — Message Sender ──────────────────────────────────────

class WhatsApp
{
    private static function post(array $payload): array
    {
        $url = WA_API_BASE . '/' . WA_PHONE_NUMBER_ID . '/messages';
        $ch  = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . WA_ACCESS_TOKEN,
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS     => json_encode($payload),
            CURLOPT_TIMEOUT        => 10,
            // SSL — set CURLOPT_CAINFO to your cacert.pem path in production
            // For local WAMP development only:
            CURLOPT_SSL_VERIFYPEER => defined('WA_DEV_MODE') && WA_DEV_MODE ? false : true,
            CURLOPT_SSL_VERIFYHOST => defined('WA_DEV_MODE') && WA_DEV_MODE ? 0 : 2,
        ]);
        $body  = curl_exec($ch);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            Logger::error("cURL error: $error");
            return ['error' => $error];
        }

        $decoded = json_decode($body, true) ?? [];
        if (!empty($decoded['error'])) {
            Logger::error("API error: " . json_encode($decoded['error']));
        }
        return $decoded;
    }

    // Mark a message as read (shows blue ticks)
    public static function markRead(string $messageId): void
    {
        self::post([
            'messaging_product' => 'whatsapp',
            'status'            => 'read',
            'message_id'        => $messageId,
        ]);
    }

    // Send plain text
    public static function text(string $to, string $body): array
    {
        return self::post([
            'messaging_product' => 'whatsapp',
            'recipient_type'    => 'individual',
            'to'                => $to,
            'type'              => 'text',
            'text'              => ['body' => $body],
        ]);
    }

    // Send interactive button message (max 3 buttons)
    public static function buttons(string $to, string $body, array $buttons, string $header = '', string $footer = ''): array
    {
        $payload = [
            'messaging_product' => 'whatsapp',
            'recipient_type'    => 'individual',
            'to'                => $to,
            'type'              => 'interactive',
            'interactive'       => [
                'type' => 'button',
                'body' => ['text' => $body],
                'action' => [
                    'buttons' => array_map(fn($b) => [
                        'type'  => 'reply',
                        'reply' => ['id' => $b['id'], 'title' => mb_substr($b['title'], 0, 20)],
                    ], array_slice($buttons, 0, 3)),
                ],
            ],
        ];
        if ($header) $payload['interactive']['header'] = ['type' => 'text', 'text' => $header];
        if ($footer) $payload['interactive']['footer'] = ['text' => $footer];
        return self::post($payload);
    }

    // Send interactive list menu (up to 10 items)
    public static function list(string $to, string $body, string $buttonLabel, array $sections, string $footer = ''): array
    {
        $payload = [
            'messaging_product' => 'whatsapp',
            'recipient_type'    => 'individual',
            'to'                => $to,
            'type'              => 'interactive',
            'interactive'       => [
                'type' => 'list',
                'body' => ['text' => $body],
                'action' => [
                    'button'   => mb_substr($buttonLabel, 0, 20),
                    'sections' => $sections,
                ],
            ],
        ];
        if ($footer) $payload['interactive']['footer'] = ['text' => $footer];
        return self::post($payload);
    }

    // Send a pre-approved template message
    public static function template(string $to, string $templateName, string $lang = 'en_US', array $components = []): array
    {
        $payload = [
            'messaging_product' => 'whatsapp',
            'to'                => $to,
            'type'              => 'template',
            'template'          => [
                'name'       => $templateName,
                'language'   => ['code' => $lang],
                'components' => $components,
            ],
        ];
        return self::post($payload);
    }
}
