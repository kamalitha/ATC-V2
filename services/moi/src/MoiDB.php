<?php
declare(strict_types=1);

// ── MOI Database — Completely isolated PDO instance ───────────────────────────
// Uses its own connection constants. Never touches the v3 portal Database class.

final class MoiDB
{
    private static ?PDO $pdo = null;

    private static function connect(): PDO
    {
        if (self::$pdo === null) {
            $dsn = sprintf(
                'mysql:host=%s;dbname=%s;charset=%s',
                MOI_DB_HOST, MOI_DB_NAME, MOI_DB_CHARSET,
            );
            self::$pdo = new PDO($dsn, MOI_DB_USER, MOI_DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Every response DTO property is typed `string` (see MoiDTOs.php) under
                // strict_types=1, so a native-typed int/float column (e.g. place_of_issue,
                // nationality, emirate) fetched straight from PDO is a fatal TypeError on
                // assignment, not a coercion. STRINGIFY_FETCHES forces PDO to hand back
                // strings for every column value regardless of the native column type.
                PDO::ATTR_EMULATE_PREPARES   => true,
                PDO::ATTR_STRINGIFY_FETCHES  => true,
            ]);
        }
        return self::$pdo;
    }

    public static function row(string $sql, array $binds = []): ?array
    {
        $st = self::connect()->prepare($sql);
        $st->execute($binds);
        return $st->fetch() ?: null;
    }

    public static function all(string $sql, array $binds = []): array
    {
        $st = self::connect()->prepare($sql);
        $st->execute($binds);
        return $st->fetchAll();
    }

    public static function execute(string $sql, array $binds = []): int
    {
        $st = self::connect()->prepare($sql);
        $st->execute($binds);
        return $st->rowCount();
    }

    public static function insert(string $sql, array $binds = []): string
    {
        $st = self::connect()->prepare($sql);
        $st->execute($binds);
        return self::connect()->lastInsertId();
    }

    public static function scalar(string $sql, array $binds = []): mixed
    {
        $st = self::connect()->prepare($sql);
        $st->execute($binds);
        return $st->fetchColumn();
    }

    public static function beginTransaction(): void { self::connect()->beginTransaction(); }
    public static function commit(): void           { self::connect()->commit(); }
    public static function rollback(): void         { self::connect()->rollBack(); }
}
