# Open risks, decisions needed, pre-deploy checklist — audit 2026-10-31

## 1. Not fixed, and why

| ID | Sev | What | Why not fixed here | Suggested next step |
|---|---|---|---|---|
| O-01 | P1 | `next@14.2.35` has critical advisories: GHSA-9g9p-9gw9-jx7f (Image Optimizer `remotePatterns` DoS, self-hosted) and GHSA-h25m-26qc-wcjf (RSC request deserialization DoS). npm offers only `next@16` (major). | Major upgrade = owner decision (CLAUDE.md §2.2 rule 8). Mitigations already in place: AVIF disabled, `remotePatterns` pinned to our own Blob host; on Vercel, image optimisation runs on Vercel's infra. | Follow `NEXT15_UPGRADE_PLAN.md`, on its own branch, with this suite as the gate. |
| O-02 | P2 | `@vercel/blob@2.6.1` pulls vulnerable `undici` (DoS / response splitting via retry interceptor) and `zod` via `@vercel/cli-config`; app `zod@3` has GHSA-mrhx-c7xc-m3w5 (memory on oversized constrained collections); `source-map-js` (build-time). | `npm audit fix` bumps `@vercel/blob` 2.6.1 → 2.8.2 (a direct dependency; needs approval). `zod` fix is `zod@4` (major, every schema). **Do not run `npm audit fix --omit=dev`**: its dry-run removes vitest and other devDependencies from node_modules. | Approve the `@vercel/blob` minor bump; re-run blob tests. zod: our only array schemas sit behind admin/API-key auth, so the risk is low — schedule zod 4 later. |
| O-03 | P2 | Dev DB (`localhost:5434`) has the schema of all 18 migrations, but `_prisma_migrations` is missing `20261031120000_…` and `20261031130000_…` (they were applied with `db push` by `fix-dev.bat`). | Touching migration history is a decision; it is dev only. | Dev: `npx prisma migrate resolve --applied <name>` for both, with DATABASE_URL pointing at the dev DB. Production: run `npm run db:migrate:deploy` (see §3). |
| O-04 | P3 | A 2FA account that tries Google sign-in now lands on NextAuth's generic "Access denied" page (secure, but no friendly Bangla message). | UI change in login page; product copy decision. | Return `'/login?error=2fa'` and show "এই অ্যাকাউন্টে ইমেইল+পাসওয়ার্ড+কোড দিয়ে ঢুকুন". |
| O-05 | P3 | Images POSTed straight to `/api/upload` keep EXIF (GPS); the UI path re-encodes through canvas and strips it. | Server-side re-encode needs an image library (new dependency). | Approve `sharp` or accept. |
| O-07 | P3 | Coupon preview and the order dialog show the retail price to a RESELLER-tier web user; the server correctly charges the reseller price (lower). | Display only; customer is charged less than shown, never more. | Pass tier price to the product page. |
| O-08 | P3 | Anonymised accounts keep PII inside financial/audit rows: `Deposit.senderNo`, `Withdrawal.accountNumber`, `Order.playerUid`, `AdminLog.detail` (append-only by trigger). | Financial and audit records must not be rewritten (rule 2.1.5). | Document in the privacy policy that payment references are retained for accounting. |
| O-09 | P3 | Coverage numbers (lines/branches) were not produced: the suite runs through a real `next dev` over HTTP, so in-process coverage of route handlers is not collected by Vitest. | Needs `@vitest/coverage-v8` (new devDependency) and server-side instrumentation. | Approve the devDependency, or accept test-case coverage as the measure. |
| O-10 | P3 | k6 load scripts (`scripts/load/*.js`) were not run: `k6` is not installed on this machine. Node-based load test (`scripts/verify/load-test.ts`) was run instead. | Installing a system tool is outside the repo. | Install k6 (`winget install k6`) and run `k6 run scripts/load/k6-money-storm.js` against a staging URL. |
| O-11 | P2 | Mobile Core Web Vitals under throttling (4x CPU, 1.6 Mbps, scripts/verify/perf-browser.ts): LCP 2.9–4.7 s on guest/customer pages (home 4.7 s, product 3.4 s); admin /admin/deposits CLS 0.217, /admin/products CLS 0.166. Desktop: every page LCP ≤ 1.16 s, CLS ≤ 0.018. | Performance work (hero/LCP image, framer-motion share of the 87 kB shared JS) is a design change, not a defect fix. | Profile the home hero (LCP element), lazy-load below-fold motion, reserve height for admin table toolbars. |
| O-12 | P3 | Hard-coded success greens in new storefront decoration: StorefrontShell.tsx:82 (avatar palette), :468 (icon tile), :486 (gem SVG). All aria-hidden/decorative, not status text. | Token rule (CLAUDE.md §1) prefers tokens; no contrast-bearing text is affected. | Move to --sem-success/--badge-new tokens when the storefront is next touched. |
| O-13 | P3 | Dead code proved (FINDINGS.md): ui/DataTable.tsx, fulfillment/service.ts, queue/index.ts, trustMetrics.ts. | PROGRESS.md records them as awaiting owner decision. | Delete in one commit if approved. |

## 2. Decisions needed from Nahim (max 3)

1. **Next.js major upgrade** (O-01): schedule now, or accept the documented mitigations until a later sprint?
2. **`@vercel/blob` 2.6.1 → 2.8.2** (O-02): approve the minor bump that clears the undici/zod-via-blob advisories?
3. **Coverage tooling** (O-09): approve `@vitest/coverage-v8` as a devDependency so line/branch coverage can be reported?

## 3. Pre-deploy checklist

1. Back up production (Neon branch or `pg_dump`) before anything else.
2. Run the two pre-checks on production — both must return 0, or `20261031130000` will roll back:
   ```sql
   SELECT COUNT(*) FROM "Order" WHERE "refundedAmount" < 0 OR "refundedAmount" > price;
   SELECT COUNT(*) FROM "Withdrawal" WHERE amount <= 0;
   ```
3. Apply migrations with the **direct** (non-pooler) URL: `npm run db:migrate:deploy`, then `npm run db:migrate:status` → "up to date".
   This audit never connected to production, so which migrations are pending there is unknown — run `migrate status` first and read its list.
4. `npx prisma generate && npm run typecheck && npm run lint && npm run build` on the release commit.
5. Env vars present in Vercel: `DATABASE_URL` (pooled), `DIRECT_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `CRON_SECRET` (same value in GitHub Actions secret), `BLOB_READ_WRITE_TOKEN`, `RESEND_API_KEY` + verified `EMAIL_FROM` domain, `TELEGRAM_*`, `GOOGLE_CLIENT_ID/SECRET`. `TRUSTED_PROXY` must stay unset on Vercel.
6. GitHub Actions secrets `APP_BASE_URL` and `CRON_SECRET` set; trigger `Cron Jobs` manually once, then check `/api/admin/readiness`.
7. Admin account: change the seed password and enable 2FA (previous audits flagged the live admin still on the seed password). With F-01 fixed, 2FA now also blocks the Google path.
8. Secret rotation: follow `SECRET_ROTATION_CHECKLIST.md` (live secrets were once shipped inside a zip — rotate if not done yet).
9. After deploy: place one real low-value order and one deposit end-to-end; run `SELECT` ledger check:
   ```sql
   SELECT u.id FROM "User" u LEFT JOIN "LedgerEntry" l ON l."userId" = u.id
   GROUP BY u.id, u.balance HAVING u.balance <> COALESCE(SUM(l.amount), 0);
   ```
   Expect zero rows (users seeded with a balance before the ledger existed would show here — investigate, do not "fix" by editing balances).
