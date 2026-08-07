# FINAL_PRODUCTION_AUDIT_REPORT.md

**Scope:** Rebrand to **SS UID TOPUP**, then a full pre-release production audit — every page, route, API, table, integration and workflow verified by actually running them in a visible browser.
**Date:** 2026-08-05
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS**) · `test:money` **18/18** ✅

| Audit suite | Result |
|---|---|
| Pages (32 pages × 3 viewports, live browser) | **0 issues** |
| Tables (alignment, drift, overflow, focus, empty states) | **0 issues** |
| System (security, a11y, SEO/PWA, themes, DB, animations) | **54/54** |
| Telegram production | **71/71** |
| Telegram enterprise | **94/94** |
| Telegram enterprise Playwright | **44/44** |
| Telegram wizard Playwright | **42/42** |
| Money invariants | **18/18** |

---

## 1. Branding — SS UID TOPUP

**Style chosen: `SS · UID TOPUP`** — the full name kept intact, presented as a two-tone wordmark with `SS` in the accent colour, a hairline middot, then `UID TOPUP`. It reads as a brand rather than a sentence, needs no new font or artwork, and degrades to plain text wherever colour isn't available (emails fall back gracefully, `aria-label` uses the plain name).

Applied to: browser title · metadata/SEO · OpenGraph · Twitter card · PWA manifest (`SS UID` as `short_name`, since home-screen labels truncate past ~12 chars) · navbar wordmark · footer · loading/splash · login · register · homepage · admin panel · customer dashboard · email header and subjects · Telegram messages and templates · notifications · seed data · the live `site_name` setting · `.env` / `.env.example` sender.

**All fallbacks now come from one file** — `src/lib/brand.ts`. The old name was scattered across 20+ files, so a rename previously meant hunting every occurrence and any miss left stale branding on a page.

### The trap I deliberately avoided
Three strings *look* like branding but are **functional identifiers**:

| String | Why it must not change |
|---|---|
| `uidtopup:secretbox:v1` / `:salt:v1` | HKDF inputs. Changing them makes **every stored encrypted bot token undecryptable.** |
| `uidtopup.telegram.backup` / `.config` | File-format markers. Changing them makes existing backup files fail validation. |
| `admin@uidtopup.local` | The seeded admin **login address**. |

A blind find-and-replace would have silently destroyed the encryption. All three were excluded and verified untouched after the rename.

The visual identity (VoltMark hexagon, favicon, colour system) was **not** changed — the brief asked to keep it.

---

## 2. Issues found and fixed

### 2.1 Broken images had no fallback — *fixed*
**Found:** `/admin/media` threw `400` from the Next image optimizer and logged a console error per image.
**Root cause:** two `Media` rows pointed at `/uploads/products/*.webp` files that no longer exist on disk. `SafeImage` handled *disallowed hosts* but not *missing files*, so a deleted upload produced a broken-image box and console noise — **including on customer-facing product pages**, not just admin.
**Fixed:** `SafeImage` now catches `onError` and renders a neutral, theme-aware "ছবি নেই" placeholder with an accessible label. Verified with a deliberately-broken probe row.
**Also fixed:** the two dead `Media` rows were removed after confirming **zero references** (no `ProductImage`, `Product`, `Banner` or `Campaign` pointed at them) and that their files are permanently gone. Products and product images were clean — 0 missing local refs.

### 2.2 Homepage was 5.7 s in production — *fixed, 36 % faster*
**Found:** production `next start` measurement — `/` at **5.7 s TTFB** while every other page was ~750 ms.
**Root cause:** the homepage ran **five sequential `await` waves** (`opsStatus` → `hero` → campaign batch → deliveries), each a separate round-trip to a remote Neon instance. None of them consumed each other's results; they only needed `settings`, which was already resolved.
**Fixed:** collapsed waves 2–5 into a single `Promise.all`, and parallelised the two independent queries inside `getShowcase()` (category tree and the sales `groupBy`).
**Measured:** **5 738 ms → 4 347 ms → 3 639 ms.**

Each function remains self-guarded (returns empty on failure), so `Promise.all` introduced no new failure path.

### 2.3 Dead code and unused dependency — *removed*
- `src/components/admin/TelegramManager.tsx` — superseded by `telegram/TelegramDashboard.tsx`, referenced nowhere.
- `src/lib/gsapClient.ts` — imported by nothing, and the **sole consumer of the `gsap` package**. Removed the file and uninstalled `gsap`, cutting an unused dependency from the install and supply-chain surface.

### 2.4 Repository cleanup
24 superseded session reports moved to `docs/archive/`. Root now holds `MANUAL_PRO.md` (authoritative) plus the five current reports that `MANUAL_PRO` §25–27 cites, and this one. Archived rather than deleted — they contain the reasoning behind decisions.

---

## 3. Verification results

### 3.1 Pages — 32 audited, live browser
Every public, customer and admin page loaded at 1440/768/390 px.

```
pages audited      : 32
HTTP failures      : 0
console errors     : 0
failed requests    : 0
overflow (any vp)  : 0
TOTAL ISSUES       : 0
```

Auth guards verified: `/account`, `/admin`, `/admin/users` all redirect to `/login?callbackUrl=…` when logged out. `/404` returns a real HTTP 404.

### 3.2 Tables — 0 issues
Header/body column alignment was measured by **actual pixel position** (`getBoundingClientRect`), not by reading CSS classes — identical classes can still drift through `colspan`, padding or `border-collapse`.

| Check | Result |
|---|---|
| Header ↔ body column alignment | 0 columns off by >1.5 px |
| Column width drift across rows | 0 px |
| Header/body cell-count match | all match |
| Overflow without a scroll wrapper | none |
| Mobile 390 px page overflow | 0 px on every table page |
| Focus ring visibility | 12/12 sampled controls |
| Empty states | present where there is no data |

Most admin pages use card layouts rather than tables — appropriate, and they pass the same overflow checks.

### 3.3 Security — 54/54 within the system audit
| Area | Result |
|---|---|
| 24 admin APIs, anonymous | all 401/403 |
| 6 user APIs, anonymous | all 401 |
| SQL-injection payload | safely rejected (400) |
| XSS payload on registration | no 500 |
| Malformed JSON | 400, never 500 |
| Rate limiting | 429 after 9 requests |
| CSP / X-Frame-Options / nosniff / Referrer-Policy | all present |
| HSTS | configured under `isProd` (correctly absent over dev http) |
| `X-Powered-By` | hidden |
| Secrets on public pages | none (token, `NEXTAUTH_SECRET`, `DATABASE_URL` all absent) |
| `/.env` served | 404 |
| Token in client JS bundles | absent (bundles fetched and scanned) |
| Audit logging | every admin mutation logged; secret values redacted |

### 3.4 Accessibility
`/`, `/login`, `/register`: 0 unlabelled inputs, 0 images without `alt`, 0 unnamed buttons, `lang` set, exactly one `h1`, skip-link present. Admin workspace: tabs expose `role="tab"` + `aria-selected` inside a `role="tablist"`; 33 keyboard-focusable controls.

**Reduced motion:** verified with an actual `prefers-reduced-motion: reduce` browser context — 13 animations, longest duration **0.01 ms**.

### 3.5 Performance
- Shared JS **87.3 kB**, unchanged across the whole audit.
- **27 running CSS animations, properties `transform, opacity` only** — zero non-composited, so nothing repaints per frame.
- Production route timings (best of 3, warm): `/` 3 639 ms, all other pages **718–793 ms**.
- API: `/api/me` 41 ms, `/api/notifications` 22 ms (session-cached), `/api/health` ~750 ms (one DB round-trip).

> **Honest reading of these numbers:** `/api/health` does a single trivial query and still takes ~750 ms. That is the **network round-trip to a us-east-1 Neon database from this machine** — it is the floor for every page, and it is topology, not code. The homepage fix removed round-*trips*; it cannot remove round-*trip latency*. Co-locating the app server with the database in production should bring these to tens of milliseconds.

### 3.6 Database
71 indexes · 16 foreign keys · 193 check constraints · 0 negative balances · 0 orphan orders · 0 orphan ledger entries · 0 Media rows pointing at missing files. Money invariants 18/18 (row-locked transactions, ledger chain intact, ledger sum == balance).

### 3.7 Integrations
Telegram (4 suites, 251 checks total), Google OAuth (configured, guarded), database, media/storage, payment architecture, notification centre, Integration Hub and scheduler all verified. PWA manifest carries the new brand, valid icons and theme colour. Sitemap serves 20 URLs; robots.txt valid.

---

## 4. Files modified

**Branding:** `src/lib/brand.ts` *(new)* · `layout.tsx` · `manifest.ts` · `Navbar.tsx` · `Footer.tsx` · `email.ts` · `(public)/layout.tsx` · `(public)/terms` · `account/layout.tsx` · `ReferralCard.tsx` · `SiteManager.tsx` · `telegram/{index,dispatch,handlers,templates,backup}.ts` · `telegram/manage`, `telegram-test`, `admin/backup` routes · `ConnectionWizard.tsx` · `prisma/seed.ts` · `.env` · `.env.example` · live `site_name` setting.

**Fixes:** `src/components/fx/SafeImage.tsx` (missing-image fallback) · `src/app/(public)/page.tsx` (parallel data loading) · `src/lib/showcase.ts` (parallel queries).

**Removed:** `src/components/admin/TelegramManager.tsx` · `src/lib/gsapClient.ts` · `gsap` dependency · 2 dead `Media` rows · 24 reports → `docs/archive/`.

**New audit tooling:** `scripts/audit-{pages,tables,system,perf,deadcode}.ts` — all re-runnable, and each clears its own rate-limit state so runs are reproducible.

---

## 5. Remaining recommendations

1. **`home_trust_stats` is a toggle that does nothing.** The admin can switch "trust statistics" on/off in Homepage settings and it saves — but `getTrustStats()` (`src/lib/trustMetrics.ts`) is never called, so nothing renders. A control that lies is worse than a missing one. **Either wire the stats back into the homepage or remove the toggle** — that is a product decision, so I flagged it rather than choosing for you.
2. **Co-locate the app with the database.** ~750 ms per round-trip currently dominates every page. This is the single largest remaining performance factor and it is infrastructure, not code.
3. **Homepage could go further** — the category→product→variant tree costs several round-trips through Prisma's nested relation loading. A single SQL join would collapse them, at the cost of more complex code.
4. **`waitUntil` for fire-and-forget Telegram sends** on serverless (carried from earlier reports; unchanged).
5. **Rotate the Telegram bot token** — it has been in plaintext `.env` and appeared in terminal output during earlier sessions.
6. **Change `ADMIN_PASSWORD`** before public launch; `.env.example` still warns about this.
7. **Drag-and-drop bot priority has no keyboard alternative** — a real accessibility gap in the Telegram admin.
8. **Next.js major upgrade (15/16)** remains the highest-value hardening item (framework advisories with no 14.2.x patch).

---

## 6. Final score

Scored against *"ready for public release"*, not against perfection.

| Dimension | Score | Reasoning |
|---|---|---|
| **UI** | **9.0 / 10** | 0 layout issues across 32 pages × 3 viewports; tables pixel-verified; consistent token-driven design; both themes correct. Not a 10 — the visual identity is competent rather than distinctive. |
| **UX** | **8.5 / 10** | Coherent flows, honest empty/loading/error states, wizard-guided setup. Held back by the dead `home_trust_stats` toggle and no keyboard path for drag-reorder. |
| **Performance** | **7.5 / 10** | Bundle is lean (87.3 kB shared), animations fully compositor-only, homepage 36 % faster. Capped by ~750 ms DB round-trips and a homepage still at 3.6 s. |
| **Security** | **9.0 / 10** | Every API guarded, encryption at rest, secrets absent from every client surface, full header set, rate limiting, audit logging with redaction. Short of 10 only because the encryption key shares the host with the data. |
| **Accessibility** | **8.5 / 10** | Labels, alt text, focus rings, skip-link, reduced-motion all verified. One known gap: keyboard drag-reorder. No screen-reader pass with a real AT. |
| **Maintainability** | **8.5 / 10** | Single-source brand, one dispatch seam, storage behind a repository, dead code removed, extensive rationale in comments. Some large components remain. |
| **Scalability** | **8.0 / 10** | Multi-bot architecture, provider registry, indexed schema, atomic job claiming, log pruning. Bot config as a JSON row and in-process scheduling are the known ceilings. |
| **Production readiness** | **8.5 / 10** | 0 failures across 8 suites; every claim verified by running it. Deductions for the dead toggle, unrotated token and default admin password. |

### **Overall: 8.4 / 10 — ready for public release**

Nothing blocking remains. Before going live, do these three: **rotate the Telegram token**, **change the admin password**, and **decide the `home_trust_stats` question**. The performance ceiling is infrastructure — deploy the app in the same region as the database and the numbers in §3.5 improve by roughly an order of magnitude without touching code.
