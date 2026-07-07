<?php
declare(strict_types=1);

class Logger
{
    private static string $dir = '';

    private static function logDir(): string
    {
        if (self::$dir === '') {
            self::$dir = API_ROOT . DIRECTORY_SEPARATOR . 'logs';
            if (!is_dir(self::$dir)) {
                mkdir(self::$dir, 0755, true);
            }
        }
        return self::$dir;
    }

    private static function write(string $level, string $message, array $context = []): void
    {
        $file    = self::logDir() . DIRECTORY_SEPARATOR . date('Y-m-d') . '.log';
        $ts      = date('Y-m-d H:i:s');
        $userId  = isset($_SESSION['user_id']) ? 'user:' . $_SESSION['user_id'] : 'guest';
        $uri     = $_SERVER['REQUEST_URI'] ?? '—';
        $ctx     = $context ? ' | ' . json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '';
        $line    = "[{$ts}] [{$level}] [{$userId}] {$uri} — {$message}{$ctx}" . PHP_EOL;

        file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
    }

    public static function info(string $message, array $context = []): void
    {
        self::write('INFO', $message, $context);
    }

    public static function warning(string $message, array $context = []): void
    {
        self::write('WARNING', $message, $context);
    }

    public static function error(string $message, array $context = []): void
    {
        self::write('ERROR', $message, $context);
    }

    public static function exception(\Throwable $e, string $prefix = ''): void
    {
        $message = ($prefix ? $prefix . ': ' : '') . $e->getMessage();
        self::write('EXCEPTION', $message, [
            'class' => get_class($e),
            'file'  => $e->getFile() . ':' . $e->getLine(),
            'trace' => array_slice(
                array_map(fn($f) => ($f['file'] ?? '?') . ':' . ($f['line'] ?? '?') . ' ' . ($f['function'] ?? ''),
                $e->getTrace()), 0, 6
            ),
        ]);
    }
}
