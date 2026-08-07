import { createHmac, randomBytes, timingSafeEqual, createHash } from 'crypto';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ TOTP (RFC 6238) — নিজস্ব বাস্তবায়ন, শূন্য নির্ভরতা
 *
 *   কেন নিজে লেখা: `speakeasy`/`otplib` টানলে dependency ও bundle
 *   বাড়ে। TOTP অ্যালগরিদম ছোট ও সুপ্রতিষ্ঠিত (HMAC-SHA1, ৩০s ধাপ,
 *   ৬ অঙ্ক) — Node crypto দিয়েই নিরাপদে করা যায়। Google Authenticator,
 *   Authy, Microsoft Authenticator সবই এই মানক ফলো করে।
 *
 *   ⚠️ secret কখনো plaintext DB-তে যায় না — secretbox দিয়ে এনক্রিপ্ট
 *      করে রাখা হয় (কল-সাইটের দায়িত্ব)।
 *   ⚠️ কোড যাচাই timing-safe ও ±১ ধাপ window (ঘড়ি সামান্য ভিন্ন হলেও চলে)।
 * ═══════════════════════════════════════════════════════════
 */

const DIGITS = 6;
const PERIOD = 30; // সেকেন্ড
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** নতুন base32 secret (160-bit — RFC সুপারিশ) */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // অজানা অক্ষর উপেক্ষা
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** নির্দিষ্ট counter-এর জন্য HOTP কোড (RFC 4226) */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (JS number ৫৩-bit নিরাপদ, TOTP-এ যথেষ্ট)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** বর্তমান TOTP কোড (সাধারণত সার্ভার নিজে বানায় না — যাচাই করে) */
export function generateTotp(base32Secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD);
  return hotp(base32Decode(base32Secret), counter);
}

/**
 * ★ ব্যবহারকারীর দেওয়া কোড যাচাই। ±window ধাপ পরীক্ষা করা হয়
 *   (ডিফল্ট ১ = আগের/পরের ৩০s), timing-safe তুলনা।
 */
export function verifyTotp(
  base32Secret: string,
  token: string,
  opts: { window?: number; atMs?: number } = {}
): boolean {
  const cleaned = (token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;

  const window = opts.window ?? 1;
  const atMs = opts.atMs ?? Date.now();
  const secret = base32Decode(base32Secret);
  const counter = Math.floor(atMs / 1000 / PERIOD);

  for (let i = -window; i <= window; i++) {
    const candidate = hotp(secret, counter + i);
    if (timingSafeEqualStr(candidate, cleaned)) return true;
  }
  return false;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * ★ Authenticator অ্যাপে যোগ করার otpauth:// URI — এটি QR কোডে
 *   রূপান্তর করা হয় (ক্লায়েন্ট-সাইড)। issuer/label ব্র্যান্ড অনুযায়ী।
 */
export function totpProvisioningUri(
  base32Secret: string,
  accountEmail: string,
  issuer: string
): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ═══════════ Recovery Codes ═══════════

/** ১০টি এককালীন recovery কোড তৈরি (মানুষ-পাঠযোগ্য ফরম্যাট) */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`); // XXXXX-XXXXX
  }
  return codes;
}

/** recovery কোড হ্যাশ (SHA-256) — DB-তে plaintext কখনো নয় */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase().replace(/\s/g, '')).digest('hex');
}

/** সংরক্ষিত হ্যাশ-তালিকার সাথে একটি কোড মেলে কিনা → মিললে বাকি হ্যাশ ফেরত (consumed বাদ) */
export function consumeRecoveryCode(
  input: string,
  storedHashes: string[]
): { matched: boolean; remaining: string[] } {
  const h = hashRecoveryCode(input);
  const idx = storedHashes.indexOf(h);
  if (idx === -1) return { matched: false, remaining: storedHashes };
  const remaining = storedHashes.filter((_, i) => i !== idx);
  return { matched: true, remaining };
}
