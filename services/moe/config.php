<?php
declare(strict_types=1);

// ── MOE SOAP Service — Isolated Configuration ─────────────────────────────────
// This file is self-contained. No dependency on the v3 portal config.
// "MOE" here is the legacy name carried over from the original service
// (class.moe_service.php) — the actual EntityName reported to the consumer is
// "Ministry of Energy and Infrastructure" (MOEI), a government revenue-reporting
// feed, not an application-facing integration.

// ── Database ──────────────────────────────────────────────────────────────────
define('MOE_DB_HOST',    'localhost');
define('MOE_DB_NAME',    'atc_prod');
define('MOE_DB_USER',    'root');
define('MOE_DB_PASS',    'root');
define('MOE_DB_CHARSET', 'utf8mb4');

// ── IP Whitelist ───────────────────────────────────────────────────────────────
// Set to empty array [] to disable (not recommended in production)
define('MOE_ALLOWED_IPS', [
    // '192.168.1.100',  // MOE production IP — add real IPs here
]);

// ── Timezone ───────────────────────────────────────────────────────────────────
define('MOE_TIMEZONE', 'Asia/Dubai');

// ── Logging ────────────────────────────────────────────────────────────────────
define('MOE_LOG_DIR', __DIR__ . '/logs');
