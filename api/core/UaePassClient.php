<?php
declare(strict_types=1);

/**
 * Thin wrapper around UAE PASS's OIDC Authentication API (staging). Digital Vault
 * (document-sharing) is a separate UAE PASS product and not handled here.
 * Endpoint spec: https://docs.uaepass.ae/feature-guides/authentication/web-application
 */
class UaePassClient
{
    public function getAuthorizeUrl(string $state): string
    {
        $params = [
            'response_type' => 'code',
            'client_id'     => Config::UAEPASS_CLIENT_ID,
            'scope'         => 'urn:uae:digitalid:profile:general',
            'state'         => $state,
            'redirect_uri'  => Config::uaePassRedirectUri(),
            'acr_values'    => 'urn:safelayer:tws:policies:authentication:level:low',
        ];

        return Config::UAEPASS_BASE_URL . '/idshub/authorize?' . http_build_query($params);
    }

    /** @return array<string,mixed> */
    public function exchangeCodeForToken(string $code): array
    {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, Config::UAEPASS_BASE_URL . '/idshub/token');
        curl_setopt($ch, CURLOPT_POST, true);
        // multipart/form-data — passing an array (not a query string) makes cURL build
        // the multipart body itself and set the correct boundary in Content-Type.
        curl_setopt($ch, CURLOPT_POSTFIELDS, [
            'grant_type'   => 'authorization_code',
            'code'         => $code,
            'redirect_uri' => Config::uaePassRedirectUri(),
        ]);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Basic ' . base64_encode(Config::UAEPASS_CLIENT_ID . ':' . Config::UAEPASS_CLIENT_SECRET),
        ]);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10); // the code itself expires 10s after issue

        $output = curl_exec($ch);
        $error  = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

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
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, Config::UAEPASS_BASE_URL . '/idshub/userinfo');
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $accessToken]);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        $output = curl_exec($ch);
        $error  = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

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
}
