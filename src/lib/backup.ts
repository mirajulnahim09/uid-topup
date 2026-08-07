import { createHash } from 'crypto';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ব্যাকআপ অখণ্ডতা (integrity) — SHA-256 checksum + version guard
 *
 *   ── সমস্যা যা এটি সমাধান করে ──
 *   আগে restore শুধু `_meta` আছে কিনা দেখত। কিন্তু একটি ব্যাকআপ
 *   ফাইল ডাউনলোড ও restore-এর মাঝে নষ্ট (truncated, edited, ভুল
 *   ফাইল) হতে পারত — আর সেটি নীরবে আধা-restore হয়ে যেত। কনফিগ/
 *   ক্যাটালগ ভুল হলে দোকান ভুল দামে/ভুল পেমেন্ট-নম্বরে চলত।
 *
 *   ── সমাধান ──
 *   ১. **Checksum:** ব্যাকআপ বানানোর সময় সব ডেটার (মেটা বাদে)
 *      canonical SHA-256 হিসাব করে `_meta.checksum`-এ বসানো হয়।
 *      restore-এ আবার হিসাব করে মিলিয়ে দেখা হয় — না মিললে থামে।
 *   ২. **Version guard:** ভিন্ন schema-version ব্যাকআপ restore করলে
 *      সতর্ক/থামানো — নীরব ভুল ম্যাপিং ঠেকাতে।
 *
 *   ⚠️ checksum ডেটার উপর, `_meta`-র উপর নয় — নাহলে exportedAt/
 *      exportedBy বদলালেই checksum বদলে যেত, যা অর্থহীন।
 * ═══════════════════════════════════════════════════════════
 */

export const BACKUP_VERSION = 2;

/** ব্যাকআপে যেসব ডেটা-কী checksum-এ ধরা হয় (মেটা বাদে, স্থির ক্রম) */
export const BACKUP_DATA_KEYS = [
  'users', 'categories', 'products', 'variants', 'banners', 'socialLinks',
  'paymentChannels', 'coupons', 'couponUses', 'deposits', 'orders',
  'ledger', 'notifications', 'settings', 'adminLogs', 'media', 'productImages',
] as const;

/**
 * ★ canonical serialization — কী সবসময় একই ক্রমে, তাই একই ডেটা
 *   সবসময় একই checksum দেয় (JSON.stringify কী-ক্রম ইনপুটের উপর
 *   নির্ভর করে; এখানে আমরা স্পষ্ট ক্রম বসাই)।
 */
function canonicalData(source: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const key of BACKUP_DATA_KEYS) {
    ordered[key] = source[key] ?? [];
  }
  return JSON.stringify(ordered);
}

/** ডেটা অংশের SHA-256 (hex) হিসাব করে */
export function computeBackupChecksum(source: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalData(source)).digest('hex');
}

export type BackupVerifyResult =
  | { ok: true; version: number }
  | { ok: false; reason: string };

/**
 * ★ restore করার আগে ব্যাকআপ যাচাই।
 *   - `_meta` ও checksum থাকা আবশ্যক
 *   - checksum পুনঃগণনা করে মিলিয়ে দেখা
 *   - version সমর্থিত কিনা
 *
 *   পুরনো (checksum-বিহীন) ব্যাকআপের জন্য `allowUnchecksummed`:
 *   সত্য হলে checksum না থাকলেও অনুমতি (backward compat), কিন্তু
 *   থাকলে অবশ্যই মিলতে হবে।
 */
export function verifyBackup(
  payload: unknown,
  opts: { allowUnchecksummed?: boolean } = {}
): BackupVerifyResult {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'ব্যাকআপ ফাইল পড়া যায়নি' };
  }
  const p = payload as Record<string, unknown>;
  const meta = p._meta as Record<string, unknown> | undefined;

  if (!meta || typeof meta !== 'object') {
    return { ok: false, reason: 'অবৈধ ব্যাকআপ — _meta নেই' };
  }

  if (meta.app && meta.app !== 'uid-topup') {
    return { ok: false, reason: 'এই ব্যাকআপ অন্য অ্যাপের — restore করা যাবে না' };
  }

  const version = Number(meta.version ?? 0);
  if (version > BACKUP_VERSION) {
    return {
      ok: false,
      reason: `ব্যাকআপ version ${version} — এই সংস্করণ (${BACKUP_VERSION}) তা পড়তে পারে না। অ্যাপ আপডেট করুন।`,
    };
  }

  const stored = meta.checksum as string | undefined;
  if (!stored) {
    if (opts.allowUnchecksummed) return { ok: true, version };
    return { ok: false, reason: 'ব্যাকআপে checksum নেই — অখণ্ডতা যাচাই করা যায়নি' };
  }

  const actual = computeBackupChecksum(p);
  if (actual !== stored) {
    return {
      ok: false,
      reason: 'ব্যাকআপ ফাইল নষ্ট বা পরিবর্তিত হয়েছে (checksum মেলেনি) — restore বাতিল',
    };
  }

  return { ok: true, version };
}
