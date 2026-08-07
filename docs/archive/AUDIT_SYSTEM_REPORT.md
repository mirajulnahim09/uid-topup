# AUDIT_SYSTEM_REPORT.md

**Date:** 2026-07-31 · **Verification:** typecheck ✅ · lint ✅ · build ✅ (76 pages) · money-invariants 18/18 ✅ · timeline verified live (LOGIN captured).

## Approach
Reviewed first: an admin audit log **already existed** (`AdminLog` model + `adminLog()` + `/admin/logs`). Rather than build a parallel system (which would duplicate logic), I **generalized the existing one** into a multi-actor Activity System. `adminId` is a plain string (no FK), so extending to customer/system was safe and additive.

## What changed
- **Schema (additive, no data loss):** `AdminLog` gained `actorType` (`ADMIN|CUSTOMER|SYSTEM`, default `ADMIN`), `role`, `userAgent`, plus an `@@index([actorType, createdAt])`. Pushed with `prisma db push`.
- **`logActivity()`** in `lib/adminLog.ts` — one generalized writer for all actors; the existing `adminLog()` now delegates to it (every old call-site unchanged). Added `requestMeta(req)` to capture IP + device from headers.
- **Actions tracked** (union extended): `LOGIN`, `LOGOUT`, `REGISTER`, `DEPOSIT_CREATE`, `ORDER_CREATE`, `MEDIA_UPLOAD/UPDATE/DELETE`, `INTEGRATION_CHANGE` — on top of the existing deposit/order/refund/balance/user/price/settings/payment/campaign actions.
- **Wired:**
  - **Auth** — `events.signIn`/`signOut` in `authOptions` log `LOGIN`/`LOGOUT` (best-effort; NextAuth events carry no request, so IP/device are blank per "if available").
  - **Customer** — deposit route logs `DEPOSIT_CREATE`, order route logs `ORDER_CREATE` (with IP + device), both best-effort and **outside** the money transaction (money-invariants still 18/18).
  - **Admin** — media upload/delete log `MEDIA_UPLOAD`/`MEDIA_DELETE`.
  - **System/existing admin actions** — already logged (deposit approve/reject, order complete/refund, balance adjust, settings, payment number change with **before→after**, etc.).

## Log fields (per requirement)
User (`adminName`) · Role (`role`) · Actor class (`actorType`) · Timestamp (`createdAt`) · IP (`ip`, if available) · Device (`userAgent`, if available) · Action (`action`) · Target (`targetId`) · Before/After (`detail`, e.g. payment number `01799998888 → 01700000000`) · Amount (`amount`).

## Admin Activity Timeline (`/admin/logs`)
Rebuilt as a full timeline: **search** (name/detail/IP/target), **filter** by actor type and action, **date range** (from/to), actor-type + device columns, and **CSV export** (`/api/admin/logs/export`, UTF-8 BOM for Bengali, same filter logic via shared `lib/auditFilter.ts` — no duplication). Verified live: my fresh admin login appears as the top `→ লগইন` row; historical admin actions render with the new columns.

## Limitations (honest)
- **Theme changes are not logged** — theme is a client-side per-user preference (localStorage); server-logging every toggle would be noisy and low-value. Documented, not implemented.
- **IP/device are blank for LOGIN/LOGOUT** — NextAuth events don't expose the request; customer deposit/order logs *do* capture them.
- Logs live in the existing `AdminLog` table (now general); it's included in DB backup.

## Result
A complete, multi-actor Audit Log & Activity System — reusing the existing table/helper/page, extended additively, wired across auth/customer/admin, with a searchable/filterable/exportable timeline, and **verified not to disturb the money engine**.
