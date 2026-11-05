/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ বিকৃত অনুরোধ — কোনো API ৫০০ দেবে না (চূড়ান্ত অডিট, ২০২৬-০৯-১৭)
 *
 *   প্রশ্ন একটাই: ক্লায়েন্টের ভুলে সার্ভার কি "সার্ভারে সমস্যা" (৫০০)
 *   বলে? বললে তা তিনটি ক্ষতি করে — গ্রাহক ভুল বার্তা পান, মনিটরিং-এ
 *   ভুয়া সার্ভার-ত্রুটি জমে (Sentry যুক্ত হলে প্রতিটি একটি অ্যালার্ট),
 *   আর `guard.ts` প্রতি ১০ মিনিটে একটি টেলিগ্রাম সতর্কতা পাঠায়।
 *
 *   প্রতিটি রুটে তিন ভূমিকায় (অতিথি · গ্রাহক · অ্যাডমিন) পাঠানো হয়:
 *   ভাঙা JSON · null · [] · {} · ভুল টাইপ · বিশাল/ভগ্নাংশ id।
 *   দাবি: status < 500, আর উত্তরে কোনো stack trace / Prisma বার্তা নেই।
 *
 *   ⚠️ ইচ্ছাকৃতভাবে বাদ — যেগুলো বৈধ অনুরোধে **সত্যিকারের কাজ** করে
 *   এবং বিকৃত ইনপুটের সাথে সম্পর্কহীন: announce (সবাইকে বিজ্ঞপ্তি),
 *   restore, revoke-all, টেলিগ্রাম connect/verify/bots (বাইরের API),
 *   webhooks, NextAuth-এর নিজের রুট।
 *
 *   চালানো (ডেভ সার্ভার :3000):  npx tsx scripts/verify/malformed-requests.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { request, type APIRequestContext } from 'playwright-core';

const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };

const RAW_BAD_JSON = Symbol('raw');
type Body = unknown | typeof RAW_BAD_JSON;

const BODIES: Array<[string, Body]> = [
  ['ভাঙা JSON', RAW_BAD_JSON],
  ['null', null],
  ['[]', []],
  ['{}', {}],
  ['ভুল টাইপ', {
    id: {}, orderId: [], userId: { x: 1 }, depositId: 12, variantId: 'abc', productId: 1.5,
    amount: 'NaN', code: {}, action: ['x'], status: {}, email: [], password: {}, token: {},
    key: [], body: {}, orderIds: 'x', items: 'x', isBanned: 'yes', price: {}, stock: [],
    label: {}, name: [], phone: {}, method: [], trxId: {}, senderNo: [], rating: 'five',
    kind: {}, subject: [], current: {}, next: [], arrived: 'yes', tier: {},
    // ⚠️ `enabled` ইচ্ছাকৃতভাবে নেই — `/api/admin/telegram` যেকোনো truthy মানকে
    //   চালু ধরে ও সেটিং লিখে ফেলে; এটি ৫০০ নয়, কিন্তু ডেভ DB বদলে দিত।
  }],
  ['বিশাল সংখ্যা', {
    id: 99999999999, orderId: 'x'.repeat(5000), userId: 'x'.repeat(5000), variantId: 99999999999,
    productId: 99999999999, depositId: 'x'.repeat(5000), amount: 1e308, stock: 1e20, price: 1e308,
    orderNo: 99999999999, rating: 1e9, email: `${'a'.repeat(3000)}@x.com`,
  }],
  ['ভগ্নাংশ id', { id: 1.5, variantId: 1.5, productId: 2.5, stock: 1.5, userId: 1, orderNo: 1.5 }],
];

type Role = 'anon' | 'customer' | 'admin';
type Route = { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; roles: Role[] };

const C: Role[] = ['anon', 'customer'];
const A: Role[] = ['customer', 'admin'];
const PUB: Role[] = ['anon'];

const ROUTES: Route[] = [
  // ── পাবলিক ──
  { method: 'POST', path: '/api/register', roles: PUB },
  { method: 'POST', path: '/api/auth/otp/send', roles: PUB },
  { method: 'POST', path: '/api/auth/forgot', roles: PUB },
  { method: 'POST', path: '/api/auth/reset', roles: PUB },
  { method: 'POST', path: '/api/auth/2fa-check', roles: PUB },
  { method: 'POST', path: '/api/auth/login-status', roles: PUB },
  { method: 'POST', path: '/api/track', roles: PUB },
  // ── গ্রাহক ──
  { method: 'POST', path: '/api/order', roles: C },
  { method: 'POST', path: '/api/order/direct', roles: C },
  { method: 'POST', path: '/api/order/confirm', roles: C },
  { method: 'POST', path: '/api/deposit', roles: C },
  { method: 'POST', path: '/api/deposit/check-trx', roles: C },
  { method: 'POST', path: '/api/coupon/check', roles: C },
  { method: 'POST', path: '/api/review', roles: C },
  { method: 'POST', path: '/api/uid/verify', roles: C },
  { method: 'POST', path: '/api/tickets', roles: C },
  { method: 'POST', path: '/api/tickets/nonexistent-id', roles: C },
  { method: 'PATCH', path: '/api/tickets/nonexistent-id', roles: C },
  { method: 'PATCH', path: '/api/account/profile', roles: C },
  { method: 'POST', path: '/api/account/password', roles: C },
  { method: 'POST', path: '/api/account/2fa', roles: C },
  { method: 'POST', path: '/api/account/withdraw', roles: C },
  { method: 'POST', path: '/api/reseller/orders', roles: PUB },
  // ── অ্যাডমিন ──
  ...([
    ['POST', '/api/admin/deposit'], ['POST', '/api/admin/order'], ['POST', '/api/admin/order/bulk'],
    ['POST', '/api/admin/order/claim'], ['POST', '/api/admin/order/refund'],
    ['POST', '/api/admin/user'], ['PATCH', '/api/admin/user'], ['PATCH', '/api/admin/user/tier'],
    ['POST', '/api/admin/user/api-key'], ['DELETE', '/api/admin/user/api-key'],
    ['POST', '/api/admin/product'], ['PATCH', '/api/admin/product'], ['DELETE', '/api/admin/product'],
    ['POST', '/api/admin/variant'], ['PATCH', '/api/admin/variant'], ['DELETE', '/api/admin/variant'],
    ['POST', '/api/admin/coupon'], ['PATCH', '/api/admin/coupon'], ['DELETE', '/api/admin/coupon'],
    ['POST', '/api/admin/banner'], ['PATCH', '/api/admin/banner'], ['DELETE', '/api/admin/banner'],
    ['POST', '/api/admin/campaign'], ['PATCH', '/api/admin/campaign'], ['DELETE', '/api/admin/campaign'],
    ['POST', '/api/admin/social'], ['PATCH', '/api/admin/social'], ['DELETE', '/api/admin/social'],
    ['POST', '/api/admin/payment'], ['PATCH', '/api/admin/payment'], ['DELETE', '/api/admin/payment'],
    ['POST', '/api/admin/payment/provider'], ['PATCH', '/api/admin/payment/provider'],
    ['PATCH', '/api/admin/media'], ['DELETE', '/api/admin/media'],
    ['POST', '/api/admin/settings'], ['POST', '/api/admin/branding'], ['POST', '/api/admin/search'],
    ['POST', '/api/admin/otp'], ['PUT', '/api/admin/otp'],
    ['POST', '/api/admin/tickets'], ['PATCH', '/api/admin/tickets'],
    ['POST', '/api/admin/withdrawals'],
    ['POST', '/api/admin/telegram'], ['POST', '/api/admin/telegram/config'],
    ['POST', '/api/admin/telegram/manage'], ['POST', '/api/admin/telegram/scheduler'],
    ['POST', '/api/admin/telegram/templates'],
  ] as const).map(([method, path]) => ({ method, path, roles: A }) as Route),
];

/** GET রুটে বিকৃত query */
const GETS: Array<{ path: string; role: Role }> = [
  { path: '/api/search?q=' + 'ক'.repeat(3000), role: 'anon' },
  { path: '/api/search?q[]=x&q=%00%ff', role: 'anon' },
  { path: '/api/uid/recent?productId=1.5', role: 'customer' },
  { path: '/api/uid/recent?productId=99999999999', role: 'customer' },
  { path: '/api/uid/recent?productId=-1', role: 'customer' },
  { path: '/api/tickets/%00', role: 'customer' },
  { path: '/api/admin/media?limit=abc&offset=xyz', role: 'admin' },
  { path: '/api/admin/media?limit=-5&offset=-9&sort=zzz&type=zzz', role: 'admin' },
  { path: '/api/admin/reports?type=zzz&from=abc&to=xyz', role: 'admin' },
  { path: '/api/admin/reports?type=orders&from=99999-99-99&to=2026-13-45', role: 'admin' },
  { path: '/api/admin/analytics?days=abc', role: 'admin' },
  { path: '/api/admin/logs/export?from=abc&to=xyz&q=' + 'x'.repeat(2000), role: 'admin' },
  { path: '/api/admin/withdrawals?status=%27', role: 'admin' },
  { path: '/api/admin/user/api-key?userId=%00', role: 'admin' },
  { path: '/api/admin/otp?x=1', role: 'admin' },
  { path: '/api/admin/telegram/backup?passphrase=' + 'x'.repeat(3000), role: 'admin' },
];

async function signIn(creds: { email: string; password: string }): Promise<APIRequestContext> {
  await db.rateLimitBucket.deleteMany({});
  const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const { csrfToken } = await (await ctx.get('/api/auth/csrf')).json();
  const r = await ctx.post('/api/auth/callback/credentials', {
    form: { csrfToken, email: creds.email, password: creds.password, json: 'true' },
    maxRedirects: 0, failOnStatusCode: false,
  });
  const s = await (await ctx.get('/api/auth/session')).json();
  if (!s?.user?.id) throw new Error(`লগইন ব্যর্থ (${creds.email}) → ${r.status()}`);
  return ctx;
}

const LEAK = /PrismaClient|prisma\.|Invalid `|at [A-Za-z_$.]+ \(|node_modules|\.tsx?:\d+/;

async function main() {
  console.log(`═══ বিকৃত অনুরোধ · ${BASE} · DB ${dbLabel()} ═══\n`);
  const ctxs: Record<Role, APIRequestContext> = {
    anon: await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true }),
    customer: await signIn(CUSTOMER),
    admin: await signIn(ADMIN),
  };

  let total = 0;
  let authz = 0;
  const bad: string[] = [];

  const record = async (label: string, res: { status(): number; text(): Promise<string> }) => {
    total++;
    const st = res.status();
    const text = await res.text().catch(() => '');
    if (st >= 500 || LEAK.test(text)) {
      bad.push(`${label} → ${st} ${text.slice(0, 140).replace(/\s+/g, ' ')}`);
    }
  };

  for (const r of ROUTES) {
    for (const role of r.roles) {
      for (const [bname, body] of BODIES) {
        // অ্যাডমিন রুটে প্রতিটি সারিতেই rate-limit এড়াতে মাঝে মাঝে সাফ
        if (total % 40 === 0) await db.rateLimitBucket.deleteMany({});
        const opts = body === RAW_BAD_JSON
          ? { headers: { 'content-type': 'application/json' }, data: '{bad json', failOnStatusCode: false }
          : { data: body as object, failOnStatusCode: false };
        const res = await ctxs[role].fetch(r.path, { method: r.method, ...opts });
        await record(`${r.method} ${r.path} [${role}] ${bname}`, res);
        // ★ অনুমতি **ইনপুট-যাচাইয়ের আগে** — নাহলে ৪০০-বার্তা দিয়ে অতিথি/গ্রাহক
        //   অ্যাডমিন-রুটের স্কিমা পড়ে ফেলতে পারতেন
        const isAdminRoute = r.path.startsWith('/api/admin/');
        const isCustomerRoute = r.roles === C;
        if ((isAdminRoute && role === 'customer') || (isCustomerRoute && role === 'anon')) {
          authz++;
          if (![401, 403].includes(res.status())) {
            bad.push(`অনুমতি: ${r.method} ${r.path} [${role}] ${bname} → ${res.status()} (৪০১/৪০৩ প্রত্যাশিত)`);
          }
        }
      }
    }
  }

  for (const g of GETS) {
    const res = await ctxs[g.role].get(g.path, { failOnStatusCode: false });
    await record(`GET ${g.path.slice(0, 80)} [${g.role}]`, res);
  }

  // ★ গ্রাহক ও অতিথি অ্যাডমিনের **পড়ার** রুটও ছুঁতে পারেন না — বিশেষত backup
  //   (পুরো ডাটাবেস) ও লগ-এক্সপোর্ট
  const ADMIN_GETS = [
    '/api/admin/backup', '/api/admin/analytics', '/api/admin/readiness', '/api/admin/flags',
    '/api/admin/withdrawals', '/api/admin/user/api-key?userId=x', '/api/admin/logs/export',
    '/api/admin/telegram/backup?passphrase=x', '/api/admin/reports', '/api/admin/media',
    '/api/admin/otp', '/api/admin/branding', '/api/admin/telegram', '/api/admin/tickets',
    '/api/admin/telegram/scheduler/tick', '/api/cron/sla-breach', '/api/cron/ratelimit-cleanup',
    '/api/cron/telegram-scheduler',
  ];
  for (const p of ADMIN_GETS) {
    for (const role of ['anon', 'customer'] as const) {
      const res = await ctxs[role].get(p, { failOnStatusCode: false });
      await record(`GET ${p} [${role}]`, res);
      authz++;
      // ★ SEC-05 — টেলিগ্রাম-টিকে Bearer ছাড়া GET কিছুই চালায় না, সরাসরি ৪০৫ (CSRF-পথ বন্ধ)
      const allowed = p === '/api/admin/telegram/scheduler/tick' ? [401, 403, 405] : [401, 403];
      if (!allowed.includes(res.status())) {
        bad.push(`অনুমতি: GET ${p} [${role}] → ${res.status()} (${allowed.join('/')} প্রত্যাশিত)`);
      }
    }
  }

  console.log(`  মোট অনুরোধ: ${total} · এর মধ্যে অনুমতি-দাবি: ${authz}`);
  if (bad.length === 0) {
    console.log('  PASS  কোনো ৫০০ বা অভ্যন্তরীণ তথ্য-ফাঁস নেই');
  } else {
    console.log(`  FAIL  ${bad.length}টি সমস্যা:`);
    for (const b of bad) console.log(`        · ${b}`);
  }

  for (const c of Object.values(ctxs)) await c.dispose();
  await db.rateLimitBucket.deleteMany({});
  await db.$disconnect();
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
