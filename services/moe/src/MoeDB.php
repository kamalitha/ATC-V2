<?php
declare(strict_types=1);

// ── MOE Database — Completely isolated PDO instance ───────────────────────────
// Uses its own connection constants. Never touches the v3 portal Database class.

final class MoeDB
{
    private static ?PDO $pdo = null;

    private static function connect(): PDO
    {
        if (self::$pdo === null) {
            $dsn = sprintf(
                'mysql:host=%s;dbname=%s;charset=%s',
                MOE_DB_HOST, MOE_DB_NAME, MOE_DB_CHARSET,
            );
            self::$pdo = new PDO($dsn, MOE_DB_USER, MOE_DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Every response DTO property is typed `string` (see MoeDTOs.php) under
                // strict_types=1, so a native-typed int/float column fetched straight from
                // PDO is a fatal TypeError on assignment, not a coercion. STRINGIFY_FETCHES
                // forces PDO to hand back strings for every column value regardless of the
                // native column type.
                PDO::ATTR_EMULATE_PREPARES   => true,
                PDO::ATTR_STRINGIFY_FETCHES  => true,
            ]);
        }
        return self::$pdo;
    }

    public static function all(string $sql, array $binds = []): array
    {
        $st = self::connect()->prepare($sql);
        $st->execute($binds);
        return $st->fetchAll();
    }
}
