/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ গেটওয়ে ক্রেডেনশিয়ালের গোপনীয়তা (Group E)
 *
 *   ── কেন এই ফাইলটিই Group E-র প্রথম কাজ ──
 *   Group E-র পুরো উদ্দেশ্য: অ্যাডমিন প্যানেল থেকে গেটওয়ে-কী বসানো
 *   যাবে, রি-ডিপ্লয় ছাড়াই। কিন্তু কী বসানোর UI বানানোর **আগে**
 *   নিশ্চিত হতে হবে যে বসানো কী কোথায় যায় — নাহলে ফিচারটিই
 *   সিক্রেট ফাঁসের যন্ত্র হয়ে দাঁড়ায়।
 *
 *   ⚠️ পাওয়া গেছে: `/admin/site` ও `/admin/homepage` পুরো settings
 *   মানচিত্র **ক্লায়েন্ট** কম্পোনেন্টে (`'use client'`) props হিসেবে
 *   পাঠায়। RSC payload ব্রাউজারে যায়, তাই যা-কিছু ঐ মানচিত্রে আছে
 *   তা view-source-এ প্লেইনটেক্সট। `site/page.tsx` কেবল দুটি
 *   টেলিগ্রাম কী redact করত; `pp_*` (পেমেন্ট কী) করত না।
 *
 *   আজ কোনো গেটওয়ে কনফিগার করা নেই বলে বাস্তবে কিছু ফাঁস হয়নি —
 *   কিন্তু মালিক SSLCommerz-এর কী বসানোর মুহূর্তেই হতো।
 *   CLAUDE.md §2.3(১১) সরাসরি নিষেধ।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin } from './helpers/app';

/** ★ চেনা যায় এমন ডামি সিক্রেট — HTML-এ খুঁজে পাওয়া সহজ */
const SECRET = 'SSLCZ-TESTPASSWD-b7f3a91c5e2d';
const STORE_ID = 'uidtopup_live_store_42';

describe('গেটওয়ে কী — ক্লায়েন্টে কখনো যাবে না', () => {
  it('অ্যাডমিন সেটিংস পাতার HTML-এ কী প্লেইনটেক্সটে থাকে না', async () => {
    const { client: adminClient } = await signedInAdmin(db);

    await db.setting.createMany({
      data: [
        // ★ নতুন namespaced রূপ (যেভাবে অ্যাডমিন UI সেভ করবে)
        {
          key: 'pp:sslcommerz:keys',
          value: JSON.stringify({ SSLCZ_STORE_ID: STORE_ID, SSLCZ_STORE_PASSWD: SECRET }),
        },
        // ★ পুরনো (legacy) প্লেইনটেক্সট রূপ — মাইগ্রেশনের আগে
        //   প্রোডাকশনে ঠিক এটিই থাকতে পারে
        { key: 'pp_stripe_keys', value: JSON.stringify({ STRIPE_SECRET_KEY: SECRET }) },
      ],
    });

    for (const path of ['/admin/site', '/admin/homepage']) {
      const res = await adminClient.raw(path);
      expect(res.status, `${path} লোড হয়নি`).toBe(200);
      const html = await res.text();

      expect(html.includes(SECRET), `${path} — সিক্রেট HTML-এ ফাঁস হয়েছে!`).toBe(false);
      expect(html.includes(STORE_ID), `${path} — store id HTML-এ ফাঁস হয়েছে!`).toBe(false);
    }
  });

  it('getSettings() কখনো pp_* বা namespaced কী ফেরত দেয় না', async () => {
    await db.setting.createMany({
      data: [
        { key: 'pp_stripe_keys', value: JSON.stringify({ STRIPE_SECRET_KEY: SECRET }) },
        { key: 'pp:sslcommerz:keys', value: 'v1.x.y.z' },
        { key: 'site_name', value: 'UID TopUp' },
      ],
    });

    // ★ সার্ভারের ভেতরের ফাংশন সরাসরি ডাকি — টেস্ট প্রসেসেও একই কোড
    const { getSettings } = await import('@/lib/settings');
    const s = await getSettings();

    expect(s.site_name).toBe('UID TopUp');
    expect(Object.keys(s).some((k) => k.startsWith('pp_'))).toBe(false);
    expect(Object.keys(s).some((k) => k.includes(':'))).toBe(false);
    expect(JSON.stringify(s).includes(SECRET)).toBe(false);
  });
});

describe('গেটওয়ে কী — at-rest এনক্রিপশন', () => {
  it('সেভ করা কী DB-তে অপাঠ্য, কিন্তু সার্ভারে হুবহু ফেরত আসে', async () => {
    const { saveProviderConfig, getProviderConfig } = await import('@/lib/payments/config');

    await saveProviderConfig('sslcommerz', {
      keys: { SSLCZ_STORE_ID: STORE_ID, SSLCZ_STORE_PASSWD: SECRET },
      mode: 'test',
    });

    // ── DB-তে যা আছে তা অপাঠ্য ──
    const row = await db.paymentGatewayConfig.findUnique({ where: { provider: 'sslcommerz' } });
    expect(row, 'কনফিগ সারি তৈরি হয়নি').toBeTruthy();
    expect(row!.credentials.includes(SECRET), 'DB-তে প্লেইনটেক্সট সিক্রেট!').toBe(false);
    expect(row!.credentials.includes(STORE_ID)).toBe(false);
    // ★ secretbox ফরম্যাট: v1.<iv>.<tag>.<ciphertext>
    expect(row!.credentials.startsWith('v1.')).toBe(true);
    expect(row!.credentials.split('.')).toHaveLength(4);

    // ── কিন্তু সার্ভার-সাইডে হুবহু ফেরত আসে ──
    const cfg = await getProviderConfig('sslcommerz');
    expect(cfg.keys.SSLCZ_STORE_PASSWD).toBe(SECRET);
    expect(cfg.keys.SSLCZ_STORE_ID).toBe(STORE_ID);
    expect(cfg.mode).toBe('test');
  });

  it('পুরনো Setting-ভিত্তিক কনফিগ থেকে মডেলে উঠে আসে, পুরনো সারি থাকে না', async () => {
    const { saveProviderConfig, getProviderConfig } = await import('@/lib/payments/config');

    // ★ মাইগ্রেশনের আগের অবস্থা — প্লেইনটেক্সট Setting সারি
    await db.setting.create({
      data: { key: 'pp_sslcommerz_keys', value: JSON.stringify({ SSLCZ_STORE_ID: STORE_ID }) },
    });

    // ★ অ্যাডমিন একটি কী বদলালেই পুরোটা মডেলে চলে আসে
    await saveProviderConfig('sslcommerz', { keys: { SSLCZ_STORE_PASSWD: SECRET } });

    expect(await db.setting.findUnique({ where: { key: 'pp_sslcommerz_keys' } })).toBeNull();
    expect(await db.setting.findUnique({ where: { key: 'pp:sslcommerz:keys' } })).toBeNull();

    // ★ পুরনো মানটিও সাথে উঠে এসেছে — কিছু হারায়নি
    const cfg = await getProviderConfig('sslcommerz');
    expect(cfg.keys.SSLCZ_STORE_ID).toBe(STORE_ID);
    expect(cfg.keys.SSLCZ_STORE_PASSWD).toBe(SECRET);
  });

  it('মাইগ্রেশনের আগের প্লেইনটেক্সট সারি এখনো পড়া যায় (পিছন-সঙ্গতি)', async () => {
    const { getProviderConfig } = await import('@/lib/payments/config');

    await db.setting.createMany({
      data: [
        { key: 'pp_stripe_keys', value: JSON.stringify({ STRIPE_SECRET_KEY: SECRET }) },
        { key: 'pp_stripe_mode', value: 'live' },
      ],
    });

    const cfg = await getProviderConfig('stripe');
    expect(cfg.keys.STRIPE_SECRET_KEY).toBe(SECRET);
    expect(cfg.mode).toBe('live');
  });

  it('বিকৃত/ডিক্রিপ্ট-অযোগ্য সারিতে throw নয়, "কী নেই" (fail safe)', async () => {
    const { getProviderConfig, configuredAsync } = await import('@/lib/payments/config');

    await db.setting.create({
      data: { key: 'pp:stripe:keys', value: 'v1.aaaa.bbbb.cccc' },
    });

    const cfg = await getProviderConfig('stripe');
    expect(cfg.keys).toEqual({});
    // ★ নিরাপদ দিকে ভেঙে পড়ে — "কনফিগার করা আছে" বলে না
    expect(await configuredAsync('stripe')).toBe(false);
  });
});

describe('PaymentGatewayConfig মডেল', () => {
  it('সেভ করলে মডেলে যায়, ক্রেডেনশিয়াল এনক্রিপ্টেড, actor রেকর্ড হয়', async () => {
    const { saveProviderConfig } = await import('@/lib/payments/config');

    await saveProviderConfig(
      'sslcommerz',
      { keys: { SSLCZ_STORE_ID: STORE_ID, SSLCZ_STORE_PASSWD: SECRET }, mode: 'live', enabled: true },
      { id: 'admin-1', name: 'Nahim' },
    );

    const row = await db.paymentGatewayConfig.findUnique({ where: { provider: 'sslcommerz' } });
    expect(row).toBeTruthy();
    expect(row!.isEnabled).toBe(true);
    expect(row!.mode).toBe('live');
    expect(row!.updatedByName).toBe('Nahim');
    expect(row!.credentials.includes(SECRET), 'কলামে প্লেইনটেক্সট সিক্রেট!').toBe(false);
    expect(row!.credentials.startsWith('v1.')).toBe(true);
  });

  it('একটি কী বদলালে বাকিগুলো হারায় না (merge)', async () => {
    const { saveProviderConfig, getProviderConfig } = await import('@/lib/payments/config');

    await saveProviderConfig('sslcommerz', {
      keys: { SSLCZ_STORE_ID: STORE_ID, SSLCZ_STORE_PASSWD: SECRET },
    });
    await saveProviderConfig('sslcommerz', { keys: { SSLCZ_STORE_PASSWD: 'new-passwd-9999' } });

    const cfg = await getProviderConfig('sslcommerz');
    expect(cfg.keys.SSLCZ_STORE_ID).toBe(STORE_ID);      // অক্ষত
    expect(cfg.keys.SSLCZ_STORE_PASSWD).toBe('new-passwd-9999');
  });

  it('মডেলে কনফিগ থাকলে পুরনো Setting সারি মুছে যায়', async () => {
    const { saveProviderConfig } = await import('@/lib/payments/config');

    await db.setting.createMany({
      data: [
        { key: 'pp_sslcommerz_keys', value: JSON.stringify({ SSLCZ_STORE_ID: 'old' }) },
        { key: 'provider_sslcommerz_enabled', value: '1' },
      ],
    });

    await saveProviderConfig('sslcommerz', { keys: { SSLCZ_STORE_PASSWD: SECRET } });

    expect(await db.setting.findUnique({ where: { key: 'pp_sslcommerz_keys' } })).toBeNull();
    expect(await db.setting.findUnique({ where: { key: 'provider_sslcommerz_enabled' } })).toBeNull();
  });

  it('Test connection ফল সংরক্ষিত হয়; ত্রুটি-বার্তায় সিক্রেট থাকে না', async () => {
    const { saveProviderConfig, recordTestResult, getProviderConfig } =
      await import('@/lib/payments/config');

    await saveProviderConfig('sslcommerz', {
      keys: { SSLCZ_STORE_ID: STORE_ID, SSLCZ_STORE_PASSWD: SECRET },
    });

    // ★ গেটওয়ে ত্রুটি-বার্তায় পাঠানো ক্রেডেনশিয়াল প্রতিধ্বনিত হলো
    await recordTestResult('sslcommerz', {
      ok: false,
      error: `Auth failed for store ${STORE_ID} with passwd ${SECRET}`,
    });

    const cfg = await getProviderConfig('sslcommerz');
    expect(cfg.lastTestedAt).toBeTruthy();
    expect(cfg.lastError).toBeTruthy();
    // ★★★ সিক্রেট মুছে গেছে — নাহলে অ্যাডমিন UI-তে ফিরে যেত
    expect(cfg.lastError!.includes(SECRET)).toBe(false);
    expect(cfg.lastError!.includes(STORE_ID)).toBe(false);
    expect(cfg.lastError!.includes('***')).toBe(true);
  });

  it('অ্যাডমিন API দিয়ে সেভ ও টেস্ট — response-এ সিক্রেট ফেরত আসে না', async () => {
    const { client: adminClient } = await signedInAdmin(db);

    const save = await adminClient.post<{ success: boolean; providers: unknown[] }>(
      '/api/admin/payment/provider',
      {
        id: 'sslcommerz',
        keys: { SSLCZ_STORE_ID: STORE_ID, SSLCZ_STORE_PASSWD: SECRET },
        mode: 'test',
        enabled: false,
      },
    );
    expect(save.status).toBe(200);
    expect(JSON.stringify(save.body).includes(SECRET), 'API response-এ সিক্রেট!').toBe(false);
    expect(JSON.stringify(save.body).includes(STORE_ID)).toBe(false);

    const test = await adminClient.raw('/api/admin/payment/provider', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'sslcommerz' }),
    });
    expect(test.status).toBe(200);

    const row = await db.paymentGatewayConfig.findUnique({ where: { provider: 'sslcommerz' } });
    expect(row!.lastTestedAt).toBeTruthy();
    // ★ সব কী আছে → CONFIGURED_PENDING → ত্রুটি নয়
    expect(row!.lastError).toBeNull();
  });
});

describe('HARD CONSTRAINT — সব গেটওয়ে বন্ধ থাকলে ম্যানুয়াল প্রবাহ অপরিবর্তিত', () => {
  /**
   * ★★★ RUN.md Group E-র সবচেয়ে কড়া শর্ত।
   *   ম্যানুয়াল bKash/Nagad ডিপোজিটই আজ **একমাত্র কার্যকর পেমেন্ট পথ**।
   *   গেটওয়ে-অবকাঠামো যোগ করতে গিয়ে সেটি ভাঙলে ব্যবসা বন্ধ।
   */
  it('গেটওয়ে কনফিগার থাকলেও (disabled) ম্যানুয়াল ডিপোজিট আগের মতোই চলে', async () => {
    const { saveProviderConfig } = await import('@/lib/payments/config');
    const { signedInUser, signedInAdmin } = await import('./helpers/app');
    const { balanceOf, ledgerSum } = await import('./helpers/factories');

    // ★ কী বসানো আছে, কিন্তু enabled = false
    await saveProviderConfig('sslcommerz', {
      keys: { SSLCZ_STORE_ID: STORE_ID, SSLCZ_STORE_PASSWD: SECRET },
      mode: 'live',
      enabled: false,
    });

    const { user, client: c } = await signedInUser(db, { balance: 0 });

    const created = await c.post<{ success: boolean }>('/api/deposit', {
      method: 'BKASH', amount: 600, trxId: 'MANUAL0001', senderNo: '01712345678',
    });
    expect(created.status).toBe(200);

    const dep = await db.deposit.findFirst({ where: { userId: user.id } });
    expect(dep!.status).toBe('PENDING'); // ★ অটো-অনুমোদন হয়নি

    const { client: adminClient } = await signedInAdmin(db);
    const approved = await adminClient.post('/api/admin/deposit', {
      depositId: dep!.id, action: 'APPROVE',
    });

    expect(approved.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(600);
    expect(await ledgerSum(db, user.id)).toBe(600);
  });
});
