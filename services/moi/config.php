<?php
declare(strict_types=1);

// ── MOI SOAP Service — Isolated Configuration ─────────────────────────────────
// This file is self-contained. No dependency on the v3 portal config.

// ── Database ──────────────────────────────────────────────────────────────────
define('MOI_DB_HOST',    'localhost');
define('MOI_DB_NAME',    'atc_prod');
define('MOI_DB_USER',    'root');
define('MOI_DB_PASS',    'root');
define('MOI_DB_CHARSET', 'utf8mb4');

// ── IP Whitelist ───────────────────────────────────────────────────────────────
// Set to empty array [] to disable (not recommended in production)
define('MOI_ALLOWED_IPS', [
    // '192.168.1.100',  // MOI production IP — add real IPs here
    // '10.0.0.1',
]);

// ── File Paths ─────────────────────────────────────────────────────────────────
define('MOI_IDL_FILES_PATH', dirname(__DIR__, 4) . '/public/user-images/idl/appointment-requests');
define('MOI_CPD_FILES_PATH', dirname(__DIR__, 4) . '/public/user-images/cpd/appointment-requests');
define('MOI_USER_FILES_PATH', dirname(__DIR__, 4) . '/public/user-images/users');
define('MOI_FONTS_PATH',      dirname(__DIR__, 4) . '/public/fonts');
define('MOI_IMAGES_PATH',     dirname(__DIR__, 4) . '/public/images');
define('MOI_HOST',            'https://eservices.atcuae.ae');

// ── Timezone ───────────────────────────────────────────────────────────────────
define('MOI_TIMEZONE', 'Asia/Dubai');

// ── Payment / Fees (static values from legacy code) ────────────────────────────
define('MOI_IDP_FEE',           '170');
define('MOI_DELIVERY_FEE',      '8.50');
define('MOI_COURIER_CHARGES',   '25.00');
define('MOI_GUARANTEE_BANK_PCT', 2.5);     // 2.5% bank charges on guarantee amount

// ── Banking Details ─────────────────────────────────────────────────────────────
define('MOI_BANK_ACCOUNT',     '1015011174901');
define('MOI_BANK_IBAN',        'AE 60026000 1015 0111 74901');
define('MOI_BANK_BENEFICIARY', 'AUTOMOBILE & TOURING CLUB OF THE UAE');
define('MOI_BANK_BENE_ADDR',   'PO BOX 5078, Dubai, UAE');
define('MOI_BANK_NAME',        'Emirates NBD');
define('MOI_BANK_ADDR',        'Emirates NBD, Main Branch, Dubai, UAE');
define('MOI_BANK_SWIFT',       'EBILAEAD');

// ── Logging ────────────────────────────────────────────────────────────────────
define('MOI_LOG_DIR', __DIR__ . '/logs');
