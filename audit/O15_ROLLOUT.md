# O-15 — Preview isolation and the PR #1 production rollout

Status as of 2026-11-02. Nothing in this file has been run against production.
No credential, host or database URL appears here, and none may be added.

## 1. Target state

| Item | Production | Preview |
|---|---|---|
| Neon | project `uidtopup`, branch `production`, database `neondb` | **separate Neon project** `uidtopup-preview`, database `uidtopup_preview`, role `preview_owner` (own password; a branch of `uidtopup` would share the production role password) |
| Vercel `DATABASE_URL` / `DIRECT_URL` | Production-scoped only | Preview-scoped only, preview project |
| `NEXTAUTH_SECRET`, `ADMIN_PASSWORD`, `GOOGLE_CLIENT_SECRET` (+ `GOOGLE_CLIENT_ID`), `BLOB_READ_WRITE_TOKEN` (+ `BLOB_STORE_ID`) | Production-scoped only | own Preview values (Blob: separate store; Google: separate OAuth client or unset) |
| `NEXTAUTH_URL` | Production only | unset |
| Email / Telegram / game API / payments | as configured | blocked in code when `VERCEL_ENV=preview` (`src/lib/deploymentEnv.ts`); no Resend/Telegram/GAME_API/SSLCZ keys in Preview |
| Build guard | `assert-local-db` skips (Vercel) | `scripts/assert-preview-db.mjs` refuses any DB but `uidtopup_preview`, before connecting; then checks `current_database()` |
| GitHub | `production-db` (reviewer = owner, `main` only, no admin bypass): `PRODUCTION_DATABASE_URL`, `PRODUCTION_DIRECT_URL` | — |
| GitHub, daily check | `production-db-readonly` (`main` only, no admin bypass): `PRODUCTION_DATABASE_URL_READONLY`, `PRODUCTION_DIRECT_URL_READONLY` — a read-only Postgres role | — |

Optional: Preview-scoped `PREVIEW_DB_BOOTSTRAP=1` makes a preview build run
`prisma migrate deploy` on the preview database and, if it has no users, the
synthetic seed (`prisma/seed.ts`; needs a Preview-scoped `ADMIN_PASSWORD`).

## 2. Read-only production checks (owner runs, Neon SQL editor, branch `production`)

Metadata and counts only — no customer rows.

```sql
-- applied / failed migrations
SELECT migration_name,
       finished_at IS NOT NULL      AS applied,
       rolled_back_at IS NOT NULL   AS rolled_back
FROM "_prisma_migrations" ORDER BY started_at;

-- schema markers of the 6 migrations that are on upgrade/next-15 but not on main
SELECT
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_balance_positive')         AS m_20260918120000,
  EXISTS (SELECT 1 FROM pg_indexes   WHERE tablename = 'Notification')                 AS m_20260918130000_any_index,
  to_regclass('"RevokedSession"') IS NOT NULL                                           AS m_20260926120000,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Product' AND column_name = 'deliveryType')                AS m_20261031120000,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'adminlog_no_update')                 AS m_20261031130000;

-- the 20261031130000 pre-checks (both must be 0)
SELECT (SELECT count(*) FROM "Order" WHERE "refundedAmount" < 0 OR "refundedAmount" > price) AS bad_refunds,
       (SELECT count(*) FROM "Withdrawal" WHERE amount <= 0)                                 AS bad_withdrawals;
```

Expected on the 18 folders in `prisma/migrations`: every name applied, none
rolled back, except those pending. If any row shows `applied = false` or
`rolled_back = true`, stop — `migrate deploy` refuses a failed migration.

## 3. Compatibility of the pending migrations with the code on `main`

All six are additive for the code currently in production:

| Migration | Change | Old code |
|---|---|---|
| 20260918120000_money_check_constraints | CHECKs on prices, stock, balance, deposit, coupon | unaffected unless it writes invalid money values (then it now fails instead of corrupting) |
| 20260918130000_notification_indexes | indexes | unaffected |
| 20260926120000_revoked_sessions | new table | unaffected |
| 20260926130000_adminlog_target_index | index | unaffected |
| 20261031120000_voucher_codes_account_deletion_bangla_qr | enum value, nullable columns, `Product.deliveryType` NOT NULL **DEFAULT 'TOPUP'**, new table | unaffected (defaulted column) |
| 20261031130000_refund_withdrawal_checks_adminlog_append_only | CHECKs, AdminLog append-only triggers | app code on `main` never updates/deletes AdminLog (only `scripts/verify/_fixture-tbl-stack.ts`, not run in prod) |

So: **migrate first, then ship the code.**

## 4. Rollout sequence (every step needs the owner)

0. Preview isolation done (§1) and a preview build log shows
   `[assert-preview-db] preview build uses the isolated "uidtopup_preview" database (connected)`.
1. **Backup**: Neon → `uidtopup` → Branches → create branch `pre-pr1-YYYYMMDD` from
   `production` (instant, point-in-time). Optionally also `pg_dump` to encrypted storage.
2. Run §2. Both pre-check counts must be 0.
3. Vercel → Settings → Environments → Production → **Auto-assign Custom
   Production Domains: off**. A merge then builds a production deployment
   without serving it.
4. Add `PRODUCTION_DATABASE_URL` / `PRODUCTION_DIRECT_URL` to the GitHub
   environment `production-db` (environment secrets, never repo secrets).
5. Merge PR #1 (owner). The workflow files reach `main`; the production build
   is not promoted.
6. Actions → "Production migration (manual)" → Run on `main`, input
   `MIGRATE-PRODUCTION`; read "Pending migrations"; approve the `production-db`
   gate. Status after deploy must be clean.
7. Vercel → redeploy the `main` commit (build now prerenders against the
   migrated schema); smoke-test on its deployment URL; **promote**.
8. Auto-assign back on. Low-value order + deposit end to end; ledger check
   from `OPEN_RISKS.md` §3 step 9.

## 5. Rollback

- **Code**: Vercel → Deployments → promote the previous production deployment
  (instant). The migrated schema stays compatible with the old code (§3).
- **Migration failed mid-way**: the failed migration is recorded as failed
  in `_prisma_migrations` and the workflow stops. Prisma does not promise a
  transaction around a migration file, so check for partial changes before
  anything else; then `prisma migrate resolve` (owner only). Never re-run blindly.
- **Data**: restore = Neon branch `pre-pr1-YYYYMMDD` (reset `production` to it,
  or point Production `DATABASE_URL` at it). Destroys writes made after the
  backup — last resort, owner decision.
