/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ইনপুট-ফাজ ও ত্রুটি-ফরেনসিক (EXTREME অডিট, ২০২৬-০৯-১৮)
 *
 *   প্রতিটি গ্রাহক-নাগালের রুটে বিকৃত ইনপুট পাঠিয়ে দেখা হয়:
 *     · স্ট্রিংয়ের বদলে array/object/number/bool/null
 *     · NaN · Infinity · -0 · 1e308 · 2^53+1 · দশমিক
 *     · অতি-দীর্ঘ স্ট্রিং · ইউনিকোড/ইমোজি/বাংলা/RTL/নাল-বাইট
 *     · অতিরিক্ত ফিল্ড · অনুপস্থিত ফিল্ড · খালি বডি
 *
 *   দাবি (Phase 33):
 *     ১. কোনো ৫xx নয় (ক্লায়েন্টের ভুলে সার্ভার-ত্রুটি নয়)
 *     ২. উত্তরে স্ট্যাক/Prisma/DB-হোস্ট/ফাইলপথ ফাঁস নয়
 *     ৩. ত্রুটি-বার্তা **বাংলা** (zod-এর ডিফল্ট ইংরেজি নয়)
 *     ৪. স্ট্যাটাস অর্থবহ: ভ্যালিডেশন ৪০০ · অনুপস্থিত ৪০৪ · সংঘাত ৪০৯
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/input-fuzz.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { request, type APIRequestContext } from 'playwright-core';

const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };

let pass = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, note = '') => {
  if (ok) pass++; else { fails.push(`${name} — ${note}`); console.log(`  FAIL  ${name} — ${note}`); }
};

/** ইংরেজি zod/প্রোগ্রাম-বার্তার ছাঁচ — গ্রাহকের সামনে যাওয়া চলবে না */
const ENGLISH_LEAK = /String must contain|Expected \w+, received|Invalid input|Required|Number must be|invalid_type|too_(small|big)/i;
const INTERNAL_LEAK = /PrismaClient|prisma\.|node_modules|at async |\.ts:\d+|ECONNREFUSED|postgres:\/\/|neon\.tech|C:\\\\|\/var\/task/i;

const VALUES: Array<[string, unknown]> = [
  ['array', ['x']],
  ['object', { a: 1 }],
  ['number', 12345],
  ['boolean', true],
  ['null', null],
  ['NaN-string', 'NaN'],
  ['Infinity-string', 'Infinity'],
  ['huge-number', 1e308],
  ['unsafe-int', 9007199254740993],
  ['negative', -5],
  ['zero', 0],
  ['decimal', 0.1],
  ['long-string', 'ক'.repeat(5000)],
  ['emoji', '🙂🔥'.repeat(10)],
  ['rtl', '\u202Eabc'],
  ['null-byte', 'a\u0000b'],
  ['html', '<b>x</b>'],
  ['sql-ish', "' OR 1=1 --"],
];

async function login(who: { email: string; password: string } | null) {
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  if (!who) return ctx;
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: who.email, password: who.password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  return ctx;
}

type Target = { label: string; path: string; base: Record<string, unknown>; fields: string[]; ctx: 'cust' | 'admin' | 'anon' };

async function main() {
  console.log(`═══ ইনপুট-ফাজ · ${BASE} · DB ${dbLabel()} ═══`);
  const anon = await login(null);
  const cust = await login(CUSTOMER);
  const admin = await login(ADMIN);
  const ctxOf = { anon, cust, admin } as Record<string, APIRequestContext>;

  const variant = await db.variant.findFirstOrThrow({ where: { isActive: true }, orderBy: { price: 'asc' } });
  const targets: Target[] = [
    { label: 'অর্ডার', path: '/api/order', ctx: 'cust', fields: ['variantId', 'playerUid', 'playerName', 'couponCode', 'clientRef', 'expectedPrice'],
      base: { variantId: variant.id, playerUid: '1234567890' } },
    { label: 'ডিপোজিট', path: '/api/deposit', ctx: 'cust', fields: ['method', 'amount', 'trxId', 'senderNo', 'screenshot'],
      base: { method: 'BKASH', amount: 500, trxId: `FUZZ${Date.now()}`, senderNo: '01712345678' } },
    { label: 'কুপন-যাচাই', path: '/api/coupon/check', ctx: 'cust', fields: ['code', 'variantId'], base: { code: 'NOPE', variantId: variant.id } },
    { label: 'রিভিউ', path: '/api/review', ctx: 'cust', fields: ['orderId', 'rating', 'body', 'photoUrl'], base: { orderId: 'nonexistent-id', rating: 5 } },
    { label: 'UID যাচাই', path: '/api/uid/verify', ctx: 'cust', fields: ['productId', 'uid'], base: { productId: variant.productId, uid: '1234567890' } },
    { label: 'টিকিট', path: '/api/tickets', ctx: 'cust', fields: ['subject', 'body', 'orderId'], base: { subject: 'পরীক্ষা', body: 'বিষয়' } },
    { label: 'ট্র্যাক (পাবলিক)', path: '/api/track', ctx: 'anon', fields: ['orderNo', 'contact', 'token'], base: { orderNo: 999999, contact: '01700000000' } },
    { label: 'রেজিস্ট্রেশন (পাবলিক)', path: '/api/register', ctx: 'anon', fields: ['name', 'email', 'phone', 'password', 'code', 'ref'],
      base: { name: 'ফাজ', email: `fuzz${Date.now()}@verify.local`, phone: `017${String(Date.now()).slice(-8)}`, password: 'FuzzPass2026x' } },
    { label: 'পাসওয়ার্ড-ভুলে-গেছি (পাবলিক)', path: '/api/auth/forgot', ctx: 'anon', fields: ['email'], base: { email: 'someone@example.com' } },
    { label: 'অ্যাডমিন অর্ডার-অ্যাকশন', path: '/api/admin/order', ctx: 'admin', fields: ['orderId', 'action', 'failReason', 'adminNote'],
      base: { orderId: 'nonexistent-id', action: 'PROCESSING' } },
    { label: 'অ্যাডমিন ব্যালেন্স-সমন্বয়', path: '/api/admin/user', ctx: 'admin', fields: ['userId', 'amount', 'note'],
      base: { userId: 'nonexistent-id', amount: 10, note: 'পরীক্ষা' } },
  ];

  let requests = 0; let fiveXX = 0; let englishLeaks = 0; let internalLeaks = 0;
  const statusMix = new Map<number, number>();

  for (const t of targets) {
    const ctx = ctxOf[t.ctx];
    const bodies: Array<[string, unknown]> = [['খালি বডি', {}], ['অতিরিক্ত ফিল্ড', { ...t.base, __proto__: { polluted: true }, extraField: 'x' }]];
    for (const f of t.fields) for (const [vLabel, v] of VALUES) bodies.push([`${f}=${vLabel}`, { ...t.base, [f]: v }]);

    for (const [label, body] of bodies) {
      await db.rateLimitBucket.deleteMany({});
      const res = await ctx.post(`${BASE}${t.path}`, { data: body as Record<string, unknown>, failOnStatusCode: false, timeout: 30_000 }).catch(() => null);
      requests++;
      if (!res) { check(`${t.label} · ${label} — উত্তর এসেছে`, false, 'নেটওয়ার্ক ত্রুটি'); continue; }
      const status = res.status();
      statusMix.set(status, (statusMix.get(status) ?? 0) + 1);
      const text = (await res.text()).slice(0, 600);
      if (status >= 500) { fiveXX++; check(`${t.label} · ${label} — ৫xx নয়`, false, `HTTP ${status} ${text.slice(0, 80)}`); }
      if (INTERNAL_LEAK.test(text)) { internalLeaks++; check(`${t.label} · ${label} — ভেতরের তথ্য ফাঁস নয়`, false, text.slice(0, 100)); }
      if (status === 400 && ENGLISH_LEAK.test(text)) { englishLeaks++; check(`${t.label} · ${label} — বার্তা বাংলা`, false, text.slice(0, 100)); }
    }
  }

  console.log(`\n  মোট অনুরোধ: ${requests}`);
  console.log(`  স্ট্যাটাস-মিশ্রণ: ${[...statusMix.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}×${n}`).join(' · ')}`);
  check('কোনো ৫xx নেই', fiveXX === 0, `${fiveXX}টি`);
  check('ভেতরের তথ্য ফাঁস নেই', internalLeaks === 0, `${internalLeaks}টি`);
  check('ইংরেজি ভ্যালিডেশন-বার্তা নেই', englishLeaks === 0, `${englishLeaks}টি`);

  /* ── স্ট্যাটাস-কোডের অর্থ (Phase 33) ── */
  console.log('\n── স্ট্যাটাস-কোডের অর্থ ──');
  const cases: Array<[string, () => Promise<number>, number[]]> = [
    ['অস্তিত্বহীন অর্ডারে রিভিউ → ৪০৪', async () => (await cust.post(`${BASE}/api/review`, { data: { orderId: 'does-not-exist', rating: 5 }, failOnStatusCode: false })).status(), [404]],
    ['অস্তিত্বহীন টিকিট → ৪০৪', async () => (await cust.get(`${BASE}/api/tickets/does-not-exist`, { failOnStatusCode: false })).status(), [404]],
    ['ভুল মেথড (GET /api/order) → ৪০৫', async () => (await cust.get(`${BASE}/api/order`, { failOnStatusCode: false })).status(), [405]],
    ['লগইন ছাড়া → ৪০১', async () => (await anon.get(`${BASE}/api/me`, { failOnStatusCode: false })).status(), [401]],
    ['গ্রাহক অ্যাডমিন-রুটে → ৪০৩', async () => (await cust.get(`${BASE}/api/admin/readiness`, { failOnStatusCode: false })).status(), [403]],
    // ★ replay-সিদ্ধান্ত (২০২৬-০৯-৩০): একই গ্রাহক + একই অঙ্ক (PENDING) = ২০০ replay;
    //   ভিন্ন অঙ্ক = ৪০৯
    ['ডুপ্লিকেট TrxID, একই অঙ্ক → ২০০ replay', async () => {
      const trx = `DUP${Date.now()}`;
      await db.rateLimitBucket.deleteMany({});
      await cust.post(`${BASE}/api/deposit`, { data: { method: 'BKASH', amount: 500, trxId: trx, senderNo: '01712345678' }, failOnStatusCode: false });
      const second = await cust.post(`${BASE}/api/deposit`, { data: { method: 'BKASH', amount: 500, trxId: trx, senderNo: '01712345678' }, failOnStatusCode: false });
      const rows = await db.deposit.count({ where: { trxId: trx } });
      await db.deposit.deleteMany({ where: { trxId: trx } });
      return rows === 1 && (await second.json()).duplicate === true ? second.status() : -rows;
    }, [200]],
    ['ডুপ্লিকেট TrxID, ভিন্ন অঙ্ক → ৪০৯', async () => {
      const trx = `DUPA${Date.now()}`;
      await db.rateLimitBucket.deleteMany({});
      await cust.post(`${BASE}/api/deposit`, { data: { method: 'BKASH', amount: 500, trxId: trx, senderNo: '01712345678' }, failOnStatusCode: false });
      const second = await cust.post(`${BASE}/api/deposit`, { data: { method: 'BKASH', amount: 450, trxId: trx, senderNo: '01712345678' }, failOnStatusCode: false });
      await db.deposit.deleteMany({ where: { trxId: trx } });
      return second.status();
    }, [409]],
  ];
  for (const [label, fn, want] of cases) {
    const got = await fn();
    check(label, want.includes(got), `HTTP ${got}`);
  }

  await Promise.all([anon.dispose(), cust.dispose(), admin.dispose()]);
  await db.deposit.deleteMany({ where: { trxId: { startsWith: 'FUZZ' } } });
  await db.rateLimitBucket.deleteMany({});
  console.log(`\n════ ${pass} দাবি পাস · ${fails.length} ব্যর্থ ════`);
  if (fails.length) { console.log(fails.slice(0, 20).join('\n')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
