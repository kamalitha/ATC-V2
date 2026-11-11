<?php
declare(strict_types=1);

/**
 * Thin wrapper around UAE PASS's OIDC Authentication API (staging). Digital Vault
 * (document-sharing) is a separate UAE PASS product and not handled here.
 * Endpoint spec: https://docs.uaepass.ae/feature-guides/authentication/web-application
 */
class UaePassClient
{
    public function getAuthorizeUrl(string $state, string $scope = 'urn:uae:digitalid:profile:general'): string
    {
        $params = [
            'response_type' => 'code',
            'client_id'     => Config::UAEPASS_CLIENT_ID,
            'scope'         => $scope,
            'state'         => $state,
            'redirect_uri'  => Config::uaePassRedirectUri(),
            'acr_values'    => 'urn:safelayer:tws:policies:authentication:level:low',
        ];
        $url = Config::UAEPASS_BASE_URL . '/idshub/authorize?' . http_build_query($params);

        // TEMP capture for UAE PASS request/response debugging.
        self::captureLog('authorize', [
            'direction' => 'REQUEST',
            'method'    => 'GET (browser redirect)',
            'url'       => $url,
            'params'    => $params,
        ]);

        return $url;
    }

    /** @return array<string,mixed> */
    public function exchangeCodeForToken(string $code): array
    {
        $url = Config::UAEPASS_BASE_URL . '/idshub/token';
        $postFields = [
            'grant_type'   => 'authorization_code',
            'code'         => $code,
            'redirect_uri' => Config::uaePassRedirectUri(),
        ];
        $authHeader = 'Authorization: Basic ' . base64_encode(Config::UAEPASS_CLIENT_ID . ':' . Config::UAEPASS_CLIENT_SECRET);

        self::captureLog('token', [
            'direction' => 'REQUEST',
            'method'    => 'POST (multipart/form-data)',
            'url'       => $url,
            'headers'   => [$authHeader],
            'body'      => $postFields,
        ]);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        // multipart/form-data — passing an array (not a query string) makes cURL build
        // the multipart body itself and set the correct boundary in Content-Type.
        curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [$authHeader]);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10); // the code itself expires 10s after issue

        $output = curl_exec($ch);
        $error  = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        self::captureLog('token', [
            'direction' => 'RESPONSE',
            'status'    => $status,
            'curlError' => $error,
            'raw'       => $output,
        ]);

        if ($error) {
            throw new \RuntimeException('UAE PASS token request failed: ' . $error);
        }
        $data = json_decode((string)$output, true);
        if ($status !== 200 || !isset($data['access_token'])) {
            throw new \RuntimeException('UAE PASS token exchange failed (HTTP ' . $status . '): ' . $output);
        }

        return $data;
    }

    /** @return array<string,mixed> */
    public function getUserInfo(string $accessToken): array
    {
        $url = Config::UAEPASS_BASE_URL . '/idshub/userinfo';
        $authHeader = 'Authorization: Bearer ' . $accessToken;

        self::captureLog('userinfo', [
            'direction' => 'REQUEST',
            'method'    => 'GET',
            'url'       => $url,
            'headers'   => [$authHeader],
        ]);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [$authHeader]);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        $output = curl_exec($ch);
        $error  = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        self::captureLog('userinfo', [
            'direction' => 'RESPONSE',
            'status'    => $status,
            'curlError' => $error,
            'raw'       => $output,
        ]);

        if ($error) {
            throw new \RuntimeException('UAE PASS userinfo request failed: ' . $error);
        }
        $data = json_decode((string)$output, true);
        // SOP1 (basic) accounts don't have a verified Emirates ID and omit `idn` entirely —
        // `sub` is the OIDC subject identifier and is always present regardless of SOP level.
        if ($status !== 200 || !isset($data['sub'])) {
            throw new \RuntimeException('UAE PASS userinfo fetch failed (HTTP ' . $status . '): ' . $output);
        }

        return $data;
    }

    /** TEMP: full unmasked request/response capture, one file per call type, for debugging. */
    private static function captureLog(string $name, array $entry): void
    {
        $path = __DIR__ . '/../logs/uaepass_' . $name . '_capture.log';
        $line = '[' . date('Y-m-d H:i:s') . "]\n" . json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n\n";
        @file_put_contents($path, $line, FILE_APPEND | LOCK_EX);
    }
}
