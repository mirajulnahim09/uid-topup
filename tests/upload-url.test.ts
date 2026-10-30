/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ গ্রাহকের দেওয়া ছবি-URL — কেবল নিজের স্টোরেজ (চূড়ান্ত অডিট)
 *
 *   ── কোন বাগটি এই ফাইল আটকায় (ব্রাউজারে মাপা, ২০২৬-০৯-১৭) ──
 *   ডিপোজিটের `screenshot` ও রিভিউর `photoUrl` ছিল `z.string().url()`:
 *     · `javascript:alert(document.cookie)` → রিভিউ API 200, সংরক্ষিত
 *     · বাইরের সাইট → 200; রিভিউ পাবলিক প্রোডাক্ট-পাতায় `<a href>` হয়
 *     · অথচ আমাদের নিজের লোকাল-আপলোড `/uploads/…` → 400 "Invalid url"
 *
 *   ব্রাউজার-স্তরের প্রমাণ: `scripts/verify/security-probes.ts`।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isOwnUploadUrl, depositSchema, reviewSchema } from '../src/lib/validation';

afterEach(() => vi.unstubAllEnvs());

describe('isOwnUploadUrl — কেবল /api/upload যে আকারে key বানায়', () => {
  it('তিনটি ড্রাইভারের আসল আকার গ্রহণ করে', () => {
    expect(isOwnUploadUrl('/uploads/deposits/1789629628517-vyutbyqy.png')).toBe(true);
    // ★ UPL-01 — Blob কেবল **আমাদের** স্টোর (নকল টেস্ট-টোকেন, SDK-র আকারে)
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_Abc123xyz_testonlynotasecret');
    expect(isOwnUploadUrl('https://abc123xyz.public.blob.vercel-storage.com/deposits/1789629628517-vyutbyqy.webp')).toBe(true);
    vi.stubEnv('S3_PUBLIC_URL', 'https://cdn.example.com/media/');
    expect(isOwnUploadUrl('https://cdn.example.com/media/deposits/1789629628517-ab12.jpg')).toBe(true);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'data:image/png;base64,AAAA',
    'https://evil.example/deposits/1-a.png',
    'http://abc.public.blob.vercel-storage.com/deposits/1-a.png',
    'https://abc.public.blob.vercel-storage.com.evil.example/deposits/1-a.png',
    'https://user:pw@abc.public.blob.vercel-storage.com/deposits/1-a.png',
    'https://abc.public.blob.vercel-storage.com/deposits/1-a.png?x=1',
    '/uploads/../api/admin/backup',
    '/uploads/deposits/1-a.svg',
    '//evil.example/uploads/deposits/1-a.png',
    '/api/admin/backup',
  ])('প্রত্যাখ্যান: %s', (url) => {
    expect(isOwnUploadUrl(url)).toBe(false);
  });

  it('S3 ভিত্তি সেট না থাকলে কোনো অচেনা https হোস্ট নয়', () => {
    vi.stubEnv('S3_PUBLIC_URL', '');
    expect(isOwnUploadUrl('https://cdn.example.com/media/deposits/1-ab.jpg')).toBe(false);
  });
});

describe('স্কিমা — ঐচ্ছিক থাকে, কিন্তু দিলে নিজের হতেই হবে', () => {
  const dep = { method: 'BKASH', amount: 100, trxId: 'ABC123XYZ', senderNo: '01712345678' };

  it('স্ক্রিনশট ছাড়া বা খালি — আগের মতোই বৈধ', () => {
    expect(depositSchema.safeParse(dep).success).toBe(true);
    expect(depositSchema.safeParse({ ...dep, screenshot: '' }).success).toBe(true);
  });

  it('বাংলা বার্তা দেয়, ইংরেজি "Invalid url" নয়', () => {
    const r = depositSchema.safeParse({ ...dep, screenshot: 'https://evil.example/x.png' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.errors[0].message).toBe('ছবিটি আবার আপলোড করুন');
  });

  it('রিভিউ: নিজের আপলোড ঠিক, javascript: নয়', () => {
    const base = { orderId: 'o1', rating: 5 };
    expect(reviewSchema.safeParse({ ...base, photoUrl: '/uploads/deposits/1-a.png' }).success).toBe(true);
    expect(reviewSchema.safeParse({ ...base, photoUrl: 'javascript:alert(1)' }).success).toBe(false);
  });
});
