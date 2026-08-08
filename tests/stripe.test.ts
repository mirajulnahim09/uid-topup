/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Stripe ড্রাইভার — স্বাক্ষর যাচাই (Group E)
 *
 *   SSLCommerz-এ স্বাক্ষর-অ্যালগরিদম ডকুমেন্টেড ছিল না, তাই সেখানে
 *   ভ্যালিডেশন API-ই সত্য। Stripe-এ স্কিম সম্পূর্ণ ডকুমেন্টেড, তাই
 *   এখানে **সত্যিকারের স্বাক্ষর যাচাই** হয় — এবং এই ফাইল সেটিই
 *   প্রমাণ করে, বিশেষ করে যে জায়গাগুলোয় ভুল করা সহজ:
 *
 *     · `v0` (Stripe-এর **জাল** টেস্ট স্বাক্ষর) কখনো গ্রহণ নয়
 *     · secret roll করার সময় একাধিক `v1` — যেকোনো একটি মিললেই বৈধ
 *     · পুরনো timestamp = replay → বাতিল, স্বাক্ষর বৈধ হলেও
 *     · অঙ্ক ক্ষুদ্রতম এককে (পয়সা) → ১০০ দিয়ে ভাগ
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { db } from '../vitest.setup';
import { client } from './helpers/app';

const WHSEC = 'whsec_test_secret_abc123';

beforeEach(async () => {
  const { saveProviderConfig } = await import('@/lib/payments/config');
  await saveProviderConfig('stripe', {
    keys: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC },
    mode: 'test',
    enabled: true,
  });
});

const sign = (payload: string, ts: number, secret = WHSEC) =>
  createHmac('sha256', secret).update(`${ts}.${payload}`, 'utf8').digest('hex');

function evt(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_test_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_123',
        amount: 50000,          // ★ পয়সা → ৳৫০০
        amount_received: 50000,
        currency: 'bdt',
        metadata: { reference: 'DEP-5001' },
      },
    },
    ...over,
  });
}

async function parse(rawBody: string, header: string) {
  const { getProvider } = await import('@/lib/payments/registry');
  return getProvider('stripe')!.parseWebhook!({
    rawBody,
    headers: { 'stripe-signature': header },
  });
}

const now = () => Math.floor(Date.now() / 1000);

describe('Stripe — স্বাক্ষর যাচাই', () => {
  it('বৈধ স্বাক্ষর → PAYMENT_SUCCEEDED, অঙ্ক পয়সা থেকে টাকায়', async () => {
    const body = evt();
    const ts = now();
    const r = await parse(body, `t=${ts},v1=${sign(body, ts)}`);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eventId).toBe('evt_test_1');
    expect(r.event).toEqual({
      type: 'PAYMENT_SUCCEEDED',
      reference: 'DEP-5001',
      providerRef: 'pi_123',
      amount: 500,   // ★★★ ৫০০০০ পয়সা ≠ ৫০০০০ টাকা
    });
  });

  it('ভুল স্বাক্ষরে ৪০১-শ্রেণির প্রত্যাখ্যান', async () => {
    const body = evt();
    const ts = now();
    const r = await parse(body, `t=${ts},v1=${'0'.repeat(64)}`);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unauthorized).toBe(true);
  });

  it('বডি এক অক্ষর বদলালেও স্বাক্ষর ভাঙে', async () => {
    const body = evt();
    const ts = now();
    const good = sign(body, ts);
    const tampered = body.replace('"amount":50000', '"amount":9900000');

    const r = await parse(tampered, `t=${ts},v1=${good}`);
    expect(r.ok).toBe(false);
  });

  /**
   * ★★★ downgrade-আক্রমণ। Stripe টেস্ট-ইভেন্টে একটি **জাল** `v0`
   *   স্বাক্ষর পাঠায়। "যেকোনো স্কিম মিললেই হলো" লিখলে আক্রমণকারী
   *   v0 দিয়ে যা খুশি পাঠাতে পারত। ডক স্পষ্ট: v1 ছাড়া সব উপেক্ষা।
   */
  it('শুধু v0 থাকলে গ্রহণ করা হয় না (downgrade আটকানো)', async () => {
    const body = evt();
    const ts = now();
    // ★ v0-তে **সঠিক** HMAC বসাই — তবুও গ্রহণ করা চলবে না
    const r = await parse(body, `t=${ts},v0=${sign(body, ts)}`);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unauthorized).toBe(true);
  });

  it('secret roll — একাধিক v1 এর যেকোনো একটি মিললেই বৈধ', async () => {
    const body = evt();
    const ts = now();
    const oldSig = sign(body, ts, 'whsec_previous_secret');
    const newSig = sign(body, ts);

    // ★ পুরনোটি আগে, নতুনটি পরে — দুটোই পাঠায় Stripe রোলিং-এর সময়
    const r = await parse(body, `t=${ts},v1=${oldSig},v1=${newSig}`);
    expect(r.ok).toBe(true);
  });

  /** ★★★ replay — স্বাক্ষর নিখুঁত, কিন্তু ঘটনাটি পুরনো */
  it('৩০০s এর বেশি পুরনো ইভেন্ট বাতিল (replay protection)', async () => {
    const body = evt();
    const ts = now() - 400;
    const r = await parse(body, `t=${ts},v1=${sign(body, ts)}`);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unauthorized).toBe(true);
    expect(r.reason).toContain('পুরনো');
  });

  it('সহনশীলতার ভেতরের পুরনো ইভেন্ট গ্রহণযোগ্য', async () => {
    const body = evt();
    const ts = now() - 120;
    const r = await parse(body, `t=${ts},v1=${sign(body, ts)}`);
    expect(r.ok).toBe(true);
  });

  it('হেডার না থাকলে প্রত্যাখ্যাত', async () => {
    const r = await parse(evt(), '');
    expect(r.ok).toBe(false);
  });

  it('webhook secret কনফিগার না থাকলে কখনো গ্রহণ নয়', async () => {
    const { saveProviderConfig } = await import('@/lib/payments/config');
    await saveProviderConfig('stripe', { keys: { STRIPE_WEBHOOK_SECRET: '' } });

    const body = evt();
    const ts = now();
    const r = await parse(body, `t=${ts},v1=${sign(body, ts)}`);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unauthorized).toBe(true);
  });
});

describe('Stripe — ইভেন্ট ব্যাখ্যা', () => {
  it('checkout.session.completed → amount_total ব্যবহার করে', async () => {
    const body = JSON.stringify({
      id: 'evt_cs_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123', amount_total: 125050, currency: 'bdt',
          client_reference_id: 'DEP-777',
        },
      },
    });
    const ts = now();
    const r = await parse(body, `t=${ts},v1=${sign(body, ts)}`);

    expect(r.ok).toBe(true);
    if (!r.ok || r.event.type !== 'PAYMENT_SUCCEEDED') throw new Error('সফল ইভেন্ট আশা করা হয়েছিল');
    expect(r.event.amount).toBe(1250.5);
    expect(r.event.reference).toBe('DEP-777');
  });

  it('reference ছাড়া সফল ইভেন্ট প্রত্যাখ্যাত — কোন ডিপোজিট তা অজানা', async () => {
    const body = JSON.stringify({
      id: 'evt_noref', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_x', amount: 1000, metadata: {} } },
    });
    const ts = now();
    const r = await parse(body, `t=${ts},v1=${sign(body, ts)}`);
    expect(r.ok).toBe(false);
  });

  it('ব্যর্থ ইভেন্ট → PAYMENT_FAILED', async () => {
    const body = JSON.stringify({
      id: 'evt_fail', type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_f', metadata: { reference: 'DEP-9' } } },
    });
    const ts = now();
    const r = await parse(body, `t=${ts},v1=${sign(body, ts)}`);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe('PAYMENT_FAILED');
  });

  it('অপ্রাসঙ্গিক ইভেন্ট নিরাপদে উপেক্ষিত', async () => {
    const body = JSON.stringify({
      id: 'evt_other', type: 'customer.created', data: { object: { id: 'cus_1' } },
    });
    const ts = now();
    const r = await parse(body, `t=${ts},v1=${sign(body, ts)}`);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe('IGNORED');
  });
});

describe('Stripe — receiver (HTTP)', () => {
  it('বৈধ ইভেন্ট গৃহীত, পুনরায় পাঠালে duplicate', async () => {
    const body = evt();
    const ts = now();
    const header = `t=${ts},v1=${sign(body, ts)}`;
    const c = client();

    const send = () =>
      c.raw('/api/webhooks/payment/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': header },
        body,
      });

    const first = await send();
    const second = await send();

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, type: 'PAYMENT_SUCCEEDED' });
    expect(await second.json()).toMatchObject({ received: true, duplicate: true });

    expect(
      await db.setting.count({ where: { key: { startsWith: 'webhook:stripe:' } } }),
    ).toBe(1);
  });

  it('জাল স্বাক্ষরে receiver ৪০১, কোনো marker লেখা হয় না', async () => {
    const body = evt();
    const ts = now();
    const res = await client().raw('/api/webhooks/payment/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': `t=${ts},v1=${'f'.repeat(64)}`,
      },
      body,
    });

    expect(res.status).toBe(401);
    expect(await db.setting.count({ where: { key: { startsWith: 'webhook:' } } })).toBe(0);
  });
});
