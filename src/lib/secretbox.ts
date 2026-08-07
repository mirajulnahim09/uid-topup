import { createCipheriv, createDecipheriv, randomBytes, hkdfSync, timingSafeEqual } from 'crypto';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ গোপন মান এনক্রিপ্ট করে সংরক্ষণ (২০২৬-০৮-০৫)
 *
 *   কেন দরকার: EXE হিসেবে বিতরণ করা অ্যাপে অ্যাডমিন প্যানেল থেকেই
 *   বট টোকেন বসানো হবে, অর্থাৎ টোকেন **ডাটাবেসে** থাকবে। প্লেইনটেক্সট
 *   রাখলে DB ব্যাকআপ, DB ডাম্প, বা DB-তে পড়ার অধিকার আছে এমন যেকোনো
 *   কিছু = টোকেন ফাঁস। তাই AES-256-GCM।
 *
 *   ── GCM কেন (CBC নয়) ──
 *   GCM authenticated: কেউ ciphertext বদলালে decrypt **ব্যর্থ হয়**,
 *   চুপচাপ আবর্জনা ফেরত দেয় না। কনফিগ ডেটার জন্য এটাই দরকার।
 *
 *   ── কী (key) কোথা থেকে ──
 *   `TELEGRAM_ENC_KEY` থাকলে সেটি, নাহলে `NEXTAUTH_SECRET` (যা
 *   এমনিতেই আবশ্যক ও উচ্চ-এনট্রপি)। HKDF-SHA256 দিয়ে আলাদা
 *   ডোমেইন-সেপারেটেড কী বের করা হয় — অর্থাৎ সেশন-সাইনিং আর
 *   সিক্রেট-এনক্রিপশন একই বাইট ব্যবহার করে না।
 *
 *   ⚠️ **সৎ সীমাবদ্ধতা:** কী আসে env থেকে। তাই এটি *DB-চুরি* ঠেকায়
 *   (ব্যাকআপ, ডাম্প, SQL ইনজেকশন) — কিন্তু যে আক্রমণকারী একই সাথে
 *   env **ও** DB দুটোই পায়, সে ডিক্রিপ্ট করতে পারবে। সত্যিকারের
 *   আলাদা KMS/HSM ছাড়া এর চেয়ে ভালো করা যায় না, এবং ডেস্কটপ EXE-তে
 *   KMS বাস্তবসম্মত নয়। TELEGRAM_PRODUCTION_REPORT.md §নিরাপত্তা দেখুন।
 * ═══════════════════════════════════════════════════════════
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM-এর প্রামাণিক দৈর্ঘ্য
const TAG_LEN = 16;
const PREFIX = 'v1';

/** ডোমেইন সেপারেশন — অন্য কোথাও এই কী পুনর্ব্যবহার হবে না */
const HKDF_INFO = 'uidtopup:secretbox:v1';
const HKDF_SALT = 'uidtopup:secretbox:salt:v1';

let cachedKey: Buffer | null = null;

export class SecretBoxError extends Error {}

/**
 * কী একবারই বের করা হয় (মডিউল-লেভেল ক্যাশ)।
 * প্রতি কলে HKDF চালানোর দরকার নেই — ইনপুট স্থির।
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = (process.env.TELEGRAM_ENC_KEY || process.env.NEXTAUTH_SECRET || '').trim();
  if (!raw) {
    throw new SecretBoxError(
      'এনক্রিপশন কী নেই — NEXTAUTH_SECRET বা TELEGRAM_ENC_KEY সেট করুন।',
    );
  }
  if (raw.length < 16) {
    throw new SecretBoxError('এনক্রিপশন কী খুব ছোট (কমপক্ষে ১৬ অক্ষর দরকার)।');
  }

  // hkdfSync ArrayBuffer ফেরত দেয় — Buffer-এ মোড়ানো দরকার
  const derived = hkdfSync('sha256', Buffer.from(raw, 'utf8'), Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32);
  cachedKey = Buffer.from(derived);
  return cachedKey;
}

/** পরীক্ষার জন্য — env বদলালে ক্যাশ ফেলে দিতে হয় */
export function resetSecretBoxKey(): void {
  cachedKey = null;
}

/** এনক্রিপশন সম্ভব কি না (কী আছে কি না) — throw না করে */
export function isSecretBoxReady(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** ফরম্যাট: `v1.<iv>.<tag>.<ciphertext>` — সবই base64url */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

/**
 * ডিক্রিপ্ট — বিকৃত/ভুল-কী ইনপুটে `SecretBoxError`।
 * কখনো আংশিক/আবর্জনা ফল ফেরত দেয় না (GCM auth tag)।
 */
export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new SecretBoxError('গোপন মানের ফরম্যাট চেনা যায়নি');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
      throw new SecretBoxError('গোপন মানের দৈর্ঘ্য ভুল');
    }
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    if (e instanceof SecretBoxError) throw e;
    // ★ ভুল কী বা বিকৃত ডেটা — কারণ আলাদা করে বলা হয় না, কারণ
    //   "কী ভুল" আর "ডেটা বিকৃত" আলাদা করে জানানো আক্রমণকারীর কাজে লাগে।
    throw new SecretBoxError('গোপন মান ডিক্রিপ্ট করা যায়নি (কী বদলেছে?)');
  }
}

/** ইতিমধ্যেই এনক্রিপ্ট করা মান কি না */
export function isEncrypted(v: string): boolean {
  return typeof v === 'string' && v.startsWith(`${PREFIX}.`) && v.split('.').length === 4;
}

/** টোকেন তুলনা — টাইমিং-নিরাপদ (import যাচাইয়ে ব্যবহৃত) */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
