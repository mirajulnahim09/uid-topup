import { createHash, createHmac, timingSafeEqual } from 'crypto';

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

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ BKP-01 — HMAC স্বাক্ষর: "এই ফাইল **আমাদের সার্ভারই** বানিয়েছে"
 *
 *   ── কেন checksum যথেষ্ট ছিল না ──
 *   SHA-256 checksum-এ কোনো গোপন চাবি নেই — যে কেউ ফাইল সম্পাদনা করে
 *   checksum আবার হিসাব করে বসাতে পারত (আর checksum-বিহীন ফাইলও চলত)।
 *   ফলে অ্যাডমিনকে একটি সাজানো "ব্যাকআপ" restore করাতে পারলে bKash/Nagad
 *   নাম্বার (`paymentChannels`) বদলে দেওয়া যেত — গ্রাহকের সব টাকা ফেরতহীনভাবে
 *   অন্যের কাছে। checksum কেবল **নষ্ট হওয়া** ধরে, **জালিয়াতি** নয়।
 *
 *   ── এখন ──
 *   HMAC-SHA256(canonical data, সার্ভারের গোপন চাবি) → `_meta.signature`।
 *   চাবি ছাড়া বৈধ স্বাক্ষর বানানো অসম্ভব; restore স্বাক্ষর **বাধ্যতামূলক** করে।
 *
 *   চাবি: `BACKUP_SIGNING_KEY` (ঐচ্ছিক, আলাদা রাখাই ভালো) নাহলে
 *   `NEXTAUTH_SECRET` থেকে লেবেলসহ উদ্ভূত (একই গোপন মান সরাসরি পুনর্ব্যবহার নয়)।
 *   ⚠️ চাবি বদলালে (যেমন NEXTAUTH_SECRET রোটেশন) পুরনো ব্যাকআপ আর যাচাই হয় না —
 *   তাই রোটেশনের আগে/পরে নতুন ব্যাকআপ নিন, অথবা আলাদা `BACKUP_SIGNING_KEY` রাখুন।
 * ═══════════════════════════════════════════════════════════
 */
export function backupSigningKey(): Buffer {
  const own = (process.env.BACKUP_SIGNING_KEY || '').trim();
  if (own) return createHash('sha256').update(own, 'utf8').digest();
  const base = (process.env.NEXTAUTH_SECRET || '').trim();
  if (!base) throw new Error('ব্যাকআপ-স্বাক্ষরের চাবি নেই (BACKUP_SIGNING_KEY / NEXTAUTH_SECRET)');
  return createHmac('sha256', base).update('uid-topup:backup-signing:v1').digest();
}

/** ★ স্ট্রিমিং রপ্তানির জন্য — যা পাঠানো হয় হুবহু তাই স্বাক্ষরে যায় */
export function createBackupSigner(key: Buffer = backupSigningKey()) {
  return createHmac('sha256', key);
}

/** ডেটা অংশের HMAC-SHA256 (hex) — checksum-এর মতোই canonical বাইটের উপর */
export function computeBackupSignature(source: Record<string, unknown>, key?: Buffer): string {
  return createBackupSigner(key ?? backupSigningKey()).update(canonicalData(source)).digest('hex');
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
  opts: {
    allowUnchecksummed?: boolean;
    /**
     * ★ BKP-01 — ডিফল্ট **true**: বৈধ HMAC স্বাক্ষর ছাড়া কিছুই পাস করে না
     *   (স্বাক্ষরহীন পুরনো ফাইলও নয়)। `false` কেবল নষ্ট-হওয়া যাচাইয়ের টুলে।
     */
    requireSignature?: boolean;
    /** ★ টেস্ট/টুলে চাবি সরাসরি দেওয়া — না দিলে সার্ভারের env থেকে */
    key?: Buffer;
  } = {}
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

  // ★★★ BKP-01 — স্বাক্ষর আগে: জাল ফাইল checksum-এ পৌঁছানোর আগেই থামে
  if (opts.requireSignature !== false) {
    const sig = typeof meta.signature === 'string' ? meta.signature : '';
    if (!/^[0-9a-f]{64}$/.test(sig)) {
      return {
        ok: false,
        reason: 'ব্যাকআপে সার্ভার-স্বাক্ষর নেই (পুরনো বা বাইরের ফাইল) — নিরাপত্তার জন্য restore বন্ধ। এখন থেকে নতুন ব্যাকআপ নিন।',
      };
    }
    let expected: string;
    try {
      expected = computeBackupSignature(p, opts.key);
    } catch {
      return { ok: false, reason: 'সার্ভারে ব্যাকআপ-স্বাক্ষরের চাবি কনফিগার করা নেই' };
    }
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
      return {
        ok: false,
        reason: 'ব্যাকআপ-স্বাক্ষর মেলেনি — ফাইলটি পরিবর্তিত বা অন্য সার্ভারের। restore বাতিল।',
      };
    }
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
