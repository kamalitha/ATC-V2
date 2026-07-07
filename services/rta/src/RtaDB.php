<?php
declare(strict_types=1);

// ── RTA Database — Completely isolated PDO instance ───────────────────────────
// Uses its own connection constants. Never touches the v3 portal Database class.

final class RtaDB
{
    private static ?PDO $pdo = null;

    private static function connect(): PDO
    {
        if (self::$pdo === null) {
            $dsn = sprintf(
                'mysql:host=%s;dbname=%s;charset=%s',
                RTA_DB_HOST, RTA_DB_NAME, RTA_DB_CHARSET,
            );
            self::$pdo = new PDO($dsn, RTA_DB_USER, RTA_DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
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
