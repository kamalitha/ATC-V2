<?php
declare(strict_types=1);

/**
 * UAE PASS Digital Vault (DV) — document-sharing API. Separate product from
 * UaePassClient's Authentication (OIDC) flow; see Config's Digital Vault section.
 * Spec source: docs/UAEPASS_DigitalVault -Service Provider Integration Guide-v2.5.pdf
 * (project's own docs/ folder) — no public documentation exists for this API.
 */
class DigitalVaultClient
{
    /**
     * Builds the HMAC-signed bearer JWT DV expects on every SP→DV call (and that DV
     * itself uses, same shared secret, on every DV→SP webhook call).
     * @param string|null $sub Required for `presentation-requests` — the citizen's UAE
     *   PASS access_token, obtained via a login with scope
     *   urn:uae:digitalid:digitalvault:datasharerequest. Omit for catalogue-only calls
     *   (document-types, verified-attributes) which don't need a citizen context.
     */
    public static function buildJwt(?string $sub = null, string $alg = 'HS512'): string
    {
        $now     = time();
        $header  = ['alg' => $alg];
        $payload = ['iss' => Config::UAEPASS_DV_PARTNER_ID, 'iat' => $now, 'exp' => $now + 3600];
        if ($sub !== null) {
            $payload = ['sub' => $sub] + $payload;
        }
        $h = self::b64url(json_encode($header));
        $p = self::b64url(json_encode($payload));
        $signingInput = "$h.$p";
        $hmacAlg = $alg === 'HS256' ? 'sha256' : 'sha512';
        $sig = self::b64url(hash_hmac($hmacAlg, $signingInput, Config::UAEPASS_DV_SECRET, true));
        return "$signingInput.$sig";
    }

    /**
     * Verifies an inbound Authorization: Bearer <jwt> header on a DV→SP webhook call,
     * checking the HMAC signature (same shared secret as outbound calls) and expiry.
     * Does NOT verify the citizen/issuer Vault Signatures embedded in the payload body
     * (CAdES + ECDSA secp256k1) — that's a separate, not-yet-implemented step; see the
     * TODO in DVController::receivePresentation().
     */
    public static function verifyInboundJwt(?string $authHeader, string $alg = 'HS512'): bool
    {
        if ($authHeader === null || !str_starts_with($authHeader, 'Bearer ')) {
            return false;
        }
        $jwt = substr($authHeader, 7);
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            return false;
        }
        [$h, $p, $sig] = $parts;
        $hmacAlg = $alg === 'HS256' ? 'sha256' : 'sha512';
        $expectedSig = self::b64url(hash_hmac($hmacAlg, "$h.$p", Config::UAEPASS_DV_SECRET, true));
        if (!hash_equals($expectedSig, $sig)) {
            return false;
        }
        $payload = json_decode(self::b64urlDecode($p), true);
        if (!is_array($payload) || !isset($payload['exp']) || time() > (int)$payload['exp']) {
            return false;
        }
        return true;
    }

    /**
     * POST /papi/v2/presentation-requests — asks DV to notify the citizen (identified by
     * $sub, their UAE PASS access_token) to share the requested documents.
     * @param array<int,array{documentType:string,required:bool}> $requestedDocuments
     * @param array<int,string> $requestedVerifiedAttributes
     * @return array{proofOfPresentationRequestId:string}
     * @throws \RuntimeException on any non-200 response
     */
    public static function requestPresentation(
        string $sub,
        array $requestedDocuments,
        array $requestedVerifiedAttributes = ['mobile', 'email'],
        string $purposeEn = 'Applying for Service',
        string $purposeAr = 'التقدم بطلب للخدمة',
        string $origin = 'WEB',
    ): array {
        $jwt = self::buildJwt($sub);
        $url = 'https://' . Config::UAEPASS_DV_HOST . '/papi/v2/presentation-requests';
        $body = [
            'partnerId'                    => Config::UAEPASS_DV_PARTNER_ID,
            'useCaseId'                     => Config::UAEPASS_DV_USE_CASE_ID,
            'purposeEN'                     => $purposeEn,
            'purposeAR'                     => $purposeAr,
            'requestId'                     => 'ATC' . time() . random_int(100, 999),
            'expiryDate'                    => date('Y-m-d H:i:s', strtotime('+1 day')),
            'origin'                        => $origin,
            'requestedDocuments'            => $requestedDocuments,
            'requestedVerifiedAttributes'   => $requestedVerifiedAttributes,
        ];
        $bodyJson = json_encode($body, JSON_UNESCAPED_UNICODE);

        // TEMP capture for DV request/response debugging — see DV_CAPTURE_PATH.
        self::captureLog([
            'direction' => 'REQUEST',
            'url'       => $url,
            'headers'   => ["Authorization: Bearer $jwt", 'Content-Type: application/json'],
            'jwt'       => $jwt,
            'body'      => $body,
        ]);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyJson);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $jwt", 'Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);

        $output = curl_exec($ch);
        $error  = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        self::captureLog([
            'direction' => 'RESPONSE',
            'status'    => $status,
            'curlError' => $error,
            'raw'       => $output,
        ]);

        if ($error) {
            throw new \RuntimeException('DV presentation request failed: ' . $error);
        }
        $data = json_decode((string)$output, true);
        if ($status !== 200 || !isset($data['proofOfPresentationRequestId'])) {
            throw new \RuntimeException("DV presentation request failed (HTTP $status): $output");
        }
        return $data;
    }

    /**
     * Decodes a received `signedPresentation` (base64 JSON, see DVController::
     * receivePresentation) into the fields the IDL/CPD wizards actually need —
     * NOT a general-purpose parser for all ~61 document types, just the two this
     * integration currently requests: EmiratesId and DRIVING_LICENSE.
     *
     * NOTE: this trusts the payload's contents as-is — citizen/issuer Vault
     * Signature verification (CAdES + ECDSA secp256k1) is still not implemented
     * (see the same TODO on DVController::receivePresentation). Do not treat the
     * returned fields as verified-authentic until that's built.
     *
     * @return array{verifiedAttributes: array<string,mixed>, emiratesId: ?array<string,mixed>, drivingLicense: ?array<string,mixed>, vehicleRegistration: ?array<string,mixed>}
     */
    public static function parseSignedPresentation(string $signedPresentationB64): array
    {
        $decoded = json_decode(self::b64urlOrStandardDecode($signedPresentationB64), true);
        $result  = ['verifiedAttributes' => [], 'emiratesId' => null, 'drivingLicense' => null, 'vehicleRegistration' => null];
        if (!is_array($decoded)) {
            return $result;
        }

        $result['verifiedAttributes'] = is_array($decoded['verifiedAttributes'] ?? null)
            ? $decoded['verifiedAttributes'] : [];

        foreach ((array)($decoded['credentials'] ?? []) as $cred) {
            $type = $cred['credentialDocumentType'] ?? null;
            $encoded = $cred['encodedCredential'] ?? null;
            if ($type === null || $encoded === null) {
                continue;
            }
            $raw = self::b64urlOrStandardDecode((string)$encoded);

            if ($type === 'EmiratesId') {
                // ICP documents ship encodedCredential as XML, not JSON — confirmed via a
                // real captured payload (2026-10-14) as <Data><claim>...actual
                // fields...</claim></Data>; the fields are one level deeper than
                // xmlToAssoc()'s original root-children-only read, which is why the very
                // first live test populated nothing despite the webhook succeeding.
                $fields = self::xmlToAssoc($raw, 'claim');
                if ($fields !== null) {
                    $result['emiratesId'] = $fields;
                }
            } elseif ($type === 'DRIVING_LICENSE') {
                // Also confirmed via the same real payload: wrapped as
                // {"issuedCredential": {..., "claim": {...actual fields...}}}, not a flat
                // object — same root cause as the EmiratesId nesting bug above.
                $decodedCred = json_decode($raw, true);
                $fields = $decodedCred['issuedCredential']['claim'] ?? null;
                if (is_array($fields)) {
                    $result['drivingLicense'] = $fields;
                }
            } elseif ($type === 'VEHICLE_REGISTRATION_CARD') {
                // Same MOI-issuer JSON wrapper as DRIVING_LICENSE above — UNVERIFIED
                // against a real payload (unlike EmiratesId/DRIVING_LICENSE, which were
                // both corrected after seeing actual captured data). Field names here
                // follow only the integration guide's summary table (PlateNumber,
                // TrafficProfileNumber, PlateSourceEnglishDescription, RegistrationDate,
                // ExpiryDate, OwnerEnglishName, NationalityEnglishDescription) — the
                // DRIVING_LICENSE table undersold the real field set significantly, so
                // treat this the same way: likely needs a follow-up fix once a real CPD
                // DV test payload is captured, same as happened there.
                $decodedCred = json_decode($raw, true);
                $fields = $decodedCred['issuedCredential']['claim'] ?? null;
                if (is_array($fields)) {
                    $result['vehicleRegistration'] = $fields;
                }
            }
        }

        return $result;
    }

    /**
     * Maps vcId => credentialDocumentType from a `signedPresentation` — needed because
     * the separate "Receive Visualization/Evidence" webhook (DVController::
     * receiveVisualization()) only gives proofOfPresentationId + vcId, not the document
     * type name, so without this captured up front there'd be no way to know whether an
     * incoming visualization belongs to the EmiratesId or the DRIVING_LICENSE credential.
     * @return array<string,string>
     */
    public static function extractVcMap(string $signedPresentationB64): array
    {
        $decoded = json_decode(self::b64urlOrStandardDecode($signedPresentationB64), true);
        $map = [];
        foreach ((array)($decoded['credentials'] ?? []) as $cred) {
            $vcId = $cred['vcId'] ?? null;
            $type = $cred['credentialDocumentType'] ?? null;
            if ($vcId !== null && $type !== null) {
                $map[(string)$vcId] = (string)$type;
            }
        }
        return $map;
    }

    /**
     * Decodes a received `visualizationInfo`/`evidenceInfo` field (DV spec §5.3) into the
     * raw visualization file bytes plus a guessed extension. Two different shapes are
     * documented for this, used by different issuers, and DVController::
     * receiveVisualization() doesn't distinguish which field name the call actually
     * used — so this tries both rather than assuming one:
     *
     * 1. `evidenceInfo` (MOI-issued docs, e.g. DRIVING_LICENSE, VEHICLE_REGISTRATION_CARD)
     *    — spec §9.1.1.2: "Base 64 encoded JSON which will contain the Evidence PDF".
     *    No field name is given for the inner file in the guide text itself, so this
     *    tries the plausible candidate keys first, then falls back to the first
     *    long/no-space string value in the decoded JSON.
     * 2. `visualizationInfo` (ICP-issued docs, e.g. EmiratesId, Passport) — confirmed via
     *    the integration guide's own real Emirates ID sample (§9.1.4): base64 → XML
     *    <Data>...<claim>...</claim><visualization><SOME_TAG>BASE64_FILE</SOME_TAG>
     *    </visualization></Data> — the file itself is base64 AGAIN inside that leaf
     *    element, whose tag name is issuer-specific ("emiratesID" in that sample), so
     *    this reads whichever single child is actually there.
     *
     * UNVERIFIED for the JSON/evidenceInfo path specifically — no real sample exists for
     * it the way the XML one does, so this will likely need a follow-up fix once a real
     * DRIVING_LICENSE/VEHICLE_REGISTRATION_CARD visualization is actually captured.
     * @return array{bytes:string, ext:string}|null
     */
    public static function decodeVisualizationFile(string $visualizationInfoB64, string $fileType): ?array
    {
        $decoded = self::b64urlOrStandardDecode($visualizationInfoB64);
        $ext = match (strtoupper($fileType)) {
            'PDF' => 'pdf',
            'JPEG', 'JPG' => 'jpg',
            'PNG' => 'png',
            default => 'bin',
        };

        $json = json_decode($decoded, true);
        if (is_array($json)) {
            // MOI-issued evidenceInfo wraps everything under issuedCredential — same
            // wrapper shape as the main signedPresentation claim (see
            // parseSignedPresentation's DRIVING_LICENSE/VEHICLE_REGISTRATION_CARD
            // handling) — confirmed via a real captured payload (2026-10-21):
            // {"issuedCredential": {context,type,issuer,credentialSubject,claim,
            // evidence}}. The original candidate-key guesses only ever looked at the
            // top level, which is why they never matched — the file sits one level
            // deeper, under the sibling "evidence" key.
            $searchRoots = [$json];
            if (isset($json['issuedCredential']) && is_array($json['issuedCredential'])) {
                $searchRoots[] = $json['issuedCredential'];
            }
            foreach ($searchRoots as $root) {
                foreach (['evidence', 'evidenceFile', 'file', 'fileContent', 'data'] as $key) {
                    if (!isset($root[$key])) {
                        continue;
                    }
                    if (is_string($root[$key]) && $root[$key] !== '') {
                        $bytes = self::b64urlOrStandardDecode($root[$key]);
                        if ($bytes !== '') {
                            return ['bytes' => $bytes, 'ext' => $ext];
                        }
                    }
                    // "evidence" may itself be a nested object rather than the raw
                    // base64 string directly — try the plausible inner keys too.
                    if (is_array($root[$key])) {
                        foreach (['file', 'data', 'content', 'base64', 'value', 'evidenceFile'] as $subKey) {
                            if (isset($root[$key][$subKey]) && is_string($root[$key][$subKey]) && $root[$key][$subKey] !== '') {
                                $bytes = self::b64urlOrStandardDecode($root[$key][$subKey]);
                                if ($bytes !== '') {
                                    return ['bytes' => $bytes, 'ext' => $ext];
                                }
                            }
                        }
                    }
                }
                foreach ($root as $v) {
                    if (is_string($v) && strlen($v) > 200 && !str_contains($v, ' ')) {
                        $bytes = self::b64urlOrStandardDecode($v);
                        if ($bytes !== '') {
                            return ['bytes' => $bytes, 'ext' => $ext];
                        }
                    }
                }
            }
        }

        // TEMP DIAGNOSTIC — logs only STRUCTURE (key names + each value's type/length/
        // one level of sub-keys, never actual content — no PII), kept in case the fix
        // above still doesn't match and another real sample is needed. Remove once the
        // DRIVING_LICENSE/VEHICLE_REGISTRATION_CARD visualization is confirmed working.
        if (is_array($json)) {
            $shapeOf = static function ($v) {
                if (is_string($v)) {
                    return 'string(len=' . strlen($v) . ')';
                }
                if (is_array($v)) {
                    $inner = [];
                    foreach ($v as $k2 => $v2) {
                        $inner[$k2] = is_string($v2) ? 'string(len=' . strlen($v2) . ')'
                            : (is_array($v2) ? 'array(keys=' . implode(',', array_keys($v2)) . ')' : gettype($v2));
                    }
                    return $inner;
                }
                return gettype($v);
            };
            $shape = [];
            foreach ($json as $k => $v) {
                $shape[$k] = $shapeOf($v);
            }
            @file_put_contents(
                __DIR__ . '/../logs/dv_visualization_shape.log',
                '[' . date('Y-m-d H:i:s') . "] fileType={$fileType} (decoder still fell through to null)\n"
                    . json_encode($shape, JSON_PRETTY_PRINT) . "\n\n",
                FILE_APPEND | LOCK_EX,
            );
        }

        $fields = self::xmlToAssoc($decoded, 'visualization');
        if ($fields === null || count($fields) === 0) {
            return null;
        }
        $innerB64 = reset($fields);
        $bytes = self::b64urlOrStandardDecode((string)$innerB64);
        return ['bytes' => $bytes, 'ext' => $ext];
    }

    /** TEMP: full unmasked request/response capture to a dedicated file for debugging. */
    private static function captureLog(array $entry): void
    {
        $path = __DIR__ . '/../logs/dv_request_capture.log';
        $line = '[' . date('Y-m-d H:i:s') . "]\n" . json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n\n";
        @file_put_contents($path, $line, FILE_APPEND | LOCK_EX);
    }

    /** Accepts either standard base64 or URL-safe base64, whichever DV actually sends. */
    private static function b64urlOrStandardDecode(string $data): string
    {
        if (str_contains($data, '-') || str_contains($data, '_')) {
            return self::b64urlDecode($data);
        }
        return (string) base64_decode($data, true) ?: (string) base64_decode($data);
    }

    /**
     * @param string|null $descendInto If given, flattens this child element's children
     *   instead of the root's (e.g. ICP's real <Data><claim>...fields...</claim></Data>
     *   shape — the actual document fields sit one level inside <claim>, not as direct
     *   children of the root).
     * @return array<string,string>|null
     */
    private static function xmlToAssoc(string $xml, ?string $descendInto = null): ?array
    {
        $prev = libxml_use_internal_errors(true);
        $node = simplexml_load_string($xml);
        libxml_use_internal_errors($prev);
        if ($node === false) {
            return null;
        }
        if ($descendInto !== null && isset($node->{$descendInto})) {
            $node = $node->{$descendInto};
        }
        $out = [];
        foreach ($node->children() as $child) {
            $out[$child->getName()] = (string) $child;
        }
        // Some samples put fields as attributes on the root element instead of children.
        foreach ($node->attributes() as $name => $value) {
            $out[(string) $name] = (string) $value;
        }
        return $out ?: null;
    }

    private static function b64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64urlDecode(string $data): string
    {
        $pad = strlen($data) % 4;
        if ($pad) {
            $data .= str_repeat('=', 4 - $pad);
        }
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
