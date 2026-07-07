<?php
// ── Logger ────────────────────────────────────────────────────────────────────

class Logger
{
    private static function write(string $level, string $msg): void
    {
        $line = sprintf("[%s] [%s] %s\n", date('Y-m-d H:i:s'), strtoupper($level), $msg);
        file_put_contents(LOG_DIR . '/' . date('Y-m-d') . '.log', $line, FILE_APPEND);
    }

    public static function info(string $msg): void  { self::write('info',  $msg); }
    public static function error(string $msg): void { self::write('error', $msg); }
}
