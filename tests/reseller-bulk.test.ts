/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রিসেলার bulk অর্ডার — API কী দিয়ে (Group F ৩)
 *
 *   ── এই স্যুটের তিনটি মূল দাবি ──
 *
 *   ১. **কী-ই একমাত্র পথ।** সেশন-কুকি দিয়ে এই endpoint ব্যবহার করা
 *      যায় না, ভুল/প্রত্যাহৃত কী দিয়েও নয়, আর রিসেলার নন এমন
 *      কারও কী দিয়েও নয়।
 *
 *   ২. **একই `clientRef`-এ কখনো দুবার টাকা কাটে না** — ধারাবাহিক
 *      retry-তেও নয়, সমান্তরাল retry-তেও নয়। স্ক্রিপ্ট টাইমআউট
 *      দেখলে আবার পাঠায়, আর সেটিই এই ফিচারের সবচেয়ে বড় আর্থিক ঝুঁকি।
 *
 *   ৩. **আংশিক ব্যর্থতা খতিয়ান ভাঙে না।** ব্যাচের মাঝপথে ব্যালেন্স
 *      ফুরালে আগের অর্ডারগুলো টেকে, বাকিগুলো ব্যর্থ হয়, এবং
 *      `SUM(ledger) == balance` অক্ষত থাকে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, client, signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, balanceOf, ledgerSum } from './helpers/factories';
import { generateApiKey } from '../src/lib/apiKey';

/**
 * ★ কী দিয়ে কল — ইচ্ছাকৃতভাবে **কুকি ছাড়া** কাঁচা `fetch`।
 *   `Client` ব্যবহার করলে সেশন-কুকিও যেত, আর তখন "কী-ই একমাত্র পথ"
 *   দাবিটি প্রমাণ হতো না।
 */
async function bulk(key: string | null, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;

  const res = await fetch(`${baseUrl()}/api/reseller/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** ★ একজন রিসেলার + তার একটি সক্রিয় কী */
async function reseller(opts: { balance?: number } = {}) {
  const { user } = await signedInUser(db, { balance: opts.balance ?? 1000 });
  await db.user.update({ where: { id: user.id }, data: { tier: 'RESELLER' } });

  const { plain, hash, prefix } = generateApiKey();
  const key = await db.apiKey.create({
    data: { userId: user.id, label: 'টেস্ট কী', prefix, hash },
  });

  return { user, plainKey: plain, keyId: key.id };
}

describe('API কী যাচাই', () => {
  it('কী ছাড়া অনুরোধ ৪০১', async () => {
    const v = await createVariant(db, { price: 100 });
    const res = await bulk(null, { items: [{ variantId: v.id, playerUid: '123456789' }] });
    expect(res.status).toBe(401);
    expect(await db.order.count()).toBe(0);
  });

  it('ভুল কী ৪০১', async () => {
    const v = await createVariant(db, { price: 100 });
    const res = await bulk('uidk_totally-made-up-key', {
      items: [{ variantId: v.id, playerUid: '123456789' }],
    });
    expect(res.status).toBe(401);
    expect(await db.order.count()).toBe(0);
  });

  /** ★★★ সেশন থাকলেই হবে না — কী লাগবে */
  it('লগইন করা রিসেলারও কী ছাড়া ঢুকতে পারেন না', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });
    await db.user.update({ where: { id: user.id }, data: { tier: 'RESELLER' } });

    // ★ `Client` কুকি পাঠায় — অর্থাৎ বৈধ সেশন আছে, কিন্তু কী নেই
    const res = await c.post('/api/reseller/orders', {
      items: [{ variantId: v.id, playerUid: '123456789' }],
    });
    expect(res.status).toBe(401);
    expect(await db.order.count()).toBe(0);
  });

  it('রিসেলার নন — কী থাকলেও ৪০৩', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user } = await signedInUser(db, { balance: 1000 });
    // ★ tier বদলাইনি — ডিফল্ট NORMAL
    const { plain, hash, prefix } = generateApiKey();
    await db.apiKey.create({ data: { userId: user.id, label: 'k', prefix, hash } });

    const res = await bulk(plain, { items: [{ variantId: v.id, playerUid: '123456789' }] });
    expect(res.status).toBe(403);
    expect(await db.order.count()).toBe(0);
  });

  /** ★ স্তর ফিরিয়ে নেওয়াই যথেষ্ট — প্রতিটি কী আলাদা করে প্রত্যাহার নয় */
  it('স্তর NORMAL করে দিলে বিদ্যমান কী সাথে সাথে অকেজো', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user, plainKey } = await reseller();

    expect((await bulk(plainKey, { items: [{ variantId: v.id, playerUid: '111111111' }] })).status).toBe(200);

    await db.user.update({ where: { id: user.id }, data: { tier: 'NORMAL' } });

    const after = await bulk(plainKey, { items: [{ variantId: v.id, playerUid: '222222222' }] });
    expect(after.status).toBe(403);
    expect(await db.order.count()).toBe(1);
  });

  it('প্রত্যাহৃত কী ৪০১', async () => {
    const v = await createVariant(db, { price: 100 });
    const { plainKey, keyId } = await reseller();
    await db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });

    const res = await bulk(plainKey, { items: [{ variantId: v.id, playerUid: '123456789' }] });
    expect(res.status).toBe(401);
    expect(await db.order.count()).toBe(0);
  });

  it('ব্যান করা রিসেলার ৪০৩', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user, plainKey } = await reseller();
    await db.user.update({ where: { id: user.id }, data: { isBanned: true } });

    const res = await bulk(plainKey, { items: [{ variantId: v.id, playerUid: '123456789' }] });
    expect(res.status).toBe(403);
    expect(await db.order.count()).toBe(0);
  });

  /** ★ কাঁচা কী DB-তে কোথাও নেই — ব্যাকআপ ফাঁস হলেও অর্ডার করা যাবে না */
  it('কাঁচা কী সংরক্ষিত হয় না, কেবল হ্যাশ', async () => {
    const { plainKey, keyId } = await reseller();
    const row = await db.apiKey.findUnique({ where: { id: keyId } });

    expect(row!.hash).not.toBe(plainKey);
    expect(row!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(plainKey.startsWith(row!.prefix)).toBe(true);
  });
});

describe('bulk অর্ডার', () => {
  it('একাধিক আইটেম — রিসেলার দাম, খতিয়ান মেলে', async () => {
    const v = await createVariant(db, { price: 100, resellerPrice: 70 });
    const { user, plainKey } = await reseller({ balance: 1000 });

    const res = await bulk(plainKey, {
      items: [
        { variantId: v.id, playerUid: '111111111', clientRef: 'a1' },
        { variantId: v.id, playerUid: '222222222', clientRef: 'a2' },
        { variantId: v.id, playerUid: '333333333', clientRef: 'a3' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 3, created: 3, duplicate: 0, failed: 0 });
    expect(res.body.idempotent).toBe(true);

    // ★ ৩ × ৭০ = ২১০ (৩ × ১০০ নয়)
    expect(await balanceOf(db, user.id)).toBe(790);
    expect(await ledgerSum(db, user.id)).toBe(-210);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(3);

    for (const r of res.body.results) {
      expect(r.status).toBe('CREATED');
      expect(r.price).toBe(70);
      expect(r.reseller).toBe(true);
      expect(r.trackToken).toBeTruthy();
    }

    const entries = await db.ledgerEntry.findMany({ where: { userId: user.id } });
    expect(entries.every((e) => e.note?.includes('[রিসেলার]'))).toBe(true);
  });

  /** ★★★ এই স্যুটের সবচেয়ে গুরুত্বপূর্ণ টেস্ট */
  it('একই clientRef দ্বিতীয়বার — নতুন অর্ডার নয়, দ্বিতীয়বার টাকাও কাটে না', async () => {
    const v = await createVariant(db, { price: 100, resellerPrice: 70 });
    const { user, plainKey } = await reseller({ balance: 1000 });

    const payload = { items: [{ variantId: v.id, playerUid: '111111111', clientRef: 'dup-1' }] };

    const first = await bulk(plainKey, payload);
    expect(first.body.results[0].status).toBe('CREATED');

    const second = await bulk(plainKey, payload);
    expect(second.status).toBe(200);
    expect(second.body.results[0].status).toBe('DUPLICATE');
    // ★ একই অর্ডারই ফেরত এসেছে, নতুন একটি নয়
    expect(second.body.results[0].orderNo).toBe(first.body.results[0].orderNo);

    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    expect(await balanceOf(db, user.id)).toBe(930);   // একবারই কাটা
    expect(await ledgerSum(db, user.id)).toBe(-70);
  });

  /** ★★★ সমান্তরাল retry — লক নয়, ডাটাবেস ইনডেক্সই আসল সুরক্ষা */
  it('একই clientRef একসাথে দুবার — ঠিক একটি অর্ডার', async () => {
    const v = await createVariant(db, { price: 100, resellerPrice: 70 });
    const { user, plainKey } = await reseller({ balance: 1000 });

    const payload = { items: [{ variantId: v.id, playerUid: '111111111', clientRef: 'race-1' }] };
    const [a, b] = await Promise.all([bulk(plainKey, payload), bulk(plainKey, payload)]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const statuses = [a.body.results[0].status, b.body.results[0].status].sort();
    expect(statuses).toEqual(['CREATED', 'DUPLICATE']);

    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    expect(await balanceOf(db, user.id)).toBe(930);
    expect(await ledgerSum(db, user.id)).toBe(-70);
  });

  it('আংশিক ব্যর্থতা — আগের অর্ডার টেকে, খতিয়ান অক্ষত', async () => {
    const v = await createVariant(db, { price: 100 });
    // ★ ২৫০ টাকায় ঠিক দুটি অর্ডার হয়, তৃতীয়টি হওয়ার কথা নয়
    const { user, plainKey } = await reseller({ balance: 250 });

    const res = await bulk(plainKey, {
      items: [
        { variantId: v.id, playerUid: '111111111' },
        { variantId: v.id, playerUid: '222222222' },
        { variantId: v.id, playerUid: '333333333' },
      ],
    });

    expect(res.status).toBe(200);           // আংশিক সাফল্যও সাফল্য
    expect(res.body.summary).toMatchObject({ created: 2, failed: 1 });
    expect(res.body.results[2].status).toBe('FAILED');
    expect(res.body.results[2].error).toContain('ব্যালেন্স');
    expect(res.body.idempotent).toBe(false); // clientRef দেওয়া হয়নি — স্পষ্টভাবে বলা

    const balance = await balanceOf(db, user.id);
    expect(balance).toBe(50);
    // ★★★ খতিয়ান-invariant: শুরুর ব্যালেন্স + খতিয়ান = এখনকার ব্যালেন্স
    expect(250 + (await ledgerSum(db, user.id))).toBe(balance);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(2);
  });

  it('সব আইটেম ব্যর্থ হলে HTTP ৪০০', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user, plainKey } = await reseller({ balance: 10 });

    const res = await bulk(plainKey, {
      items: [{ variantId: v.id, playerUid: '111111111' }],
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(0);
    expect(await balanceOf(db, user.id)).toBe(10);
  });

  it('স্টক শেষ — ব্যাচের বাকিটা ব্যর্থ, টাকা কাটা যায় না', async () => {
    const v = await createVariant(db, { price: 100, stock: 1 });
    const { user, plainKey } = await reseller({ balance: 1000 });

    const res = await bulk(plainKey, {
      items: [
        { variantId: v.id, playerUid: '111111111' },
        { variantId: v.id, playerUid: '222222222' },
      ],
    });

    expect(res.body.summary).toMatchObject({ created: 1, failed: 1 });
    expect(res.body.results[1].error).toContain('স্টক');
    expect(await balanceOf(db, user.id)).toBe(900);
    expect(Number((await db.variant.findUnique({ where: { id: v.id } }))!.stock)).toBe(0);
  });

  it('একই অনুরোধে একই clientRef দুবার — পুরো অনুরোধ প্রত্যাখ্যাত', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user, plainKey } = await reseller({ balance: 1000 });

    const res = await bulk(plainKey, {
      items: [
        { variantId: v.id, playerUid: '111111111', clientRef: 'same' },
        { variantId: v.id, playerUid: '222222222', clientRef: 'same' },
      ],
    });

    expect(res.status).toBe(400);
    // ★ একটিও অর্ডার হয়নি — টাইপো ধরা পড়েছে অর্ডার বসার আগেই
    expect(await db.order.count({ where: { userId: user.id } })).toBe(0);
    expect(await balanceOf(db, user.id)).toBe(1000);
  });

  it('২০টির বেশি আইটেম প্রত্যাখ্যাত', async () => {
    const v = await createVariant(db, { price: 1 });
    const { user, plainKey } = await reseller({ balance: 1000 });

    const items = Array.from({ length: 21 }, (_, i) => ({
      variantId: v.id, playerUid: `10000000${i}`,
    }));

    const res = await bulk(plainKey, { items });
    expect(res.status).toBe(400);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(0);
  });

  it('অন্য রিসেলারের একই clientRef আলাদা — ইউনিকতা ব্যবহারকারী-ভিত্তিক', async () => {
    const v = await createVariant(db, { price: 100 });
    const one = await reseller({ balance: 1000 });
    const two = await reseller({ balance: 1000 });

    const payload = { items: [{ variantId: v.id, playerUid: '111111111', clientRef: 'shared' }] };
    const a = await bulk(one.plainKey, payload);
    const b = await bulk(two.plainKey, payload);

    expect(a.body.results[0].status).toBe('CREATED');
    expect(b.body.results[0].status).toBe('CREATED');
    expect(await db.order.count()).toBe(2);
  });

  /**
   * ★★★ রিগ্রেশন গার্ড — `(userId, clientRef)` ইউনিক ইনডেক্স যেন
   *   ওয়েব অর্ডার না ভাঙে। ওয়েবের প্রতিটি অর্ডারে clientRef = NULL,
   *   আর Postgres একাধিক NULL মানে; কিন্তু এই ধারণাটি ভুল হলে
   *   একজন গ্রাহকের **দ্বিতীয়** অর্ডারই ব্যর্থ হতো — অর্থাৎ ইনডেক্সটি
   *   পুরো দোকান বন্ধ করে দিত।
   */
  it('ওয়েবে একই গ্রাহকের একাধিক অর্ডার আগের মতোই কাজ করে', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });

    for (const uid of ['111111111', '222222222', '333333333']) {
      const res = await c.post('/api/order', { variantId: v.id, playerUid: uid });
      expect(res.status).toBe(200);
    }

    expect(await db.order.count({ where: { userId: user.id } })).toBe(3);
    expect(await balanceOf(db, user.id)).toBe(700);
  });
});

describe('অ্যাডমিন — কী ব্যবস্থাপনা', () => {
  it('অ্যাডমিন কী বানান, কাঁচা মান একবারই ফেরে, তা দিয়ে অর্ডার হয়', async () => {
    const v = await createVariant(db, { price: 100, resellerPrice: 70 });
    const { user } = await signedInUser(db, { balance: 500 });
    await db.user.update({ where: { id: user.id }, data: { tier: 'RESELLER' } });

    const { client: ac } = await signedInAdmin(db);
    const made = await ac.post('/api/admin/user/api-key', {
      userId: user.id, label: 'রিসেলার প্যানেল',
    });

    expect(made.status).toBe(200);
    expect(made.body.plainKey).toMatch(/^uidk_/);

    // ★ তালিকায় কাঁচা কী কখনো ফেরে না
    const list = await ac.get(`/api/admin/user/api-key?userId=${user.id}`);
    expect(list.body.keys).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(made.body.plainKey);

    const used = await bulk(made.body.plainKey, {
      items: [{ variantId: v.id, playerUid: '111111111' }],
    });
    expect(used.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(430);
  });

  it('রিসেলার নন এমন ব্যবহারকারীর জন্য কী তৈরি করা যায় না', async () => {
    const { user } = await signedInUser(db, {});
    const { client: ac } = await signedInAdmin(db);

    const res = await ac.post('/api/admin/user/api-key', { userId: user.id, label: 'x' });
    expect(res.status).toBe(400);
    expect(await db.apiKey.count()).toBe(0);
  });

  it('সাধারণ ব্যবহারকারী নিজেকে কী দিতে পারেন না', async () => {
    const { user, client: c } = await signedInUser(db, {});
    await db.user.update({ where: { id: user.id }, data: { tier: 'RESELLER' } });

    const res = await c.post('/api/admin/user/api-key', { userId: user.id, label: 'x' });
    expect(res.status).toBe(403);
    expect(await db.apiKey.count()).toBe(0);
  });

  /**
   * ★★★ Group E-র শিক্ষা: ক্লায়েন্ট কম্পোনেন্টের props RSC পে-লোডে
   *   সিরিয়ালাইজ হয়ে ব্রাউজারে যায়। কী-প্যানেল একটি ক্লায়েন্ট
   *   কম্পোনেন্ট, তাই তার props-এ `hash` চলে গেলে সেটি view-source-এ
   *   প্লেইনটেক্সট হয়ে থাকত। পাঠ নয়, প্রমাণ চাই।
   */
  it('অ্যাডমিন পাতার HTML-এ কীর হ্যাশ যায় না', async () => {
    const { user, keyId } = await reseller({ balance: 100 });
    const row = await db.apiKey.findUnique({ where: { id: keyId } });

    const { client: ac } = await signedInAdmin(db);
    const res = await ac.raw(`/admin/users/${user.id}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain(row!.hash);
    // ★ প্যানেলটি আসলেই রেন্ডার হয়েছে — নাহলে টেস্টটি খালি পাতায় পাস করত
    expect(html).toContain(row!.prefix);
    expect(html).toContain('টেস্ট কী');
  });

  it('প্রত্যাহার সারি মোছে না, কেবল সময় বসায়', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user, plainKey, keyId } = await reseller({ balance: 500 });
    const { client: ac } = await signedInAdmin(db);

    const res = await ac.raw('/api/admin/user/api-key', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId }),
    });
    expect(res.status).toBe(200);

    const row = await db.apiKey.findUnique({ where: { id: keyId } });
    expect(row).not.toBeNull();          // ইতিহাস অক্ষত
    expect(row!.revokedAt).not.toBeNull();

    const after = await bulk(plainKey, { items: [{ variantId: v.id, playerUid: '111111111' }] });
    expect(after.status).toBe(401);
    expect(await balanceOf(db, user.id)).toBe(500);
  });
});

describe('অন্য কিছু ভাঙেনি', () => {
  it('ওয়েব অর্ডারে খতিয়ান ও ব্যালেন্স আগের মতোই (সার্ভিস refactor)', async () => {
    const v = await createVariant(db, { price: 100 });
    const { user, client: c } = await signedInUser(db, { balance: 300 });

    const res = await c.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    expect(res.status).toBe(200);
    expect(res.body.orderNo).toBeGreaterThan(0);
    expect(res.body.balance).toBe('200.00');

    expect(await balanceOf(db, user.id)).toBe(200);
    expect(await ledgerSum(db, user.id)).toBe(-100);

    const order = await db.order.findFirst({ where: { userId: user.id } });
    expect(order!.clientRef).toBeNull();
    expect(order!.status).toBe('PENDING');
    expect(order!.trackToken).toBeTruthy();

    // ★ ঘটনাপঞ্জির প্রথম এন্ট্রিও আগের মতোই লেখা হয়
    expect(await db.orderEvent.count({ where: { orderId: order!.id } })).toBe(1);
  });

  it('অনুমোদনহীন কেউ /api/order এ ঢুকতে পারে না', async () => {
    const v = await createVariant(db, { price: 100 });
    const res = await client().post('/api/order', { variantId: v.id, playerUid: '123456789' });
    expect(res.status).toBe(401);
  });
});
