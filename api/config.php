<?php
declare(strict_types=1);

final class Config
{
    // Load from environment variables — never hardcode in production
    public const DB_HOST     = 'localhost';
    public const DB_NAME     = 'atc_prod';
    public const DB_USER     = 'root';       // override via env: DB_USER
    public const DB_PASS     = 'root';           // override via env: DB_PASS
    public const DB_CHARSET  = 'utf8mb4';
    public const DB_PREFIX   = 'mn_';

    public const IS_LIVE      = false;
    // Fallback only — used when no request context is available (e.g. CLI). Real
    // requests resolve the frontend origin dynamically via Config::frontendUrl(),
    // so this never needs per-environment editing (local/staging/production).
    public const FRONTEND_URL = 'http://v2.eservices.local';
    public const TIMEZONE     = 'Asia/Dubai';

    public const IDL_AMOUNT             = 160.00;
    public const IDL_ADMIN_FEE           = 10.00;  // administration fee added on top of the IDL fee
    public const CPD_EXTRA_DRIVER_FEE   = 50.00;
    public const DELIVERY_FEE  = 15.75;   // delivery surcharge when send_to_address / home_delivery
    public const CPD_PENALTY           = 150.00;
    public const CPD_DELIVERY_FEE = 30.00;

    /** Directory where IDL appointment document uploads are stored (relative to API root) */
    public const UPLOADS_DIR    = 'appointment-requests';

    /** Directory where CPD document uploads are stored (relative to API root) */
    public const CPD_IMAGE_PATH = 'appointment-requests/cpd';

    /** Max file size for document uploads in bytes (2 MB) */
    public const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

    // ── Telr Payment Gateway ──────────────────────────────────────────────────
    public const TELR_TEST      = '1';
    public const TELR_STORE_ID  = '15870';
    public const TELR_AUTH_KEY  = 'SjKmt-Wz8D@Z5nkR';
    public const TELR_CURRENCY  = 'aed';
    /** Resolve a config value from ENV first, then fall back to constant */
    public static function env(string $key, mixed $default = null): mixed
    {
        $val = getenv($key);
        return $val !== false ? $val : $default;
    }

    /** The scheme+host the current request actually arrived on, falling back to FRONTEND_URL outside a request (e.g. CLI). */
    public static function frontendUrl(): string
    {
        if (!empty($_SERVER['HTTP_HOST'])) {
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            return $scheme . '://' . $_SERVER['HTTP_HOST'];
        }
        return self::FRONTEND_URL;
    }

    public static function telrReturnUrl(): string  { return self::frontendUrl() . '/payment-success'; }
    public static function telrDeclineUrl(): string { return self::frontendUrl() . '/payment-declined'; }
    public static function telrCancelUrl(): string  { return self::frontendUrl() . '/payment-cancelled'; }
}

// ── Aramex Shipment API ───────────────────────────────────────────────────────
define("ARAMAX_CREATE_SHIPMENT_URL","https://ws.sbx.aramex.net/ShippingAPI.V2/Shipping/Service_1_0.svc/json/CreateShipments");
define("ARAMAX_USERNAME","testingapi@aramex.com");
define("ARAMAX_PASSWORD","R123456789\$r");
define("ARAMAX_ACCOUNT_NO","45796");
define("ARAMAX_ACCOUNT_PIN","116216");
