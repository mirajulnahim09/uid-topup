# MANUAL_PRO.md — UID TopUp Engineering Manual

> The single source of truth for this codebase. Written so a senior developer who has never seen the project can build, run, extend, and operate it without any other document. Last verified: 2026-07-31 (typecheck ✅ · lint ✅ · build ✅ · money-invariants 18/18 ✅ · responsive+a11y sweep 0 issues in both themes).
>
> **§20 (bottom of this file) documents the systems added in the 2026-07-31 pass** — dark/light/system theme, accent system, central Media Library + storage abstraction, product cover images, and the design-token layer. Read §20 alongside the older sections; where they differ, §20 is newer.

---

# 1. Project Overview

## Purpose
**UID TopUp** is a **manual (human-operated) Free Fire diamond top-up e-commerce platform** for the Bangladesh market. Customers buy in-game currency (Free Fire diamonds) and digital subscriptions (YouTube/Netflix/Prime, grouped under "SMM"). UI copy is primarily **Bengali**; code comments are frequently Bengali too — preserve that convention.

## The core business model (read this first — everything follows from it)
**There is no payment gateway.** The money flow is deliberately manual:

1. Customer sends money via **bKash / Nagad / Rocket / Upay** to a fixed account number shown on the site.
2. Customer submits a **Deposit** claim (amount, method, sender number, transaction ID, optional screenshot). No money moves yet.
3. An **admin manually cross-checks** the transaction in their own banking app and **approves or rejects** it.
4. Approval credits the customer's **in-app wallet balance** (with a ledger entry).
5. Customer **spends wallet balance** on Orders. Order starts `PENDING`; admin manually delivers in-game and marks `COMPLETED` (or `FAILED`, which auto-refunds).

The entire security model rests on **a human verifying a real bank transaction before any balance moves.** Never add auto-approval based on client data.

## Goals
- Trustworthy manual commerce in a market where buyers are frequently scammed (honesty and transparency are the product).
- Zero fabricated marketing claims — only real, computed data is shown.
- A premium, gaming-native front-end that reads as a brand, not a template.
- Correct money handling under concurrency (no double-spend, no over-redemption, no lost refunds).

## Architecture
Monolithic **Next.js 14 App Router** application (server + client in one deploy), talking to a **PostgreSQL** database via **Prisma**, with **NextAuth** for auth. Rendered mostly as **React Server Components** that call Prisma directly and pass serializable props to small `'use client'` islands. Deploy target: **Vercel serverless**.

```
Browser ── Next.js (RSC + Client islands) ── Route Handlers (/api/*) ── Prisma ── PostgreSQL (Neon)
                     │                              │
              NextAuth (JWT)                 lib/* (business logic, guards, money, validation)
```

## Tech stack
| Layer | Choice |
|---|---|
| Framework | Next.js 14.2.35 (App Router, TypeScript, React 18) |
| DB / ORM | PostgreSQL (Neon) + Prisma 5 (all money fields `Decimal(12,2)`) |
| Auth | NextAuth v4 (JWT sessions; Credentials + optional Google OAuth) |
| Styling | Tailwind CSS 3 + CSS custom properties (two design systems: **VOLT** + **Maison**) |
| Animation | Framer Motion + GSAP/ScrollTrigger (React Three Fiber was removed) |
| Storage | Vercel Blob (images, optional) |
| Email | Resend (transactional, optional) |
| Tests | `scripts/money-invariants.ts` (money correctness) |

Optional integrations (Blob, Resend, Google OAuth) **degrade gracefully** when their env vars are absent.

---

# 2. Folder Structure

```
prisma/
  schema.prisma          Source of truth for the data model (21 models, 11 enums)
  seed.ts                Seeds categories/products/admin user/settings
  constraints.sql        DB-level CHECK constraints (non-negative balance/price, discount ≤ subtotal)
  apply-constraints.ts   Applies constraints.sql (wired into db:setup)

scripts/
  money-invariants.ts    `npm run test:money` — verifies the money model end-to-end (18 checks)

src/
  middleware.ts          Runs on every request: route protection (JWT+role) + security headers (CSP/HSTS/…)
  app/
    (public)/            Public routes: home, product pages, login/register, legal, faq, contact, track
    account/             Customer-only routes (gated) — orders, wallet/deposit, profile, notifications
    admin/               Admin-only routes (triple-gated) — dashboard, orders, deposits, products, etc.
    api/                 All 39 route handlers (see §4)
    layout.tsx, globals.css, error/loading/not-found
  components/            Shared UI (customer + public)
    home/                Homepage sections (HeroDeck, Arsenal, TrustGrid, CampaignSlider, …)
    admin/               Admin-panel components (tables, managers, forms)
    fx/                  Visual effects (SiteBackground, CustomCursor, Diamond, SafeImage, Icon)
  lib/                   ALL business logic, guards, money, validation, integrations (see §12–14)
  types/                 next-auth type augmentation
```

**Key `lib/` files:** `prisma.ts` (client + env assertion), `guard.ts` (`requireUser`/`requireAdmin`/`apiError`/`ApiError`), `auth.ts` (NextAuth config), `validation.ts` (zod schemas), `sanitize.ts` (XSS guards), `rateLimit.ts` (shared Postgres limiter), `money.ts` (rounding/formatting), `services/wallet.ts` (credit/debit + ledger), `coupon.ts`, `referral.ts`, `settings.ts` (cached), `campaigns.ts` / `liveActivity.ts` / `showcase.ts` / `trustMetrics.ts` (homepage read models), `date.ts` (Asia/Dhaka), `sla.ts`, `opsStatus.ts`, `upload.ts`, `email.ts`, `notify.ts`.

---

# 3. Database

All money is `Decimal(12,2)`. Never use float/int-cents. Every mutation to `User.balance`, `Variant.stock`, `Deposit.status`, or `Coupon.usageCount` must run inside `prisma.$transaction` with `SELECT … FOR UPDATE` row locks (see §5).

## Tables (why each exists)

| Model | Purpose |
|---|---|
| **User** | Customers + the owner (`role` USER/ADMIN). Holds `balance` (wallet), `referralCode`/`referredById`/`referralBonusPaid`, `isBanned`/`status`, and `emailVerified` (used by the OAuth-takeover guard, §13). |
| **Category** | Top-level catalogue grouping (Free Fire, subscriptions…). `isActive`, `sortOrder`. |
| **Product** | A sellable item within a category (e.g. "Free Fire BD Server"). `needsUid`/`uidLabel`/`uidHint` describe what the customer must enter. |
| **Variant** | A specific package/price of a product (e.g. "115 Diamond"). Holds `price`, `costPrice`, `oldPrice` (for discounts), `stock`, `isPopular`, `deliveryMinutes`. **This is what an Order references.** |
| **Coupon** | Discount codes. `type` (PERCENT/FLAT), `value`, `minOrder`, `maxDiscount`, `usageLimit`, `usageCount`, `perUserLimit`, `startsAt`/`expiresAt`. |
| **CouponUse** | One row per redemption (couponId, userId, orderId, discount) — enforces per-user limits and audits usage. |
| **Deposit** | A customer's claim that they sent money. `amount`, `method`, `senderNo`, `trxId`, `screenshot`, `status` (PENDING/APPROVED/REJECTED), `intent`, `rejectReason`. Approval credits the wallet. |
| **Order** | A purchase. Stores a **price snapshot** (`productName`, `variantName`, `subtotal`, `discount`, `price`) independent of live rows, plus `playerUid`, `status`, `slaDueAt`, `trackToken` (login-free tracking), `couponId`, refund fields. |
| **OrderEvent** | Append-only timeline of an order's status changes (`recordOrderEvent`), with actor type/id — the customer-facing order history. |
| **LedgerEntry** | **The audit trail for every balance change** (DEPOSIT/ORDER/REFUND/ADMIN_ADJUST/REFERRAL_BONUS), each with `balanceAfter`. Written in the same transaction as the balance mutation. The ledger sum must always equal the current balance. |
| **Banner** | Legacy homepage banner slider (image/title/subtitle/link). Fallback when no `Campaign(SLIDER)` exists. |
| **Campaign** | **The unified homepage marketing table** (see §8). One row = one scheduled, admin-authored marketing item, discriminated by `placement` (POPUP/HERO/SLIDER/NOTICE/STRIP/PROMO/FLOAT) and `kind`. |
| **PaymentChannel** | The live bKash/Nagad/Rocket/Upay account numbers customers send money to. **The seeded number is a placeholder — must be changed before go-live.** |
| **SocialLink** | Footer social links + the floating-contact source (WhatsApp/Telegram). |
| **Review** | Customer reviews (`isPublished`, `rating`) — feed the honest average-rating trust stat. |
| **TrustMetric** | A cache table for computed homepage stats (`getTrustStats` upserts here with a 10-min TTL). |
| **UidLookupCache** | Caches third-party Free Fire UID → player-name lookups to save quota. |
| **Notification** | In-app notifications (bell icon). |
| **Setting** | Key/value site configuration (site name, payment/support info, SLA, homepage toggles). Read through the cached `settings.ts`. |
| **AdminLog** | "Who did what, when, from which IP" — written by **every** admin route (fire-and-forget). The accountability record for disputes. |
| **RateLimitBucket** | Shared rate-limit counters (`key`, `count`, `resetAt`) so throttling works across serverless instances (§13). |

## Relationships
- `Category 1─* Product 1─* Variant` — the catalogue tree.
- `User 1─* Order`, `User 1─* Deposit`, `User 1─* LedgerEntry`, `User 1─* Notification`, `User 1─* Review`, `User 1─* CouponUse`.
- `Variant 1─* Order` (an order buys one variant; the order snapshots the price).
- `Order 1─* OrderEvent` (timeline); `Order 0..1─ Coupon` via `couponId`; `Order 1─* CouponUse`.
- `Coupon 1─* CouponUse`.
- `User self-relation` via `referredById` (referrer ↔ referrals).

## Migrations / setup
Schema changes go through `prisma/schema.prisma` + `npx prisma db push` (additive changes are safe on Neon; a data-loss prompt means stop and think). `npm run db:setup` = `db push` + seed + **apply constraints**. The app-layer transaction guards are the real guarantee; `constraints.sql` is defence-in-depth.

---

# 4. APIs

All handlers live in `src/app/api/**/route.ts`. **Contract every handler follows:**

1. **Auth first:** `const user = await requireUser()` or `const admin = await requireAdmin()` (from `lib/guard.ts`). These re-verify role/ban against the DB on **every** call — never trust `session.user.role` directly.
2. **Rate limit** abusable endpoints: `const rl = await rateLimit(key, limit, windowSec)` → 429 if `!rl.ok`.
3. **Validate** the body with a zod schema from `lib/validation.ts` (`schema.safeParse(await req.json())`).
4. **Sanitize** any user text that will later render (`cleanText`/`safeUrl`/`cleanName`).
5. **Never trust client prices** — re-derive from the DB inside the transaction.
6. Wrap the body in `try { … } catch (e) { return apiError(e); }`. Throw `ApiError(message, status)` for expected failures.
7. Admin mutations call `adminLog({…}).catch(()=>{})` (fire-and-forget, outside the money transaction).

## Request → response flow (example: place an order, `POST /api/order`)
`requireUser()` → `await rateLimit('order:<id>')` → zod `orderSchema` → **one `$transaction`**: lock Variant `FOR UPDATE` → re-read price from DB → (if coupon) lock Coupon `FOR UPDATE` + `validateCoupon` → lock User `FOR UPDATE` → check balance → decrement stock → create Order (snapshot) → consume coupon → write OrderEvent → `debitWallet` (balance − ledger) → commit → (outside txn) notify + email → `Response.json`.

## Route inventory (39)
**Auth/session:** `auth/[...nextauth]`, `auth/forgot`, `auth/reset`, `register`, `me`.
**Customer money/order:** `order`, `order/direct`, `order/confirm`, `deposit`, `deposit/check-trx`, `coupon/check`, `notifications`, `review`, `account/profile`, `account/password`.
**Public utility:** `track` (login-free order tracking, rate-limited by IP), `uid/verify`, `uid/recent`, `upload`.
**Admin (all `requireAdmin` + `adminLog`):** `admin/deposit`, `admin/order`, `admin/order/bulk`, `admin/order/claim`, `admin/order/refund`, `admin/user`, `admin/product`, `admin/variant`, `admin/coupon`, `admin/banner`, `admin/campaign`, `admin/payment`, `admin/social`, `admin/settings`, `admin/announce`, `admin/search`, `admin/reports`, `admin/upload`, `admin/backup`, `admin/restore`.

## Authentication & authorization
- **Auth:** NextAuth JWT sessions (no DB adapter). Credentials provider (bcrypt cost 12, constant-time dummy-hash to prevent user enumeration) + optional Google. The JWT callback re-verifies role/ban from the DB on every refresh so a banned user's old token dies.
- **Authz (triple-gated):** `middleware.ts` (JWT presence + role for `/admin` & `/account`) → `admin/layout.tsx` (re-check) → `requireAdmin()`/`requireUser()` per API call (DB re-verification). Keep all three layers for any new gated surface.

---

# 5. Money Invariants (load-bearing — never simplify)

These are the rules the platform's integrity depends on. `npm run test:money` verifies them (18 checks).

1. **Row-locked transactions.** Any check-then-write on `User.balance`, `Variant.stock`, `Deposit.status`, or `Coupon.usageCount` runs in `$transaction` with `SELECT … FOR UPDATE` on the checked rows, re-reading the **locked** value (not a stale pre-transaction read). Lock order is consistent (**variant → coupon → user**) to avoid deadlocks.
2. **Ledger for every balance change.** `services/wallet.ts` `creditWallet`/`debitWallet` write a `LedgerEntry` with `balanceAfter` in the same transaction. Ledger sum == current balance, always.
3. **Snapshot pricing.** Orders store their own `productName/variantName/subtotal/discount/price` — never join back to live rows to "correct" a historical order.
4. **Atomic refunds.** `FAILED` orders restore balance **and** stock **and** coupon usage together, in one transaction, with a locked-status re-check to prevent double-refund.
5. **Coupon concurrency (fixed).** The Coupon row is locked `FOR UPDATE` before validation so concurrent orders can't exceed `usageLimit`/`perUserLimit`.
6. **Referral one-time payout.** `referralBonusPaid` flag + explicit `FOR UPDATE` on the referred user prevents double bonus.

---

# 6. Homepage

The homepage (`src/app/(public)/page.tsx`) is a **story**, each section with its own geometry, and **every marketing element is admin-controlled or derived from real data** — nothing hardcoded; a section renders nothing when it has no data. Order:

| # | Section | Component | Why it exists / how it works | Admin control |
|---|---|---|---|---|
| — | Ops status bar | `OpsStatusBanner` | Real-time "are we busy / office hours" computed from open orders + SLA settings. Affects the buy-now decision. | Support hours/SLA in Settings; content is computed, not authored. |
| — | Notice bar | `NoticeBar` (Campaign NOTICE) → falls back to `site_notice` setting | Scrolling marquee / breaking-news; sets expectations above the fold. | Admin → হোমপেজ (Campaign NOTICE) or Settings `site_notice`. |
| 01 | Hero | `HeroDeck` + `OperatorMascot` | The 3-second pitch. Command-console framing; an SVG cyber-sentinel mascot (the "human verifier" made visible) whose visor tracks the cursor. Headline/sub/CTA/status/highlights are admin-driven with strong fallbacks. | Campaign HERO (title/subtitle/CTA/image/badge) + Campaign STRIP (highlight chips) + Settings. |
| — | Ticker | `Ticker` | Counter-scrolling verifiable promises — pure CSS, zero per-frame JS. | Static (honest claims only). |
| — | Campaign slider | `CampaignSlider` (Campaign SLIDER) → falls back to `BannerSlider` | Promo carousel with countdown/flash-sale styling. | Admin → হোমপেজ (SLIDER) or Banners. |
| 02 | Operator Story | `OperatorStory` | "Who does the work" — a sticky terminal with GSAP scroll-driven verification beats (uses `position: sticky`, not ScrollTrigger `pin`). | Static narrative. |
| 03 | Product Showcase | `Arsenal` (data from `showcase.ts`) | The catalogue: category tabs (sliding `layoutId` indicator), search, premium imageless cards showing **starting price** + data-derived badges (Sold Out / % off / জনপ্রিয়/popular / নতুন/new) + a "এই মুহূর্তে জনপ্রিয়" best-seller rail (real completed-order counts or admin-flagged popular). | Products/variants/`isPopular` in admin; badges computed from real data. |
| 04 | Trust & Social Proof | `TrustGrid` + `LiveActivity` | Trust strip (icon promises), **live recent-deliveries feed** (real COMPLETED orders, first-name-masked), **real stats** (`getTrustStats`), the 100%-refund/safety/ledger bento, and a payment-method band. | Admin toggles `home_trust_strip`/`home_live_activity`/`home_trust_stats`; live feed shows only real orders. |
| — | Closing CTA | `CtaBlock` | Final push with an oversized bleeding wordmark. | Static. |
| — | Overlays | `PopupHost`, `FloatingCard`, `FloatingContact` | Entry popup (Campaign POPUP), floating campaign card (Campaign FLOAT), persistent WhatsApp/Telegram button (`float_contact_*` settings, bottom-right — opposite the floating card). | Admin → হোমপেজ + Settings. |

**Read models (all read-only, self-guarded — return empty on DB failure so the page never breaks):** `showcase.ts` (catalogue + badges + best-sellers), `liveActivity.ts` (masked recent deliveries), `trustMetrics.ts` (honest stats or nothing), `campaigns.ts` (all Campaign placements, schedule-window filtered).

---

# 7. Customer Flow

1. **Browse** by category (public, no login) → product detail with variants and live price/stock.
2. **Register/Login** (email+password or Google). Registration is rate-limited; passwords bcrypt-hashed.
3. **Add money:** send bKash/Nagad/etc. to the displayed number → submit a **Deposit** (amount/method/sender/trxId/screenshot) → status `PENDING`.
4. **Wait for approval:** admin verifies → wallet credited (LedgerEntry `DEPOSIT`) → notification/email. First qualifying deposit also pays a one-time **referral bonus** to the referrer.
5. **Order:** pick product/variant (+ optional coupon), pay from wallet balance. Order `PENDING`.
6. **Track:** `/account/orders` (with polling) or the login-free `/track` using the order's `trackToken`. Order timeline shows each `OrderEvent`.
7. **Fulfilment:** admin delivers in-game → `COMPLETED`; or `FAILED` → automatic full refund (balance + stock + coupon).
8. **Extras:** notifications, profile edit, referral code/bonus, reviews.

---

# 8. Admin Flow

Single `ADMIN` role (deliberate — the owner runs the whole panel; a STAFF tier was evaluated and declined). Admin surfaces under `src/app/admin/**`, triple-gated. Every mutation writes an `AdminLog`.

- **Dashboard** (`/admin`) — key metrics.
- **Deposits** (`/admin/deposits`) — review PENDING claims, cross-check the trxId in the real banking app, **approve** (credits wallet, one row-locked transaction, referral payout) or **reject with a reason**.
- **Orders** (`/admin/orders`) — see PENDING orders, copy the Player UID, deliver in-game, mark `COMPLETED` or `FAILED` (auto-refund). Bulk actions, claim, partial refund, group-by-product, SLA-breach signals.
- **Products / Variants** — manage catalogue, pricing, stock, `isPopular`, delivery times.
- **Coupons** — create/manage discount codes.
- **Users** — adjust balance (ledgered), ban/suspend/unban, view history (never fetch `password`).
- **Homepage** (`/admin/homepage`) — the **Campaign Manager** + section toggles (see §9).
- **Banners / Site / Settings / Payment numbers / Social links** — site config.
- **Tools** — announcements, maintenance mode, **DB backup** (password hashes excluded) / restore (config/catalogue only, never users).
- **Logs** (`/admin/logs`) — the AdminLog audit trail.
- **Reports** — computed business metrics.

**Every destructive/money action requires a confirmation step** (`ConfirmDialog` pattern in `Toast.tsx`).

---

# 9. Campaign System

All homepage marketing is **one table (`Campaign`)** wearing many hats, managed from **Admin → হোমপেজ** (`CampaignManager` + `HomeConfigForm`) via `POST/PATCH/DELETE /api/admin/campaign` (zod-validated, sanitized, admin-logged, `revalidatePath('/')`).

| Field | Meaning |
|---|---|
| `placement` | **Where it shows:** POPUP · HERO · SLIDER · NOTICE · STRIP · PROMO · FLOAT |
| `kind` | **Theme/behaviour:** ENTRY/GIVEAWAY/COUPON/TOURNAMENT/OFFER/EVENT/MAINTENANCE (drives colour + icon) |
| `title`/`subtitle`/`imageUrl`/`ctaLabel`/`ctaLink`/`badge` | Content |
| `dismissible` | Can the user close it |
| `frequency` | POPUP show rule: `once` / `session` / `always` (remembered in local/session storage) |
| `isActive` | Master on/off |
| `sortOrder` | **Priority** within a placement |
| `startsAt` / `endsAt` | **Scheduling window** (nulls = open-ended). Server filters to the active window; `endsAt` also powers live countdowns. |

**How each renders:** `campaigns.ts` fetches active, in-window rows per placement; the matching component (`PopupHost`/`NoticeBar`/`CampaignSlider`/`FloatingCard`/hero builder) renders them, or `null` if none. **Two things are NOT campaigns** (they're real data, not authored content): the **live-activity feed** (from real orders) and **trust stats** (computed) — inventing them as editable rows would be dishonest.

Legacy `Banner` model is the fallback slider when no `Campaign(SLIDER)` exists.

---

# 10. Animation System

Three libraries, three non-overlapping jobs. **Never two engines on the same element** (two libraries fighting one `transform` is the bug this rule prevents).

| Library | Job | Where |
|---|---|---|
| **Framer Motion** | Component motion — mount/exit, hover, `layoutId`, `AnimatePresence` | Arsenal tabs/cards, PopupHost, FloatingCard, page templates |
| **GSAP + ScrollTrigger** | Scroll choreography — scrub, timelines, active-step | `HeroDeck` (parallax), `OperatorStory` (sticky beats); single registration point `lib/gsapClient.ts` |
| ~~React Three Fiber~~ | (Removed) | The 3D operator was replaced by an SVG+CSS mascot; `three`/`@react-three/fiber` deps were uninstalled |

**Rules:** import GSAP plugins from `gsap/dist/*` (never `gsap/*`, which touches `window` at build); prefer CSS `sticky` over ScrollTrigger `pin`; keep per-frame JS O(n); prefer CSS `@keyframes` for anything not reacting to real-time input; **always respect `prefers-reduced-motion`** — the global CSS zeroes durations, and JS effects must independently check and early-return. Reduced-motion mount animations use `<MotionConfig reducedMotion="user">` (never branch a Framer variant's *structure* on `useReducedMotion` — that caused an SSR/client hydration mismatch, now fixed). Scroll-reveals use `VoltReveal`, which is **never able to leave content hidden** (server HTML is always visible; it only hides below-fold after mount).

---

# 11. Design System

**Two systems coexist deliberately.** The public homepage + shared chrome (navbar, footer, mobile tab bar, background) use **VOLT**; product pages, `/account/**`, and `/admin/**` still use the older **Maison** tokens/component classes. When migrating a page, move it wholesale — don't mix `--v-*` and `--gold` in one component.

## VOLT (public)
- **Colour:** `--v-void`/`--v-pit`/`--v-steel` surfaces; **`--v-volt` `#c8ff3d` is the one action colour** (CTA/active/live only — a second lime element destroys the first's meaning); `--v-ice` `#7de3ff` for structure/links; `--v-plasma` `#7b2cff` for **glow/depth only, never text** (3.5:1); `--v-heat` for warnings; `--v-ink`/`--v-mut`/`--v-dim` text (19.4 / 9.2 / 5.3 :1). Each token carries its measured contrast in the source.
- **Geometry is the brand:** notched corners (`--nc`) run through panels/buttons/chips/logo. The notch is drawn on **two pseudo-elements** (a `--panel-edge` layer + inset `--panel-fill` layer), **never `clip-path` on the element** — `clip-path` would clip the keyboard focus ring.
- **Typography:** `.v-dsp` = `Unbounded → Anek Bangla → Hind Siliguri` (per-glyph fallback: Latin numerals get Unbounded, Bengali gets Anek Bangla at weight 800 — Hind Siliguri stops at 700, which is why earlier headings looked thin). `.v-hud` = `Chakra Petch`. `.hud` letter-spacing is Bengali-safe (`.08em`); wide tracking is opt-in (`.hud-wide`) and Latin-only.

## Maison (legacy, other routes)
Tokens `--bg/--glass/--gold/--ice/--ink/--mut/--line` etc. in `:root`; component classes `.card`/`.btn*`/`.input`/`.badge`/`table.tbl`/`.alert-*`. Display font `Space Grotesk`, body `Hind Siliguri`. A **theme-bridge** block in `globals.css` maps legacy light-theme Tailwind classes (`.text-emerald-700`, `.bg-slate-100`, …) onto dark-theme values — it is a compatibility shim, and it is **fragile for un-listed variants** (e.g. opacity variants like `text-emerald-700/70` slip through). Prefer CSS-var inline styles or the component classes for new code. Retiring this bridge (mapping vars into `tailwind.config.ts`) is the recommended long-term cleanup.

## Icons & components
Line icons via `fx/Icon.tsx` (24px grid, `currentColor`, `aria-hidden`) — not emoji. The brand diamond is `fx/Diamond.tsx`. Images go through `fx/SafeImage.tsx` (falls back to `<img>` for non-whitelisted hosts). Money is always formatted through `lib/money.ts`; dates through `lib/date.ts` (Asia/Dhaka).

## Motion philosophy / brand identity
Cold, mechanical, high-energy, honest. Built for 12–30-year-old gamers. Restraint (one signal colour) is what reads as premium. No unverifiable claims anywhere.

---

# 12. Security

- **Authorization** triple-gated (§4). Passwords bcrypt cost 12; login is constant-time (dummy-hash) to prevent user enumeration.
- **Validation:** zod schemas in `lib/validation.ts` on request bodies.
- **Sanitization:** `lib/sanitize.ts` — `cleanText`/`cleanName` strip control + HTML-danger chars; `safeUrl` blocks `javascript:`/`data:`/`vbscript:`/`file:`/`blob:` and protocol-relative `//` bypasses. Applied to any admin/customer text that later renders.
- **Rate limiting** (`lib/rateLimit.ts`): a **shared Postgres store** (`RateLimitBucket`) with an **atomic** `INSERT … ON CONFLICT … RETURNING` using the **DB clock** (`NOW()`) for both the window check and the reset — correct across serverless instances and clock-skew-proof. **Fail-open** on DB error (availability over lockout). `await`-ed at all call sites (login ×2, register, forgot, reset, order, deposit, coupon, upload, profile, password, uid, track, …).
- **OAuth account-takeover guard:** the app has no NextAuth adapter, so `allowDangerousEmailAccountLinking` is a no-op; the real guard is `User.emailVerified` + a **reclaim** in `findOrCreateGoogleUser` — a Google sign-in (proof of inbox ownership) into an unverified credentials account verifies it **and invalidates the old password**, so a pre-registering attacker is locked out. Credentials-only users are unaffected.
- **Uploads** (`lib/upload.ts`): validated by **magic bytes** (not client MIME), SVG rejected, 8MB cap.
- **Headers** (`middleware.ts`): CSP/HSTS/X-Frame-Options on every response; the Google OAuth `form-action` allowance is scoped narrowly to `accounts.google.com`.
- **Cookies:** `httpOnly`, `sameSite:lax`, `secure` in production.
- **Backups** exclude password hashes.
- **Env** validated at boot (`lib/env.ts` `assertEnv()`, called from `prisma.ts`).

**Accepted risk (owner decision):** single `USER`/`ADMIN` role — no STAFF tier.

---

# 13. Performance

- **RSC-first:** pages are `async` Server Components using Prisma `select` (not `include`); only interactive islands are client components.
- **Caching:** homepage ISR `revalidate = 60`; `settings.ts` has a 30s in-process TTL (payment numbers are time-sensitive, so the TTL is short + invalidated on write); `trustMetrics` caches to a table with a 10-min TTL.
- **Bundle:** the R3F/three chunk (~180 kB) was removed; homepage first-load ≈ 200 kB.
- **Animation cost:** mostly pure CSS (zero per-frame JS); GSAP/Framer only where needed; everything heavy is behind `prefers-reduced-motion`.
- **Images:** `SafeImage`/`next/image` with responsive `sizes` where the host is known.
- **Watch items (not blocking):** `SiteBackground.tsx` per-frame canvas + `CustomCursor.tsx` rAF on desktop (both reduced-motion-guarded); run a field Lighthouse on mid-tier Android/4G before scale.

---

# 14. Deployment

## Environment variables (validated at boot)
| Var | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | Postgres (Neon), pooled |
| `NEXTAUTH_SECRET` | **yes** | JWT signing (32+ bytes) |
| `NEXTAUTH_URL` | **yes** | Production URL |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seed | **Change from defaults** (`admin@uidtopup.local` / `Admin@2026Secure`) |
| `BLOB_READ_WRITE_TOKEN` | **yes in prod** | Image uploads. Without it prod **fail-closes** (uploads error out); it never falls back to the ephemeral disk. Dev-only fallback is `local`. |
| `RESEND_API_KEY` | optional | Transactional email (degrades gracefully) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Google login |

## Database setup
`npm run db:setup` = `prisma db push` + seed + `apply-constraints.ts`. Verify with `npm run test:money` against a staging copy (expect 18/18).

## Production checklist
1. Set all required env vars; change the admin password.
2. **Set real payment numbers** in Admin → Settings (the seeded number is a placeholder — money is lost if not changed).
3. Remove any `[demo]` sample campaigns; configure real homepage content.
4. `npm run typecheck && npm run lint && npm run build` — all green.
5. Smoke-test on **staging** (place an order, approve a deposit) with disposable data.
6. Take a first backup (Admin → Tools) and store it securely.

## Commands
```
npm run dev          # local dev server
npm run build        # prisma generate + next build
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run test:money   # money-invariants (18 checks)
npm run db:setup     # push + seed + constraints
```
> On Windows, `next build` runs `prisma generate`, which needs the query-engine DLL lock released — stop the dev server before building.

---

# 15. Future Improvements

## Recommended roadmap (priority order)
1. **Next.js major upgrade (15/16)** — clears the remaining framework DoS advisories (Image Optimizer / RSC deserialization / rewrites) that have no 14.2.x patch. Touches routing/middleware/RSC/Server Actions — do it on its own branch with a full regression pass. This is the highest-value remaining hardening.
2. **Email verification on registration** — currently the OAuth-takeover guard handles the attack; adding a Resend-backed verification link is the defence-in-depth completion.
3. **Retire the Maison theme-bridge** — map CSS vars into `tailwind.config.ts theme.extend.colors` and migrate admin/account/product surfaces off the `globals.css` override block (removes the opacity-variant contrast fragility).
4. **zod for `admin/restore`** — validate the backup shape before applying.
5. **Migrate to `prisma migrate`** — replace `db push` with versioned migrations so `constraints.sql` and schema changes are tracked and reproducible.
6. **CustomCursor safety reset** — restore `cursor:auto` if its rAF loop ever throws.
7. **Field performance pass** — real Lighthouse on mid-tier Android/4G; profile `SiteBackground`/`CustomCursor` on low-end devices.
8. **Staging E2E harness** — automated click-through of order/deposit/refund with disposable data (the money-invariants test covers correctness transactionally, but not the full UI flow).

## Known limitations
- Single admin role (deliberate).
- Optional integrations (Blob/Resend/Google) are off unless their env vars are set.
- Dual design system (VOLT + Maison) until the migration in (3) completes.
- Rate-limit `retryAfter` hint uses app-clock while the store uses DB-clock — the hint can be off by the skew (correctness is unaffected).

## Ideas
- Product images pipeline (the biggest visual lever — competitors' premium feel is 80% uploaded game art).
- Blog/SEO surface for acquisition.
- Admin-editable "why choose us" value grid.

---

*This manual replaces all prior development reports. For questions the code itself answers, match the existing patterns in the file you're editing over anything written here, and update this document when a deliberate change makes it stale.*

---

# 20. Systems added in the 2026-07-31 pass

This section documents the design-system, theme, and media subsystems built after the original manual. It is authoritative for these areas.

## 20.1 Design system & tokens (`src/app/globals.css`)
The entire look is driven by **CSS custom properties** in `:root`, so surfaces flip with one change:
- **Surfaces:** `--v-void` (page), `--v-pit` (card), `--v-steel` (raised), `--v-field`/`--v-field-focus` (inputs), `--surface-nav`/`--surface-bar`/`--surface-adminnav` (nav chrome).
- **Text:** `--v-ink` / `--v-mut` / `--v-dim` (all WCAG-AA measured on the active bg).
- **Signals:** `--v-ice` (info), `--v-heat` (error), and the **accent** (see 20.3).
- **Elevation:** `--v-shadow-1/2/3`; **edges** `--v-edge`/`--v-edge2`; **tints** `--tint-violet/-ice/-volt`.
- **Component classes** (`.card`, `.btn*`, `.input`, `.badge`, `table.tbl`, `.alert-*`, `.pkg-card`, `.prod-card`, `.v-panel`, `.v-btn*`) all consume tokens — **never hardcode a surface color in a component**; add/extend a token instead. A legacy "theme bridge" maps stray Tailwind classes (`bg-white`, `text-slate-*`) to tokens.

## 20.2 Theme system — Dark / Light / System
- `:root` = dark (brand default); `:root[data-theme='light']` overrides tokens for light. `ThemeProvider` (`src/components/theme/ThemeProvider.tsx`) resolves `system` via `prefers-color-scheme`, follows OS changes live, persists to `localStorage('theme')`, and applies a `.theme-anim` transition (disabled under reduced-motion).
- **No-flash:** `THEME_INIT_SCRIPT` runs as the first `<body>` child (before paint) stamping `data-theme` + `data-accent`.
- **Toggle:** `ThemeToggle` (3-way, SVG icons) in the public navbar (desktop + mobile) and the admin header.

## 20.3 Accent system (future-ready)
- The single "action" color flows through `--accent` / `--accent-2` / `--accent-strong` / `--accent-ink` / `--accent-text` / `--accent-glow`; `--v-volt*` alias them. Change **one** `data-accent` and buttons/FAB/scrollbar/CTAs recolor.
- Presets: `lime` (default) + `purple`/`blue`/`red`/`orange` via `:root[data-accent='…']` (each with per-theme text-safe values). `AccentPicker` (navbar mobile menu) persists to `localStorage('accent')`.

## 20.4 Storage abstraction (`src/lib/storage/`)
- `StorageDriver` interface + factory `getStorage()` chosen by `STORAGE_DRIVER` env (auto = Blob if token else Local). Drivers: **vercel-blob** and **local** (working), **s3** (Amazon S3 / Cloudflare R2 / MinIO — structurally ready; fill `put()`/`del()` with `@aws-sdk/client-s3` and set S3 env).
- `lib/upload.ts` is driver-agnostic, keeps **magic-byte validation** (SVG blocked → no XSS), and parses image dimensions. `driverForUrl()` routes deletes to the right backend.

## 20.5 Product Media Management
- **`Media` model** (`prisma/schema.prisma`): central library record — `url` (unique), `key`, `storage`, `folder`, `type` (`MediaType`), `mime`, `bytes`, `width`/`height`, and **SEO** `alt`/`title`/`description`. Product gained `thumbnail`/`banner` (cover stays `image`); gallery via `ProductImage[]`.
- **API** `/api/admin/media` (GET search/filter/sort/**unused**, POST upload→storage+record, PATCH metadata, DELETE with in-use guard). `lib/mediaRefs.ts` is the **single source** for "is this URL used" — extend it when a new consumer references media.
- **UI:** `/admin/media` (`MediaBrowser`) — grid, search, folder/sort filters, unused toggle, upload (client-side WebP compression via `lib/imageProcess.ts`), edit-metadata drawer, safe delete. **`MediaPicker`** modal reuses it for "pick from library" (wired into `ProductManager`). Every form upload also registers in the library.
- **Display:** `ProductImage` (`src/components/fx/ProductImage.tsx`) is the single source for thumbnails — full-cover `next/image` (AVIF/WebP via `next.config.js` `formats`, responsive `srcset`, lazy) + shimmer/blur placeholder + professional gradient/diamond fallback. If a cover exists the placeholder never shows.

## 20.6 Empty / error / loading states
- **`EmptyState`** (`src/components/EmptyState.tsx`): the one premium empty pattern (icon tile + title + hint + optional CTA). Use it for any new "nothing here" state. `DataUnavailable` remains the specific fallback for money pages when the **DB is unreachable** (never shows a fake ₹0).
- **Errors:** `error.tsx` (in-app boundary, SVG icon, logs via `logger`), `global-error.tsx` (dark), `not-found.tsx` (on-brand 404, real 404 status). Toasts: `Toast.tsx` (queue, auto+manual dismiss, `aria-live`).
- **Loading:** `account/loading.tsx` + `admin/loading.tsx` use content-shaped `.skeleton` shimmer (better perceived perf than a spinner).

## 20.7 Environment variables (names only — new/relevant)
`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `BLOB_READ_WRITE_TOKEN`, **`STORAGE_DRIVER`** (`blob`|`local`|`s3`|`r2`, optional — auto if unset), **`S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_PUBLIC_URL`** (only if using the S3/R2 driver). Never commit `.env`; rotate any leaked secret.

## 20.8 Deployment & DB migrations
- Build: `prisma generate && next build`. After schema changes run **`npm run db:push`** (additive changes — `Media`, `ProductImage`, `Product.thumbnail/banner` — are safe). On Vercel use a **pooled** `DATABASE_URL` (see `.env.example`).
- Images: keep `BLOB_READ_WRITE_TOKEN` set (or `STORAGE_DRIVER=local` for self-host). `next.config.js` allows `**.public.blob.vercel-storage.com` and emits AVIF/WebP.

### Storage verification scripts
Blob is **proven, not assumed** — see `BLOB_VERIFICATION_REPORT.md` (7 Aug 2026, 174 runtime assertions).

| Script | What it proves |
|---|---|
| `scripts/blob-verify.ts` | storage layer: upload → download (byte-for-byte) → headers → delete, per folder |
| `scripts/blob-routes-verify.ts` | the **real** path: logged-in browser → `/api/upload`, `/api/admin/upload`, `/api/admin/media`; asserts `public/uploads` is byte-identical before/after. `--only=<endpoint-substring>` runs one route |
| `scripts/blob-ui-check.ts` | images actually **decode** in the browser (`naturalWidth > 0`) via `/_next/image` |
| `scripts/migrate-uploads-to-blob.ts` | moves legacy `/uploads/**` to Blob and rewrites every DB reference; dry by default, `--apply` to commit. Idempotent, and repairs rows left with a stale `storage` column |
| `scripts/pw-server.ts` | one headed browser for the whole session (writes `ws.txt`; other scripts `chromium.connect` to it) |

`/api/upload` and `/api/admin/upload` share the rate-limit bucket `upl:<userId>` with different limits (10 vs 25), so back-to-back full runs can 429 — that's the limiter working, not a route fault.

### Notifications (toasts + inline alerts)
Styled **only** with `--v-*` tokens and `.v-toast` / `.alert-*` classes — never Tailwind palette classes (`bg-emerald-50`, `text-rose-800`, …). The legacy bridge in `globals.css` rewrites those with `!important` into 12%-opaque fills meant for inline panels; on a floating overlay that made the navbar show through the toast, and collapsed `info` into `error`'s colors. Message text is always `--v-ink` (AA in both themes); role is carried by icon + left bar + tint, so it survives colour-blindness. The host's `top` is measured at runtime from the sticky header stack (public 70px, admin 128px) — don't hardcode it.

| Script | What it proves |
|---|---|
| `scripts/auth-diagnose.ts` | which DB, account exists, bcrypt match, live rate-limit buckets. `--clear-limits` |
| `scripts/auth-ui-test.ts` | real UI login: form → csrf → callback → cookie → session → redirect |
| `scripts/auth-lockout-test.ts` | brute-force guard still trips on failures, and the message tells the truth |
| `scripts/toast-audit.ts` | toast + `.alert-*` contrast, role-colour distinctness, overlap — both themes |
| `scripts/notification-surfaces-audit.ts` | remaining notification pages + the runtime toast offset |

## 20.9 Troubleshooting (theme/media)
- **"ইমেইল বা পাসওয়ার্ড ভুল" with credentials you know are right:** you are almost certainly **rate-limited**, not wrong. The guard is 5 attempts / 15 min per email and 10 / 10 min per IP. Run `npx tsx scripts/auth-diagnose.ts` — it separates the three causes (bad password / banned / throttled) and prints the live buckets; `--clear-limits` releases them. Since Aug 2026 successful logins no longer count toward the limit, and the UI now says "…X মিনিট পর আবার চেষ্টা করুন" instead of blaming the password. See `AUTH_AND_NOTIFICATION_FIX_REPORT.md`.
- **Uploads say "storage not configured":** set `BLOB_READ_WRITE_TOKEN` or `STORAGE_DRIVER=local`. Confirm the driver actually resolved with `npx tsx scripts/blob-verify.ts` — it prints the chosen driver and refuses to run a meaningless pass when Blob is inactive.
- **Every page returns 500, `Cannot find the middleware module`:** stale `.next` (a `next build` and `next dev` cache mixing). Stop dev, delete `.next`, restart. Not an app-code fault — but it makes the whole site look broken, so check this before debugging further.
- **Media list slow (2–7 s) in dev:** Neon cold-start latency; fast when warm/prod (queries are parallelized).
- **Light-theme flash:** ensure the `THEME_INIT_SCRIPT` is the first `<body>` child in `layout.tsx`.
- **A page looks light-on-light or dark-on-dark:** it hardcoded a color instead of a token — replace with the matching `--v-*`/`--accent*` token.
- **Bengali numerals cramped:** don't apply `tabular-nums` to Bengali display text (use `.tnum` only where column alignment needs it); keep display tracking ≥ `-.02em`.


---

# 21. Provider architecture, Integration Hub & Audit (2026-07-31)

## 21.1 Payment providers (`src/lib/payments/`) + fulfillment policy (`src/lib/fulfillment/`)
- `PaymentProvider` interface (`verify`/`refund` + `capabilities`); **Manual** provider = current model; gateway **stubs** (bKash/Nagad/Rocket/SSLCommerz/Stripe/PayPal/Razorpay) throw until an SDK + env keys are added. Registry = one line per provider (`registry.ts`).
- `policy.ts` reads settings (`pay_mode`, `deposit_approval`, `order_approval`, `refund_mode`), **defaults manual**. A flow goes automatic **only if** the mode is automatic **and** a provider both supports the capability **and** is configured — so today everything is manual and the money model is unchanged. Admin: **`/admin/payments`**.

## 21.2 Integration Hub (`src/lib/integrations/`)
- One `hub` for every category: `fulfillment`, `email`, `sms`, `push`, `webhook`, `ai`, `analytics` (+ `payment`/`storage` surfaced read-only). Business logic calls `hub.email()`/`hub.sms()`/`fulfillOrder()` etc. (DIP) — never a concrete service.
- **Builtins reuse existing code:** email→Resend (`sendEmail`), storage→`lib/storage`, payment→payments registry, fulfillment→manual. Everything else is a stub. Enable/active via `integration_<category>_<id>_enabled` / `integration_<category>_active`. Admin: **`/admin/integrations`**.
- **Add a real integration:** fill the stub's method(s), set its env keys, then enable + set Active in the admin UI — no business-logic changes.

## 21.3 Audit / Activity system (`src/lib/adminLog.ts`, `/admin/logs`)
- One `AdminLog` table (generalized): `actorType` (ADMIN/CUSTOMER/SYSTEM), `role`, `userAgent` added (additive). Write via **`logActivity()`**; `adminLog()` (admin) delegates to it. `requestMeta(req)` captures IP+device.
- Wired: auth `LOGIN`/`LOGOUT` (NextAuth `events`), customer `DEPOSIT_CREATE`/`ORDER_CREATE`, admin media + all existing admin actions (with before→after in `detail`).
- **Timeline** `/admin/logs`: search · actor/action filter · date range · **CSV export** (`/api/admin/logs/export`, shared `lib/auditFilter.ts`). Logs are immutable and included in backup.

## 21.4 Backup extension
`/api/admin/backup` now also exports `Media` + `ProductImage`. Restore stays config/catalog-only (never touches users/money). Scheduled/off-site backup is architecturally ready (cron → the GET handler, or push to S3/R2 via the storage layer) but not wired without credentials.

## 21.5 Do-not-break rules (for the next developer)

- **Never** move money outside the `wallet` service + a `$transaction`; keep the lock order variant→coupon→user. Re-run `npm run test:money` (must stay 18/18) after touching any deposit/order/refund path.
- New provider/hub/audit code must stay **outside** the money transaction and be `try/catch`-guarded (never break the flow).
- New "nothing here" states → `EmptyState`; new surfaces → design tokens, never hardcoded colors.
- **Never call `await req.json()` directly in a route** — use `readJson(req)` from `@/lib/guard` (see §24).

---

# 24. Request body parsing — `readJson()` (2026-08-05)

## 24.1 The bug it fixes
`await req.json()` throws a `SyntaxError` when the body is malformed, empty, or sent with the wrong `Content-Type`. That error is **not** an `ApiError`, so `apiError()`'s catch-all mapped it to **500 "সার্ভারে সমস্যা হয়েছে"** — blaming the server for a client mistake. Every mutating route shared the shape; it was found on `POST /api/deposit` during the 2026-08-01 loading pass and deferred because it sits on a money path.

## 24.2 The rule
```ts
import { readJson } from '@/lib/guard';
const parsed = someSchema.safeParse(await readJson(req));
```
`readJson()` throws `ApiError(…, 400)` in two cases:
| Body | Message |
|---|---|
| unparseable / empty / wrong content-type | `অনুরোধের ডেটা পড়া যায়নি` |
| valid JSON but `null` or a primitive (`null`, `123`, `"x"`, `true`) | `অনুরোধের ডেটা সঠিক নয়` |

The second guard matters: `JSON.parse('null')` *succeeds*, so without it the next line (`const { id } = body`) threw a `TypeError` and produced the same 500 by a different route. Arrays still pass (`typeof [] === 'object'`).

It is generic with `T = any` so existing destructuring and `safeParse()` call sites type-check exactly as they did against `req.json()`.

## 24.3 The four deliberate exceptions
Four handlers use `await req.json().catch(() => ({}))` / `.catch(() => null)` and were **left alone** — they treat a missing body as "no fields supplied" and already return 400 themselves, so they never 500:
`admin/media` DELETE · `admin/payment/provider` POST + DELETE · `admin/telegram-test` POST.
Converting them to `readJson()` would turn a legitimately empty body into an error and change behaviour.

---

# 29. NOVA — the one loading architecture (2026-08-06)

> Supersedes the earlier "login mascot loader" section entirely. The systems described there (`MascotLoader`, `CatMascot`, `BrandedLoader`, `EnergyCore`, `claimLoadingScope`, `data-mascot-busy`) **no longer exist** — they were deleted, not deprecated. If you find a reference to any of them, it is stale.

## 29.1 The rule
**There is exactly one full-screen loading visual in this codebase.** It is `LoadingStage`, and it is rendered from exactly two places:

| Where | Why it exists separately | File |
|---|---|---|
| `.v-ovl` — the global overlay | React is running; `LoadingProvider` owns it | `src/components/fx/LoadingProvider.tsx` |
| `#v-boot` — the boot screen | React is **not** running yet (full page load / F5) | `src/app/layout.tsx` |

Both render the *same* component with the *same* CSS, so the two are visually indistinguishable. `NovaCat` is a **server component with no hooks** precisely so the boot screen can render it before hydration, and `LoadingStage`'s message rotation is **pure CSS** for the same reason — no JS timer, so it animates in server-rendered markup.

The only other loading affordance is `InlinePulse` (three orbiting particles, ~16 px) for inside buttons. **A rotating spinner is banned**; `scripts/loading-test.ts` fails the build if `animate-spin` appears anywhere or if any element inside `.v-ovl` animates a full 360° rotation (the orb's orbit ring and satellites are explicitly allowed — they are scenery, not a progress indicator).

```
src/components/loading/
  NovaCat.tsx       ← geometry only (server component)
  LoadingStage.tsx  ← mascot + rotating message + progress sweep
  InlinePulse.tsx   ← the only permitted inline indicator
```
Motion lives in `globals.css` under `.nv-*`. Geometry and motion are deliberately separated: reskinning the mascot is a one-file change.

## 29.2 Why login has no loader of its own
It used to. `/login` mounted a `MascotLoader` while `LoadingProvider` *also* blocked on `/api/auth/callback` — two parallel systems, reconciled by a `claimLoadingScope()` handshake that existed only to stop them fighting.

`/api/auth/*` is already in `BLOCKING_PATHS`, so login, register and logout get the global overlay for free. Deleting the login-page loader deleted the handshake with it: the coordination problem was removed rather than solved.

**`GoogleButton` is the one exception** and it takes no overlay: `signIn('google')` is a full-page redirect, not a `fetch`, so the interceptor cannot see it — and a full-screen loader would be wrong for something that leaves in one frame. It shows an `InlinePulse` inside the button.

## 29.3 Labels vs. rotating messages
`labelFor()` returns `''` for auth and route changes. **Empty label ⇒ the rotating premium messages play** (`load.rotate1..3`). Money, orders, uploads and admin saves keep a specific label, because there "what is happening" matters more than atmosphere, and rotating generic copy over a payment would be dishonest.

> This was a real miss on the first pass: the label was set for auth too, so the rotating messages only ever appeared on the boot screen — the exact opposite of the requirement. The test now asserts rotation **during login**.

The crossfade timings must **overlap**. Three spans, 9 s cycle, delays 0/3/6 s; each span fades out at 42 % (3.8 s) while the next starts at 3 s. Butt-jointing them (fade-out ending exactly at 33 %) leaves a ~0.4 s window with no text on screen.

## 29.4 Performance — the bottleneck is never the SVG
Measured by isolation on one page load, production build, headless (CPU raster = worst case):

| State | FPS |
|---|---|
| idle login page (baseline) | 130–138 |
| overlay up, everything animating | **81–96** |

`backdrop-filter` is expensive **only when its backdrop changes**; `SiteBackground` runs a canvas rAF loop and 30+ particles, so the blur could never be cached. Freezing the decoration while the overlay is up is what buys the frame rate.

That freeze is now **pure CSS with no extra state**:
```css
body:has(> #v-boot) .site-bg canvas,
body:has(.v-ovl)    .site-bg canvas { display:none !important; }
```
The previous version set a `data-mascot-busy` attribute from JS — a second source of truth that could stick if the component ever crashed. With `:has()`, the DOM *is* the condition. A browser without `:has()` simply loses the optimisation; nothing looks different.

Rules that still hold:
- Animate **only** `transform` and `opacity`. Everything else repaints per frame. Enforced by an assertion.
- **No `filter`/`feGaussianBlur` for glow.** Every bloom in `NovaCat` is a `radialGradient` — it looks like bloom and rasterises like a plain shape.
- Dev-mode FPS is meaningless (React dev build + on-demand compile). Measure `next start`.
- Never trust **headed** FPS in automation: an occluded window throttles rAF to ~1 FPS.

## 29.5 Scroll lock without layout shift
```css
body:has(.v-ovl) { overflow:hidden; scrollbar-gutter:stable; }
```
`scrollbar-gutter` is not optional. `overflow:hidden` alone removes the scrollbar and shifts the whole page ~15 px right — precisely the layout shift this screen is not allowed to cause.

## 29.6 The light theme needs a *stronger* scrim, not a weaker one
Counter-intuitive but simple: 88 % black over bright content leaves 12 % of something bright — invisible. 88 % white over **dark text** leaves 12 % of near-black, which is still perfectly readable on white. So:

```css
.v-ovl                      { --v-ovl-scrim: 88%; }
:root[data-theme='light'] .v-ovl { --v-ovl-scrim: 96%; }
```
This is opacity only — the message sits *on* the scrim, so its contrast is untouched.

## 29.7 Reduced motion
The global rule zeroes every animation, which would freeze the cat solid. Class-specific rules (specificity 0,1,0 beats `*`) restore **breathing, blinking and the message rotation** at 7 s / 9 s / 9 s. Orb, paw, head, tail, ears, sparks, trails and motes all stop. Same drawing, calm motion.

## 29.8 SVG animation traps (all of these were paid for)
- `transform-box: fill-box` is required, otherwise parts rotate about the SVG origin and fly off.
- With `fill-box`, **never write an inline `transform="rotate(a cx cy)"` or a user-space `transform-origin`** — the centre is reinterpreted against the element's own box and the shape leaves the screen. Draw the shape pre-rotated, or wrap and rotate about `50% 50%`.
- Size the `viewBox` for the animation's **extremes**, not the rest pose. The orb travels +54 px and its bloom scales to 1.5×; a tight viewBox clips it *mid-cycle only*, which no static check catches.
- **Rim light must be a `stroke` along the silhouette, not a filled shape inside it.** A filled "rim" reads as a green smudge on the cheek.
- Layer order carries the acting: tail *behind* the body, striking paw *in front*. With the paw behind, the strike frame showed nothing happening.

## 29.9 Verifying
```bash
npx tsx scripts/loading-test.ts [--headless]   # 63 assertions: architecture, login,
                                               # logout, themes, responsive, FPS,
                                               # reduced motion, pixel-level obscuring
npx tsx scripts/loading-preview.ts             # renders the mascot to audit/loading/_pv-*.png
```
`loading-preview.ts` is the iteration loop — it renders `LoadingStage` straight to static HTML and screenshots four points in the animation cycle, so judging the artwork takes ~3 s instead of a build-plus-login round trip.

**Screenshots catch what assertions cannot.** Twice now, 40+ green assertions have accompanied a visibly broken screen (an invisible element; a scrim that hid nothing). Where a property can be measured in pixels, measure it in pixels: `regionContrast()` in the test screenshots the nav strip, decodes it **in the browser** via a canvas (no image library is installed), and asserts the contrast behind the overlay collapses to <30 % of its bare value.

> **Auth-dependent suites must run against `next dev`.** In a production build served over plain http, NextAuth issues `Secure` cookies that the browser drops, so every authenticated page redirects to `/login` and the audits report phantom failures (SSL errors, "31 px overflow"). Use `next start` only for FPS.

---

# 28. Brand identity management (2026-08-05)

**No logo or brand string is hardcoded any more.** Everything is admin-managed at **Settings → ব্র্যান্ডিং** (`/admin/branding`).

## 28.1 Two files, two jobs — don't merge them
| File | Role |
|---|---|
| `src/lib/brand.ts` | code-level **fallback constants**; safe in the client bundle, works with no DB |
| `src/lib/branding.ts` | **runtime resolution** from `Setting` rows; server-only |

Merging them would make every client component pull the DB.

## 28.2 Logo slots
Ten slots (`primary`, `secondary`, `compact`, `square`, `favicon`, `pwa`, `login`, `loading`, `email`, `og`) × two themes = 20 settings keys, `brand_logo_<slot>_<theme>`.

**Two fallback layers mean one upload brands the whole site:**
1. missing theme variant → the other theme's image
2. missing slot → a defined chain (`login → primary`, `loading → square → primary`, `pwa → square → favicon`, …)
3. nothing at all → the existing `VoltMark`

So the site is never logo-less, and the admin is never forced to upload 20 files.

## 28.3 Theme switching is CSS, not JS
`BrandLogo` renders **both** images and CSS (`:root[data-theme='light']`) hides one.

> Choosing in JS from `useTheme().resolved` would paint the wrong logo on first frame and cause a hydration mismatch — the server cannot know the theme. CSS is correct from frame one.

## 28.4 Client access
`BrandProvider` (mounted once in the root layout) hands the resolved branding to the client tree; `useLogo(slot)` reads it. One server→client handoff instead of a fetch per component.

## 28.5 Email
Emails carry a `<!--BRAND_HEADER-->` placeholder that `send()` replaces just before dispatch. Changing 8 `wrap()` call sites would have risked missing one; a single choke point cannot drift.
**Email logos need an absolute URL** — an email client has no site to resolve `/uploads/x.png` against. If `site_url` is unset, the text wordmark is used rather than a broken image.

## 28.6 Security
Uploads reuse the existing pipeline: magic-byte mime detection (not the declared type), 8 MB cap, folder allowlist, admin-only, rate-limited. Logo URLs pass `safeUrl()`, so `javascript:` can't be stored. Slot and text keys are allowlisted. Replacing or deleting a logo removes the old file from storage, so orphans don't accumulate.

## 28.7 Anything that renders branding must be dynamic
`manifest.ts` sets `export const dynamic = 'force-dynamic'` — otherwise Next renders it once at build and admin changes never appear. Same reasoning applies to any new brand-consuming route.

---

# 27. Telegram enterprise — multi-bot, scheduler, templates, backup (2026-08-05)

> **Extends §26; nothing there was replaced.** Config priority, encryption, the wizard and the token-never-reaches-the-browser rule all still hold.

## 27.1 New tables
`TelegramMessageLog` · `TelegramJob` · `TelegramJobRun` · `TelegramTemplate` (added with `prisma db push`, purely additive — 4 CREATE TABLEs, no ALTER on existing tables).

**Bot config deliberately stayed in `Setting.telegram_bots`** (encrypted JSON). Only things a table genuinely enables moved to tables: per-message logs (need aggregation), job history, templates.

## 27.2 Multi-bot routing (`store.ts` + `dispatch.ts`)
Five roles: `admin` · `customer` · `marketing` · `support` · `monitoring`. Each bot has `events[]` and a `priority`.

`getBotsForEvent(event)` returns **every** eligible bot ordered by priority — one event can fan out to several bots. An empty `events[]` falls back to `ROLE_DEFAULT_EVENTS`, so pre-existing single-bot configs keep receiving everything.

`sendTelegramAdmin(...)` now delegates to `sendToEvent()` when an event is given. **No call site changed** — the routing decision moved into `dispatch.ts` so it lives in exactly one place.

> One bot failing never stops the fan-out; each send is logged separately.

## 27.3 Scheduler (`scheduler.ts` + `handlers.ts`)
**There was no scheduler in this project before** — this is new, not an integration with something existing.

Two entry points into the same `tick()`:
- in-process `setInterval` every 30 s (`ensureSchedulerStarted`, idempotent via `globalThis`) — enough for EXE / VPS / `next start`
- `POST /api/admin/telegram/scheduler/tick` for serverless, guarded by `CRON_SECRET` bearer or an admin session

Double-run is prevented by a **conditional UPDATE claim** (`WHERE status <> 'RUNNING' AND nextRunAt <= now`); the tick that wins the update runs the job.

16 jobs, all with real handlers reading real data. **All default to disabled** — installing must not start 16 automatic message streams. `computeNextRun()` is timezone-aware via `Intl` (no date library added); MONTHLY is capped at day 28 so a job can never skip February.

## 27.4 Templates
`{{variable}}` substitution. **Variable values are escaped, template markup is not** — the admin may intentionally write `<b>`, but a customer name containing `<` must not break the message or inject markup. Unknown `{{vars}}` are left visibly intact rather than silently blanked, so typos are noticeable. Preview renders **server-side** through the same `render()` used for real sends.

## 27.5 Backup
Third option beyond "omit secrets" / "export plaintext": tokens are sealed with an **admin-supplied passphrase** (scrypt N=2^15 + AES-256-GCM), independent of the installation key — so backups are genuinely portable but unreadable without the passphrase. No passphrase ⇒ no tokens in the file.

Restore is **validate → preview → explicit confirm**. The server refuses `restore` without `confirm: true`, and without `replace: true` existing bots are kept (new ones are added).

---

# 26. Telegram — production configuration system (2026-08-05)

> **Supersedes §25.1 and §25.3.** The config source order is now **reversed** (DB first), and the module is a package (`src/lib/telegram/`), not a flat file. §25.2 (never send the token to the browser) and §25.5–25.6 (event gating, cache rule) still hold.

## 26.1 Config priority — DB first, `.env` second
```
1. Encrypted database settings   ← the admin panel writes here
2. Environment variables (.env)  ← first install / dev convenience only
```
If **any** bot exists in the DB, `.env` is ignored entirely — never merged, so "which token is live" is never ambiguous. This is what lets an EXE build be configured wholly from the admin panel. Proven by `scripts/telegram-no-env-test.ts`, which refuses to run unless the vars are actually absent.

## 26.2 Encryption at rest (`src/lib/secretbox.ts`)
AES-256-GCM, key derived via HKDF-SHA256 from `TELEGRAM_ENC_KEY` or `NEXTAUTH_SECRET`, domain-separated so session signing and secret encryption never share bytes. Ciphertext format `v1.<iv>.<tag>.<data>` (base64url), random IV per encryption.

- GCM is **authenticated** — a tampered ciphertext throws instead of returning garbage.
- Decrypt failure is non-fatal: the bot shows as "token missing" and the UI asks you to re-enter it. It never crashes the notification path.
- **Honest limit:** the key lives in env, so this defeats DB-only compromise (backups, dumps, SQL injection) but not an attacker holding both env and DB. A real KMS isn't feasible in a desktop EXE.

## 26.3 Multi-bot architecture (`src/lib/telegram/store.ts`)
Bots are keyed by **role** — `admin` / `customer` / `marketing` / `support`. Business code calls `getBotForRole(role)`, never a specific bot, so swapping bots is configuration only. Unset roles fall back to the `admin` bot, so adding a role never silently drops its notifications.

Stored as one JSON row (`Setting.telegram_bots`) rather than a table: this project uses `prisma db push` with no versioned migrations, and changing a live production schema wasn't a risk worth taking here. **All reads/writes are confined to `store.ts`** — moving to a real table later is a one-file change.

## 26.4 The wizard
`/admin/telegram` auto-shows the 6-step Connection Wizard when unconfigured (`TelegramGate`). Steps: welcome → token → chat → test → preferences → done. Step 2 and 3 gate forward navigation on successful verification.

> The wizard **does** accept a token in the request body — that direction is fine, the admin is typing a value they already know. The invariant is the other direction: server → browser never returns a token.

Bot profile photos are fetched server-side and returned as a **data: URI**. Telegram's file URLs embed the token (`/file/bot<TOKEN>/…`), so linking one directly would leak it to the browser.

## 26.5 Export / import
Export deliberately **omits the bot token**. The stored ciphertext is useless on another install (different key), and exporting plaintext would turn the config file itself into the leak. Export carries structure and preferences; re-enter the token after import. Import allowlists event keys — unknown keys are dropped, not written.

---

# 25. Telegram bot — config & secret handling (2026-08-05)

## 25.1 Where the config comes from
**`env > DB settings`**, resolved in `getTelegramConfig()` (`src/lib/telegram.ts`):

| | env (preferred) | DB settings (fallback) |
|---|---|---|
| token | `TELEGRAM_BOT_TOKEN` | `telegram_bot_token` |
| chat | `TELEGRAM_CHAT_ID` | `telegram_chat_id` |

Env wins so there is never ambiguity about which value is live. Both are sanitized on read (trim + strip wrapping quotes) — a quoted multi-line `.env` value previously appended `\n` to the token and broke every call.

> ⚠️ **`.env` values must be on one line.** dotenv treats an unterminated quote as a multi-line value.

## 25.2 The rule that must not be broken
**The bot token must never reach the browser.** `SiteManager` is a client component, so anything passed to it is serialized into the RSC payload and lands in the page HTML. `app/admin/site/page.tsx` therefore strips the key before passing props:

```ts
const { telegram_bot_token: _redacted, ...settings } = rawSettings;
```

Consequences that are deliberate, not oversights:
- the admin UI shows a **read-only** status panel, not an input — an editable field would require sending the value down;
- `/api/admin/telegram-test` **does not accept a token in its body** — it reads server config;
- `/api/admin/settings` **ignores a blank `telegram_bot_token`** so an ordinary Save cannot wipe a configured token.

## 25.3 Logging
`logger.ts` redacts secrets at the choke point (`SECRET_PATTERNS`) — Telegram tokens, `Bearer …`, and `postgres://user:pass@…`. It deep-walks meta objects, error messages and stacks.

> The token lives **inside the URL** (`/bot<TOKEN>/…`), and undici errors embed the URL. Do **not** anchor the token pattern with a leading `\b` — in `…/bot8801466881:AA…` the preceding char is `t`, so there is no word boundary and the most important case silently escapes redaction. Use `(?<!\d)`.

## 25.4 Operator tooling
```
npx tsx scripts/telegram-check.ts             # env shape, getMe, webhook, chat_id discovery, verdict
npx tsx scripts/telegram-integration-test.ts  # 26 checks incl. leak + redaction (needs dev server)
npx tsx scripts/telegram-admin-leak-test.ts   # logs in as admin, proves no token in page HTML
```

`chat_id` cannot be auto-discovered — a bot cannot initiate a chat, so a human must message it or add it to a group first. Full status in `TELEGRAM_INTEGRATION_REPORT.md`.

## 25.5 Admin UI & event switches (`/admin/telegram`)

Two-level gate, both checked inside `sendTelegramAdmin()`:

1. `telegram_enabled` — master switch (default on)
2. `telegram_ev_<key>` — one per event (defaults in `TELEGRAM_EVENTS`)

Ten events: `deposit_new`, `deposit_approved`, `deposit_rejected`, `order_new`, `order_completed`, `refund`, `user_registered`, `low_stock`, `maintenance`, `campaign_published`.

**Two dispatch helpers — pick the right one:**

| Helper | In-app notification? | Use for |
|---|---|---|
| `notifyAdmins(title, body, link, event?)` | ✅ yes | customer-triggered events (new order, new deposit) |
| `telegramEvent(event, title, body, link?)` | ❌ Telegram only | **admin-triggered** actions (approve, complete, refund, publish) |

`telegramEvent` exists because routing admin actions through `notifyAdmins` would give the admin an in-app notification about *their own click* — noise in the panel, but genuinely useful in an operator group.

> **Event switches gate Telegram only.** In-app notifications always fire regardless, or turning off a Telegram event would silently hide the event from the admin panel too.

**Status rows** (`telegram_last_ok_at`, `telegram_last_error`, `telegram_last_error_at`, `telegram_last_event`) are written **without** `invalidateSettings()` — see §25.6. The admin page reads them straight from the DB via `getTelegramActivity()`.

The **test button bypasses both switches** (`sendTelegramRaw` directly) — admins test connectivity *before* enabling, so a gated test button would be useless. It still records status.

## 25.6 Why status writes must not invalidate the settings cache
`settings.ts` caches all settings for 30 s to avoid a Neon round-trip on every server render. A Telegram send happens on every order/deposit, so calling `invalidateSettings()` when writing "last sent at" would blow that cache away continuously. Status is allowed to read up to 30 s stale; the cache is not allowed to die. Config writes (`/api/admin/telegram` POST) **do** invalidate, because switches must take effect immediately.

---

# 23. Brand mark v2 + Energy Core (2026-08-01)

## 23.1 One logo, everywhere
`src/components/fx/VoltMark.tsx` — a **pointy-top hexagon with a negative-space lightning bolt** (the bolt is *cut* from the plate via an SVG `mask`, not drawn on it). Fewer elements, survives 16 px, and the knockout is what makes it memorable.

> ⚠️ Before this pass the site shipped **two unrelated logos**: the hexagonal VoltMark in the navbar/footer, and a completely different *diamond* in `src/app/icon.svg` (the favicon + PWA icon, copied from `Diamond.tsx`). The tab and the header did not look like the same company. `icon.svg` is now a static copy of VoltMark v2 with `plate=true` — **if the mark changes, change both files.**

`plate` prop = dark rounded-square backing for favicon/PWA/app-icon use (a bare hexagon's lime edge disappears on a light tab bar).

## 23.2 Energy Core — the loading animation ⚠️ REMOVED — see §29
> `EnergyCore.tsx` was **deleted** on 2026-08-06 and replaced by `NovaCat`/`LoadingStage`. Kept here only because the two design rules below outlived it and still govern the replacement.

`src/components/fx/EnergyCore.tsx`. **Not a spinner.** Five layers: expanding hexagonal energy waves · breathing halo · the brand mark pulsing · a holographic scan line crossing the mark · HUD corner brackets.

Two rules make it feel alive rather than mechanical:
1. **Deliberately unequal periods** (2.4 · 2.6 · 2.9 · 3.3 · 3.7 s) — the layers drift against each other, so the composite does not visibly repeat.
2. **`transform` and `opacity` only.** No `filter`, `box-shadow`, or `background-position` animation — those repaint every frame. Verified by a Playwright audit that walks `document.getAnimations()` and asserts the animated property set.

## 23.3 Performance fixes this exposed
The same audit found **pre-existing** non-composited animations and both were converted to transform sweeps (identical appearance):
- `.v-flow-line` — the energy line in the **navbar, footer and mobile tab bar**, i.e. three continuous repaints on every page.
- `.skeleton` — the shimmer, which can appear 20+ times on one loading page.

After the fix the audit reports **zero** non-composited animations anywhere on the page.

---

# 22. Global loading overlay (2026-08-01, visual replaced 2026-08-06)

> ⚠️ The **behaviour** below (what triggers it, grace periods, silent paths, the GET rule) is still exactly right. Only the **visual** changed: wherever this section says "Energy Core" or `BrandedLoader`, read `LoadingStage` — see **§29**.

**File:** `src/components/fx/LoadingProvider.tsx` · mounted in `Providers.tsx` **inside `I18nProvider`** (it needs `useT()` for its labels).

## 22.1 What it does
One app-wide "something is happening" language. It wraps `window.fetch` **once**, so every mutation — today's 45 call sites and every future one — automatically shows a centred, branded, fading overlay (`.v-ovl` → `LoadingStage`). No call site opts in; nothing can be forgotten.

## 22.1b Coverage — three places the overlay appears

| Trigger | What shows | Notes |
|---|---|---|
| **Full page load / reload** | `#v-boot` — server-rendered `LoadingStage` on an opaque backdrop | §22.1c |
| **Page switching** (any internal navigation) | the full overlay | 150 ms grace so instant/cached navigations don't flash |
| **Every mutation** (all sectors: orders, wallet, payments, admin, uploads, product updates…) | the full overlay | 120 ms grace for money/identity/upload, 220 ms for the rest |
| **Login / register / logout** | the full overlay | `/api/auth/*` is in `BLOCKING_PATHS`; these pages mount **no** loader of their own (§29.2) |

The 2 px top beam still runs **alongside** the overlay as a secondary signal (it replaced `NavProgress.tsx`, which was deleted — two systems would have run two bars on one navigation).

> ⚠️ **The one rule that must not change: GET/HEAD never show the overlay.** `/api/me` and `/api/notifications` poll continuously and were measured at **5.2 s** on a cold Neon connection. Blocking on reads would freeze every single page load for five seconds. Silent-by-default for reads is load-bearing, not a preference.

`tierFor()` / `graceFor()` in `LoadingProvider.tsx` decide from the request path (`BLOCKING_PATHS`) plus "is it a `FormData` body". Override per call with `start(label, { tier, grace })`.

## 22.1c Boot overlay — the reload case (`#v-boot`)
`LoadingProvider` is a React component, so it **cannot paint before hydration**. On F5 or a cold visit the user saw a blank screen (measured with Playwright: ~2.5 s of nothing). So the boot layer is **server-rendered markup in `layout.tsx`** running on pure CSS — visible on first paint, no JS required. `LoadingStage` is a server component whose motion *and message rotation* are CSS-only, so the boot screen and the in-app overlay are literally the same visual.

Two safety rules:
1. **grace `.18s`** — fast loads never flash it.
2. **`v-boot-safety` at 8 s** — if JS never runs, the screen removes *itself*. Without this, a JS failure would leave the site permanently covered.

Dismissed by `BootDismiss.tsx` on hydration. It freezes the current computed opacity before fading, because the element may still be mid-fade-in — snapping to 1 first would cause a visible flash on fast loads.

## 22.2 The three restraint rules (this is the whole design)
| Rule | Value | Why |
|---|---|---|
| **GET/HEAD never show** | — | Reads must not block. `/api/me` and `/api/notifications` poll constantly and were measured at **5.2 s** on a cold Neon connection — showing the overlay for reads would freeze every page load. |
| **GRACE delay** | 260 ms (routes 450 ms) | Anything faster finishes invisibly. A flashed overlay is worse than none. |
| **MIN_SHOW** | 420 ms | Once visible it stays briefly, so it can't strobe. |

Plus **`SAFETY_MS` = 20 s**: a job that never settles releases itself. A customer must never be trapped behind the overlay — this is not negotiable.

## 22.3 Staying silent
- Any `GET`/`HEAD`.
- `SILENT_PATHS`: `/api/notifications` (bell mark-as-read), `/api/auth/_log`.
- Opt-out header **`x-volt-silent`** (exported as `SILENT_HEADER`) on any request.

## 22.4 Route transitions
Detected by a `click` listener on internal `<a href="/…">`, plus `popstate` and non-prevented native `submit`. Cleared when `usePathname()` changes.

> ⚠️ **Do not add an `e.defaultPrevented` guard to that click handler.** Next's `<Link>` calls `preventDefault()` *before* the event reaches `document`, so the flag is always `true` — checking it silently disables every route transition. Playwright caught exactly this. Prevented-default *is* the signature of a client navigation.

Because the grace is 450 ms, routes with a `loading.tsx` skeleton never trigger it — the overlay appears only where the wait is genuinely long, and `NavProgress` still handles the fast case.

## 22.5 Labels
Contextual, translated (`load.*` keys in `src/lib/i18n.ts`, bn + en): order · payment · upload (any `FormData` body) · admin save.

Everything else — auth, route changes, unclassified mutations — returns **`''`**, and an empty label is the signal to play the rotating premium messages instead (§29.3). `load.auth`, `load.page` and `load.processing` were deleted with the labels that used them.

## 22.6 Manual control
`useLoading()` → `{ start, stop, withLoading }` for async work that isn't a `fetch`. Safe outside the provider (no-ops).

## 22.7 Verified
Playwright, 21/21: polling silent · fast mutation invisible · slow mutation shown · fade in→out sequence · min-show honoured · GET silent · silenced paths · opt-out header · all five labels · centred (0.0 px within the overlay box) · `aria-busy` · route overlay shows *and clears* · fast route stays skeleton-only · no new console errors. Label contrast: dark **7.97:1**, light **5.09:1** (both ≥ AA).

---

# ═══════════════════════════════════════════════════════════
# PHASE 1 — RELEASE BLOCKERS (Batch 1) — 2026-08-06
# ═══════════════════════════════════════════════════════════

এই ব্যাচে অপারেশনাল পরিপক্বতার মূল ফাঁকগুলো বন্ধ করা হয়েছে — কোড আগে
থেকেই production-grade ছিল, চারপাশের machinery কাঁচা ছিল।

## ১. Prisma Migrate Baseline (সবচেয়ে বড় deploy-blocker)

**সমস্যা:** প্রজেক্ট `prisma db push` দিয়ে চলত। `prisma/migrations/`-এ শুধু
একটি orphan `ALTER TABLE Review ADD photoUrl` ছিল, কোনো baseline `init`
migration বা `migration_lock.toml` ছিল না। ফলে নতুন/খালি DB-তে
`prisma migrate deploy` পুরো schema বানাতে পারত না — deploy অসম্ভব ছিল।

**সমাধান:**
- `prisma/migrations/00000000000000_init/migration.sql` — সম্পূর্ণ baseline
  (২৭ table · ১২ enum · ৩২ index · ১৬ FK)। schema-র সাথে programmatically
  ক্রস-ভেরিফাই করা (প্রতিটি model/enum/enum-value/index মিলেছে)।
- `20260728034227_review_photo_url` → `ADD COLUMN IF NOT EXISTS` করা হয়েছে,
  কারণ baseline-এ `photoUrl` ইতিমধ্যে আছে (idempotent, কোনো DB-তেই ভাঙে না)।
- `migration_lock.toml` (provider = postgresql) যোগ।
- `package.json`-এ scripts: `db:migrate`, `db:migrate:deploy`, `db:migrate:status`।

**⚠️ বিদ্যমান production DB-তে baseline mark করার ধাপ (একবার):**
```bash
npx prisma migrate resolve --applied 00000000000000_init
npx prisma migrate resolve --applied 20260728034227_review_photo_url
npx prisma migrate status   # "Database schema is up to date" দেখাবে
```
এটি Prisma-কে জানায় migration গুলো ইতিমধ্যে প্রয়োগিত (টেবিল আগেই আছে),
তাই সে আবার CREATE করতে গিয়ে ব্যর্থ হবে না। এরপর থেকে `db:migrate:deploy`
স্বাভাবিক কাজ করবে। **কেন `db push` রাখলাম না:** roadmap নিজেই "Replace
db push with Prisma Migrate" চেয়েছে; migration history/rollback/CI-verify
production-এ আবশ্যক।

## ২. হেলথ চেক সম্প্রসারণ — `src/lib/health.ts` (নতুন, reusable)

**আগে:** `/api/health` শুধু DB পিং করত।
**এখন:** একটি একক সত্যের উৎস (`getSystemHealth()`) সব সাবসিস্টেম দেখে —
database (critical), email, storage, telegram, monitoring। সব check
সমান্তরাল, প্রতিটি try/catch-এ মোড়া। `status='degraded'` কেবল critical
(DB) down হলে; ঐচ্ছিক ফিচার `not_configured` কখনো degraded বানায় না।
`/api/health` backward-compatible রাখা হয়েছে (পুরনো `db`/`uptimeMs` ফিল্ড
বহাল, নতুন `subsystems[]` যোগ)। এই module পরে অ্যাডমিন Health Dashboard-এও
reuse হবে (enterprise phase)।

## ৩. Email নীরব no-op দৃশ্যমান — `src/lib/email.ts`

**আগে:** `RESEND_API_KEY` না থাকলে `send()` চুপচাপ `return` করত — password
reset/verification নীরবে ভাঙা থাকত, কেউ টের পেত না।
**এখন:** no-op হলে throttled (প্রতি ১০ মিনিটে একবার) `logger.warn` — deploy
যে ইমেইল-বিহীন চলছে তা মনিটরিং-এ দৃশ্যমান। warn (error নয়), কারণ এটা
misconfiguration, crash নয়।

## ৪. Exception tracking — `src/lib/errorReporter.ts` (নতুন)

**সমস্যা:** কোনো error tracking ছিল না — production exception অদৃশ্য।
**সমাধান:** vendor SDK ছাড়া (bundle হালকা, lock-in নেই) একটি provider-agnostic
sink। `SENTRY_DSN` থাকলে Sentry-র store endpoint-এ exception POST করে
(DSN পার্স → auth header → event payload)। DSN না থাকলে নীরব no-op।
`logger.ts`-এর একক choke point-এ hook করা: `logger.error()` ডাকলেই
স্বয়ংক্রিয়ভাবে রিপোর্ট হয় (কল-সাইট বদলাতে হয় না)। fire-and-forget +
per-instance rate-limit (৩০/মিনিট), তাই কখনো মূল ফ্লো ব্লক/ভাঙে না।
হেলথ চেকে `monitoring` সাবসিস্টেম হিসেবে দৃশ্যমান।

## ৫. CI/CD — `.github/workflows/ci.yml` (নতুন)

প্রতিটি push/PR-এ: install → prisma generate → typecheck → lint → build,
এবং আলাদা job-এ `npm audit` (report-only)। build-phase-এ ডামি env
(`env.ts` phase-production-build-এ যাচাই skip করে), তাই secret লাগে না।

## ৬. README.md (নতুন)

নতুন dev-এর সম্পূর্ণ onboarding: quick start, env টেবিল, migration
baseline গাইড, স্থাপত্য ম্যাপ, টাকার invariant, হেলথ চেক।

## যাচাই (এই ব্যাচ)
- ✅ `tsc --noEmit` — 0 error
- ✅ `next lint` — 0 warning
- ✅ `next build` — Compiled successfully, ৬৭ static page
- ✅ init migration schema-র সাথে programmatic ক্রস-ভেরিফাই (২৭/২৭ table,
  ১২/১২ enum, প্রতিটি enum-value মিলেছে, ৩২/৩২ index, ১৬ FK)

## এই environment-এ যা করা যায়নি (Nahim-কে করতে হবে)
- **Live Postgres-এ migration deploy টেস্ট:** sandbox-এ Postgres ইনস্টল
  করা যায়নি (network limit)। migration SQL programmatically যাচাই করা,
  কিন্তু Nahim একটি নতুন Neon branch-এ `db:migrate:deploy` চালিয়ে একবার
  নিশ্চিত করলে ভালো।
- **Prisma engine (Linux):** এই zip Windows-এ তৈরি, তাই engine binary
  Windows-এর। Nahim-এর মেশিন/Vercel-এ `prisma generate` সঠিক engine বানাবে।

---

# ═══════════════════════════════════════════════════════════
# PHASE 1 (Batch 2) + PHASE 2 — SECURITY — 2026-08-06
# ═══════════════════════════════════════════════════════════

## Phase 1 সম্পূর্ণ: Backup Integrity — src/lib/backup.ts (নতুন)

**সমস্যা:** restore শুধু `_meta` আছে কিনা দেখত। corrupt/tampered/ভুল-সংস্করণ
ব্যাকআপ নীরবে আধা-restore হয়ে কনফিগ (দাম/পেমেন্ট নম্বর) নষ্ট করতে পারত।

**সমাধান:**
- `computeBackupChecksum()` — ডেটা অংশের (মেটা বাদে) canonical SHA-256।
  কী স্থির ক্রমে সাজানো, তাই একই ডেটা সবসময় একই checksum।
- backup route: `_meta.checksum` embed করে।
- restore route: `verifyBackup()` — checksum পুনঃগণনা করে মেলায়, version
  guard, app-name guard। না মিললে restore বাতিল (আধা-restore হওয়ার আগে)।
- পুরনো checksum-বিহীন ব্যাকআপ backward-compatible (`allowUnchecksummed`),
  কিন্তু checksum থাকলে অবশ্যই মিলতে হবে।
- **যাচাই:** unit test — round-trip match, tamper detect (নষ্ট ডেটা ধরা পড়ে),
  key-order independence, empty-backup stability — সব pass।

## Phase 2: Admin 2FA (TOTP) — src/lib/totp.ts (নতুন)

**কেন নিজে লেখা (নির্ভরতা ছাড়া):** TOTP অ্যালগরিদম (RFC 6238) ছোট ও
সুপ্রতিষ্ঠিত। `speakeasy`/`otplib` bundle বাড়ায়। Node crypto যথেষ্ট।

**যা আছে:** base32 secret gen/encode/decode, HOTP (RFC 4226), TOTP verify
(±১ ধাপ window, timing-safe), otpauth:// provisioning URI, recovery কোড
(gen + SHA-256 hash + consume)।

**★★★ যাচাই — সবচেয়ে গুরুত্বপূর্ণ:** RFC 6238-এর official test vectors
(T=59, 1111111109, 1234567890, 2000000000) সব **pass**। অর্থাৎ Google
Authenticator / Authy-র সাথে হুবহু মিলবে — ভুল implementation-এ admin
lock-out এর ঝুঁকি ছিল, সেটি নেই।

### 2FA সংরক্ষণ ও নিরাপত্তা
- secret DB-তে **AES-256-GCM এনক্রিপ্টেড** (secretbox reuse — নতুন crypto নয়)।
- recovery কোড শুধু হ্যাশ (SHA-256) DB-তে; plaintext কেবল enable-এর মুহূর্তে
  একবার দেখানো হয়।
- enable করার আগে অবশ্যই একটি বৈধ কোড দিতে হয় (নাহলে নিজেই লক-আউট)।
- QR: proven `qrcode` package (নিজে-লেখা QR encoder ঝুঁকিপূর্ণ ও verify করা
  যাচ্ছিল না বলে বাদ দিয়ে সুপ্রতিষ্ঠিত lib নেওয়া হয়েছে)। SVG সার্ভারে তৈরি।

### API ও UI
- `/api/account/2fa` — GET (status), POST (setup/enable/disable)।
- `/api/account/sessions/revoke-all` — sessionEpoch বাড়ায়।
- `src/components/TwoFactorSettings.tsx` — profile পেজে QR/enable/disable UI।
- `src/components/SignOutAllButton.tsx` — সব ডিভাইস সাইন-আউট।
- login পেজ: password ঠিক হলে সার্ভার '2FA_REQUIRED' দেয় → TOTP input দেখায়।

## Phase 2: Login 2FA Gate + Session Revocation — src/lib/auth.ts

- authorize(): password যাচাইয়ের পর, 2FA চালু থাকলে TOTP (বা recovery)
  কোড আবশ্যক। recovery কোড এককালীন — ব্যবহারে সরিয়ে দেওয়া হয়, audit log।
- `sessionEpoch` (User field): JWT stateless বলে individual-device revoke
  সম্ভব নয়, কিন্তু epoch বাড়ালে **সব** পুরনো টোকেন অকার্যকর। jwt callback
  প্রতি refresh এ DB epoch মিলিয়ে দেখে; না মিললে টোকেন বাতিল (ban-reverify
  logic-এর পাশেই)। Google login path-এও epoch বসে।

## Schema/Migration
- User টেবিলে: `twoFactorSecret`, `twoFactorEnabled`, `twoFactorRecovery`,
  `sessionEpoch` — সব additive/nullable/defaulted।
- migration: `20260806100000_admin_2fa_session_epoch` (ADD COLUMN IF NOT EXISTS)।

## সৎ সীমাবদ্ধতা (roadmap বনাম বাস্তবতা)
- **"Active sessions list / individual device revoke"** — JWT strategy-তে
  server কোনো session তালিকা রাখে না, তাই এটি সৎভাবে করা যায় না। fake
  তালিকা না বানিয়ে "সব ডিভাইস সাইন-আউট" (epoch) দেওয়া হয়েছে — যা JWT-র
  সাথে সঠিকভাবে কাজ করে ও একই নিরাপত্তা-উদ্দেশ্য (compromise হলে kill) পূরণ করে।

## যাচাই (এই ব্যাচ)
- ✅ Typecheck 0 error (Prisma client নতুন field সহ verify-patch করে; Nahim-এর
  `prisma generate`-এ স্বয়ংক্রিয় মিলবে)
- ✅ Lint 0 warning
- ✅ Build — Compiled successfully (2fa ও sessions route সহ)
- ✅ TOTP RFC 6238 vectors pass · Backup checksum tests pass

## নতুন নির্ভরতা
- `qrcode` (^1.5.4) + `@types/qrcode` (dev) — 2FA QR রেন্ডার। হালকা,
  সুপ্রতিষ্ঠিত, শুধু setup-এ সার্ভার-সাইডে ব্যবহৃত।

---

# ═══════════════════════════════════════════════════════════
# PHASE 3 — PERFORMANCE & SCALABILITY — 2026-08-06
# ═══════════════════════════════════════════════════════════

## সৎ মূল্যায়ন: বেশিরভাগ কাজ আগেই করা ছিল

এই codebase আগে থেকেই performance-সচেতন। অডিটে যা **ইতিমধ্যে ভালো**
পাওয়া গেছে, সেগুলোতে হাত দেওয়া হয়নি (over-engineering এড়াতে):
- **settings cache** (`settings.ts`) — TTL ৩০s, in-flight dedup, invalidate,
  payment-number safety বিবেচিত।
- **homepage** — sequential wave → parallel (`Promise.all`), TTFB ৫.৭s→৭৫০ms
  (কোডে নথিভুক্ত)। সব loader self-guarded।
- **ISR** — homepage/product ৬০s, static পেজ ৩৬০০s। admin/account যথাযথ
  `force-dynamic` (auth-gated live data)।
- **connection pooling** — env.example-এ Neon pooler + `connection_limit=1`
  guidance সম্পূর্ণ; prisma.ts-এ P2024/P1001 retry + singleton।
- **image** — next/image AVIF/WebP + responsive srcset।

## যা আসলে যোগ করা হয়েছে (genuine gaps)

### ১. Order টেবিলে missing index (সবচেয়ে গুরুত্বপূর্ণ — scale-critical)
`getShowcase()` চালায় `Order.groupBy(variantId) WHERE status='COMPLETED'`।
আগে index ছিল `[status, createdAt]` ও `[userId]` — কিন্তু (status,
variantId) এর জন্য কিছু ছিল না। order টেবিল বড় হলে (5000 ইউজার) এটি
**পূর্ণ scan** করত। যোগ করা হয়েছে:
- `@@index([status, variantId])` — showcase groupBy ও বেস্ট-সেলার হিসাব
- `@@index([variantId])` — variant-ভিত্তিক অর্ডার খোঁজা (রিপোর্ট)
migration: `20260806110000_perf_order_indexes` (CREATE INDEX IF NOT EXISTS)।
schema-তে এখন ৩৪ index (আগে ৩২)।

**index audit:** সব common filter (status/userId/isActive/code/productId/
isRead/orderId/categoryId) index-covered — Order showcase gap-ই একমাত্র missing ছিল।

### ২. next.config বান্ডল অপ্টিমাইজেশন
- `productionBrowserSourceMaps: false` — ক্লায়েন্ট বান্ডল ছোট, সোর্স কম উন্মুক্ত।
- `experimental.optimizePackageImports: ['framer-motion']` — barrel-file
  tree-shaking, শুধু ব্যবহৃত অংশ বান্ডলে। (lucide-react/recharts আসলে
  dependency নয় — তাই বাদ; ভুল প্যাকেজ দিলে build warn করত।)

## যা এই environment-এ verify করা যায়নি (Nahim-কে করতে হবে)
- **bundle size / lazy-loading impact** — bundle analyzer + browser লাগে।
  Nahim `ANALYZE=true npm run build` (analyzer যোগ করে) দিয়ে দেখতে পারে।
- **5000-user load test** — deployed infra-তে k6/Artillery দিয়ে করতে হয়;
  sandbox-এ সম্ভব নয়। index যোগ করায় DB-বাউন্ড অংশ অনেক দ্রুত হবে।

## যাচাই
- ✅ Typecheck 0 · Lint 0 · Build Compiled successfully
- ✅ index migration schema-সঙ্গত · next.config valid (build pass)

---

# ═══════════════════════════════════════════════════════════
# PHASE 4 — PAYMENT AUTOMATION FOUNDATION — 2026-08-06
# ═══════════════════════════════════════════════════════════

**roadmap স্পষ্ট: লাইভ গেটওয়ে বানানো নয় — production-ready architecture।**

## সৎ মূল্যায়ন: ভিত্তি আগেই চমৎকার ছিল

payments/ স্তর আগে থেকেই SOLID ও honest:
- **Gateway-ready architecture** ✅ — `PaymentProvider` interface (DIP),
  registry (Open/Closed), ৭টি গেটওয়ে stub।
- **Provider validation** ✅ — `configuredAsync`, `keysSetMap`, `envProvidedKeys`।
- **Provider health** ✅ — `ProviderHealth` (MANUAL_READY/NO_KEYS/PARTIAL_KEYS/
  CONFIGURED_PENDING); লাইভ ড্রাইভার নেই বলে `live=false` — সৎভাবে দেখানো।
- **Provider test mode** ✅ — `ProviderMode` ('test'|'live')।
- **Hybrid approval** ✅ — `fulfillment/policy.ts` `decideOrderApproval`
  (manual/automatic); ডিফল্ট manual → বর্তমান প্রবাহ অপরিবর্তিত।
- **Automatic verification framework** ✅ — `verify()`/`refund()` চুক্তি;
  stub গুলো configured না হওয়া পর্যন্ত পরিষ্কার বার্তায় থামে (ভুলে টাকা নড়া রোধ)।

## যা genuinely যোগ করা হয়েছে (আসল gap)

### ১. Webhook-Ready Design (সবচেয়ে বড় missing অংশ)
গেটওয়ে async payment confirmation webhook দিয়ে পাঠায় — এর কোনো
কাঠামো ছিল না। যোগ করা হয়েছে:
- **types.ts:** `WebhookEvent` (PAYMENT_SUCCEEDED/FAILED/REFUND_SUCCEEDED/
  IGNORED), `WebhookParseResult`, `WebhookRequest`। `PaymentProvider`-এ
  ঐচ্ছিক `parseWebhook()` — প্রোভাইডার raw payload যাচাই করে সাধারণ রূপে আনে।
- **receiver:** `/api/webhooks/payment/[provider]` — একটিই endpoint সব
  গেটওয়ে সামলায়। প্রবাহ: provider খোঁজা → enabled যাচাই → parseWebhook
  (signature সহ) → **idempotency** (Setting-এ `webhook:<provider>:<eventId>`
  marker; duplicate হলে skip — double-credit রোধ) → ইভেন্ট হ্যান্ডল।
- **webhookSignature.ts:** HMAC (sha256/sha512) timing-safe যাচাই helper —
  Stripe/SSLCommerz/Razorpay সব HMAC ব্যবহার করে। **যাচাই করা:** valid/
  prefixed accept, wrong-secret/tampered/empty reject, sha512 — সব pass।
  ⚠️ raw body অপরিবর্তিত রাখা হয় (req.text()), নাহলে signature ভাঙত।

**money-safety নীতি:** signature ছাড়া কোনো ইভেন্ট বিশ্বাস নয় (ভুয়া
"succeeded" = ফ্রি টপ-আপ); idempotency ছাড়া retry = double-credit। দুটোই বাধ্যতামূলক।

### ২. Queue-Ready Design — src/lib/queue/index.ts
`JobHandler` চুক্তি (idempotent flag সহ) + `runWithRetry` (exponential
backoff, never-throw)। **সৎ:** এখনো লাইভ গেটওয়ে/consumer নেই, তাই পূর্ণ
background worker বানানো হয়নি (ব্যবহারহীন জটিলতা = roadmap-এর "no dummy"
নীতির বিরুদ্ধে)। চুক্তি ও retry প্রস্তুত; queue backend (QStash/Vercel
Queue/DB-poll) যোগ করার সময় consumer কোড অপরিবর্তিত থাকবে।

### ৩. One-Click Environment Validation
- **env.ts:** non-throwing `validateEnv()` → `EnvReport` (required/optional,
  আছে/নেই/সমস্যা — কোনো মান নয়)।
- **readiness endpoint:** `/api/admin/readiness` (অ্যাডমিন) — এক কলে env +
  সিস্টেম হেলথ + পেমেন্ট প্রোভাইডার। `ready` bool + blockers[] + warnings[]।
  deploy-এর আগে "সব ঠিক?" এর একক উত্তর।

## যাচাই
- ✅ Typecheck 0 · Lint 0 · Build Compiled successfully (webhook ও readiness route সহ)
- ✅ HMAC signature helper — ৬টি case pass
- ✅ কোনো নতুন money path তৈরি হয়নি; সব stub honest ও guarded

## গেটওয়ে যোগ করার সময় (ভবিষ্যৎ dev-এর জন্য)
১টি গেটওয়ে চালু করতে: provider-এ `verify()`, `refund()`, `parseWebhook()`
পূরণ (webhookSignature helper দিয়ে) → গেটওয়ে ড্যাশবোর্ডে webhook URL
`/api/webhooks/payment/<id>` দেওয়া → env/DB-তে কী বসানো → admin panel-এ
enable। receiver/idempotency/queue/security অপরিবর্তিত থাকবে।

---

# ═══════════════════════════════════════════════════════════
# PHASE 5 — BUSINESS FEATURES — 2026-08-06
# ═══════════════════════════════════════════════════════════

## সৎ মূল্যায়ন: অনেক business feature আগেই ছিল

- **Referral** ✅ — code gen, double-payout-guarded bonus (`referral.ts`),
  customer-facing `ReferralCard` (account পেজ), অ্যাডমিন-কনফিগার bonus/min।
- **Admin reports** ✅ — revenue (today/7d/30d), deposits, best-selling
  products, top customers, new users; CSV export।
- **Live chat / support** ✅ — Tawk.to (`LiveChat.tsx`) integrated — তাই
  আলাদা support-ticket system বানানো হয়নি (duplicate/over-engineering)।

## যা genuinely যোগ করা হয়েছে

### ১. মুনাফা (Profit) tracking — সবচেয়ে গুরুত্বপূর্ণ business metric
আগে reports শুধু **revenue** দেখাত, **profit নয়** — অথচ মালিকের কাছে
মুনাফাই আসল। সমস্যা: `Variant.costPrice` ছিল কিন্তু Order snapshot করত না,
তাই cost পরে বদলালে ঐতিহাসিক মুনাফা ভুল হতো।

**সমাধান:**
- schema: `Order.costPrice` (Decimal, default 0) — অর্ডারের সময়কার unit
  cost snapshot। migration `20260806120000_order_cost_snapshot`।
- order route ও direct route — create-এ `costPrice: variant.costPrice`
  snapshot (Variant পরে বদলালেও অপরিবর্তিত)।
- admin reports পেজ — প্রতিটি period-এ মুনাফা (revenue − cost − refund)।
- ⚠️ পুরনো অর্ডারে costPrice=0 → মুনাফা কিছুটা বেশি দেখাবে; রিপোর্টে নথিভুক্ত।

### ২. Analytics module — src/lib/analytics.ts (নতুন, reusable)
একক সত্যের উৎস (reports পেজ ও API দুটোই ব্যবহার করে):
- `periodSummary(since)` — revenue/cost/profit/refund/orders/deposits।
- `revenueTrend(days)` — দিন-প্রতি revenue/profit trend (চার্টের জন্য;
  একটি query, JS-এ দিন-বাকেট — পোর্টেবল, raw SQL লাগে না)।
- `customerInsights()` — total/new/repeat customer, গড় অর্ডার-মূল্য।

### ৩. Analytics API — /api/admin/analytics (নতুন)
অ্যাডমিন। today/7d/30d summary + trend (৭–৯০ দিন) + customer insights এক কলে।
চার্ট/ড্যাশবোর্ড এই endpoint consume করতে পারে।

## যাচাই
- ✅ Typecheck 0 · Lint 0 · Build Compiled successfully (analytics route সহ)
- ✅ profit = revenue − cost − refund; costPrice snapshot দুই অর্ডার-পথেই
- ✅ কোনো money path বদলায়নি — costPrice কেবল রিপোর্টিং, ব্যালেন্স হিসাবে নয়

## ভবিষ্যৎ (ঐচ্ছিক, over-engineering নয় বলে বাদ)
- analytics endpoint-এর উপর একটি চার্ট-UI পেজ (recharts) — endpoint প্রস্তুত।
- পুরনো অর্ডারে costPrice ব্যাকফিল (Variant থেকে, আনুমানিক) — চাইলে এক-বারের script।

---

# ═══════════════════════════════════════════════════════════
# ENTERPRISE: Feature Flags + DEEP GAP-SCAN — 2026-08-06
# ═══════════════════════════════════════════════════════════

## Feature Flags — src/lib/featureFlags.ts (নতুন)

কোড deploy ছাড়া ফিচার on/off। DB Setting-এ `flag_<key>` ('1'/'0'),
settings cache-এর উপর বসে (দ্রুত, invalidate-সচেতন)। ৫টি flag:
live_activity, reviews, referral, review_photos, rating_badges।
- `isFeatureEnabled(key)` — ডিফল্ট সহ।
- `/api/admin/flags` (GET) — অবস্থা; সেভ সাধারণ settings রুট দিয়ে (DRY)।
- প্রোডাক্ট পেজে reviews flag wired (উদাহরণ consumer)।
- readiness endpoint-এ flags যোগ।
⚠️ flag কেবল UI/অ-আর্থিক ফিচার — টাকা/অর্ডার/নিরাপত্তা পথ কখনো নয়।

## Maintenance Mode — আগেই সম্পূর্ণ (verify করা)
`MaintenanceScreen` + `MaintenanceToggle` + layout gate + **admin bypass**
আগে থেকেই ছিল ও সঠিক — নতুন কিছু লাগেনি।

## ═══ DEEP GAP-SCAN ফলাফল ═══

পুরো প্রজেক্ট systematic স্ক্যান — নিচের ১৬টি দিক পরীক্ষা করা হয়েছে:

### 🔴 পাওয়া ও ঠিক করা gap

**GAP-1 (মাঝারি): Webhook idempotency marker settings cache pollute করত।**
webhook receiver `webhook:<provider>:<eventId>` marker Setting টেবিলে রাখত,
কিন্তু `getSettings()` পুরো Setting টেবিল load করে cache-এ — webhook বাড়লে
cache ফুলে যেত (memory + প্রতি refresh এ বড় ডেটা)।
*ঠিক:* (a) settings loader-এ DB-লেভেল filter `NOT key contains ':'` (আসল
সেটিংস-কী-তে কোলন নেই — যাচাই করা), (b) webhook route-এ ৭-দিন opportunistic
marker cleanup। এখন cache শুধু প্রকৃত সেটিংস ধরে।

**GAP-2 (ছোট): ৪টি ব্যবহৃত env `.env.example`-এ ছিল না।**
`CRON_SECRET`, `FF_LOOKUP_API_KEY`, `TELEGRAM_ENC_KEY`, `STORAGE_DRIVER` —
কোডে ব্যবহৃত কিন্তু documented ছিল না (নতুন dev টের পেত না)। যোগ করা হয়েছে।

### 🟢 পরীক্ষা করা ও নিরাপদ পাওয়া (কোনো gap নেই)

- **API auth:** সব route guarded (requireAdmin/requireUser/rateLimit);
  শুধু NextAuth handler নিজে auth।
- **Money safety:** সব wallet write `services/wallet.ts` দিয়ে; deposit/order/
  refund-এ `FOR UPDATE` row-lock; `admin/deposit:199` এর `balance:` শুধু
  response variable (creditWallet আসল কাজ করে) — false alarm।
- **XSS:** ৪টি `dangerouslySetInnerHTML` — সব নিরাপদ (server-esc preview,
  server-gen QR SVG, boldOnly sanitizer, theme-init script)।
- **SQL injection:** কোনো `$queryRawUnsafe`/`$executeRawUnsafe` নেই; সব
  parameterized `$queryRaw`।
- **Floating promise:** `upload:33` intentional best-effort `.catch()` (documented)।
- **Cron protection:** scheduler tick `CRON_SECRET` Bearer + 401।
- **Console usage:** মাত্র ৩টি (db-error fallback) — logger বাকি সব।
- **নতুন route dynamic:** সব ৬টি নতুন route-এ `force-dynamic`।
- **Index coverage:** নতুন groupBy query (analytics) Order(status/variantId)
  index-covered (Phase 3-এ যোগ করা)।
- **Migration ক্রম:** baseline → review → 2fa → perf → cost — সঠিক।
- **Seed:** নতুন field (costPrice default 0, 2FA nullable) seed ভাঙে না।

## চূড়ান্ত যাচাই (সব পরিবর্তনের পর)
- ✅ Typecheck 0 · Lint 0 · Build Compiled successfully

---

# ═══════════════════════════════════════════════════════════
# DEEP BUG-HUNT — logic/race/edge bugs — 2026-08-06
# ═══════════════════════════════════════════════════════════

pattern-match নয়, actual code-path পড়ে ৭টি bug ধরা ও ঠিক করা। এর
বেশিরভাগই এই সেশনে যোগ করা নতুন কোডে (নতুন কোডেই bug বেশি থাকে)।

## 🔴 BUG-1 (গুরুত্বপূর্ণ): 2FA login কাজ নাও করতে পারত
NextAuth v4-এ `authorize()` throw করা message (`2FA_REQUIRED`) ক্লায়েন্টে
**নির্ভরযোগ্যভাবে পৌঁছায় না** — অনেক setup-এ শুধু "CredentialsSignin"
আসে (web search-এ নিশ্চিত)। ফলে login page 2FA-কোড ইনপুট দেখাত না →
2FA-চালু ইউজার ঢুকতে পারত না।
*ঠিক:* deterministic pre-check endpoint `/api/auth/2fa-check` (email+password
যাচাই করে বলে 2FA লাগবে কিনা; rate-limited + timing-safe, সেশন তৈরি করে না)।
login page আগে এটি ডাকে; throw-fallback রাখা হয়েছে। এখন নির্ভরযোগ্য।

## 🔴 BUG-2 (গুরুত্বপূর্ণ): Webhook idempotency race → double-processing
webhook receiver `findUnique` → `create` (check-then-act) করত। একই webhook
একসাথে দুবার এলে (gateway দ্রুত retry করে) দুটোই null দেখত, দুটোই handle
করত → future gateway-এ double-credit।
*ঠিক:* atomic create-first — unique PK constraint-ই lock। create সফল হলে
এই instance owner; P2002 (duplicate) হলে skip। check-then-act বাদ।

## 🔴 BUG-3 (গুরুত্বপূর্ণ): Recovery code double-use race
2FA recovery কোড consume করত read-modify-write **lock ছাড়া**
(`authorize()`-এ)। একই recovery কোড নিয়ে দুটো login একসাথে এলে দুটোই
pass করত (একবার-ব্যবহার্য কোড দুবার)।
*ঠিক:* `$transaction` + `SELECT ... FOR UPDATE` — lock-এর ভেতরে আবার পড়ে,
তখনও থাকলেই remove ও pass। existing money-route pattern-এর সাথে সঙ্গতিপূর্ণ।

## 🔴 BUG-5 (মাঝারি): Analytics revenue trend ভুল দিনে বসত (timezone)
`revenueTrend` UTC তারিখে দিন-বাকেট করত, কিন্তু দোকান Bangladesh (UTC+6)।
রাত ৬টার পরের অর্ডার পরদিনের UTC-তে পড়ত → ভুল দিনের revenue।
*ঠিক:* +৬ঘণ্টা offset দিয়ে "Bangladesh দিন" হিসাব (bdDayKey helper)।

## 🔴 BUG-6 (মাঝারি): Prisma groupBy having inconsistency
`customerInsights` `_count: { _all: true }` select করত কিন্তু having-এ
`userId._count` চাইত — কিছু Prisma version-এ runtime error দেয়।
*ঠিক:* দুটোই `userId` — `_count: { userId: true }` + `having: { userId:
{ _count: { gt: 1 } } }`।

## 🟡 BUG-4 (ছোট, robustness): 2FA enable-এ secret validation নেই
enable-এ client-দেওয়া secret base32 যাচাই ছাড়া save হতো — malformed হলে
ইউজার স্থায়ী লক-আউট হতে পারত।
*ঠিক:* `/^[A-Z2-7]{16,}$/` যাচাই enable-এর আগে।

## 🟡 BUG-7 (ছোট): 2FA status endpoint corrupt-data-এ 500
GET `/api/account/2fa`-এ `JSON.parse(recovery)` unguarded — corrupt হলে পুরো
status endpoint 500 দিত (enabled অবস্থাও দেখা যেত না)।
*ঠিক:* safe-parse — corrupt হলে count 0, enabled অবস্থা তবু দেখায়।

## যাচাই (সব fix-এর পর)
- ✅ Typecheck 0 · Lint 0 · Build Compiled successfully
- ✅ recovery transaction existing money-route lock-pattern এর সাথে সঙ্গতিপূর্ণ
- ✅ retry-middleware × transaction interaction existing pattern-এর মতোই (নতুন ঝুঁকি নেই)

---

# ═══════════════════════════════════════════════════════════
# SUPER-DEEP LINE-BY-LINE SCAN — 2026-08-06
# ═══════════════════════════════════════════════════════════

প্রতিটি critical file লাইন ধরে পড়া। আরও bug ও limitation পাওয়া গেছে।

## 🔴 BUG-9 (গুরুত্বপূর্ণ): 2FA decrypt ব্যর্থতায় স্থায়ী লক-আউট
`auth.ts`-এ `decryptSecret(twoFactorSecret)` try/catch **ছাড়া** ছিল। যদি
`NEXTAUTH_SECRET`/`TELEGRAM_ENC_KEY` rotate হয় বা secret corrupt হয়,
decryptSecret throw করত → `authorize()` throw → 2FA ইউজার **স্থায়ীভাবে
লক-আউট**, recovery কোড দিয়েও না (throw decrypt-এই হতো, recovery check-এর আগে)।
*ঠিক:* decrypt try/catch-এ মোড়া — ব্যর্থ হলে TOTP বাদ কিন্তু recovery কোড
পথ খোলা থাকে। key rotation আর সব 2FA ইউজারকে লক করবে না।

## 🟡 BUG-10 (UI glitch): login-এ email/password বদলালে 2FA state আটকে থাকত
2FA কোড-স্ক্রিন দেখানোর পর ইউজার email/password বদলালে `needsTotp` true-ই
থাকত → ভুল অ্যাকাউন্টের জন্য 2FA চাইত।
*ঠিক:* email/password onChange-এ needsTotp ও totp reset।

## 🟡 BUG-13/14 (defense-in-depth): commit-পরবর্তী `await notify` guarded
৯টি জায়গায় (order, deposit approve/reject, refund, admin order complete/
refund/processing, balance adjust, password, 2fa enable/disable) transaction
commit-এর পর `await notify(...)` `.catch()` **ছাড়া** ছিল।
*বিশ্লেষণ (সৎ):* `notify()` **নিজেই** try/catch করে, কখনো throw করে না —
তাই এগুলো আসলে user-facing bug ছিল **না**। তবু `.catch()` যোগ করা হয়েছে
(defense-in-depth): ভবিষ্যতে notify refactor করে throw এলে money/order
commit-পরবর্তী notify-ব্যর্থতা যেন ইউজারকে ভুল "ব্যর্থ" না দেখায় (যা
double-order/double-refund ডেকে আনত)। ⚠️ comment-এ overclaim সংশোধন করা
হয়েছে — এগুলো bug-fix নয়, নিরাপত্তা-জাল।

## 🟢 লাইন-বাই-লাইন যাচাই করা ও নিরাপদ পাওয়া

- **wallet.ts:** creditWallet/debitWallet — ledger সবসময় লেখা (structural),
  balanceAfter DB থেকে (hand-calc নয়), assertPositive negative-amount আটকায়।
- **order route:** lock ক্রম variant→coupon→user (deadlock-free), stock race,
  coupon race, negative-price defense, snapshot — সব সঠিক।
- **coupon.ts:** discount cap, min-order, per-user limit; caller row-locks (order
  route)। validateCoupon preview (coupon/check) নিরাপদ (order-এ real check)।
- **deposit approval:** double-approve status-lock, linked-order lock, negative-
  balance guard, credit+settle একই transaction।
- **rateLimit.ts:** atomic INSERT ON CONFLICT (race-free), DB-clock (skew-safe),
  fail-open, off-by-one যাচাই করা সঠিক (limit=5 → ৫টা pass, ৬ষ্ঠ block)।
- **tracking.ts:** 128-bit token, contact 2nd-factor, masked UID, uniform error
  (enumeration-safe)।
- **register:** dupe-check + P2002 race-catch, referral validation, XSS guard।
- **JSON.parse (সব):** guard.ts (readJson wraps), store.ts, passwordReset,
  auth recovery, 2fa status — সব try/catch বা outer-guard-এ নিরাপদ।

## 📋 EXISTING FEATURE LIMITATIONS (bug নয়, নকশার সীমা)

1. **Wallet negative-balance:** structural guard নেই — negative আটকানো
   caller-এর দায়িত্ব (lock+check)। নতুন caller ভুল করলে negative হতে পারত।
   বর্তমান সব caller সঠিক, কিন্তু নাজুক প্যাটার্ন।
2. **Coupon lock split:** validateCoupon নিজে lock করে না; caller-কে আগে
   FOR UPDATE করতে হয়। নতুন caller ভুলে গেলে race ফিরে আসবে।
3. **Phone normalization নেই:** register-এ `+8801712...` ও `01712...` আলাদা
   অ্যাকাউন্ট বানাতে পারে (একই আসল নম্বর)। contactMatches-এ ১০-vs-১১ ডিজিট
   edge সামান্য নাজুক।
4. **costPrice ব্যাকফিল নেই:** পুরনো অর্ডারে costPrice=0 → মুনাফা রিপোর্ট
   কিছুটা বেশি দেখায় (নথিভুক্ত, one-time script দিয়ে সমাধেয়)।
5. **2FA TOTP replay:** একই ৬-অঙ্ক কোড ৩০s window-এ replay সম্ভব (used-code
   cache নেই)। standard TOTP আচরণ; login rate-limit brute ঠেকায়। banking-grade
   হলে used-code cache লাগত — এই shop-এ acceptable।

## চূড়ান্ত যাচাই
- ✅ Typecheck 0 · Lint 0 · Build Compiled successfully

---

# ═══════════════════════════════════════════════════════════
# EXTENDED SCAN: telegram/frontend/admin — 2026-08-06
# ═══════════════════════════════════════════════════════════

আরও subsystem লাইন ধরে পড়া (UID verify, telegram, OrderForm, admin, deposit)।

## 🔴 BUG-15 (মাঝারি): telegram job double-run (manual + scheduled)
`runJob()` tick থেকে (SCHEDULE) আসার আগে atomic claim হতো, কিন্তু MANUAL
("এখনই চালান") ও RETRY সরাসরি runJob-এ ঢুকত **claim ছাড়া**। admin manual
run + scheduled tick একসাথে হলে একই job দুবার চলত (broadcast হলে ইউজার
দুটো মেসেজ পেত, backup দুবার হতো)।
*ঠিক:* MANUAL/RETRY trigger-এ atomic `updateMany(status != RUNNING → RUNNING)`
claim যোগ; claim ব্যর্থ (count 0) হলে "জবটি চলছে" বার্তা। SCHEDULE tick থেকে
আসে (ইতিমধ্যে claimed), তাই তাকে বাদ — নাহলে নিজের claim-এ আটকাত।

## 🔴 BUG-16 (মাঝারি): ConfirmDialog ডাবল-ক্লিক → double-order
`ConfirmDialog`-এর confirm বাটন busy-state ছাড়া ছিল। onConfirm সাধারণত
async কাজ (অর্ডার/পেমেন্ট) শুরু করে, কিন্তু dialog বন্ধ হতে এক re-render
লাগে — সেই ফাঁকে দ্রুত দ্বিতীয় ক্লিক দ্বিতীয় অর্ডার পাঠাত (order route-এ
per-request idempotency নেই)।
*ঠিক (দুই স্তর):* (a) `ConfirmDialog`-এ internal `confirming` state — প্রথম
ক্লিকেই বাটন disable, open বদলালে reset (সব confirm dialog সুরক্ষিত)।
(b) `OrderForm.submit()`-এ re-entrancy গার্ড (`if (loading) return`)।

## 🔴 BUG-18 (defense-in-depth): direct-order ও deposit route notify
`order/direct` ও `deposit` route-এ commit-পরবর্তী `await notify` `.catch()`
ছাড়া ছিল (আগের sweep-এ বাদ পড়েছিল)। guarded — এখন **সব** route-এ শূন্য
unguarded `await notify` (যাচাই করা)।

## 🟢 লাইন-বাই-লাইন যাচাই করা ও নিরাপদ

- **uidVerify.ts:** cache, never-throw, graceful fallback (provider ডাউনে
  বিক্রি থামে না), timeout (AbortSignal)। textbook।
- **telegram api.ts:** retry+backoff, 429 retry_after মানে, timeout।
- **telegram scheduler tick:** atomic `updateMany` claim (double-run guard)।
- **admin/order:** FOR UPDATE, claim/takeover, double-refund guard।
- **order/direct trxId:** `@unique` + P2002 race-catch।
- **admin components:** সব fetch error-handled; RestoreForm type-RESTORE confirm।

## 🔴 LIMITATION-7 (ঠিক করা হয়েছে): analytics/flags/readiness-এর UI ছিল না
এই সেশনে বানানো `/api/admin/analytics`, `/api/admin/flags`,
`/api/admin/readiness` endpoint কাজ করত কিন্তু **কোনো admin UI ছিল না** —
feature অদৃশ্য (শুধু API)।
*ঠিক:* `ReadinessPanel.tsx` (নতুন) — admin টুলস পেজে সিস্টেম প্রস্তুতি
(env/health/payments), blockers/warnings, ও ফিচার-ফ্ল্যাগ টগল দেখায়।
এখন feature গুলো অ্যাডমিনের কাছে দৃশ্যমান ও ব্যবহারযোগ্য।

## 📋 আরও LIMITATION চিহ্নিত (bug নয়)

6. **UID provider নেই:** Free Fire-এর public lookup API নেই, তাই কোনো
   provider configured নেই — double-entry fallback-ই একমাত্র সুরক্ষা।
   commercial provider পেলে registry-তে এক এন্ট্রি যোগ করলেই চলবে।

## চূড়ান্ত যাচাই (এই ব্যাচ)
- ✅ Typecheck 0 · Lint 0 · Build Compiled successfully
- ✅ সব route-এ শূন্য unguarded commit-পরবর্তী notify
- ✅ ডাবল-অ্যাকশন গার্ড (confirm dialog + order re-entrancy + telegram job claim)

---

# ═══════════════════════════════════════════════════════════
# TABLE ALIGNMENT FIX (সব admin/other page) — 2026-08-06
# ═══════════════════════════════════════════════════════════

## সমস্যা: টেবিলের হেডার ও সারি এক উল্লম্ব রেখায় থাকত না (বেঁকে যেত)

সব admin টেবিল (OrderTable, UserTable, DataTable, ইত্যাদি) একই `.tbl`
class ব্যবহার করে। রিপোর্ট: কলাম হেডার আর নিচের ডেটা সোজা লাইনে মিলত না।

## মূল কারণ: `border-collapse` সেট করা ছিল না

`table.tbl`-এ `border-collapse` অনুপস্থিত → ব্রাউজার ডিফল্ট `separate`
চলত। এতে প্রতিটি সেলের **আলাদা বর্ডার** + `border-spacing` (২px ফাঁক)।
`thead th`-এর `border-bottom` ও `tbody td`-এর `border-top` আলাদা করে আঁকা
হতো, আর সেল-মধ্যবর্তী ফাঁক কলাম-সীমা সূক্ষ্মভাবে সরিয়ে দিত — বিশেষত যখন
কিছু সেলে `whitespace-nowrap` থাকে, কিছুতে নেই। ফলে হেডার ও ডেটার উল্লম্ব
রেখা মিলত না।

## সমাধান (এক লাইন, সব টেবিলে প্রযোজ্য)
`table.tbl { … border-collapse: collapse; }` — বর্ডার মিলিয়ে দেয়, সেল-ফাঁক
দূর করে। কলাম হেডার থেকে শেষ সারি পর্যন্ত একই প্রস্থে থাকে। যেহেতু **সব**
টেবিল `.tbl` ব্যবহার করে, একটিমাত্র নিয়মেই সব পেজ ঠিক হয়।

## যাচাই করা অন্যান্য (নিরাপদ)
- th/td padding মেলে (px-4 py-3.5 দুটোতেই)।
- OrderTable: ৯ th = ৯ td = colSpan 9 ✅; UserTable: ৮ = ৮ = ৮ ✅।
- `.num`/`.ctr` alignment সিস্টেম (specificity-সঠিক) আগে থেকেই ঠিক।
- sticky header নেই (থাকলে scroll-এ misalign হতো)।
- DataTable `<colgroup>` দিয়ে প্রস্থ দেয় (হেডার+সেল একই উৎস) — সঠিক।

## যাচাই
- ✅ Typecheck 0 · Lint 0 · Build Compiled successfully
