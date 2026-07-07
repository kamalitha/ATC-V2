<?php
// ── Session Manager — stores conversation state per phone number ──────────────

class SessionManager
{
    private static function path(string $phone): string
    {
        return SESSION_DIR . '/' . preg_replace('/[^0-9]/', '', $phone) . '.json';
    }

    public static function get(string $phone): array
    {
        $file = self::path($phone);
        if (!file_exists($file)) return self::fresh();

        $data = json_decode(file_get_contents($file), true) ?? [];

        // Expire stale sessions
        if ((time() - ($data['last_activity'] ?? 0)) > SESSION_TTL) {
            self::clear($phone);
            return self::fresh();
        }
        return $data;
    }

    public static function save(string $phone, array $session): void
    {
        $session['last_activity'] = time();
        file_put_contents(self::path($phone), json_encode($session, JSON_PRETTY_PRINT));
    }

    public static function clear(string $phone): void
    {
        $file = self::path($phone);
        if (file_exists($file)) unlink($file);
    }

    private static function fresh(): array
    {
        return [
            'flow'          => null,   // current workflow name
            'step'          => null,   // current step within the workflow
            'data'          => [],     // accumulated input data
            'last_activity' => time(),
        ];
    }
}
