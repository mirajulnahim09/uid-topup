/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SEC-01 — পাতার গার্ড: প্রতিটি /admin ও /account পাতা নিজেই
 *     DB থেকে role + ban + sessionEpoch যাচাই করে (`src/lib/pageGuard.ts`)
 *
 *   ── কেন দরকার ──
 *   Next 14.2.35-এ ক্লায়েন্ট-নেভিগেশনের (RSC) অনুরোধে সার্ভার সেই সেগমেন্ট
 *   থেকে রেন্ডার শুরু করে যেটি ক্লায়েন্টের `Next-Router-State-Tree`-এ নেই
 *   (`walk-tree-with-flight-router-state.js:40–51`) — অর্থাৎ `admin/layout.tsx`
 *   তখন চলে না। আগে ২১টির ২০টি অ্যাডমিন পাতার নিজস্ব গার্ড ছিল না, আর
 *   অ্যাকাউন্ট পাতাগুলো epoch দেখত jwt callback-এর ৫-মিনিট থ্রটলে।
 *
 *   ── এখানকার দাবি (প্রতিটি নেতিবাচক দাবির পাশে ইতিবাচক নিয়ন্ত্রণ) ──
 *     ১. বৈধ অ্যাডমিন: প্রতিটি অ্যাডমিন পাতা খোলে; মার্কার-ডেটা দেখা যায়
 *     ২. ক্লায়েন্ট-নেভিগেশনে লেআউট সত্যিই বাদ পড়ে (লেআউটের লেখা নেই,
 *        পাতার ডেটা আছে) — অর্থাৎ পাতার নিজের গার্ডই একমাত্র পাহারা
 *     ৩. epoch বাড়লে (সব ডিভাইস সাইন-আউট/রিসেট): প্রতিটি অ্যাডমিন ও
 *        অ্যাকাউন্ট পাতা — সাধারণ লোড **ও** ক্লায়েন্ট-নেভিগেশন — লগইনে
 *        পাঠায় এবং মার্কার-ডেটা একটিও বাইট দেয় না
 *     ৪. ব্যান হলে একই
 *     ৫. গ্রাহক অ্যাডমিন পাতায় → হোমে; ডেটা নেই
 *     ৬. বৈধ গ্রাহক: প্রতিটি অ্যাকাউন্ট পাতা খোলে (কেউ অকারণে বের হন না)
 *
 *   ⚠️ রিডাইরেক্টের রূপ অনুমান করা হয় না: পাতার উপরে `loading.tsx` থাকায়
 *   স্ট্রিম শুরু হয়ে যেতে পারে, তখন Next ৩০৭-এর বদলে ২০০-এর ভেতরে
 *   `NEXT_REDIRECT` নির্দেশ পাঠায়। তাই দুটিই গ্রহণযোগ্য — কিন্তু **কেবল**
 *   এ দুটি, আর সবক্ষেত্রে ডেটা-অনুপস্থিতিই আসল প্রমাণ।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser, signedInAdmin } from './helpers/app';
import { createUser, createVariant, createCompletedOrder } from './helpers/factories';
import type { Client } from './helpers/http';

/** অ্যাডমিন লেআউটের হেডারের লেখা — লেআউট রেন্ডার হলেই কেবল থাকে */
const LAYOUT_TEXT = 'কন্ট্রোল প্যানেল';

const ADMIN_STATIC = [
  '/admin', '/admin/banners', '/admin/branding', '/admin/coupons', '/admin/deposits',
  '/admin/homepage', '/admin/integrations', '/admin/logs', '/admin/media', '/admin/orders',
  '/admin/otp', '/admin/payments', '/admin/products', '/admin/reports', '/admin/site',
  '/admin/telegram', '/admin/tickets', '/admin/tools', '/admin/users', '/admin/withdrawals',
];

/**
 * ★ Next-এর ক্লায়েন্ট রাউটার যে router-state পাঠায়, তার আকার
 *   (`[segment, parallelRoutes, url, refresh, isRootLayout]`)। `from` = ক্লায়েন্ট
 *   এখন যে পাতায় আছে; সার্ভার প্রথম অমিল সেগমেন্ট থেকে রেন্ডার করে।
 */
function routerTree(from: string[]): string {
  let node: unknown[] = ['__PAGE__', {}];
  for (let i = from.length - 1; i >= 0; i--) node = [from[i], { children: node }];
  return encodeURIComponent(JSON.stringify(['', { children: node }, null, null, true]));
}

/** ★ সাধারণ (হার্ড) লোড */
async function hard(c: Client, path: string) {
  const res = await c.raw(path);
  return { status: res.status, location: res.headers.get('location') || '', body: await res.text() };
}

/** ★ ক্লায়েন্ট-নেভিগেশন — Next-এর নিজের রাউটার যে হেডার পাঠায় */
async function nav(c: Client, path: string, from: string[]) {
  const res = await c.raw(path, { headers: { RSC: '1', 'Next-Router-State-Tree': routerTree(from) } });
  return { status: res.status, location: res.headers.get('location') || '', body: await res.text() };
}

/** ★ লগইনে পাঠানো হলো কি না — ৩০৭/৩০৮ বা স্ট্রিমের ভেতরের NEXT_REDIRECT, কেবল এ দুটি */
function sentTo(r: { status: number; location: string; body: string }, target: '/login' | '/') {
  const viaStatus = [303, 307, 308].includes(r.status) &&
    (target === '/login' ? r.location.includes('/login') : new URL(r.location, 'http://x').pathname === '/');
  const viaStream = r.body.includes('NEXT_REDIRECT') &&
    (target === '/login' ? r.body.includes('/login') : /NEXT_REDIRECT;(replace|push);\/;/.test(r.body));
  return viaStatus || viaStream;
}

async function adminFixture() {
  const { admin, client } = await signedInAdmin(db);
  // ★ মার্কার — /admin/users ও /admin/users/[id] এ দেখা যায়
  const victim = await createUser(db, { email: `pgmark${Date.now()}@test.local`, name: 'PG Marker' });
  const pages = [...ADMIN_STATIC, `/admin/users/${victim.id}`];
  return { admin, client, victim, pages };
}

describe('SEC-01 — অ্যাডমিন পাতার গার্ড', () => {
  it('বৈধ অ্যাডমিন: প্রতিটি পাতা খোলে (২১/২১), মার্কার দেখা যায়', async () => {
    const { client: adm, victim, pages } = await adminFixture();
    for (const p of pages) {
      const r = await hard(adm, p);
      expect(r.status, p).toBe(200);
      expect(sentTo(r, '/login'), `${p} ভুল করে লগইনে`).toBe(false);
    }
    expect((await hard(adm, '/admin/users')).body).toContain(victim.email);
    expect((await hard(adm, `/admin/users/${victim.id}`)).body).toContain(victim.email);
  });

  it('ক্লায়েন্ট-নেভিগেশনে লেআউট চলে না — পাতার নিজের গার্ডই পাহারা (প্রক্রিয়ার প্রমাণ)', async () => {
    const { client: adm, victim } = await adminFixture();
    const full = await hard(adm, '/admin/users');
    expect(full.body).toContain(LAYOUT_TEXT); // হার্ড-লোডে লেআউট আছে

    const r = await nav(adm, '/admin/users', ['admin', 'logs']);
    expect(r.status).toBe(200);
    expect(r.body).toContain(victim.email); // পাতার ডেটা এসেছে
    expect(r.body).not.toContain(LAYOUT_TEXT); // কিন্তু লেআউট রেন্ডার হয়নি
  });

  it('epoch বাড়লে: প্রতিটি অ্যাডমিন পাতা — হার্ড লোড ও ক্লায়েন্ট-নেভিগেশন — লগইনে, ডেটা শূন্য', async () => {
    const { admin, client: adm, victim, pages } = await adminFixture();
    await db.user.update({ where: { id: admin.id }, data: { sessionEpoch: { increment: 1 } } });

    for (const p of pages) {
      const h = await hard(adm, p);
      expect(sentTo(h, '/login'), `hard ${p} → ${h.status} ${h.location}`).toBe(true);
      expect(h.body, `hard ${p}`).not.toContain(victim.email);

      const n = await nav(adm, p, ['admin', 'logs']);
      expect(sentTo(n, '/login'), `nav ${p} → ${n.status}`).toBe(true);
      expect(n.body, `nav ${p}`).not.toContain(victim.email);
    }
  });

  it('ব্যান হলে: অ্যাডমিন পাতা (দুই ধরনের অনুরোধ) লগইনে, ডেটা শূন্য', async () => {
    const { admin, client: adm, victim } = await adminFixture();
    await db.user.update({ where: { id: admin.id }, data: { isBanned: true } });
    for (const p of ['/admin/users', `/admin/users/${victim.id}`]) {
      const h = await hard(adm, p);
      expect(sentTo(h, '/login'), p).toBe(true);
      expect(h.body).not.toContain(victim.email);
      const n = await nav(adm, p, ['admin', 'logs']);
      expect(sentTo(n, '/login'), p).toBe(true);
      expect(n.body).not.toContain(victim.email);
    }
  });

  it('গ্রাহক অ্যাডমিন পাতায়: হোমে (বা middleware-এ আটকে), ডেটা শূন্য', async () => {
    const { client: cust } = await signedInUser(db, {});
    const victim = await createUser(db, { email: `pgmark${Date.now()}c@test.local` });
    for (const p of ['/admin/users', `/admin/users/${victim.id}`]) {
      const h = await hard(cust, p);
      expect(sentTo(h, '/'), p).toBe(true);
      expect(h.body).not.toContain(victim.email);
      const n = await nav(cust, p, ['admin', 'logs']);
      expect(sentTo(n, '/'), p).toBe(true);
      expect(n.body).not.toContain(victim.email);
    }
  });
});

describe('SEC-01 — অ্যাকাউন্ট পাতার গার্ড', () => {
  async function accountFixture() {
    const { user, client } = await signedInUser(db, {});
    const variant = await createVariant(db);
    const order = await createCompletedOrder(db, { userId: user.id, variantId: variant.id });
    const pages = [
      '/account', '/account/notifications', '/account/orders', `/account/orders/${order.id}`,
      `/account/orders/${order.id}/invoice`, '/account/profile', '/account/smm-orders',
      '/account/tickets', '/account/wallet/deposit', '/account/wallet/withdraw',
    ];
    // ★ টিকিট-থ্রেড: অস্তিত্বহীন id — বৈধ সেশনে ৪০৪, বাতিল সেশনে লগইন (গার্ড আগে)
    const ticketPage = '/account/tickets/doesnotexist0000000000000';
    return { user, client, pages, ticketPage };
  }

  it('বৈধ গ্রাহক: প্রতিটি পাতা খোলে (১১/১১) — কেউ অকারণে বের হন না', async () => {
    const { user, client: c, pages, ticketPage } = await accountFixture();
    for (const p of pages) {
      const r = await hard(c, p);
      expect(r.status, p).toBe(200);
      expect(sentTo(r, '/login'), `${p} ভুল করে লগইনে`).toBe(false);
    }
    const t = await hard(c, ticketPage);
    expect(sentTo(t, '/login')).toBe(false);
    expect((await hard(c, '/account/profile')).body).toContain(user.email);
  });

  it('epoch বাড়লে: প্রতিটি অ্যাকাউন্ট পাতা (দুই ধরনের অনুরোধ) লগইনে, ইমেইল/ফোন শূন্য', async () => {
    const { user, client: c, pages, ticketPage } = await accountFixture();
    // ইতিবাচক নিয়ন্ত্রণ: বাতিলের আগে ক্লায়েন্ট-নেভিগেশনে ডেটা আসে
    const before = await nav(c, '/account/profile', ['account', 'orders']);
    expect(before.body).toContain(user.email);

    await db.user.update({ where: { id: user.id }, data: { sessionEpoch: { increment: 1 } } });

    for (const p of [...pages, ticketPage]) {
      const h = await hard(c, p);
      expect(sentTo(h, '/login'), `hard ${p} → ${h.status} ${h.location}`).toBe(true);
      expect(h.body, p).not.toContain(user.email);
      expect(h.body, p).not.toContain(user.phone);

      const n = await nav(c, p, ['account', 'orders']);
      expect(sentTo(n, '/login'), `nav ${p} → ${n.status}`).toBe(true);
      expect(n.body, p).not.toContain(user.email);
      expect(n.body, p).not.toContain(user.phone);
    }
  });
});
