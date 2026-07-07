<?php
declare(strict_types=1);

class AuthController
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function login(array $params, array $body, array $query): void
    {
        RateLimit::check(RateLimit::loginKey(), maxHits: 10, window: 300);

        Validator::make($body)->required('username', 'password')->validate();

        $user = Auth::attempt(trim($body['username']), $body['password']);

        $this->db->execute(
            "INSERT INTO mn_event_logs (log_module, log_action, action_initiator, log_datetime, extra_params)
             VALUES ('LOGIN', ?, ?, NOW(), '')",
            [$user ? 'SUCCESS' : 'FAIL', trim($body['username'])],
        );

        if ($user === null) {
            Response::error('Invalid username or password', 401);
        }

        $this->db->execute(
            'UPDATE mn_users SET last_logged_in = NOW() WHERE user_id = ?',
            [$user['user_id']],
        );

        Response::success($user, 'Login successful');
    }

    public function logout(array $params, array $body, array $query): void
    {
        if (Auth::check()) {
            $u = Auth::user();
            $this->db->execute(
                "INSERT INTO mn_event_logs (log_module, log_action, action_initiator, log_datetime, extra_params)
                 VALUES ('LOGOUT', 'SUCCESS', ?, NOW(), '')",
                [$u['email'] ?? ''],
            );
        }
        Auth::logout();
        Response::success(null, 'Logged out');
    }

    public function me(array $params, array $body, array $query): void
    {
        $user = Auth::user();
        if ($user === null) Response::unauthorized();

        // Issue a fresh CSRF token on every /me call so page refreshes work
        $csrf = bin2hex(random_bytes(32));
        $_SESSION['csrf_token'] = $csrf;
        $user['csrf_token'] = $csrf;

        Response::success($user);
    }

    public function updateProfile(array $params, array $body, array $query): void
    {
        $id = Auth::id();
        Validator::make($body)->required('first_name', 'email')->email('email')->validate();

        $this->db->execute(
            'UPDATE mn_users SET first_name=?, last_name=?, email=?, mobile_no=?, address=? WHERE user_id=?',
            [
                $body['first_name'],
                $body['last_name'] ?? '',
                $body['email'],
                $body['mobile_no'] ?? '',
                $body['address'] ?? '',
                $id,
            ],
        );
        Response::success(null, 'Profile updated');
    }

    public function changeOwnPassword(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('current_password', 'new_password')
            ->min('new_password', 8)
            ->validate();

        $user = $this->db->queryOne('SELECT password FROM mn_users WHERE user_id=?', [Auth::id()]);
        if (!password_verify($body['current_password'], $user['password'])) {
            // Legacy fallback
            $legacy = hash('sha256', substr(hash('whirlpool', $body['current_password']), 3, -3));
            if (!hash_equals($legacy, $user['password'])) {
                Response::error('Current password is incorrect', 401);
            }
        }

        $this->db->execute(
            'UPDATE mn_users SET password=? WHERE user_id=?',
            [Auth::hashPassword($body['new_password']), Auth::id()],
        );
        Response::success(null, 'Password changed');
    }
}
