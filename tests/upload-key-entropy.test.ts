/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ UPL-02 — আপলোড-key-র গোপন অংশ এখন CSPRNG (১২৮-বিট)
 *
 *   Blob `public`; ডিপোজিট-স্ক্রিনশটের একমাত্র গোপনীয়তা তার নাম। আগে
 *   `Math.random()`-এর ৮ অক্ষর (CSPRNG নয়)। দাবি:
 *     · key = `<folder>/<ms>-<৩২ hex>.<ext>` — ১২৮-বিট `crypto.randomBytes`
 *     · প্রতিটি আপলোডে আলাদা; `Math.random` আর ব্যবহৃত হয় না
 *     · বিদ্যমান URL-যাচাই (`isOwnUploadUrl`/ডিপোজিট-schema) নতুন key মেনে নেয় —
 *       নাহলে গ্রাহকের নিজের আপলোডই ডিপোজিটে প্রত্যাখ্যাত হতো
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const puts = vi.hoisted(() => [] as string[]);
vi.mock('../src/lib/storage', async (orig) => ({
  ...(await orig<typeof import('../src/lib/storage')>()),
  getStorage: () => ({
    name: 'local',
    configured: true,
    reason: null,
    put: async ({ key }: { key: string }) => { puts.push(key); return { url: `/uploads/${key}` }; },
    del: async () => {},
    owns: () => true,
  }),
}));

import { uploadImage } from '../src/lib/upload';
import { isOwnUploadUrl, depositSchema } from '../src/lib/validation';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); puts.length = 0; });

// ন্যূনতম বৈধ PNG (magic bytes + IHDR) — detectMime ও imageSize পাস করে
const PNG = new Uint8Array(Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8FFFF3F0005FE02FEA7D6A5D60000000049454E44AE426082',
  'hex',
));
const png = () => new File([PNG], 'shot.png', { type: 'image/png' });

describe('UPL-02 — আপলোড key', () => {
  it('key = folder/ms-৩২hex.ext; প্রতিবার আলাদা; Math.random ডাকা হয় না', async () => {
    const spy = vi.spyOn(Math, 'random');
    const a = await uploadImage(png(), 'deposits');
    const b = await uploadImage(png(), 'deposits');
    expect(a.key).toMatch(/^deposits\/\d+-[0-9a-f]{32}\.png$/);
    expect(b.key).toMatch(/^deposits\/\d+-[0-9a-f]{32}\.png$/);
    expect(a.key).not.toBe(b.key);
    expect(spy).not.toHaveBeenCalled();
  });

  it('নতুন key বিদ্যমান URL-যাচাইয়ে বৈধ — লোকাল ও Blob দুই আকারেই, ডিপোজিট-schema সহ', async () => {
    const { url, key } = await uploadImage(png(), 'deposits');
    expect(isOwnUploadUrl(url)).toBe(true);
    vi.stubEnv('BLOB_PUBLIC_HOST', 'ourstore01.public.blob.vercel-storage.com');
    expect(isOwnUploadUrl(`https://ourstore01.public.blob.vercel-storage.com/${key}`)).toBe(true);
    const dep = depositSchema.safeParse({
      method: 'BKASH', amount: 100, trxId: 'ABC123XYZ', senderNo: '01711111111', screenshot: url,
    });
    expect(dep.success).toBe(true);
  });
});
