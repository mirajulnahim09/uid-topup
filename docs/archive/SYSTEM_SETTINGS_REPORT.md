# SYSTEM_SETTINGS_REPORT.md

**Date:** 2026-07-31

## Review finding
Settings are **already centralized and config-driven** — a single `Setting` key/value table (`lib/settings.ts`, 30 s cache + `invalidateSettings()`), written only through the audited, allow-listed `/api/admin/settings` route, and surfaced across **purpose-built admin pages**. There are **no hardcoded business values**; where a setting is absent, a safe default is used (e.g. `min_deposit=20`), which is correct fallback behaviour, not a hardcode.

Per the guardrails (*reuse existing, avoid duplication*), I did **not** rebuild the working settings forms into a single mega-page. Instead this report maps the 13 requested groups to their existing, purpose-built surfaces.

## Category → where it's configured (all from the Admin Panel)
| Group | Keys / Surface |
|---|---|
| **General** | `site_name`, `site_logo`, `site_url` — `/admin/site` |
| **Security** | admin role (DB), rate limits (`lib/rateLimit`), CSP/headers (`middleware.ts`), secrets (env) |
| **Payment** | fulfillment modes + provider enable — **`/admin/payments`** (`pay_mode`, `deposit_approval`, `order_approval`, `refund_mode`, `provider_*_enabled`); manual channels via `/api/admin/payment` |
| **Order** | `order_approval` (`/admin/payments`); SLA in settings |
| **Wallet** | `min_deposit`, `max_deposit`, `referral_bonus`, `referral_min_deposit` — `/admin/site` |
| **Notification** | `telegram_bot_token`, `telegram_chat_id`, `tawk_property_id`, `tawk_widget_id` — `/admin/site` |
| **Homepage** | `hero_title/subtitle`, `home_live_activity*`, `home_trust_*`, banners/campaigns — **`/admin/homepage`**, `/admin/banners` |
| **Theme** | client preference (`ThemeProvider`, localStorage) + accent tokens; default accent = lime |
| **Product** | products/variants/cover media — `/admin/products`, `/admin/media` |
| **Campaign** | popups/hero/slider/notice/float — `/admin/homepage` (Campaign model) |
| **Support** | `support_email`, `support_phone`, `support_hours`, `float_contact_*` — `/admin/site` |
| **API / Integrations** | **`/admin/integrations`** (SMS/email/push/webhook/AI/analytics + storage/payment status), `integration_*` keys |
| **Maintenance** | `maintenance_mode`, `maintenance_message` — `/admin/tools` |

## Guarantees
- **No arbitrary keys** — the settings route allow-lists exact keys plus the bounded `integration_*` pattern; every value is `cleanText`-sanitised (XSS-safe), numbers/URLs validated.
- **Audited** — every settings change writes an `AdminLog` `SETTINGS_CHANGE` row (visible in the Activity Timeline, incl. before→after for payment numbers).
- **Cache-consistent** — writes call `invalidateSettings()` so changes apply immediately.

## Recommendation (optional, not done to avoid duplication)
A thin `/admin/settings` **index** page that links to these grouped surfaces would give a single entry point without re-implementing any form. Left as a documented future consolidation.
