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

        // password is nullable — a UAE-PASS-only account (no local password ever set)
        // must not reach password_verify(), which deprecation-warns on a null hash arg
        // in PHP 8.1 and can never match anyway.
        if ($user === null || !(bool)$user['is_active'] || $user['password'] === null) {
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

        return static::establishSession((int) $user['user_id'], viaUaePass: false);
    }

    /**
     * UAE PASS login — matches (or provisions) an mn_users row from a verified
     * UAE PASS userinfo payload, then establishes a session identically to attempt().
     * @param array<string,mixed> $userInfo raw response from UaePassClient::getUserInfo()
     */
    public static function attemptViaUaePass(array $userInfo): array
    {
        $uuid        = (string)($userInfo['uuid'] ?? $userInfo['sub'] ?? '');
        $emiratesId  = (string)($userInfo['idn'] ?? '');
        $mobile      = (string)($userInfo['mobile'] ?? '');
        // SOP1 accounts (basic verification) don't carry an Emirates ID, and none of the
        // SOP levels return a date of birth — only gender/nationality are always present.
        $sex         = (string)($userInfo['gender'] ?? '');
        $nationality = static::nationalityIdFor((string)($userInfo['nationalityEN'] ?? ''));

        $user = static::$db->queryOne(
            'SELECT user_id, first_name, last_name, email, username, user_type, is_active
             FROM mn_users WHERE uaepass_uuid = ? LIMIT 1',
            [$uuid],
        );

        if ($user === null && $emiratesId !== '') {
            // First UAE PASS login for an account that previously registered the normal
            // way — match by Emirates ID and link the UUID for next time.
            $user = static::$db->queryOne(
                'SELECT user_id, first_name, last_name, email, username, user_type, is_active
                 FROM mn_users WHERE emirates_id = ? LIMIT 1',
                [$emiratesId],
            );
            if ($user !== null) {
                static::$db->execute('UPDATE mn_users SET uaepass_uuid = ? WHERE user_id = ?', [$uuid, $user['user_id']]);
            }
        }

        if ($user === null) {
            $email = (string)($userInfo['email'] ?? '');
            $userId = static::$db->insert(
                'INSERT INTO mn_users
                 (first_name, last_name, email, emirates_id, mobile_no, nationality, sex, username, password, user_type, is_active, date_created, uaepass_uuid)
                 VALUES (?,?,?,?,?,?,?,?,NULL,?,1,CURDATE(),?)',
                [
                    (string)($userInfo['firstnameEN'] ?? ''),
                    (string)($userInfo['lastnameEN'] ?? ''),
                    $email,
                    $emiratesId,
                    $mobile,
                    $nationality,
                    $sex !== '' ? $sex : null,
                    $email !== '' ? $email : $uuid,
                    static::ROLE_MAP['public'],
                    $uuid,
                ],
            );
            $user = [
                'user_id'    => $userId,
                'first_name' => $userInfo['firstnameEN'] ?? '',
                'last_name'  => $userInfo['lastnameEN'] ?? '',
                'email'      => $email,
                'user_type'  => static::ROLE_MAP['public'],
                'is_active'  => 1,
            ];
        } else {
            // Backfill anything UAE PASS knows that the stored profile is still missing —
            // never overwrite a value the customer or an officer already filled in/corrected.
            static::$db->execute(
                'UPDATE mn_users SET
                    mobile_no   = COALESCE(NULLIF(mobile_no, \'\'), ?),
                    emirates_id = COALESCE(NULLIF(emirates_id, \'\'), ?),
                    nationality = COALESCE(nationality, ?),
                    sex         = COALESCE(NULLIF(sex, \'\'), ?)
                 WHERE user_id = ?',
                [$mobile, $emiratesId, $nationality, $sex !== '' ? $sex : null, $user['user_id']],
            );
        }

        if (!(bool)$user['is_active']) return null;

        return static::establishSession((int) $user['user_id'], viaUaePass: true);
    }

    /** Maps UAE PASS's ISO-3 `nationalityEN` (e.g. "LKA") to mn_nationalities.nationality_id. */
    private static function nationalityIdFor(string $isoCode): ?int
    {
        if ($isoCode === '') return null;
        $row = static::$db->queryOne(
            'SELECT nationality_id FROM mn_nationalities WHERE emirates_id_code = ? LIMIT 1',
            [$isoCode],
        );
        return $row !== null ? (int)$row['nationality_id'] : null;
    }

    private static function establishSession(int $userId, bool $viaUaePass): array
    {
        // Re-fetch fresh from the DB rather than trusting the caller's array — picks up
        // any profile fields (mobile/emirates_id/nationality/sex) a UAE PASS backfill
        // UPDATE or new-account INSERT just wrote, without duplicating that shape here.
        $user = static::$db->queryOne(
            'SELECT user_id, first_name, last_name, email, emirates_id, mobile_no,
                    nationality, sex, dob, user_type
             FROM mn_users WHERE user_id = ?',
            [$userId],
        );

        $csrf = bin2hex(random_bytes(32));
        $_SESSION['user_id']      = (int) $user['user_id'];
        $_SESSION['role']         = (int) $user['user_type'];
        $_SESSION['csrf_token']   = $csrf;
        $_SESSION['via_uae_pass'] = $viaUaePass;
        session_regenerate_id(true);

        return [
            'user_id'      => (int) $user['user_id'],
            'first_name'   => $user['first_name'],
            'last_name'    => $user['last_name'],
            'email'        => $user['email'],
            'emirates_id'  => $user['emirates_id'],
            'mobile_no'    => $user['mobile_no'],
            'nationality'  => $user['nationality'] !== null ? (int) $user['nationality'] : null,
            'sex'          => $user['sex'],
            'dob'          => $user['dob'],
            'role_id'      => (int) $user['user_type'],
            'role_name'    => static::roleNameFor((int) $user['user_type']),
            'csrf_token'   => $csrf,
            'modules'      => static::accessibleModules((int) $user['user_type']),
            'via_uae_pass' => $viaUaePass,
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
            'SELECT user_id, first_name, last_name, email, username, emirates_id,
                    nationality, sex, dob, user_type, is_active, date_created,
                    last_logged_in, address, mobile_no
             FROM mn_users WHERE user_id = ?',
            [static::id()],
        );
        if ($u === null) return null;
        $u['role_name']    = static::roleName();
        $u['modules']      = static::accessibleModules((int) $u['user_type']);
        $u['via_uae_pass'] = $_SESSION['via_uae_pass'] ?? false;
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
