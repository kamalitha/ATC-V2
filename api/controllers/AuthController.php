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

    /** GET /api/auth/uaepass/start — redirects the browser to UAE PASS's authorize endpoint. */
    public function uaePassStart(array $params, array $body, array $query): void
    {
        $state = bin2hex(random_bytes(16));

        // TEMPORARY (2026-09-22): ?scope=dv requests the Digital Vault data-sharing scope
        // instead of the normal login scope, so we can capture a real access_token to use
        // as the `sub` claim in DV API calls per TDRA's onboarding guidance. Remove this
        // branch (and the matching one in uaePassCallback()) once DV onboarding is done.
        $scope = 'urn:uae:digitalid:profile:general';
        if (($query['scope'] ?? null) === 'dv') {
            $scope = 'urn:uae:digitalid:digitalvault:datasharerequest';
            $state = 'DVTEST_' . $state;
        }

        $_SESSION['uaepass_state'] = $state;

        header('Location: ' . (new UaePassClient())->getAuthorizeUrl($state, $scope));
        exit;
    }

    /** Which Digital Vault documents the real "Continue with UAE PASS" button requests,
     * per wizard context. Keep this list and ::DV_CONTEXTS in sync. */
    private const DV_CONTEXT_DOCUMENTS = [
        // Context value matches the frontend route name exactly (public.js's
        // renderPublicApplyIDL via app.js route 'public-apply-idl') so
        // handleUaePassCallback() can navigate(data.context) directly.
        'public-apply-idl' => [
            ['documentType' => 'EmiratesId', 'required' => true],
            ['documentType' => 'DRIVING_LICENSE', 'required' => true],
        ],
        // CPD's widget copy says "Emirates ID, Driving License & Mulkiya" —
        // VEHICLE_REGISTRATION_CARD is the Mulkiya per the DV document-type catalogue.
        // Passport was briefly added here (passport_no has no other DV source) and then
        // explicitly removed — only these 3 documents are wanted for CPD.
        'public-apply-cpd' => [
            ['documentType' => 'EmiratesId', 'required' => true],
            ['documentType' => 'DRIVING_LICENSE', 'required' => true],
            ['documentType' => 'VEHICLE_REGISTRATION_CARD', 'required' => true],
        ],
    ];

    /**
     * GET /api/auth/uaepass/dv-consent/start?context=idl-new — the REAL "Continue with
     * UAE PASS" flow for the IDL (and future CPD) wizard: the user is already logged in
     * (this is a document-sharing consent step mid-wizard, not a login), so unlike
     * uaePassStart() this does not touch the portal session at all — it only stashes
     * which wizard/context to return the Digital Vault request to once UAE PASS redirects
     * back. See the matching DVCONSENT_ branch in uaePassCallback().
     */
    public function dvConsentStart(array $params, array $body, array $query): void
    {
        if (Auth::id() === null) {
            Response::error('You must be signed in first', 401);
        }
        $context = (string)($query['context'] ?? '');
        if (!isset(self::DV_CONTEXT_DOCUMENTS[$context])) {
            Response::error('Unknown request context', 422);
        }

        $state = 'DVCONSENT_' . bin2hex(random_bytes(16));
        $_SESSION['uaepass_state']       = $state;
        $_SESSION['dv_consent_context']  = $context;
        $_SESSION['dv_consent_user_id']  = Auth::id();

        header('Location: ' . (new UaePassClient())->getAuthorizeUrl(
            $state,
            'urn:uae:digitalid:digitalvault:datasharerequest',
        ));
        exit;
    }

    /**
     * POST /api/auth/uaepass/callback — completes the OIDC flow: exchanges the
     * authorization code (must happen within UAE PASS's 10s expiry window) for a
     * token, fetches the verified profile, and logs the user in.
     */
    public function uaePassCallback(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('code', 'state')->validate();

        $expectedState = $_SESSION['uaepass_state'] ?? null;
        unset($_SESSION['uaepass_state']); // one-time use regardless of outcome

        if ($expectedState === null || !hash_equals($expectedState, (string)$body['state'])) {
            Response::error('Invalid or expired UAE PASS session — please try again', 422);
        }

        // Real "Continue with UAE PASS" document-sharing consent flow (see
        // dvConsentStart()) — NOT a login. The user's existing portal session is left
        // untouched; this just exchanges the code for a fresh DV-scope access_token,
        // uses it to create the Digital Vault presentation request, and hands the
        // frontend the request id to poll instead of a user/session payload.
        if (str_starts_with((string)$expectedState, 'DVCONSENT_')) {
            $context = (string)($_SESSION['dv_consent_context'] ?? '');
            $userId  = $_SESSION['dv_consent_user_id'] ?? null;
            unset($_SESSION['dv_consent_context'], $_SESSION['dv_consent_user_id']);

            if ($context === '' || !isset(self::DV_CONTEXT_DOCUMENTS[$context]) || $userId === null) {
                Response::error('Invalid or expired request — please try again', 422);
            }

            $client = new UaePassClient();
            try {
                $token = $client->exchangeCodeForToken((string)$body['code']);
            } catch (\RuntimeException $e) {
                Logger::error('DV consent token exchange failed: ' . $e->getMessage());
                Response::error('Token exchange failed — please try again', 502);
            }

            try {
                $dvResult = DigitalVaultClient::requestPresentation(
                    (string)$token['access_token'],
                    self::DV_CONTEXT_DOCUMENTS[$context],
                );
            } catch (\RuntimeException $e) {
                Logger::error('DV presentation request failed: ' . $e->getMessage());
                Response::error('Could not reach UAE PASS Digital Vault — please try again', 502);
            }

            $requestId = (string)$dvResult['proofOfPresentationRequestId'];
            $this->db->execute(
                'INSERT INTO mn_dv_presentations
                    (proof_of_presentation_request_id, status, context, user_id, requested_datetime)
                 VALUES (?, \'pending\', ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE status = \'pending\', requested_datetime = NOW()',
                [$requestId, $context, $userId],
            );

            Response::success(
                ['proofOfPresentationRequestId' => $requestId, 'context' => $context],
                'Request sent',
            );
        }

        // TEMPORARY (2026-09-22): DV scope test — see matching comment in uaePassStart().
        // Writes the raw access_token to a file (read directly via SSH, no need for the
        // browser user to copy anything out of DevTools) instead of logging in normally.
        // Remove this branch once DV onboarding is done.
        if (str_starts_with((string)$expectedState, 'DVTEST_')) {
            $client = new UaePassClient();
            try {
                $token = $client->exchangeCodeForToken((string)$body['code']);
            } catch (\RuntimeException $e) {
                Logger::error('UAE PASS DV-scope token exchange failed: ' . $e->getMessage());
                Response::error('Token exchange failed — please try again', 502);
            }
            @file_put_contents(__DIR__ . '/../logs/dv-test-token.txt', json_encode($token, JSON_PRETTY_PRINT));
            Response::success(['ok' => true], 'DV test token captured — you can close this tab');
        }

        $client = new UaePassClient();
        try {
            $token    = $client->exchangeCodeForToken((string)$body['code']);
            $userInfo = $client->getUserInfo((string)$token['access_token']);
        } catch (\RuntimeException $e) {
            Logger::error('UAE PASS login failed: ' . $e->getMessage());
            Response::error('UAE PASS login failed — please try again', 502);
        }

        $user = Auth::attemptViaUaePass($userInfo);

        $this->db->execute(
            "INSERT INTO mn_event_logs (log_module, log_action, action_initiator, log_datetime, extra_params)
             VALUES ('LOGIN', ?, ?, NOW(), 'uae_pass')",
            [$user ? 'SUCCESS' : 'FAIL', $userInfo['email'] ?? $userInfo['idn'] ?? ''],
        );

        if ($user === null) {
            Response::error('This UAE PASS account is inactive — contact support', 403);
        }

        $this->db->execute('UPDATE mn_users SET last_logged_in = NOW() WHERE user_id = ?', [$user['user_id']]);

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
