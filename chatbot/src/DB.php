<?php
// ── ATC Database Helper ───────────────────────────────────────────────────────

class DB
{
    private static ?PDO $pdo = null;

    private static function connect(): PDO
    {
        if (self::$pdo === null) {
            self::$pdo = new PDO(
                'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
                DB_USER, DB_PASS,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
            );
        }
        return self::$pdo;
    }

    public static function row(string $sql, array $binds = []): ?array
    {
        $st = self::connect()->prepare($sql);
        $st->execute($binds);
        $row = $st->fetch();
        return $row ?: null;
    }

    public static function query(string $sql, array $binds = []): array
    {
        $st = self::connect()->prepare($sql);
        $st->execute($binds);
        return $st->fetchAll();
    }

    // ── ATC-specific queries ──────────────────────────────────────────────────

    // Look up user by phone number
    public static function findUserByPhone(string $phone): ?array
    {
        // Normalise: strip country code variations
        $bare = preg_replace('/^\+?971/', '0', preg_replace('/\D/', '', $phone));
        return self::row(
            "SELECT user_id, first_name, last_name, email, mobile_no
             FROM mn_users
             WHERE REPLACE(REPLACE(mobile_no,' ',''),'-','') LIKE ?
               AND is_active = 1
             LIMIT 1",
            ['%' . substr($bare, -9)], // match last 9 digits
        );
    }

    // Get IDL requests for a user
    public static function getIDLRequests(int $userId): array
    {
        return self::query(
            "SELECT r.request_id, r.request_status, r.requested_datetime,
                    r.idl_no, r.paid_status, r.total_amount,
                    s.status AS status_label
             FROM mn_idl_requests r
             LEFT JOIN mn_idl_status s ON s.status_id = r.request_status
             WHERE r.belonging_user_id = ? AND r.is_active = 1
             ORDER BY r.auto_id DESC LIMIT 5",
            [$userId],
        );
    }

    // Get a single IDL request by request_id string
    public static function getIDLByRequestId(string $requestId): ?array
    {
        return self::row(
            "SELECT r.request_id, r.request_status, r.requested_datetime,
                    r.idl_no, r.paid_status, r.total_amount, r.delivery_option,
                    r.air_bill_no,
                    s.status AS status_label,
                    u.first_name, u.last_name
             FROM mn_idl_requests r
             LEFT JOIN mn_idl_status s ON s.status_id = r.request_status
             LEFT JOIN mn_users u      ON u.user_id   = r.belonging_user_id
             WHERE r.request_id = ? AND r.is_active = 1",
            [$requestId],
        );
    }

    // Get CPD requests for a user
    public static function getCPDRequests(int $userId): array
    {
        return self::query(
            "SELECT r.request_id, r.request_status, r.requested_datetime,
                    r.vehicle_make, r.vehicle_model, r.total_amount,
                    COALESCE(s.status, r.request_status) AS status_label
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_statuses s ON s.carnet_status_id = r.request_status
             WHERE r.belonging_user_id = ?
             ORDER BY r.auto_id DESC LIMIT 5",
            [$userId],
        );
    }

    // Get a CPD request by request_id
    public static function getCPDByRequestId(string $requestId): ?array
    {
        return self::row(
            "SELECT r.request_id, r.request_status, r.vehicle_make, r.vehicle_model,
                    r.total_amount, r.method_of_payment, r.requested_datetime,
                    COALESCE(s.status, r.request_status) AS status_label,
                    u.first_name, u.last_name
             FROM mn_cpd_requests r
             LEFT JOIN mn_cpd_statuses s ON s.carnet_status_id = r.request_status
             LEFT JOIN mn_users u        ON u.user_id          = r.belonging_user_id
             WHERE r.request_id = ?",
            [$requestId],
        );
    }

    // Create a support ticket from WhatsApp
    public static function createSupportTicket(array $data): string
    {
        $pdo = self::connect();
        $pdo->prepare(
            "INSERT INTO mn_support_tickets
             (ticket_no, subject, description, category, ticket_type, priority,
              status, customer_phone, customer_email, channel, created_at, updated_at)
             VALUES ('PENDING', ?, ?, ?, 'GENERAL_INQUIRY', 'MEDIUM', 'OPEN', ?, ?, 'WhatsApp', NOW(), NOW())"
        )->execute([
            $data['subject'],
            $data['description'],
            $data['category'] ?? 'IDL',
            $data['phone'],
            $data['email'] ?? '',
        ]);
        $id = $pdo->lastInsertId();
        $ticketNo = 'TKT-' . date('Ymd') . '/' . $id;
        $pdo->prepare("UPDATE mn_support_tickets SET ticket_no=? WHERE ticket_id=?")
            ->execute([$ticketNo, $id]);
        return $ticketNo;
    }
}
