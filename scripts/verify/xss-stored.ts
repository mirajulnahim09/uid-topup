/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Stored/Reflected XSS — আসল ব্রাউজারে (EXTREME অডিট, ২০২৬-০৯-১৮)
 *
 *   নিরীহ পেলোড: `<img src=x onerror="window.__xss=(window.__xss||0)+1">` ও
 *   `<script>window.__xss=...</script>` — কোনো বাইরের কল নয়, শুধু গণনা।
 *   পাতা লোডের পরে `window.__xss` দেখা হয়: > 0 মানে কোড চলেছে (FAIL)।
 *
 *   যেসব ইনপুট-পথ পরীক্ষা করা হয়:
 *     · প্রোডাক্টের নাম ও বিবরণ (অ্যাডমিন → স্টোরফ্রন্ট, দুই পাতা)
 *     · ভ্যারিয়েন্টের লেবেল
 *     · গ্রাহকের রিভিউ (বডি) — পাবলিক প্রোডাক্ট পাতায়
 *     · গ্রাহকের নাম — অ্যাডমিনের গ্রাহক-তালিকা ও অর্ডার-তালিকায়
 *     · অর্ডারের playerUid ও অ্যাডমিন-নোট — অর্ডার-বিস্তারিত (দুই দিকে)
 *     · সার্চ-কোয়েরি (reflected) — `/search?q=`
 *     · টেলিগ্রাম টেমপ্লেট-প্রিভিউ (অ্যাডমিন → অ্যাডমিন)
 *
 *   সব পরীক্ষামূলক সারি শেষে মুছে ফেলা হয় (কেবল স্থানীয় ডেভ DB)।
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/xss-stored.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import { creditWallet } from '../../src/lib/services/wallet';
import { request, type Page, type BrowserContext } from 'playwright-core';
import bcrypt from 'bcryptjs';

const TAG = `xss${Date.now().toString(36)}`;
const PASSWORD = 'XssProbe2026Pass';
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
/** নিরীহ — শুধু কাউন্টার বাড়ায়, কোনো নেটওয়ার্ক কল নয় */
const PAYLOAD = `<img src=x onerror="window.__xss=(window.__xss||0)+1"><script>window.__xss=(window.__xss||0)+1</script>`;
/**
 * ★ ছোট সংস্করণ — `playerName` স্কিমায় `max(80)`, তাই পূর্ণ PAYLOAD (৯২ অক্ষর)
 *   পাঠালে সার্ভার **সঠিকভাবেই** 400 দেয় এবং XSS দাবিটি আর পরীক্ষাই হয় না।
 *   এটি ৫১ অক্ষর, উদ্ধৃতি-চিহ্ন ছাড়া — সমান কার্যকর ইনজেকশন ভেক্টর।
 */
const PAYLOAD_SHORT = `<img src=x onerror=window.__xss=(window.__xss||0)+1>`;

let pass = 0; const fails: string[] = [];
function check(name: string, ok: boolean, note = '') {
  if (ok) pass++; else fails.push(`${name} — ${note}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function xssCount(page: Page, path: string): Promise<{ count: number; status: number; textHasPayload: boolean }> {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
  await page.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(900);
  const count = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? 0);
  const text = await page.locator('body').innerText().catch(() => '');
  return { count, status: res?.status() ?? 0, textHasPayload: /onerror|<script/i.test(text) };
}

async function loginCtx(ctx: BrowserContext, email: string, password: string) {
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email, password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
}

async function main() {
  console.log(`═══ Stored/Reflected XSS · ${BASE} · DB ${dbLabel()} ═══`);
  const category = await db.category.findFirstOrThrow({ where: { isActive: true } });

  // ── পেলোডসহ ক্যাটালগ সারি (অ্যাডমিন যা লিখতে পারেন) ──
  const product = await db.product.create({
    data: {
      categoryId: category.id, name: `${TAG} ${PAYLOAD}`, slug: `${TAG}-xss`,
      description: `বিবরণ ${PAYLOAD}`, isActive: true, needsUid: true, uidLabel: 'Player UID', sortOrder: 999,
    },
  });
  const variant = await db.variant.create({
    data: { productId: product.id, label: `প্যাকেজ ${PAYLOAD}`, price: 25, costPrice: 10, stock: -1, isActive: true },
  });

  // ── পেলোডসহ গ্রাহক ──
  const user = await db.user.create({
    data: {
      name: `গ্রাহক ${PAYLOAD}`, email: `${TAG}@verify.local`, phone: `013${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(PASSWORD, 10), emailVerified: true, referralCode: TAG.toUpperCase().slice(0, 12),
    },
  });
  await db.$transaction((tx) => creditWallet({ tx, userId: user.id, amount: 500, type: 'ADMIN_ADJUST', note: 'XSS প্রোব' }));

  const api = await request.newContext({ ignoreHTTPSErrors: true });
  const browser = await openBrowser({ headless: true });
  const custCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const admCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  await loginCtx(custCtx, user.email, PASSWORD);
  await loginCtx(admCtx, ADMIN.email, ADMIN.password);
  const custPage = await custCtx.newPage();
  const admPage = await admCtx.newPage();

  try {
    // ── গ্রাহকের অর্ডার (playerUid নিরাপদ regex, তাই নাম/নোট দিয়ে পরীক্ষা) ──
    await db.rateLimitBucket.deleteMany({});
    const orderRes = await custCtx.request.post(`${BASE}/api/order`, {
      data: { variantId: variant.id, playerUid: '1234567890', playerName: `নাম ${PAYLOAD_SHORT}`, clientRef: `${TAG}-o1` },
      failOnStatusCode: false,
    });
    const orderId = (await orderRes.json().catch(() => ({})))?.orderId as string | undefined;
    check('অর্ডার তৈরি (পেলোডসহ playerName)', orderRes.status() === 200 && Boolean(orderId), `HTTP ${orderRes.status()}`);

    if (orderId) {
      await admCtx.request.post(`${BASE}/api/admin/order`, {
        data: { orderId, action: 'COMPLETE', adminNote: `অ্যাডমিন নোট ${PAYLOAD}` }, failOnStatusCode: false,
      });
      // রিভিউ — গ্রাহকের লেখা, পাবলিক পাতায় দেখা যায়
      await custCtx.request.post(`${BASE}/api/order/confirm`, { data: { orderId, arrived: true }, failOnStatusCode: false });
      const rev = await custCtx.request.post(`${BASE}/api/review`, {
        data: { orderId, rating: 5, body: `দারুণ ${PAYLOAD}` }, failOnStatusCode: false,
      });
      check('রিভিউ জমা (পেলোডসহ)', rev.status() === 200, `HTTP ${rev.status()}`);
      // রিভিউ ডিফল্টে প্রকাশিত; নিশ্চিত করতে স্পষ্ট করে বসাই
      await db.review.updateMany({ where: { orderId }, data: { isPublished: true } }).catch(() => {});
    }

    const productPath = `/product/${product.id}/${encodeURIComponent(product.slug)}`;
    const cases: Array<[string, Page, string]> = [
      ['পাবলিক প্রোডাক্ট পাতা (নাম/বিবরণ/ভ্যারিয়েন্ট/রিভিউ)', custPage, productPath],
      ['হোমপেজ (ক্যাটালগ কার্ড)', custPage, '/'],
      ['সার্চ — reflected', custPage, `/search?q=${encodeURIComponent(PAYLOAD)}`],
      ['গ্রাহকের অর্ডার-তালিকা', custPage, '/account/orders'],
      ['অ্যাডমিন — গ্রাহক তালিকা', admPage, '/admin/users'],
      ['অ্যাডমিন — অর্ডার তালিকা', admPage, '/admin/orders'],
      ['অ্যাডমিন — প্রোডাক্ট ব্যবস্থাপনা', admPage, '/admin/products'],
      ['অ্যাডমিন — অ্যাক্টিভিটি লগ', admPage, '/admin/logs'],
    ];
    if (orderId) cases.push(['গ্রাহকের অর্ডার-বিস্তারিত', custPage, `/account/orders/${orderId}`]);

    console.log('\n── পেলোড রেন্ডার হয় কি না ──');
    for (const [label, page, path] of cases) {
      const r = await xssCount(page, path);
      check(`${label} — স্ক্রিপ্ট চলেনি`, r.count === 0, `__xss=${r.count} · HTTP ${r.status}`);
      if (r.textHasPayload) console.log(`    ↳ (পেলোড **টেক্সট হিসেবে** দেখা যাচ্ছে — এটাই কাম্য)`);
    }

    /* ── টেলিগ্রাম টেমপ্লেট-প্রিভিউ (অ্যাডমিন → অ্যাডমিন) ── */
    console.log('\n── টেলিগ্রাম টেমপ্লেট প্রিভিউ ──');
    const tpl = await admCtx.request.get(`${BASE}/api/admin/telegram/templates`, { failOnStatusCode: false });
    const tplJson = await tpl.json().catch(() => ({}));
    const firstKey = tplJson?.templates?.[0]?.key as string | undefined;
    const originalBody = tplJson?.templates?.[0]?.body as string | undefined;
    if (firstKey) {
      const save = await admCtx.request.post(`${BASE}/api/admin/telegram/templates`, {
        data: { action: 'save', key: firstKey, body: `পরীক্ষা ${PAYLOAD}` }, failOnStatusCode: false,
      });
      const r = await xssCount(admPage, '/admin/telegram');
      check('টেমপ্লেট-প্রিভিউতে স্ক্রিপ্ট চলেনি', r.count === 0, `__xss=${r.count} · save ${save.status()}`);
      // আগের বডি ফেরত
      if (originalBody) {
        await admCtx.request.post(`${BASE}/api/admin/telegram/templates`, {
          data: { action: 'save', key: firstKey, body: originalBody }, failOnStatusCode: false,
        });
      } else {
        await admCtx.request.post(`${BASE}/api/admin/telegram/templates`, { data: { action: 'reset', key: firstKey }, failOnStatusCode: false });
      }
    } else {
      console.log('  (টেমপ্লেট তালিকা পাওয়া যায়নি — NOT VERIFIED)');
    }
  } finally {
    await browser.close();
    await api.dispose();
    // পরিষ্কার
    const orders = await db.order.findMany({ where: { userId: user.id }, select: { id: true } });
    await db.review.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await db.orderEvent.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await db.notification.deleteMany({ where: { userId: user.id } });
    await db.adminLog.deleteMany({ where: { OR: [{ adminId: user.id }, { targetId: user.id }] } });
    await db.ledgerEntry.deleteMany({ where: { userId: user.id } });
    await db.order.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    await db.variant.deleteMany({ where: { productId: product.id } });
    await db.product.delete({ where: { id: product.id } }).catch(() => {});
    await db.rateLimitBucket.deleteMany({});
  }

  console.log(`\n════ ${pass} পাস · ${fails.length} ব্যর্থ ════`);
  if (fails.length) { console.log(fails.join('\n')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
