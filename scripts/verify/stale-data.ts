/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ বাসি ডাটা — অ্যাডমিনের পরিবর্তন গ্রাহকের কাছে কখন পৌঁছায়
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   ক. পেমেন্ট নাম্বার বদল → প্রোডাক্ট পাতা (ISR, revalidate 60) ও
 *      ডিপোজিট পাতা (dynamic) কখন নতুন নাম্বার দেখায়। ভুল নাম্বার
 *      দেখানো মানে গ্রাহকের টাকা ভুল জায়গায় যাওয়া।
 *   খ. অর্ডার সম্পন্ন করা → খোলা অর্ডার-পাতা রিলোড ছাড়া কখন বদলায়।
 *   গ. প্যাকেজ বন্ধ → পুরনো পাতা থেকে অর্ডার দিলে সার্ভার স্পষ্ট বার্তায় থামায়।
 *
 *   শেষে সব আগের অবস্থায় ফেরে (নাম্বার, প্যাকেজ-অবস্থা)।
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/stale-data.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import { request, type APIRequestContext } from 'playwright-core';

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };
const results: Array<{ ok: boolean; line: string }> = [];
const ev = (page: string, role: string, action: string, expected: string, actual: string, ok: boolean) => {
  const line = `PAGE: ${page} | VIEWPORT: API | ROLE: ${role} | ACTION: ${action} | EXPECTED: ${expected} | ACTUAL: ${actual} | RESULT: ${ok ? 'PASS' : 'FAIL'}`;
  results.push({ ok, line });
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiLogin(ctx: APIRequestContext, who: { email: string; password: string }) {
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: who.email, password: who.password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  const me = await (await ctx.get(`${BASE}/api/auth/session`)).json();
  if (me?.user?.email !== who.email) throw new Error(`লগইন হয়নি: ${who.email}`);
}

async function main() {
  console.log(`ডাটাবেস: ${dbLabel()} · সার্ভার: ${BASE}`);
  const admin = await request.newContext({ ignoreHTTPSErrors: true });
  const customer = await request.newContext({ ignoreHTTPSErrors: true });
  const anon = await request.newContext({ ignoreHTTPSErrors: true });
  await apiLogin(admin, ADMIN);
  await apiLogin(customer, CUSTOMER);

  const product = await db.product.findFirst({
    where: { isActive: true, needsUid: true, variants: { some: { isActive: true, stock: -1 } } },
    include: { variants: { where: { isActive: true, stock: -1 }, orderBy: { price: 'asc' }, take: 1 } },
  });
  if (!product) throw new Error('সক্রিয় প্রোডাক্ট নেই');
  const productPath = `/product/${product.id}/${encodeURIComponent(product.slug)}`;
  const html = async (ctx: APIRequestContext, p: string) => (await ctx.get(`${BASE}${p}`, { failOnStatusCode: false })).text();

  // ── ক. পেমেন্ট নাম্বার ──
  console.log('\n── ক. পেমেন্ট নাম্বার বদল ──');
  const channel = await db.paymentChannel.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  if (!channel) throw new Error('সক্রিয় পেমেন্ট চ্যানেল নেই');
  const ORIG = channel.accountNo;
  const NEW = ORIG === '01799999998' ? '01799999997' : '01799999998';
  try {
    await html(anon, productPath); await sleep(500);
    const primed = await html(anon, productPath);
    ev(productPath, 'অতিথি', 'পাতা খোলা (ক্যাশ গরম)', 'বর্তমান নাম্বার দেখায়', primed.includes(ORIG) ? 'বর্তমান নাম্বার আছে' : 'নেই', primed.includes(ORIG));

    const patch = await admin.patch(`${BASE}/api/admin/payment`, { data: { id: channel.id, accountNo: NEW }, failOnStatusCode: false });
    const t0 = Date.now();
    ev('/api/admin/payment', 'অ্যাডমিন', 'নাম্বার বদল (PATCH)', '200', String(patch.status()), patch.status() === 200);

    const dep = await html(customer, '/account/wallet/deposit');
    ev('/account/wallet/deposit', 'গ্রাহক', 'বদলের সাথে সাথে খোলা', 'নতুন নাম্বার', dep.includes(NEW) ? 'নতুন নাম্বার' : dep.includes(ORIG) ? 'পুরনো নাম্বার' : 'কোনোটিই নয়', dep.includes(NEW) && !dep.includes(ORIG));

    const first = await html(anon, productPath);
    const staleNow = first.includes(ORIG) && !first.includes(NEW);
    ev(productPath, 'অতিথি', 'বদলের সাথে সাথে খোলা', 'নতুন নাম্বার', staleNow ? 'পুরনো নাম্বার (বাসি ক্যাশ)' : first.includes(NEW) ? 'নতুন নাম্বার' : 'কোনোটিই নয়', !staleNow && first.includes(NEW));

    let freshAt = -1;
    if (staleNow) {
      for (let i = 0; i < 40; i++) {
        await sleep(5000);
        const h = await html(anon, productPath);
        if (h.includes(NEW) && !h.includes(ORIG)) { freshAt = Math.round((Date.now() - t0) / 1000); break; }
      }
      console.log(`    ↳ প্রোডাক্ট পাতায় নতুন নাম্বার এল: ${freshAt < 0 ? '২০০ সেকেন্ডেও নয়' : `${freshAt} সেকেন্ড পর`}`);
    }
  } finally {
    const back = await admin.patch(`${BASE}/api/admin/payment`, { data: { id: channel.id, accountNo: ORIG }, failOnStatusCode: false });
    const row = await db.paymentChannel.findUnique({ where: { id: channel.id } });
    console.log(`    ↳ নাম্বার ফেরত: ${back.status()} · DB-তে আসল নাম্বার: ${row?.accountNo === ORIG}`);
  }

  // ── খ. অর্ডার সম্পন্ন → খোলা পাতা ──
  console.log('\n── খ. অর্ডার-অবস্থা রিলোড ছাড়া ──');
  const variant = product.variants[0];
  await db.rateLimitBucket.deleteMany({});
  const placed = await customer.post(`${BASE}/api/order`, {
    data: { variantId: variant.id, playerUid: '123456789', clientRef: `stale-${Date.now()}` }, failOnStatusCode: false,
  });
  const { orderId } = await placed.json();
  ev('/api/order', 'গ্রাহক', 'ওয়ালেট অর্ডার', '200', String(placed.status()), placed.status() === 200 && Boolean(orderId));

  const browser = await openBrowser({ headless: true });
  const bctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  await apiLogin(bctx.request, CUSTOMER);
  const page = await bctx.newPage();
  await page.goto(`${BASE}/account/orders/${orderId}`, { waitUntil: 'load' });
  await page.waitForSelector('#v-boot', { state: 'detached', timeout: 30_000 }).catch(() => {});
  const badge = (label: string, cls: string) => page.evaluate(([l, c]) =>
    [...document.querySelectorAll('span,div')].some((e) => e.className?.toString().includes(c) && e.textContent?.trim() === l), [label, cls]);
  ev(`/account/orders/${orderId}`, 'গ্রাহক (390x844)', 'পাতা খোলা', 'পেন্ডিং ব্যাজ', (await badge('পেন্ডিং', 'bg-amber-100')) ? 'পেন্ডিং' : 'অন্য', await badge('পেন্ডিং', 'bg-amber-100'));

  const done = await admin.post(`${BASE}/api/admin/order`, { data: { orderId, action: 'COMPLETE' }, failOnStatusCode: false });
  const t1 = Date.now();
  ev('/api/admin/order', 'অ্যাডমিন', 'অর্ডার সম্পন্ন', '200', String(done.status()), done.status() === 200);
  let seenAt = -1;
  for (let i = 0; i < 90; i++) {
    if (await badge('সম্পন্ন', 'bg-emerald-100')) { seenAt = Math.round((Date.now() - t1) / 1000); break; }
    await sleep(1000);
  }
  ev(`/account/orders/${orderId}`, 'গ্রাহক (390x844)', 'রিলোড ছাড়া অপেক্ষা', 'সম্পন্ন ব্যাজ ≤ ৩৫s (AutoRefresh ৩০s)', seenAt < 0 ? '৯০s-এও নয়' : `${seenAt}s পর সম্পন্ন`, seenAt >= 0 && seenAt <= 35);
  await browser.close();

  // ── গ. বন্ধ প্যাকেজে পুরনো পাতা থেকে অর্ডার ──
  console.log('\n── গ. বন্ধ প্যাকেজ ──');
  try {
    const off = await admin.patch(`${BASE}/api/admin/variant`, { data: { id: variant.id, isActive: false }, failOnStatusCode: false });
    ev('/api/admin/variant', 'অ্যাডমিন', 'প্যাকেজ বন্ধ', '200', String(off.status()), off.status() === 200);
    await db.rateLimitBucket.deleteMany({});
    const r = await customer.post(`${BASE}/api/order`, { data: { variantId: variant.id, playerUid: '123456789', clientRef: `stale-off-${Date.now()}` }, failOnStatusCode: false });
    const body = await r.json().catch(() => ({}));
    ev('/api/order', 'গ্রাহক', 'বন্ধ প্যাকেজে অর্ডার', '400 + বাংলা বার্তা, টাকা কাটে না', `${r.status()} ${body.error ?? ''}`, r.status() === 400 && /পাওয়া যাচ্ছে না/.test(body.error ?? ''));
  } finally {
    const on = await admin.patch(`${BASE}/api/admin/variant`, { data: { id: variant.id, isActive: true }, failOnStatusCode: false });
    console.log(`    ↳ প্যাকেজ আবার চালু: ${on.status()}`);
  }

  await Promise.all([admin.dispose(), customer.dispose(), anon.dispose()]);
  await db.rateLimitBucket.deleteMany({});
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nফল: ${results.length - failed}/${results.length} PASS`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
