/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Blob-পথ — আসল `@vercel/blob` SDK + আসল ড্রাইভার, নকল Blob-সার্ভারের বিরুদ্ধে
 *
 *   আসল Vercel Blob টেস্টে ছোঁয়া হয় না (NV)। SDK নিজেই `VERCEL_BLOB_API_URL` দিয়ে
 *   API-ঠিকানা বদলাতে দেয় — তাই একটি লোকাল HTTP সার্ভার Blob-API সেজে আসল অনুরোধটি
 *   ধরে। দাবি:
 *     · PUT-এ key = `deposits/<ms>-<৩২hex>.png` (UPL-02), public, random-suffix বন্ধ, Bearer টোকেন
 *     · ফেরত URL আমাদের নিজের-স্টোর যাচাই (`isOwnUploadUrl`, UPL-01) পেরোয়; অন্য স্টোরের নয়
 *     · Blob-সার্ভার ৫০০ দিলে আপলোড ত্রুটি উপরে যায় (মিথ্যা সফলতা নয়)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const STORE = 'mockstore123';
const TOKEN = `vercel_blob_rw_${STORE}_testonlynotarealtoken`;
const seen: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; bytes: number }> = [];
let failNext = false;

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, bytes: body.length });
    if (failNext) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"code":"internal","message":"mock failure"}}'); return; }
    const pathname = new URL(req.url!, 'http://x').searchParams.get('pathname')!;
    const url = `https://${STORE}.public.blob.vercel-storage.com/${pathname}`;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url, downloadUrl: `${url}?download=1`, pathname, contentType: 'image/png', contentDisposition: 'inline' }));
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  vi.stubEnv('VERCEL_BLOB_API_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('VERCEL_BLOB_RETRIES', '0');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  vi.stubEnv('BLOB_PUBLIC_HOST', '');
  vi.stubEnv('STORAGE_DRIVER', 'blob');
});
afterAll(() => { vi.unstubAllEnvs(); server.close(); });

const PNG = new Uint8Array(Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8FFFF3F0005FE02FEA7D6A5D60000000049454E44AE426082',
  'hex',
));

describe('Blob-ড্রাইভার (নকল Blob-API)', () => {
  it('আসল SDK যা পাঠায় ও ফেরত URL — key, public, suffix বন্ধ, টোকেন; নিজের-স্টোর যাচাই পেরোয়', async () => {
    const { uploadImage } = await import('../src/lib/upload');
    const { isOwnUploadUrl } = await import('../src/lib/validation');
    const r = await uploadImage(new File([PNG], 's.png', { type: 'image/png' }), 'deposits');
    const req = seen.at(-1)!;
    expect(req.method).toBe('PUT');
    expect(new URL(req.url, 'http://x').searchParams.get('pathname')).toMatch(/^deposits\/\d+-[0-9a-f]{32}\.png$/);
    expect(req.headers['x-vercel-blob-access']).toBe('public');
    expect(req.headers['x-add-random-suffix']).toBe('0');
    expect(req.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    expect(req.bytes).toBe(PNG.length);
    expect(r.url.startsWith(`https://${STORE}.public.blob.vercel-storage.com/deposits/`)).toBe(true);
    expect(isOwnUploadUrl(r.url)).toBe(true);
    expect(isOwnUploadUrl(r.url.replace(STORE, 'attackerstore'))).toBe(false);
  });

  it('Blob-সার্ভার ৫০০ → আপলোড ত্রুটি উপরে যায় (মিথ্যা সফলতা নয়)', async () => {
    const { uploadImage } = await import('../src/lib/upload');
    failNext = true;
    await expect(uploadImage(new File([PNG], 's.png', { type: 'image/png' }), 'deposits')).rejects.toThrow();
    failNext = false;
  });
});
