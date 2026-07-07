<?php
declare(strict_types=1);

// ── RTA SOAP Service — Isolated Configuration ─────────────────────────────────
// This file is self-contained. No dependency on the v3 portal config.

// ── Database ──────────────────────────────────────────────────────────────────
define('RTA_DB_HOST',    'localhost');
define('RTA_DB_NAME',    'atc_prod');
define('RTA_DB_USER',    'root');
define('RTA_DB_PASS',    'root');
define('RTA_DB_CHARSET', 'utf8mb4');

// ── IP Whitelist ───────────────────────────────────────────────────────────────
// Set to empty array [] to disable (not recommended in production)
define('RTA_ALLOWED_IPS', [
    // '192.168.1.100',  // RTA production IP — add real IPs here
]);

// ── File Paths ─────────────────────────────────────────────────────────────────
// Points at the same document storage the staff portal (api/controllers/IDLController.php
// and CPDController.php) reads from, so requests submitted via RTA are visible to officers.
define('RTA_IDL_FILES_PATH', dirname(__DIR__, 2) . '/api/appointment-requests');
define('RTA_CPD_FILES_PATH', dirname(__DIR__, 2) . '/api/appointment-requests/cpd');
define('RTA_USER_FILES_PATH', dirname(__DIR__, 2) . '/public/user-images/users');
define('RTA_HOST',            'https://eservices.atcuae.ae');

// ── Timezone ───────────────────────────────────────────────────────────────────
define('RTA_TIMEZONE', 'Asia/Dubai');

// ── Payment / Fees (static values — mirrors the public portal's IDL config) ────
define('RTA_IDP_FEE',      '170');
define('RTA_DELIVERY_FEE', '8.50');
define('RTA_VAT_PERCENT',  5.0);

// ── Logging ────────────────────────────────────────────────────────────────────
define('RTA_LOG_DIR', __DIR__ . '/logs');
