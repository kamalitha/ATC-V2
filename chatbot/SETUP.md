# ATC UAE WhatsApp Chatbot — Setup Guide

## Prerequisites

- Meta Business Account (business.facebook.com)
- Meta Developer Account (developers.facebook.com)
- Public HTTPS server (the webhook URL must be accessible by Meta)
- PHP 8.1+ with cURL extension
- Access to atc_prod MySQL database

---

## Step 1 — Meta App Setup

1. Go to https://developers.facebook.com → **My Apps** → **Create App**
2. Choose **Business** as the app type
3. Give it a name (e.g. "ATC UAE Chatbot") and click **Create App**
4. In your app dashboard, find **WhatsApp** and click **Set Up**

---

## Step 2 — Get Your Credentials

In your Meta App → WhatsApp → API Setup:

| Credential | Where to find it |
|---|---|
| `WA_PHONE_NUMBER_ID` | Shown on the API Setup page as "Phone number ID" |
| `WA_ACCESS_TOKEN` | Generate a **permanent token** via System Users in Business Settings |
| `WA_VERIFY_TOKEN` | Any secret string you choose (e.g. `atc-whatsapp-2025`) |

> **Important:** The temporary token expires in 24 hours. Always use a permanent token via:
> Meta Business Settings → System Users → Add System User (Admin) → Generate Token → Select your WhatsApp app → All permissions

---

## Step 3 — Deploy the Bot

1. Upload the entire `whatsapp-bot/` folder to your server
2. Edit `config.php` with your real credentials:

```php
define('WA_PHONE_NUMBER_ID',  '1234567890');
define('WA_ACCESS_TOKEN',     'EAAxxxxxxxxxxxxxxxx');
define('WA_VERIFY_TOKEN',     'atc-whatsapp-2025');
```

3. Make sure `sessions/` and `logs/` directories are writable:
```bash
chmod 755 sessions/ logs/
```

4. The webhook URL will be: `https://yourdomain.com/whatsapp/webhook.php`

---

## Step 4 — Register the Webhook

In Meta App → WhatsApp → Configuration → Webhooks:

1. Click **Edit**
2. **Callback URL:** `https://yourdomain.com/whatsapp/webhook.php`
3. **Verify Token:** (same value as `WA_VERIFY_TOKEN` in config.php)
4. Click **Verify and Save**
5. Under Webhook Fields, subscribe to: **messages**

---

## Step 5 — Test

In Meta App → WhatsApp → API Setup, add your personal WhatsApp number as a test recipient, then send a message to your business number.

---

## Conversation Flows

### Main Menu
```
User: hi / hello / menu
Bot:  [buttons] IDL Status | CPD Status | Support
```

### IDL Status Flow
```
User: IDL Status
Bot:  Ask for Request ID or Emirates ID
User: IDL-ATC-20250501/123  OR  784-1990-1234567-1
Bot:  Show application details + status
```

### CPD Status Flow
```
User: CPD Status
Bot:  Ask for Request ID
User: CPD-ATC-20250501/456
Bot:  Show vehicle, status, amount
```

### Support Ticket Flow
```
User: Support
Bot:  Select category (IDL / CPD / General)
Bot:  Enter subject
Bot:  Describe the issue
Bot:  Enter email
Bot:  Confirm → creates ticket in mn_support_tickets
Bot:  Return ticket number (TKT-YYYYMMDD/NNN)
```

---

## Global Commands (work in any state)

| User types | Action |
|---|---|
| hi / hello / hey / menu | Return to main menu |
| 0 / back / cancel | Return to main menu |

---

## File Structure

```
whatsapp-bot/
├── webhook.php          ← Public entry point (configure this URL in Meta)
├── config.php           ← Credentials and settings
├── src/
│   ├── WhatsApp.php     ← API sender (text, buttons, lists, templates)
│   ├── SessionManager.php ← Per-user conversation state
│   ├── DB.php           ← ATC database queries
│   ├── Logger.php       ← Daily log files
│   └── Workflows.php    ← All conversation flows + Router
├── sessions/            ← Per-user session files (auto-created)
└── logs/                ← Daily log files (auto-created)
```

---

## Adding New Flows

1. Add a new class in `src/Workflows.php`:
```php
class MyNewFlow
{
    public static function handle(string $phone, array &$session, string $input): bool
    {
        // handle steps, return true when handled
    }
}
```

2. Register it in `Router::route()`:
```php
'my_flow' => MyNewFlow::handle($phone, $session, $input),
```

3. Add it to the main menu buttons and `handleMainMenuInput()`.

---

## Production Recommendations

- **Session storage:** Replace file-based sessions with a Redis or MySQL table for multi-server deployments
- **Rate limiting:** Add a per-phone rate limiter to prevent spam
- **Approved templates:** For proactive messages (outside 24h window), create pre-approved templates in Meta App → WhatsApp → Message Templates
- **Monitoring:** Check `logs/YYYY-MM-DD.log` daily for errors
