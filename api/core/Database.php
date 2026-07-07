<?php
declare(strict_types=1);

class Database
{
    private static ?Database $instance = null;
    private readonly \PDO $pdo;

    private function __construct()
    {
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s',
            Config::DB_HOST,
            Config::DB_NAME,
        );

        $this->pdo = new \PDO($dsn, Config::DB_USER, Config::DB_PASS, [
            \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES   => false,
            \PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'",
        ]);
    }

    public static function getInstance(): static
    {
        return static::$instance ??= new static();
    }

    /** Execute a SELECT and return all rows */
    public function query(string $sql, array $params = []): array
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** Execute a SELECT and return a single row or null */
    public function queryOne(string $sql, array $params = []): ?array
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    /** Execute INSERT / UPDATE / DELETE and return affected rows */
    public function execute(string $sql, array $params = []): int
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }

    /** Execute INSERT and return the new auto-increment ID */
    public function insert(string $sql, array $params = []): int
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return (int) $this->pdo->lastInsertId();
    }

    /** Execute a scalar query (COUNT, SUM …) */
    public function scalar(string $sql, array $params = []): int|float|string|null
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $val = $stmt->fetchColumn();
        return $val !== false ? $val : null;
    }

    public function beginTransaction(): void  { $this->pdo->beginTransaction(); }
    public function commit(): void            { $this->pdo->commit(); }
    public function rollback(): void          { $this->pdo->rollBack(); }

    /**
     * Safely build a paginated query.
     * Accepts an optional $countSql for a fast COUNT query instead of
     * wrapping the full JOIN query in a subquery.
     * Returns ['data' => [...], 'total' => N, 'page' => N, 'per_page' => N, 'pages' => N]
     */
    public function paginate(
        string  $sql,
        array   $params      = [],
        int     $page        = 1,
        int     $perPage     = 20,
        ?string $countSql    = null,
        array   $countParams = [],
    ): array {
        $page    = max(1, $page);
        $perPage = min(10000, max(1, $perPage));
        $offset  = ($page - 1) * $perPage;

        // Use dedicated count query when provided, otherwise fall back to wrapping
        if ($countSql !== null) {
            $total = (int) $this->scalar($countSql, $countParams ?: $params);
        } else {
            $total = (int) $this->scalar("SELECT COUNT(*) FROM ({$sql}) AS _count_wrap", $params);
        }

        $data = $this->query("{$sql} LIMIT ? OFFSET ?", [...$params, $perPage, $offset]);

        return [
            'data'     => $data,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
            'pages'    => (int) ceil($total / $perPage),
        ];
    }
}
