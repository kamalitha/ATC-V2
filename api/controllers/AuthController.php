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

    public function forgotPassword(array $params, array $body, array $query): void
    {
        RateLimit::check(RateLimit::forgotPasswordKey(), maxHits: 5, window: 300);

        Validator::make($body)->required('email')->email('email')->validate();

        $email = trim($body['email']);
        // Filter by the public role directly in SQL — the same email can be shared
        // across multiple mn_users rows with different roles, so a plain
        // "WHERE email = ?" here could non-deterministically match a staff account.
        $user  = $this->db->queryOne(
            'SELECT user_id FROM mn_users WHERE email = ? AND user_type = ? AND is_active = 1 LIMIT 1',
            [$email, Auth::ROLE_MAP['public']],
        );

        if (!$user) {
            Response::error('No account was found with that email address', 404);
        }

        $newPassword = self::generateRandomPassword();

        $this->db->execute(
            'UPDATE mn_users SET password = ? WHERE user_id = ?',
            [Auth::hashPassword($newPassword), $user['user_id']],
        );

        $mail = new MailHandler();
        $sent = $mail->sendBasicMailViaMailJet(
            Config::MJ_RESET_PASSWORD_TEMPLATE,
            $email,
            ['username' => $email, 'passwordResetLink' => $newPassword],
        );

        $this->db->execute(
            "INSERT INTO mn_event_logs (log_module, log_action, action_initiator, log_datetime, extra_params)
             VALUES ('LOGIN', 'PASSWORD_RESET', ?, NOW(), '')",
            [$email],
        );

        if (!$sent) Response::serverError('Password was reset but the email could not be sent. Please contact support.');

        Response::success(null, 'A new password has been sent to your email address');
    }

    private static function generateRandomPassword(): string
    {
        $chars  = 'abcdefghijkmnopqrstuvwxyz023456789';
        $result = '';
        for ($i = 0; $i < 8; $i++) {
            $result .= $chars[random_int(0, strlen($chars) - 1)];
        }
        return $result;
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
            ->required('new_password')
            ->validate();

        $this->db->execute(
            'UPDATE mn_users SET password=? WHERE user_id=?',
            [Auth::hashPassword($body['new_password']), Auth::id()],
        );
        Response::success(null, 'Password changed');
    }
}
