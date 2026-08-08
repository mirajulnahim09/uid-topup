/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SSLCommerz ড্রাইভার (Group E)
 *
 *   একটি **আসল HTTP mock সার্ভার** SSLCommerz-এর ভ্যালিডেশন API
 *   নকল করে; প্রোভাইডার `SSLCZ_BASE_URL` দিয়ে সেদিকে তাকায়। ফলে
 *   fetch/টাইমআউট/JSON-পার্সিং — পুরো নেটওয়ার্ক পথটাই পরীক্ষিত হয়,
 *   ফাংশন stub করে নয়।
 *
 *   ── যা প্রমাণ করা হচ্ছে ──
 *   IPN একটি অননুমোদিত POST। তাই সবচেয়ে গুরুত্বপূর্ণ দাবি:
 *   **payload-এর কোনো মান বিশ্বাস করা হয় না** — অঙ্ক, status,
 *   tran_id সবই ভ্যালিডেশন API-র উত্তর থেকে আসে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { db } from '../vitest.setup';
import { sslczMockPort } from './helpers/app';

/** ★ mock গেটওয়ে যা ফেরত দেবে — প্রতিটি টেস্ট নিজের মতো সাজায় */
let respond: (valId: string) => { code: number; body: unknown };
let hits: string[] = [];
let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    const valId = url.searchParams.get('val_id') || '';
    hits.push(valId);

    // ★ ক্রেডেনশিয়াল সত্যিই পাঠানো হচ্ছে কিনা — নাহলে আসল গেটওয়ে
    //   ৪০১ দিত আর আমরা বুঝতেই পারতাম না
    const hasCreds =
      Boolean(url.searchParams.get('store_id')) &&
      Boolean(url.searchParams.get('store_passwd'));
    if (!hasCreds) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'INVALID_TRANSACTION', error: 'no creds' }));
      return;
    }

    const out = respond(valId);
    res.writeHead(out.code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });

  // ★ পোর্টটি globalSetup ঠিক করেছে ও Next প্রসেসকেও জানিয়ে দিয়েছে —
  //   তাই receiver টেস্টেও (যেখানে কল Next থেকে যায়) এই mock-ই সাড়া দেয়
  const port = sslczMockPort();
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // ★ টেস্ট-প্রসেস থেকে সরাসরি ডাকা parseWebhook-ও এখানেই আসবে
  process.env.SSLCZ_BASE_URL = baseUrl;
});

afterAll(async () => {
  delete process.env.SSLCZ_BASE_URL;
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  hits = [];
  respond = () => ({ code: 200, body: { status: 'INVALID_TRANSACTION' } });

  // ★ প্রতিটি টেস্টে কী বসাই (truncate সব মুছে দেয়)
  const { saveProviderConfig } = await import('@/lib/payments/config');
  await saveProviderConfig('sslcommerz', {
    keys: { SSLCZ_STORE_ID: 'teststore', SSLCZ_STORE_PASSWD: 'testpass' },
    mode: 'test',
    enabled: true,
  });
});

/** IPN form-encoded বডি বানাই */
const ipn = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString();

async function parse(body: string) {
  const { getProvider } = await import('@/lib/payments/registry');
  const p = getProvider('sslcommerz')!;
  return p.parseWebhook!({ rawBody: body, headers: {} });
}

describe('SSLCommerz — IPN যাচাই', () => {
  it('বৈধ IPN → ভ্যালিডেশন API-র অঙ্ক ও tran_id ব্যবহার করে', async () => {
    respond = () => ({
      code: 200,
      body: {
        status: 'VALID', tran_id: 'DEP-1001', val_id: 'V-9', amount: '500.00',
        currency: 'BDT', bank_tran_id: 'BNK-77',
      },
    });

    const r = await parse(ipn({ tran_id: 'DEP-1001', val_id: 'V-9', status: 'VALID' }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toEqual({
      type: 'PAYMENT_SUCCEEDED',
      reference: 'DEP-1001',
      providerRef: 'BNK-77',
      amount: 500,
    });
    // ★ idempotency key = val_id (প্রতি লেনদেনে অনন্য)
    expect(r.eventId).toBe('V-9');
    expect(hits).toEqual(['V-9']);
  });

  /**
   * ★★★ এই স্যুটের সবচেয়ে গুরুত্বপূর্ণ টেস্ট।
   *   আক্রমণকারী IPN-এ ৳৯৯,৯৯৯ দাবি করেছে; গেটওয়ে বলছে ৳৫০০।
   *   অঙ্ক অবশ্যই গেটওয়ের কথা মেনে ৫০০ হতে হবে।
   */
  it('IPN-এ জাল অঙ্ক থাকলেও ভ্যালিডেশনের অঙ্কই জেতে', async () => {
    respond = () => ({
      code: 200,
      body: { status: 'VALID', tran_id: 'DEP-1002', val_id: 'V-10', amount: '500.00', bank_tran_id: 'B2' },
    });

    const r = await parse(
      ipn({ tran_id: 'DEP-1002', val_id: 'V-10', status: 'VALID', amount: '99999.00' }),
    );

    expect(r.ok).toBe(true);
    if (!r.ok || r.event.type !== 'PAYMENT_SUCCEEDED') throw new Error('সফল ইভেন্ট আশা করা হয়েছিল');
    expect(r.event.amount).toBe(500);
  });

  it('val_id ছাড়া "VALID" দাবি প্রত্যাখ্যাত (401) — জাল IPN-এর চেনা রূপ', async () => {
    const r = await parse(ipn({ tran_id: 'DEP-1003', status: 'VALID' }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unauthorized).toBe(true);
    // ★ গেটওয়েকে জিজ্ঞেসই করা হয়নি — কিছু যাচাই করার ছিল না
    expect(hits).toEqual([]);
  });

  it('ভ্যালিডেশন INVALID বললে PAYMENT_FAILED, কখনো সফল নয়', async () => {
    respond = () => ({ code: 200, body: { status: 'INVALID_TRANSACTION' } });

    const r = await parse(ipn({ tran_id: 'DEP-1004', val_id: 'V-11', status: 'VALID' }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe('PAYMENT_FAILED');
  });

  it('IPN ও ভ্যালিডেশনের tran_id আলাদা হলে প্রত্যাখ্যাত', async () => {
    respond = () => ({
      code: 200,
      body: { status: 'VALID', tran_id: 'DEP-OTHER', val_id: 'V-12', amount: '500.00' },
    });

    const r = await parse(ipn({ tran_id: 'DEP-1005', val_id: 'V-12', status: 'VALID' }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unauthorized).toBe(true);
  });

  it('ভ্যালিডেশন API ডাউন হলে সফল ধরা হয় না (retry-যোগ্য ব্যর্থতা)', async () => {
    respond = () => ({ code: 500, body: { error: 'boom' } });

    const r = await parse(ipn({ tran_id: 'DEP-1006', val_id: 'V-13', status: 'VALID' }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // ★ unauthorized নয় → receiver 400 দেবে, গেটওয়ে আবার পাঠাবে
    expect(r.unauthorized).toBeUndefined();
  });

  it('ব্যর্থ/বাতিল IPN (val_id নেই) → PAYMENT_FAILED', async () => {
    const r = await parse(ipn({ tran_id: 'DEP-1007', status: 'FAILED' }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe('PAYMENT_FAILED');
    expect(hits).toEqual([]);
  });

  it('ক্রেডেনশিয়াল না থাকলে যাচাই হয় না — সফল ধরা হয় না', async () => {
    const { saveProviderConfig } = await import('@/lib/payments/config');
    await saveProviderConfig('sslcommerz', {
      keys: { SSLCZ_STORE_ID: '', SSLCZ_STORE_PASSWD: '' },
    });

    const r = await parse(ipn({ tran_id: 'DEP-1008', val_id: 'V-14', status: 'VALID' }));

    expect(r.ok).toBe(false);
    // ★ কী নেই → গেটওয়েকে ডাকাই হয়নি
    expect(hits).toEqual([]);
  });
});

describe('SSLCommerz — webhook receiver (HTTP, replay সহ)', () => {
  it('একই IPN দুবার এলে দ্বিতীয়টি duplicate — double-credit নয়', async () => {
    respond = () => ({
      code: 200,
      body: { status: 'VALID', tran_id: 'DEP-2001', val_id: 'V-20', amount: '750.00', bank_tran_id: 'B20' },
    });

    const { client } = await import('./helpers/app');
    const c = client();
    const body = ipn({ tran_id: 'DEP-2001', val_id: 'V-20', status: 'VALID' });

    const send = () =>
      c.raw('/api/webhooks/payment/sslcommerz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

    const first = await send();
    const second = await send();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, type: 'PAYMENT_SUCCEEDED' });
    // ★★★ replay protection — receiver-এর atomic idempotency marker
    expect(await second.json()).toMatchObject({ received: true, duplicate: true });

    const markers = await db.setting.findMany({
      where: { key: { startsWith: 'webhook:sslcommerz:' } },
    });
    expect(markers).toHaveLength(1);
  });

  it('প্রোভাইডার বন্ধ থাকলে webhook গ্রহণ করা হয় না (403)', async () => {
    const { saveProviderConfig } = await import('@/lib/payments/config');
    await saveProviderConfig('sslcommerz', { enabled: false });

    const { client } = await import('./helpers/app');
    const res = await client().raw('/api/webhooks/payment/sslcommerz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: ipn({ tran_id: 'DEP-2002', val_id: 'V-21', status: 'VALID' }),
    });

    expect(res.status).toBe(403);
    expect(hits).toEqual([]);
  });

  it('জাল IPN (val_id ছাড়া VALID) receiver-এ 401', async () => {
    const { client } = await import('./helpers/app');
    const res = await client().raw('/api/webhooks/payment/sslcommerz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: ipn({ tran_id: 'DEP-2003', status: 'VALID' }),
    });

    expect(res.status).toBe(401);
    // ★ কোনো idempotency marker লেখা হয়নি — ইভেন্টটি গৃহীতই হয়নি
    expect(await db.setting.count({ where: { key: { startsWith: 'webhook:' } } })).toBe(0);
  });
});
