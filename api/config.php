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

    // IDL fee, split for the breakdown shown to EMSO online/walkin customers — VAT
    // applies only to (base + delivery); the service fee is added after VAT, untaxed.
    // Distributor/MOI/RTA pricing is entirely separate (services/moi, services/rta)
    // and unaffected by these constants.
    public const IDL_BASE_FEE    = 160.00;
    public const IDL_SERVICE_FEE = 10.00;
    public const CPD_EXTRA_DRIVER_FEE   = 50.00;
    public const DELIVERY_FEE  = 15.00;   // delivery surcharge when send_to_address / home_delivery
    public const CPD_PENALTY           = 150.00;
    public const CPD_DELIVERY_FEE = 25.00;   // new-carnet home delivery — separate from the return pickup fee below
    public const CPD_RETURN_PICKUP_FEE = 100.00;   // Aramex pickup fee when returning a carnet

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

    // ── Mailjet (transactional email) ────────────────────────────────────────
    public const MJ_API_KEY  = '4b357e06d6c0bd7489f2afa8029224c5';
    public const MJ_SECRET   = '45dc5df60ab1b4c6ae55137a8a347d45';
    public const MJ_RESET_PASSWORD_TEMPLATE = 4360118;
    // Ported from the legacy system's IDLManagementController (same Mailjet template
    // IDs) — unverified against the current Mailjet account, since the legacy code's
    // own send call was commented out there and evidently never exercised in production.
    public const MJ_IDL_PAYMENT_CONFIRMED_TEMPLATE    = 7203055;
    public const MJ_IDL_READY_FOR_COLLECTION_TEMPLATE = 887450;
    public const MJ_IDL_DISPATCHED_TEMPLATE           = 865908;
    // CPD had zero email notifications before this batch — no legacy template IDs exist
    // to port. These are PLACEHOLDERS (0 = deliberately invalid) — replace with real
    // Mailjet template IDs once created. Every send call wraps this in try/catch and
    // logs on failure rather than breaking the underlying action, same as the IDL calls
    // above, so a placeholder ID here is safe to ship.
    public const MJ_CPD_PAYMENT_CONFIRMED_TEMPLATE  = 0;
    public const MJ_CPD_DISPATCHED_TEMPLATE         = 0;
    public const MJ_CPD_CORRECTION_NEEDED_TEMPLATE  = 0;
    public const MJ_CPD_RETURN_APPROVED_TEMPLATE    = 0;
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

    // ── UAE PASS (staging) ──────────────────────────────────────────────────────
    // Authentication (OIDC login) only — the Digital Vault (document-sharing) product
    // used by the IDL/CPD wizard's "Continue with UAE PASS" step is separate and not
    // wired up yet; UAEPASS_DV_SECRET is stored here for that future work.
    public const UAEPASS_CLIENT_ID     = 'atcuae_emso_web_stage';
    public const UAEPASS_CLIENT_SECRET = 'bupdaiXezhPsZfwW';
    public const UAEPASS_DV_SECRET     = '0061b32b9b3372e4ef224d2ec54fc2c4';
    public const UAEPASS_BASE_URL      = 'https://stg-id.uaepass.ae'; // production: https://id.uaepass.ae

    public static function uaePassRedirectUri(): string { return self::frontendUrl() . '/uaepass-auth-success'; }
}

// ── Aramex Shipment API ───────────────────────────────────────────────────────
define("ARAMAX_CREATE_SHIPMENT_URL","https://ws.uat.aramex.net/ShippingAPI.V2/Shipping/Service_1_0.svc/json/CreateShipments");
define("ARAMAX_USERNAME","testingapi@aramex.com");
define("ARAMAX_PASSWORD","R123456789\$r");
define("ARAMAX_ACCOUNT_NO","45796");
define("ARAMAX_ACCOUNT_PIN","116216");
