<?php
declare(strict_types=1);

class Auth
{
    private static ?Database $db = null;

    /** Role name → user_type integer (matches mn_users.user_type) */
    public const ROLE_MAP = [
        'public'          => 2,
        'finance'         => 3,
        'tir'             => 4,
        'esma_inspector'  => 5,
        'esma_operator'   => 6,
        'esma_senior'     => 7,
        'idl_officer'     => 8,
        'admin'           => 14,
        'cpd_officer'     => 11,
        'cpd_finance'     => 12,
        'cpd_branch'      => 13,
        'cpd_cheque'      => 15,
        'management'      => 16,
        'idl_distributor' => 17,
        'idl_branch_mgr'  => 18,
        'idl_branch_staff'=> 19,
        'cpd_super_user'  => 20,
        'idl_cpd_online'  => 22,
        'idl_cpd_walkin'  => 23,
        'idl_cpd_branch'  => 24,
        'idl_cpd_cashier' => 25,
    ];

    /** Roles allowed to access each module */
    public const MODULE_ACCESS = [
        'idl'    => [8, 14, 20, 22, 23, 24, 25, 17, 18, 19],
        'cpd'    => [11, 12, 13, 14, 15, 20, 22, 23, 24, 25],
        'users'  => [14],
        'reports'=> [3, 9, 12, 14, 16],
        'public' => [2],
    ];

    public static function init(): void
    {
        static::$db = Database::getInstance();
    }

    public static function attempt(string $username, string $password): ?array
    {
        $user = static::$db->queryOne(
            'SELECT user_id, first_name, last_name, email, username, password,
                    user_type, is_active, address, mobile_no
             FROM mn_users
             WHERE (username = ? OR email = ?)
             LIMIT 1',
            [$username, $username],
        );

        if ($user === null || !(bool)$user['is_active']) {
            return null;
        }

        $matched = false;

        // Try modern bcrypt first
        if (password_verify($password, $user['password'])) {
            $matched = true;
        } else {
            // Legacy SHA-256(whirlpool) fallback — auto-upgrade on success
            $legacy = hash('sha256', substr(hash('whirlpool', $password), 3, -3));
            if (hash_equals($legacy, $user['password'])) {
                $matched = true;
                static::$db->execute(
                    'UPDATE mn_users SET password = ? WHERE user_id = ?',
                    [static::hashPassword($password), $user['user_id']],
                );
            }
        }

        if (!$matched) return null;

        $csrf = bin2hex(random_bytes(32));
        $_SESSION['user_id']    = (int) $user['user_id'];
        $_SESSION['role']       = (int) $user['user_type'];
        $_SESSION['csrf_token'] = $csrf;
        session_regenerate_id(true);

        return [
            'user_id'    => (int) $user['user_id'],
            'first_name' => $user['first_name'],
            'last_name'  => $user['last_name'],
            'email'      => $user['email'],
            'role_id'    => (int) $user['user_type'],
            'role_name'  => static::roleNameFor((int) $user['user_type']),
            'csrf_token' => $csrf,
            'modules'    => static::accessibleModules((int) $user['user_type']),
        ];
    }

    public static function check(): bool
    {
        return isset($_SESSION['user_id']);
    }

    public static function user(): ?array
    {
        if (!static::check()) return null;
        $u = static::$db->queryOne(
            'SELECT user_id, first_name, last_name, email, username,
                    user_type, is_active, date_created, last_logged_in, address, mobile_no
             FROM mn_users WHERE user_id = ?',
            [static::id()],
        );
        if ($u === null) return null;
        $u['role_name'] = static::roleName();
        $u['modules']   = static::accessibleModules((int) $u['user_type']);
        unset($u['password']);
        return $u;
    }

    public static function id(): ?int
    {
        return isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;
    }

    public static function roleId(): ?int
    {
        return isset($_SESSION['role']) ? (int)$_SESSION['role'] : null;
    }

    public static function roleName(): ?string
    {
        return static::roleNameFor(static::roleId());
    }

    public static function roleNameFor(?int $id): ?string
    {
        if ($id === null) return null;
        return array_search($id, static::ROLE_MAP) ?: "role_{$id}";
    }

    public static function hasRole(array|string $roles): bool
    {
        $current = static::roleName();
        return $current !== null && in_array($current, (array)$roles, true);
    }

    public static function can(string $module): bool
    {
        $roleId = static::roleId();
        return $roleId !== null &&
               in_array($roleId, static::MODULE_ACCESS[$module] ?? [], true);
    }

    public static function accessibleModules(int $roleId): array
    {
        $modules = [];
        foreach (static::MODULE_ACCESS as $module => $roles) {
            if (in_array($roleId, $roles, true)) $modules[] = $module;
        }
        return $modules;
    }

    public static function requireCsrf(): void
    {
        // Accept token from header (JSON requests) or form field (multipart uploads)
        $token = $_SERVER['HTTP_X_CSRF_TOKEN']
              ?? $_POST['_csrf_token']
              ?? '';
        if (empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $token)) {
            Response::forbidden('Invalid CSRF token');
        }
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    }
}
