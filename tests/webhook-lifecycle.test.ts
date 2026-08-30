/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Webhook রিসিভার — লাইফসাইকেল (প্রোভাইডার-নিরপেক্ষ অংশ)
 *
 *   `stripe.test.ts` ও `sslcommerz.test.ts` **ড্রাইভারের** যুক্তি
 *   প্রমাণ করে (স্বাক্ষর, অঙ্ক, replay)। এই ফাইলটি তার উপরের
 *   **রিসিভার** স্তরটি ধরে, যা সব গেটওয়ের জন্য এক — আর যেটির
 *   কোনো টেস্ট ছিল না:
 *
 *     ১. অজানা প্রোভাইডার → ৪০৪ · বন্ধ প্রোভাইডার → ৪০৩
 *     ২. `parseWebhook` না থাকলে → ৫০১ (নীরবে ২০০ নয়)
 *     ৩. idempotency marker ঠিক **একটি**, আর দ্বিতীয় কল `duplicate`
 *     ৪. **সমান্তরাল** দুটি একই webhook — ঠিক একটিই প্রক্রিয়া হয়
 *     ৫. marker সাইট-সেটিংসে **ফাঁস হয় না** (ক্লায়েন্টে যায় না)
 *     ৬. বিকৃত বডি → ৪xx, কখনো ৫০০ নয়
 *     ৭. 🔴 **কোনো webhook ওয়ালেটে এক পয়সাও জমা করে না**
 *
 *   ⚠️ ৭ নম্বরটি আজকের **ইচ্ছাকৃত** আচরণ লক করে রাখে: অটো-ক্রেডিট
 *   money path এখনো লেখা হয়নি (sandbox ক্রেডেনশিয়াল ছাড়া লেখা
 *   CLAUDE.md §৬ বিরোধী)। কেউ ভবিষ্যতে ক্রেডিট যোগ করলে এই টেস্টটি
 *   **ইচ্ছাকৃতভাবে** ভাঙবে — অর্থাৎ নতুন money path নীরবে ঢুকতে পারবে না।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { db } from '../vitest.setup';
import { client } from './helpers/app';
import { createUser } from './helpers/factories';
import { balanceOf, ledgerSum } from './helpers/factories';

const WHSEC = 'whsec_lifecycle_secret';

beforeEach(async () => {
  const { saveProviderConfig } = await import('@/lib/payments/config');
  await saveProviderConfig('stripe', {
    keys: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC },
    mode: 'test',
    enabled: true,
  });
});

const now = () => Math.floor(Date.now() / 1000);
const sign = (payload: string, ts: number, secret = WHSEC) =>
  createHmac('sha256', secret).update(`${ts}.${payload}`, 'utf8').digest('hex');

function evt(id: string, reference = 'DEP-9001') {
  return JSON.stringify({
    id,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_lifecycle', amount: 50000, amount_received: 50000,
        currency: 'bdt', metadata: { reference },
      },
    },
  });
}

/** স্বাক্ষরসহ webhook POST — আসল HTTP পথে, রুট-হ্যান্ডলার সরাসরি নয় */
async function postHook(provider: string, body: string, header?: string) {
  const ts = now();
  const res = await client().raw(`/api/webhooks/payment/${provider}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': header ?? `t=${ts},v1=${sign(body, ts)}`,
    },
    body,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* কাঁচা থাক */ }
  return { status: res.status, body: parsed as Record<string, unknown> };
}

const markerCount = (provider = 'stripe') =>
  db.setting.count({ where: { key: { startsWith: `webhook:${provider}:` } } });

describe('Webhook রিসিভার — প্রবেশদ্বার', () => {
  it('অজানা প্রোভাইডারে ৪০৪', async () => {
    const r = await postHook('notaprovider', evt('evt_x'));
    expect(r.status).toBe(404);
  });

  it('বন্ধ প্রোভাইডারের webhook গ্রহণ করা হয় না (৪০৩)', async () => {
    const { saveProviderConfig } = await import('@/lib/payments/config');
    await saveProviderConfig('stripe', {
      keys: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC },
      mode: 'test', enabled: false,
    });
    const r = await postHook('stripe', evt('evt_disabled'));
    expect(r.status).toBe(403);
    expect(await markerCount()).toBe(0);
  });

  it('parseWebhook বাস্তবায়িত নয় এমন প্রোভাইডারে ৫০১ — নীরবে ২০০ নয়', async () => {
    const { saveProviderConfig } = await import('@/lib/payments/config');
    await saveProviderConfig('bkash', {
      keys: {}, mode: 'test', enabled: true,
    });
    const r = await postHook('bkash', evt('evt_bkash'));
    expect(r.status).toBe(501);
  });
});

describe('Webhook রিসিভার — স্বাক্ষর ও গঠন', () => {
  it('ভুল স্বাক্ষরে ৪০১, আর marker তৈরি হয় না', async () => {
    const body = evt('evt_badsig');
    const r = await postHook('stripe', body, `t=${now()},v1=${'0'.repeat(64)}`);
    expect(r.status).toBe(401);
    expect(await markerCount()).toBe(0);
  });

  it('বিকৃত JSON বডিতে ৪xx — কখনো ৫০০ নয়', async () => {
    const bad = '{ এটি বৈধ JSON নয়';
    const ts = now();
    const r = await postHook('stripe', bad, `t=${ts},v1=${sign(bad, ts)}`);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('হেডার ছাড়া অনুরোধ প্রত্যাখ্যাত', async () => {
    const res = await client().raw('/api/webhooks/payment/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: evt('evt_nohdr'),
    });
    expect(res.status).toBe(401);
  });
});

describe('Webhook রিসিভার — idempotency', () => {
  it('বৈধ webhook গ্রহণ করে ও ঠিক একটি marker লেখে', async () => {
    const r = await postHook('stripe', evt('evt_once'));
    expect(r.status).toBe(200);
    expect(r.body.received).toBe(true);
    expect(await markerCount()).toBe(1);
  });

  it('একই ইভেন্ট দ্বিতীয়বার → duplicate, marker এখনো একটি', async () => {
    const body = evt('evt_twice');
    const a = await postHook('stripe', body);
    const b = await postHook('stripe', body);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(await markerCount()).toBe(1);
  });

  it('🔴 সমান্তরাল দুটি একই webhook — ঠিক একটিই প্রক্রিয়া হয়', async () => {
    const body = evt('evt_race');
    const [a, b] = await Promise.all([
      postHook('stripe', body),
      postHook('stripe', body),
    ]);
    const dupes = [a, b].filter((r) => r.body?.duplicate === true).length;
    const fresh = [a, b].filter((r) => r.body?.duplicate !== true && r.status === 200).length;
    expect(fresh).toBe(1);
    expect(dupes).toBe(1);
    expect(await markerCount()).toBe(1);
  });

  it('ভিন্ন eventId আলাদা marker পায়', async () => {
    await postHook('stripe', evt('evt_a'));
    await postHook('stripe', evt('evt_b'));
    expect(await markerCount()).toBe(2);
  });
});

describe('Webhook রিসিভার — তথ্য-স্বাস্থ্য ও টাকার নিরাপত্তা', () => {
  it('idempotency marker সাইট-সেটিংস মানচিত্রে ফাঁস হয় না', async () => {
    await postHook('stripe', evt('evt_leak'));
    expect(await markerCount()).toBe(1);

    const { getSettings, invalidateSettings } = await import('@/lib/settings');
    invalidateSettings();
    const map = await getSettings();
    const leaked = Object.keys(map).filter((k) => k.startsWith('webhook:'));
    expect(leaked).toEqual([]);
  });

  it('🔴 কোনো webhook ওয়ালেটে এক পয়সাও জমা করে না (আজকের ইচ্ছাকৃত আচরণ)', async () => {
    const user = await createUser(db, { balance: 100 });
    const before = await balanceOf(db, user.id);
    const beforeLedger = await ledgerSum(db, user.id);

    // ★ সফল, ব্যর্থ ও ডুপ্লিকেট — তিন ধরনের ইভেন্টই পাঠানো হয়
    await postHook('stripe', evt('evt_money_1'));
    await postHook('stripe', evt('evt_money_1'));           // duplicate
    const failBody = JSON.stringify({
      id: 'evt_money_2', type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_f', metadata: { reference: 'DEP-9001' } } },
    });
    await postHook('stripe', failBody);

    expect(await balanceOf(db, user.id)).toBe(before);
    expect(await ledgerSum(db, user.id)).toBe(beforeLedger);
    // ★ খতিয়ানে একটিও নতুন সারি নয়
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(0);
  });
});
