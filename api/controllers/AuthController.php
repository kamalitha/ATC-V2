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

    // ── Public self-registration ────────────────────────────────────────────

    public function captcha(array $params, array $body, array $query): void
    {
        $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids ambiguity
        $code  = '';
        for ($i = 0; $i < 5; $i++) {
            $code .= $chars[random_int(0, strlen($chars) - 1)];
        }
        $_SESSION['register_captcha'] = $code;

        // Render at 2x then downsample — smooths the blocky built-in bitmap font.
        $scale  = 2;
        $w      = 140 * $scale;
        $h      = 50  * $scale;
        $canvas = imagecreatetruecolor($w, $h);
        $bg     = imagecolorallocate($canvas, 245, 246, 248);
        imagefill($canvas, 0, 0, $bg);

        // Noise lines
        for ($i = 0; $i < 6; $i++) {
            $lineColor = imagecolorallocate($canvas, random_int(180, 210), random_int(180, 210), random_int(180, 210));
            imageline($canvas, random_int(0, $w), random_int(0, $h), random_int(0, $w), random_int(0, $h), $lineColor);
        }

        // Characters, jittered
        $charSpacing = intdiv($w, strlen($code) + 1);
        for ($i = 0; $i < strlen($code); $i++) {
            $textColor = imagecolorallocate($canvas, random_int(30, 70), random_int(30, 70), random_int(90, 140));
            $x = $charSpacing * ($i + 1) - 8 * $scale + random_int(-4, 4);
            $y = intdiv($h, 2) - 10 * $scale + random_int(-6, 6);
            imagestring($canvas, 5, $x, $y, $code[$i], $textColor);
        }

        // Noise dots
        for ($i = 0; $i < 80; $i++) {
            $dotColor = imagecolorallocate($canvas, random_int(190, 220), random_int(190, 220), random_int(190, 220));
            imagesetpixel($canvas, random_int(0, $w - 1), random_int(0, $h - 1), $dotColor);
        }

        $final = imagecreatetruecolor(140, 50);
        imagecopyresampled($final, $canvas, 0, 0, 0, 0, 140, 50, $w, $h);
        imagedestroy($canvas);

        header('Content-Type: image/png');
        header('Cache-Control: no-store, no-cache, must-revalidate');
        imagepng($final);
        imagedestroy($final);
        exit;
    }

    public function register(array $params, array $body, array $query): void
    {
        RateLimit::check(RateLimit::registerKey(), maxHits: 10, window: 300);

        Validator::make($body)
            ->required('full_name', 'emirates_id', 'mobile_no', 'email', 'password', 'confirm_password', 'captcha')
            ->email('email')
            ->validate();

        $captchaInput = strtoupper(trim($body['captcha']));
        $captchaValid = isset($_SESSION['register_captcha']) && hash_equals($_SESSION['register_captcha'], $captchaInput);
        unset($_SESSION['register_captcha']); // one-time use, regardless of outcome

        if (!$captchaValid) Response::error('Incorrect captcha code', 422);

        if ($body['password'] !== $body['confirm_password']) {
            Response::error('Passwords do not match', 422);
        }

        $email      = trim($body['email']);
        $emiratesId = trim($body['emirates_id']);

        $existing = $this->db->queryOne(
            'SELECT user_id FROM mn_users WHERE email = ? OR username = ? LIMIT 1',
            [$email, $email],
        );
        if ($existing) Response::error('An account with that email already exists', 409);

        if ($emiratesId !== '') {
            $existingEid = $this->db->queryOne(
                'SELECT user_id FROM mn_users WHERE emirates_id = ? LIMIT 1',
                [$emiratesId],
            );
            if ($existingEid) Response::error('An account with that Emirates ID already exists', 409);
        }

        $nameParts = array_values(array_filter(explode(' ', trim($body['full_name']))));
        $firstName = implode(' ', array_slice($nameParts, 0, 2));
        $lastName  = implode(' ', array_slice($nameParts, 2));

        $userId = $this->db->insert(
            'INSERT INTO mn_users
             (first_name, last_name, email, emirates_id, mobile_no, username, password, user_type, is_active, date_created)
             VALUES (?,?,?,?,?,?,?,?,1,CURDATE())',
            [
                $firstName ?: $body['full_name'],
                $lastName,
                $email,
                $emiratesId,
                trim($body['mobile_no']),
                $email,
                Auth::hashPassword($body['password']),
                Auth::ROLE_MAP['public'],
            ],
        );

        $this->db->execute(
            "INSERT INTO mn_event_logs (log_module, log_action, action_initiator, log_datetime, extra_params)
             VALUES ('LOGIN', 'REGISTER', ?, NOW(), '')",
            [$email],
        );

        Response::created(['user_id' => $userId], 'Account created successfully. You can now log in.');
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
