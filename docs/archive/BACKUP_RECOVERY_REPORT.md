# BACKUP_RECOVERY_REPORT.md

**Date:** 2026-07-31 · Build ✅.

## Review finding
A **full-database backup + restore already exists** (`/api/admin/backup`, `/api/admin/restore`, admin **Tools** page). This pass **extended** it, not replaced it.

## Backup (`/api/admin/backup` — admin only)
- Exports every table as one JSON file: users (**password hashes excluded** — H3), categories, products, variants, banners, social links, payment channels, coupons, coupon-uses, deposits, orders, ledger, notifications, **settings**, adminLogs.
- **Added this pass:** `Media` (library metadata) and `ProductImage` (gallery) tables — so media records are recoverable.
- Every download is audited (`BACKUP_DOWNLOAD`), streamed with `no-store`, filename timestamped.

### What each backup type covers
- **Database backup** — the full JSON above (all business data).
- **Settings backup** — the `settings` table is inside the DB backup (and can be restored selectively).
- **Media backup** — **metadata** (URLs, alt/title, dims) is in the backup; the **binary files** live in the storage provider (Vercel Blob / S3 / R2 / local) and are backed up **by that provider's** durability/versioning, not re-downloaded here (avoids duplicating large binaries and blowing the JSON size).

## Restore (`/api/admin/restore`)
- Restores **config + catalog only** (products, variants, categories, banners, coupons, settings, payment channels) from an uploaded backup JSON. It **never touches** users / deposits / orders / ledger — so money records can't be overwritten by an old file. Confirmation-gated ("RESTORE").

## Architecture readiness (per requirement)
- **Manual backup** — implemented (download button, Tools page). ✅
- **Scheduled backup** — architecture ready: the backup logic is a plain GET handler; a cron (Vercel Cron / external scheduler) can hit it with an admin token, or a small `scripts/backup.ts` can call the same Prisma reads and push to object storage. **Not wired live** (no scheduler credentials configured) — documented seam.
- **Media/off-site** — the storage abstraction (`lib/storage`, `STORAGE_DRIVER`) means binaries can live on S3/R2 with provider-side versioning/replication for DR.

## Limitations (honest)
- No off-site/cloud backup destination is wired (no credentials) — by instruction; the manual JSON download + provider durability cover today's DR.
- Restore is deliberately config/catalog-only to protect money data; full disaster recovery of user/money tables would use a DB-level restore (Neon point-in-time recovery) rather than this JSON.

## Result
Manual DB/settings/media-metadata backup works and now includes media; restore is safe (money-protected); scheduled + off-site paths are architecturally ready to wire when credentials exist.
