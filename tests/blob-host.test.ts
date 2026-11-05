/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ UPL-01 — কেবল আমাদের নিজের Vercel Blob স্টোর বিশ্বাস করা হয়
 *
 *   আগে `endsWith('.public.blob.vercel-storage.com')` — যেকোনো স্টোর পাস করত,
 *   আর যে কেউ নিজের স্টোর খুলতে পারে। এখন হোস্ট টোকেন থেকে হুবহু (SDK-র নিজের
 *   নিয়ম: storeId = token.split('_')[3]) বা `BLOB_PUBLIC_HOST` থেকে।
 *   টোকেনগুলো নকল (টেস্ট-কেবল), কোনো আসল গোপন মান নয়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ownBlobHost } from '../src/lib/blobHost';
import { isOwnUploadUrl, depositSchema } from '../src/lib/validation';
import { blobDriver } from '../src/lib/storage/blob';
import { baseUrl } from './helpers/app';

const OURS = 'https://ourstore01.public.blob.vercel-storage.com/deposits/1789629628517-vyutbyqy.png';
const OTHER = 'https://attackerstore.public.blob.vercel-storage.com/deposits/1789629628517-vyutbyqy.png';

afterEach(() => vi.unstubAllEnvs());

describe('ownBlobHost', () => {
  it('টোকেন থেকে হুবহু হোস্ট (ছোট হাতের)', () => {
    expect(ownBlobHost({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_OurStore01_xyzTESTONLY' }))
      .toBe('ourstore01.public.blob.vercel-storage.com');
  });
  it('BLOB_PUBLIC_HOST অগ্রাধিকার পায়; অবৈধ মান প্রত্যাখ্যাত', () => {
    expect(ownBlobHost({ BLOB_PUBLIC_HOST: 'OurStore01.public.blob.vercel-storage.com', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_zzz_x' }))
      .toBe('ourstore01.public.blob.vercel-storage.com');
    expect(ownBlobHost({ BLOB_PUBLIC_HOST: 'evil.example' })).toBeNull();
  });
  it('কনফিগ না থাকলে null — কোনো স্টোরই বিশ্বাস নয়', () => {
    expect(ownBlobHost({})).toBeNull();
    expect(ownBlobHost({ BLOB_READ_WRITE_TOKEN: 'garbage' })).toBeNull();
  });
});

describe('UPL-01 — অন্যের Blob স্টোর প্রত্যাখ্যাত', () => {
  it('ইনপুট-যাচাই: আমাদের স্টোর গৃহীত, অন্য স্টোর নয়', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_OurStore01_xyzTESTONLY');
    expect(isOwnUploadUrl(OURS)).toBe(true);
    expect(isOwnUploadUrl(OTHER)).toBe(false);
  });

  it('ডিপোজিট স্কিমা অন্য স্টোরের "স্ক্রিনশট" নেয় না', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_OurStore01_xyzTESTONLY');
    const base = { method: 'BKASH', amount: 100, trxId: 'ABC123XYZ', senderNo: '01712345678' };
    expect(depositSchema.safeParse({ ...base, screenshot: OURS }).success).toBe(true);
    expect(depositSchema.safeParse({ ...base, screenshot: OTHER }).success).toBe(false);
  });

  it('Blob কনফিগার না থাকলে কোনো Blob URL-ই "নিজের" নয়', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    vi.stubEnv('BLOB_PUBLIC_HOST', '');
    expect(isOwnUploadUrl(OURS)).toBe(false);
  });

  it('চলমান সার্ভারের CSP-তে যেকোনো-স্টোর wildcard নেই (middleware)', async () => {
    const res = await fetch(`${baseUrl()}/login`, { redirect: 'manual' });
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain('img-src'); // ইতিবাচক নিয়ন্ত্রণ: হেডারটি আছে
    expect(csp).not.toContain('*.public.blob.vercel-storage.com');
  });

  it('স্টোরেজ ড্রাইভারের owns() — কেবল আমাদের হোস্ট', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_OurStore01_xyzTESTONLY');
    const d = blobDriver();
    expect(d.owns(OURS)).toBe(true);
    expect(d.owns(OTHER)).toBe(false);
    expect(d.owns('https://ourstore01.public.blob.vercel-storage.com.evil.example/x.png')).toBe(false);
  });
});
