<?php
declare(strict_types=1);

/**
 * UAE PASS Digital Vault webhooks — endpoints DV itself calls (not the browser/customer).
 * See DigitalVaultClient for the outbound (SP→DV) side.
 */
class DVController
{
    /** Directory where UAE PASS Digital Vault "Receive Visualization/Evidence" webhook
     *  payloads are saved (relative to API root). Kept local to this controller rather
     *  than in Config — deploying Config changes means re-deploying the whole config
     *  file, which holds environment-specific DB credentials; a wholesale overwrite of
     *  that file once already broke staging login, so this feature avoids touching it
     *  at all. Keyed by proofOfPresentationId since this arrives before any IDL/CPD
     *  request_id exists to file it under. */
    private const VISUALIZATION_PATH = 'appointment-requests/dv-visualizations';

    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * POST /api/dv/webhook/receive-presentation — DV calls this once the citizen approves
     * (or the flow otherwise concludes) a presentation request, carrying the actual shared
     * document data. Must respond within DV's ~5s budget.
     *
     * NOTE (2026-09-24): this stores the raw payload and confirms receipt, but does NOT
     * yet verify the citizen's/issuer's Vault Signatures (CAdES over signedPresentation,
     * ECDSA secp256k1 over each proof object) — that's a real security gap for production
     * use, tracked as a follow-up. It's not safe to trust `signedPresentation`'s contents
     * as authentic until that verification is implemented. See docs/ integration guide
     * §5.2 and Appendix-VI/ECDSA sample for what's still needed.
     */
    public function receivePresentation(array $params, array $body, array $query): void
    {
        $authHeader = $this->getAuthorizationHeader();
        if (!DigitalVaultClient::verifyInboundJwt($authHeader)) {
            Logger::error('DV receivePresentation — inbound JWT verification failed');
            Response::error('Unauthorised', 401);
        }

        $proofOfPresentationId = (string)($body['proofOfPresentationId'] ?? '');
        $signedPresentation    = (string)($body['signedPresentation'] ?? '');
        $requestId             = (string)($body['proofOfPresentationRequestId'] ?? ($body['qrId'] ?? ''));
        if ($proofOfPresentationId === '' || $signedPresentation === '') {
            Response::error('Invalid presentation payload', 500);
        }

        // vcId => credentialDocumentType — the separate Receive Visualization webhook
        // (below) only gives us proofOfPresentationId + vcId, so this is captured now
        // while we still know which credential each vcId belongs to.
        $vcMap = DigitalVaultClient::extractVcMap($signedPresentation);

        try {
            // Prefer updating the 'pending' row AuthController::uaePassCallback's
            // DVCONSENT_ branch inserted when WE created this request (keyed by the
            // request id, the only id we had at that point) — this is what lets the
            // wizard's polling pick up the result. Fall back to a bare insert for any
            // call that didn't originate from that flow (manual/direct test calls,
            // e.g. the 2026-09-24 proof-of-concept).
            $updated = 0;
            if ($requestId !== '') {
                $updated = $this->db->execute(
                    'UPDATE mn_dv_presentations
                     SET proof_of_presentation_id = ?, signed_presentation = ?,
                         citizen_signature = ?, raw_payload = ?, vc_map = ?, received_datetime = NOW(),
                         status = \'received\'
                     WHERE proof_of_presentation_request_id = ?',
                    [$proofOfPresentationId, $signedPresentation, $body['citizenSignature'] ?? null,
                     json_encode($body, JSON_UNESCAPED_UNICODE), json_encode($vcMap), $requestId],
                );
            }
            if (!$updated) {
                $this->db->execute(
                    'INSERT INTO mn_dv_presentations
                        (proof_of_presentation_id, proof_of_presentation_request_id,
                         signed_presentation, citizen_signature, raw_payload, vc_map, received_datetime, status)
                     VALUES (?, ?, ?, ?, ?, ?, NOW(), \'received\')
                     ON DUPLICATE KEY UPDATE
                        signed_presentation = VALUES(signed_presentation),
                        citizen_signature   = VALUES(citizen_signature),
                        raw_payload         = VALUES(raw_payload),
                        vc_map              = VALUES(vc_map),
                        received_datetime   = NOW(),
                        status              = \'received\'',
                    [
                        $proofOfPresentationId,
                        $requestId !== '' ? $requestId : null,
                        $signedPresentation,
                        $body['citizenSignature'] ?? null,
                        json_encode($body, JSON_UNESCAPED_UNICODE),
                        json_encode($vcMap),
                    ],
                );
            }
        } catch (\Throwable $e) {
            Logger::error('DV receivePresentation — DB insert failed: ' . $e->getMessage());
            Response::error('INVALID_PRESENTATION', 500);
        }

        // Per UAE PASS's own feedback (2026-10-19): the expected response body is the
        // raw {"presentationReceiptID": "..."} object at the TOP level, not wrapped in
        // this app's normal {success, message, data} envelope — Response::success()
        // was nesting it under "data", which UAE PASS couldn't parse ("didn't receive
        // expected response back from the API"). Response::json() outputs the raw
        // payload with no wrapper.
        Response::json(['presentationReceiptID' => 'ATC-' . bin2hex(random_bytes(8))]);
    }

    /**
     * POST /api/dv/webhook/reject-notification — DV calls this when the citizen rejects,
     * exits without deciding, or an internal DV error occurs (unless a `failureurl` was
     * passed on an app-to-app request, which substitutes for this call in the
     * USER_EXITED/UAEPASS_ERROR cases — see the integration guide §5.4).
     */
    public function rejectNotification(array $params, array $body, array $query): void
    {
        $authHeader = $this->getAuthorizationHeader();
        if (!DigitalVaultClient::verifyInboundJwt($authHeader)) {
            Logger::error('DV rejectNotification — inbound JWT verification failed');
            Response::error('Unauthorised', 401);
        }

        Logger::error('DV rejectNotification: ' . json_encode($body, JSON_UNESCAPED_UNICODE));

        // The integration guide doesn't give one fixed field name for this payload across
        // all onboarding variants — check the plausible candidates defensively rather than
        // assume. If none match, the pending row is simply left at 'pending' until the
        // wizard's polling times out on its own and offers manual entry.
        $requestId = (string)($body['proofOfPresentationRequestId'] ?? $body['requestId'] ?? $body['qrId'] ?? '');
        if ($requestId !== '') {
            $this->db->execute(
                "UPDATE mn_dv_presentations SET status = 'rejected'
                 WHERE proof_of_presentation_request_id = ? AND status = 'pending'",
                [$requestId],
            );
        }

        // Per UAE PASS's own feedback (2026-10-19): expected response is the raw
        // {"presentationRejectID": "..."} object at the top level — same fix as
        // receivePresentation()/receiveVisualization() below. This also means a
        // receipt ID is now actually generated and returned here, which wasn't
        // happening at all before (the old response had no ID field whatsoever).
        Response::json(['presentationRejectID' => 'ATC-' . bin2hex(random_bytes(8))]);
    }

    /**
     * GET /api/dv/requests/{id}/status — the New IDL (and future CPD) wizard polls this
     * after redirecting back from the "Continue with UAE PASS" consent round trip.
     * {id} is the proofOfPresentationRequestId AuthController::uaePassCallback's
     * DVCONSENT_ branch returned when it created the request.
     */
    public function requestStatus(array $params, array $body, array $query): void
    {
        $requestId = (string)$params['id'];
        $row = $this->db->queryOne(
            'SELECT status, signed_presentation, proof_of_presentation_id FROM mn_dv_presentations
             WHERE proof_of_presentation_request_id = ? AND user_id = ? LIMIT 1',
            [$requestId, Auth::id()],
        );
        if (!$row) {
            // Either it never existed, or it belongs to a different user — same response
            // either way so this can't be used to probe for other users' request ids.
            Response::notFound('No such request');
        }

        if ($row['status'] !== 'received') {
            Response::success(['status' => $row['status']], 'OK');
        }

        $data = DigitalVaultClient::parseSignedPresentation((string)$row['signed_presentation']);

        // Which card-scan visualizations (if any) have arrived so far via the separate
        // "Receive Visualization" webhook below — this is independent of, and can lag
        // well behind, the main presentation data (DV spec: "in real time or via a
        // 20-min retry interval, up to 24h"), so the wizard treats these as optional
        // extras that may show up after the main data already populated.
        $allVisRows = $this->db->query(
            'SELECT document_type, status, file_type, file_path, received_datetime
             FROM mn_dv_visualizations WHERE proof_of_presentation_id = ?',
            [$row['proof_of_presentation_id']],
        );
        $visRows = array_filter($allVisRows, fn($r) => $r['status'] === 'ACTIVE' && $r['file_path'] !== null);
        $data['visualizations'] = array_values(array_unique(array_filter(
            array_map(fn($r) => $r['document_type'], $visRows),
        )));

        // TEMP DIAGNOSTIC — VALUE LENGTHS only (never the actual values — a bare
        // integer carries no PII) plus the raw visualization rows (technical
        // metadata, not citizen data), to debug the "no images / no full name"
        // report without exposing identity data. Remove once the DV
        // field-mapping/visualization issue is resolved.
        $lengths = static function ($v): mixed {
            if (!is_array($v)) {
                return $v;
            }
            $out = [];
            foreach ($v as $k => $vv) {
                $out[$k] = is_string($vv) ? strlen($vv) : (is_array($vv) ? '[array]' : $vv);
            }
            return $out;
        };
        @file_put_contents(
            __DIR__ . '/../logs/dv_debug_latest.log',
            json_encode([
                'proofOfPresentationId'          => $row['proof_of_presentation_id'],
                'emiratesId_fieldLengths'         => $lengths($data['emiratesId'] ?? null),
                'drivingLicense_fieldLengths'     => $lengths($data['drivingLicense'] ?? null),
                'verifiedAttributes_fieldLengths' => $lengths($data['verifiedAttributes'] ?? null),
                'all_visualization_rows'          => $allVisRows,
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
            FILE_APPEND | LOCK_EX,
        );

        Response::success(['status' => 'received'] + $data, 'OK');
    }

    /**
     * POST /api/dv/webhook/receive-visualization — DV spec §5.3. Pushes the actual
     * card-scan PDF/image for an already-shared credential, separately and
     * asynchronously from Receive Presentation above (DV fetches it from the issuer
     * and pushes it "in real time or via a 20-min retry interval, up to 24h" — it may
     * arrive well after the citizen's browser session has moved on, or not at all if
     * the issuer never supplies one for a given document type).
     *
     * NOTE: same gap as receivePresentation() — this does not yet verify the issuer's
     * CAdES Signature (issuerSignature) over visualizationInfo/evidenceInfo. Not safe
     * to treat the file as authentic until that's built (DV spec §5.3.4 "For
     * Visualization").
     */
    public function receiveVisualization(array $params, array $body, array $query): void
    {
        $authHeader = $this->getAuthorizationHeader();
        if (!DigitalVaultClient::verifyInboundJwt($authHeader)) {
            Logger::error('DV receiveVisualization — inbound JWT verification failed');
            Response::error('Unauthorised', 401);
        }

        $proofOfPresentationId = (string)($body['proofOfPresentationId'] ?? '');
        $vcId                  = (string)($body['vcId'] ?? '');
        // Normalized to uppercase — the spec only documents ACTIVE/EXPIRED/REVOKED as
        // constants, but doesn't guarantee DV always sends that exact casing, and
        // requestStatus() queries this column with a literal 'ACTIVE' match.
        $status                = strtoupper((string)($body['Status'] ?? $body['status'] ?? ''));
        $fileType              = (string)($body['fileType'] ?? '');
        $infoB64               = (string)($body['visualizationInfo'] ?? $body['evidenceInfo'] ?? '');

        if ($proofOfPresentationId === '' || $vcId === '') {
            Response::error('Invalid visualization payload', 500);
        }

        // Resolve which credential (EmiratesId / DRIVING_LICENSE) this vcId is for, from
        // the map captured when the main presentation was received.
        $presentation = $this->db->queryOne(
            'SELECT vc_map FROM mn_dv_presentations WHERE proof_of_presentation_id = ? LIMIT 1',
            [$proofOfPresentationId],
        );
        $vcMap = $presentation ? (json_decode((string)($presentation['vc_map'] ?? '{}'), true) ?: []) : [];
        $documentType = $vcMap[$vcId] ?? null;

        $filePath = null;
        if ($status === 'ACTIVE' && $infoB64 !== '' && $fileType !== '') {
            try {
                $decoded = DigitalVaultClient::decodeVisualizationFile($infoB64, $fileType);
            } catch (\Throwable $e) {
                Logger::error('DV receiveVisualization — decode failed: ' . $e->getMessage());
                $decoded = null;
            }
            if ($decoded !== null) {
                $dir = API_ROOT . DIRECTORY_SEPARATOR . self::VISUALIZATION_PATH
                     . DIRECTORY_SEPARATOR . $proofOfPresentationId;
                if (!is_dir($dir)) {
                    @mkdir($dir, 0755, true);
                }
                $safeVcId = preg_replace('/[^A-Za-z0-9_-]/', '_', $vcId);
                $relPath = self::VISUALIZATION_PATH . "/{$proofOfPresentationId}/{$safeVcId}.{$decoded['ext']}";
                $fullPath = API_ROOT . DIRECTORY_SEPARATOR . $relPath;
                if (@file_put_contents($fullPath, $decoded['bytes']) !== false) {
                    $filePath = $relPath;
                }
            }
        }

        try {
            $this->db->execute(
                'INSERT INTO mn_dv_visualizations
                    (proof_of_presentation_id, vc_id, document_type, status, file_type,
                     file_path, issuer_signature, received_datetime)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    document_type    = VALUES(document_type),
                    status           = VALUES(status),
                    file_type        = VALUES(file_type),
                    file_path        = VALUES(file_path),
                    issuer_signature = VALUES(issuer_signature),
                    received_datetime = NOW()',
                [$proofOfPresentationId, $vcId, $documentType, $status, $fileType ?: null,
                 $filePath, $body['issuerSignature'] ?? null],
            );
        } catch (\Throwable $e) {
            Logger::error('DV receiveVisualization — DB insert failed: ' . $e->getMessage());
            Response::error('INVALID_VISUALIZATION', 500);
        }

        // Per UAE PASS's own feedback (2026-10-19): raw {"evidenceVisualizationReceiptID":
        // "..."} at the top level — same fix as the other two DV webhook responses.
        // This is almost certainly why UAE PASS reported never getting an expected
        // response from this endpoint specifically — the raw-bytecode search I'd used
        // to "confirm" the route existed earlier never actually exercised the response
        // body shape, just that *a* response came back.
        Response::json(['evidenceVisualizationReceiptID' => 'ATC-' . bin2hex(random_bytes(8))]);
    }

    /**
     * GET /api/dv/requests/{id}/visualization/{docType} — serves an already-received
     * card-scan file to the browser (ownership-checked via the owning mn_dv_presentations
     * row's user_id) so the wizard can pull it into the matching document-upload slot.
     * {id} is the proofOfPresentationRequestId, consistent with requestStatus() above.
     */
    public function serveVisualization(array $params, array $body, array $query): void
    {
        $requestId = (string)$params['id'];
        $docType   = (string)$params['docType'];

        $presentation = $this->db->queryOne(
            'SELECT proof_of_presentation_id FROM mn_dv_presentations
             WHERE proof_of_presentation_request_id = ? AND user_id = ? LIMIT 1',
            [$requestId, Auth::id()],
        );
        if (!$presentation) {
            Response::notFound('No such request');
        }

        $vis = $this->db->queryOne(
            "SELECT file_path, file_type FROM mn_dv_visualizations
             WHERE proof_of_presentation_id = ? AND document_type = ? AND status = 'ACTIVE' LIMIT 1",
            [$presentation['proof_of_presentation_id'], $docType],
        );
        if (!$vis || empty($vis['file_path'])) {
            Response::notFound('No visualization available');
        }

        $fullPath = API_ROOT . DIRECTORY_SEPARATOR . $vis['file_path'];
        if (!file_exists($fullPath)) {
            Response::notFound('File missing');
        }

        $mimes = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'png' => 'image/png'];
        $ext = strtolower(pathinfo($fullPath, PATHINFO_EXTENSION));
        header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
        header('Content-Disposition: inline; filename="' . $docType . '.' . $ext . '"');
        header('Content-Length: ' . filesize($fullPath));
        header('Cache-Control: private, max-age=3600');
        readfile($fullPath);
        exit;
    }

    private function getAuthorizationHeader(): ?string
    {
        $headers = function_exists('getallheaders') ? getallheaders() : [];
        foreach ($headers as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                return $value;
            }
        }
        return $_SERVER['HTTP_AUTHORIZATION'] ?? null;
    }
}
