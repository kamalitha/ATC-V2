<?php
declare(strict_types=1);

final class MoiLogger
{
    private static function write(string $level, string $msg): void
    {
        if (!is_dir(MOI_LOG_DIR)) mkdir(MOI_LOG_DIR, 0755, true);
        $line = sprintf("[%s] [%s] %s\n", date('Y-m-d H:i:s'), strtoupper($level), $msg);
        file_put_contents(MOI_LOG_DIR . '/' . date('Y-m-d') . '.log', $line, FILE_APPEND);
    }

    public static function info(string $msg): void    { self::write('info',  $msg); }
    public static function error(string $msg): void   { self::write('error', $msg); }
    public static function auth(string $msg): void    { self::write('auth',  $msg); }
    public static function request(string $msg): void { self::write('request', $msg); }
}
