<?php
declare(strict_types=1);

/**
 * Simple APCu-based rate limiter.
 * Falls back to session if APCu is unavailable (dev environments).
 */
class RateLimit
{
    /**
     * Check rate limit. Aborts with 429 if exceeded.
     *
     * @param string $key      Unique key (e.g. 'login:127.0.0.1')
     * @param int    $maxHits  Max allowed hits in the window
     * @param int    $window   Window in seconds
     */
    public static function check(string $key, int $maxHits = 10, int $window = 60): void
    {
        if (function_exists('apcu_fetch')) {
            $hits = (int)(apcu_fetch($key) ?: 0);
            if ($hits === 0) apcu_store($key, 1, $window);
            else apcu_inc($key);

            if ($hits >= $maxHits) {
                http_response_code(429);
                echo json_encode(['success' => false, 'message' => 'Too many requests. Please wait.']);
                exit;
            }
        } else {
            // Session fallback for dev — not suitable for production
            $entry = $_SESSION['rl'][$key] ?? null;
            $now   = time();

            if ($entry === null || $now > $entry['reset']) {
                $_SESSION['rl'][$key] = ['hits' => 1, 'reset' => $now + $window];
            } else {
                $_SESSION['rl'][$key]['hits']++;
            }

            if ($_SESSION['rl'][$key]['hits'] > $maxHits) {
                http_response_code(429);
                echo json_encode(['success' => false, 'message' => 'Too many requests. Please wait.']);
                exit;
            }
        }
    }

    public static function loginKey(): string
    {
        $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        return 'login:' . hash('xxh3', $ip);
    }

    public static function apiKey(): string
    {
        $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        return 'api:' . hash('xxh3', $ip);
    }
}
