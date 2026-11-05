// ★ দৃশ্যমান (headed) গ্রাহক → অ্যাডমিন → গ্রাহক যাত্রা — মালিক জানালায় দেখেন।
//   কেবল সিম-রিগ ও সিম-DB (সিন্থেটিক গ্রাহক/টাকা); ws.txt-এর headed Chrome-এ যুক্ত হয়।
import { db, BASE, mintCookie } from '../_lib';
import { chromium, type Page } from 'playwright-core';
import bcrypt from 'bcryptjs';
import { readFileSync, mkdirSync } from 'node:fs';

const STEP_PAUSE = Number(process.env.PAUSE || 1200);
const SHOTS = 'audit/sim/visible';
mkdirSync(SHOTS, { recursive: true });
let shotN = 0;

async function caption(p: Page, who: string, text: string) {
  console.log(`[${who}] ${text}`);
  // ★ জানালার কোণে ছোট লেবেল — দর্শক বোঝেন এখন কী হচ্ছে (কেবল এই ট্যাবে, অ্যাপে কোনো বদল নয়)
  await p.evaluate(`(() => {
    let el = document.getElementById('__qa_caption');
    if (!el) { el = document.createElement('div'); el.id = '__qa_caption';
      el.style.cssText = 'position:fixed;left:8px;bottom:84px;z-index:2147483647;background:#111;color:#c8ff3d;font:600 13px system-ui;padding:6px 10px;border-radius:8px;opacity:.92;pointer-events:none;max-width:90vw';
      document.body.appendChild(el); }
    el.textContent = ${JSON.stringify(`${who} · ${text}`)};
  })()`).catch(() => {});
  await p.waitForTimeout(STEP_PAUSE);
}
async function settle(p: Page) {
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 20_000 }).catch(() => {});
  await p.waitForTimeout(500);
}
async function shot(p: Page, name: string) {
  const f = `${SHOTS}/${String(++shotN).padStart(2, '0')}-${name}.png`;
  await p.screenshot({ path: f });
  console.log(`[SCREENSHOT] ${f}`);
}

(async () => {
  const ws = readFileSync('ws.txt', 'utf8').trim();
  const browser = await chromium.connect(ws, { slowMo: 250 });
  await db.rateLimitBucket.deleteMany({});

  const email = `visible-${Date.now().toString(36)}@sim.invalid`;
  const PASSWORD = 'Visible#Customer2026';
  await db.user.create({ data: {
    name: 'Rakib (সিম গ্রাহক)', email, phone: `013${String(Date.now()).slice(-8)}`,
    password: await bcrypt.hash(PASSWORD, 10), referralCode: `VIS${Date.now().toString(36)}`.toUpperCase(), emailVerified: true,
  } });
  const product = await db.product.findFirstOrThrow({ where: { isActive: true, needsUid: true }, include: { variants: { where: { isActive: true, stock: -1 }, orderBy: { price: 'asc' } } } });
  const variant = product.variants[3] ?? product.variants[0];

  // ════════ গ্রাহক, পর্ব ১ ════════
  const cctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 430, height: 900 }, isMobile: true, hasTouch: true });
  const c = await cctx.newPage();
  await c.goto(`${BASE}/`); await settle(c);
  await caption(c, 'REAL CUSTOMER', 'হোমপেজ — প্রথম দেখা'); await shot(c, 'customer-home');
  await c.mouse.wheel(0, 900); await c.waitForTimeout(900); await c.mouse.wheel(0, -900);

  await caption(c, 'REAL CUSTOMER', 'লগইন');
  await c.goto(`${BASE}/login`); await settle(c);
  await c.locator('input[type="email"]').fill(email);
  await c.locator('input[type="password"]').fill(PASSWORD);
  await c.locator('button[type="submit"]').click();
  await c.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {}); await settle(c);

  await caption(c, 'REAL CUSTOMER', 'Homepage → Product selection');
  await c.goto(`${BASE}/product/${product.id}/${encodeURIComponent(product.slug)}`); await settle(c);
  await shot(c, 'customer-product');
  await c.locator('[role="radio"]').filter({ hasText: variant.label }).first().click().catch(() => {});
  await caption(c, 'REAL CUSTOMER', `প্যাকেজ বাছলাম: ${variant.label}`);
  await c.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
  await c.waitForTimeout(600);
  await caption(c, 'REAL CUSTOMER', 'ব্যালেন্স ০ — কী বলছে দেখি'); await shot(c, 'customer-zero-balance');

  await caption(c, 'REAL CUSTOMER', 'Add Money-তে যাই');
  await c.goto(`${BASE}/account/wallet/deposit`); await settle(c);
  await shot(c, 'customer-deposit');
  const trx = `VIS${Date.now().toString(36).toUpperCase()}`;
  await c.locator('input[placeholder*="যত টাকা"]').first().fill(String(Math.ceil(Number(variant.price) + 20)));
  await caption(c, 'REAL CUSTOMER', 'টাকার অঙ্ক, TrxID, নাম্বার লিখছি');
  await c.locator('input[placeholder*="9A7B"]').first().fill(trx);
  await c.locator('input[placeholder^="01X"]').first().fill('01711111111');
  await shot(c, 'customer-deposit-filled');
  await c.locator('button[type="submit"]').last().click();
  await c.waitForTimeout(2500);
  await caption(c, 'REAL CUSTOMER', 'রিকোয়েস্ট পাঠালাম — এখন কী দেখায়?'); await shot(c, 'customer-deposit-submitted');

  // ════════ অ্যাডমিন ════════
  const actx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const [k, ...v] = (await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }))).split('=');
  await actx.addCookies([{ name: k, value: v.join('='), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const a = await actx.newPage();
  await a.goto(`${BASE}/admin`); await settle(a);
  await caption(a, 'ADMIN', 'ড্যাশবোর্ড'); await shot(a, 'admin-dashboard');
  await a.goto(`${BASE}/admin/deposits`); await settle(a);
  await caption(a, 'ADMIN', 'ডিপোজিট কিউ — TrxID দিয়ে খুঁজি');
  await a.locator('input[placeholder*="TrxID"]').first().fill(trx).catch(() => {});
  await a.waitForTimeout(1500);
  await shot(a, 'admin-search-trx');
  await a.keyboard.press('Escape').catch(() => {});
  const dep = await db.deposit.findFirst({ where: { trxId: trx } });
  await caption(a, 'ADMIN', dep ? `দাবি #${dep.depositNo} — অনুমোদন (UI বোতাম)` : 'দাবি পাওয়া যায়নি!');
  // ★ কার্ডে TrxID লেখা আছে এমন সারির "অনুমোদন" বোতাম
  const card = a.locator('div,li,tr').filter({ hasText: trx }).last();
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await shot(a, 'admin-deposit-card');
  const approveBtn = card.getByRole('button', { name: /অনুমোদন|Approve/ }).first();
  if (await approveBtn.count()) {
    await approveBtn.click();
    await a.waitForTimeout(800);
    await shot(a, 'admin-approve-confirm');
    await a.getByRole('button', { name: /অনুমোদন|নিশ্চিত|হ্যাঁ/ }).last().click().catch(() => {});
    await a.waitForTimeout(2000);
  } else console.log('[ADMIN] ⚠️ কার্ডে অনুমোদন-বোতাম পাওয়া গেল না — স্ক্রিনশট দেখুন');
  const after = dep ? await db.deposit.findUnique({ where: { id: dep.id } }) : null;
  await caption(a, 'ADMIN', `ডিপোজিটের অবস্থা: ${after?.status}`);

  // ════════ গ্রাহক, পর্ব ২ ════════
  await c.bringToFront();
  await c.goto(`${BASE}/product/${product.id}/${encodeURIComponent(product.slug)}`); await settle(c);
  await caption(c, 'REAL CUSTOMER', 'টাকা যোগ হয়েছে কি? আবার প্রোডাক্টে');
  await c.locator('[role="radio"]').filter({ hasText: variant.label }).first().click().catch(() => {});
  await c.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
  await caption(c, 'REAL CUSTOMER', 'UID দুবার লিখছি');
  await c.fill('#uid', '1234567890').catch(() => {});
  await c.fill('#uid2', '1234567890').catch(() => {});
  await shot(c, 'customer-ready');
  await c.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().click().catch(() => {});
  await c.waitForTimeout(900);
  await caption(c, 'REAL CUSTOMER', 'Checkout → নিশ্চিতকরণ ডায়ালগ'); await shot(c, 'customer-confirm');
  await c.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first().click().catch(() => {});
  await c.waitForTimeout(3000);
  await caption(c, 'REAL CUSTOMER', 'অর্ডারের পরে কী দেখায়'); await shot(c, 'customer-order-result');

  await c.goto(`${BASE}/account/orders`); await settle(c);
  await caption(c, 'REAL CUSTOMER', 'আমার অর্ডার'); await shot(c, 'customer-orders');
  await c.goto(`${BASE}/account`); await settle(c);
  await caption(c, 'REAL CUSTOMER', 'প্রোফাইল ও লেনদেন'); await shot(c, 'customer-account');
  await c.goto(`${BASE}/contact`); await settle(c);
  await caption(c, 'REAL CUSTOMER', 'সাপোর্ট/যোগাযোগ কোথায়?'); await shot(c, 'customer-contact');

  // ════════ অ্যাডমিন: অর্ডার সম্পন্ন ════════
  await a.bringToFront();
  const ord = await db.order.findFirst({ where: { user: { email } }, orderBy: { createdAt: 'desc' } });
  await a.goto(`${BASE}/admin/orders?status=PENDING`); await settle(a);
  await caption(a, 'ADMIN', `অর্ডার-কিউ — #${ord?.orderNo ?? '?'} খুঁজি`);
  await a.locator('input[placeholder*="TrxID"]').first().fill(String(ord?.orderNo ?? '')).catch(() => {});
  await a.waitForTimeout(1500); await shot(a, 'admin-search-order');
  await a.keyboard.press('Escape').catch(() => {});
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  await a.goto(`${BASE}/admin/users/${u.id}`); await settle(a);
  await caption(a, 'ADMIN', 'গ্রাহকের বিস্তারিত — টাকা কোথায় গেল'); await shot(a, 'admin-customer');
  await a.goto(`${BASE}/admin/logs`); await settle(a);
  await caption(a, 'ADMIN', 'অডিট-লগ'); await shot(a, 'admin-logs');

  await c.bringToFront();
  await caption(c, 'REAL CUSTOMER', 'লগআউট');
  await c.goto(`${BASE}/account`); await settle(c);
  await c.getByRole('button', { name: /লগআউট/ }).first().click().catch(() => {});
  await c.waitForTimeout(2000);
  await caption(c, 'REAL CUSTOMER', 'যাত্রা শেষ'); await shot(c, 'customer-logged-out');
  console.log('[DONE] জানালা খোলা থাকছে — পরের ধাপে পুনর্ব্যবহার হবে');
  await db.$disconnect();
  process.exit(0);
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
