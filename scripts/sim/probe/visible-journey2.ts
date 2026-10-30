// ★ দৃশ্যমান যাত্রা, পর্ব ২ — অ্যাডমিন সতর্কতায় টিক দিয়ে অনুমোদন → গ্রাহক অর্ডার → অ্যাডমিন সম্পন্ন
import { db, BASE, mintCookie } from '../_lib';
import { chromium, type Page } from 'playwright-core';
import { readFileSync } from 'node:fs';

const PAUSE = Number(process.env.PAUSE || 1200);
let n = 30;
async function cap(p: Page, who: string, t: string) {
  console.log(`[${who}] ${t}`);
  await p.evaluate(`(() => { let el = document.getElementById('__qa_caption'); if (!el) { el = document.createElement('div'); el.id='__qa_caption';
    el.style.cssText='position:fixed;left:8px;bottom:84px;z-index:2147483647;background:#111;color:#c8ff3d;font:600 13px system-ui;padding:6px 10px;border-radius:8px;opacity:.92;pointer-events:none'; document.body.appendChild(el); }
    el.textContent = ${JSON.stringify(`${who} · ${t}`)}; })()`).catch(() => {});
  await p.waitForTimeout(PAUSE);
}
const settle = async (p: Page) => { await p.waitForLoadState('domcontentloaded').catch(() => {}); await p.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 20_000 }).catch(() => {}); await p.waitForTimeout(500); };
const shot = async (p: Page, name: string) => { const f = `audit/sim/visible/${++n}-${name}.png`; await p.screenshot({ path: f }); console.log(`[SCREENSHOT] ${f}`); };
async function asCookie(ctx: import('playwright-core').BrowserContext, cookie: string) {
  const [k, ...v] = cookie.split('='); await ctx.addCookies([{ name: k, value: v.join('='), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
}

(async () => {
  const browser = await chromium.connect(readFileSync('ws.txt', 'utf8').trim(), { slowMo: 250 });
  await db.rateLimitBucket.deleteMany({});
  const cust = await db.user.findFirstOrThrow({ where: { email: { startsWith: 'visible-' } }, orderBy: { createdAt: 'desc' } });
  const dep = await db.deposit.findFirstOrThrow({ where: { userId: cust.id }, orderBy: { createdAt: 'desc' } });
  const product = await db.product.findFirstOrThrow({ where: { isActive: true, needsUid: true }, include: { variants: { where: { isActive: true, stock: -1 }, orderBy: { price: 'asc' } } } });
  const variant = product.variants[3] ?? product.variants[0];

  // ── অ্যাডমিন: সতর্কতা দেখে টিক, তারপর অনুমোদন ──
  const actx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  await asCookie(actx, await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } })));
  const a = await actx.newPage();
  await a.goto(`${BASE}/admin/deposits`); await settle(a);
  // ★ ঠিক এই দাবির কার্ড — নম্বর-লেখা থেকে সবচেয়ে কাছের "অনুমোদন"-বোতামওয়ালা পূর্বপুরুষ
  //   (আগের `.last()` ভুল কার্ড ধরেছিল — #10005 অনুমোদিত হয়ে গিয়েছিল; সিম-ডেটা)
  const card = a.locator(`xpath=//*[contains(normalize-space(.), '#${dep.depositNo}') and not(*[contains(normalize-space(.), '#${dep.depositNo}')])]/ancestor::*[.//button[contains(., 'অনুমোদন')]][1]`);
  if ((await card.count()) !== 1) throw new Error(`কার্ড অনন্য নয় (${await card.count()}) — থামলাম`);
  await card.scrollIntoViewIfNeeded();
  await cap(a, 'ADMIN', `দাবি #${dep.depositNo} — সতর্কতাগুলো পড়ে টিক দিচ্ছি`);
  const boxes = card.locator('input[type="checkbox"]');
  for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).check().catch(() => {});
  await shot(a, 'admin-warnings-ticked');
  await cap(a, 'ADMIN', 'এবার অনুমোদন বোতাম');
  await card.getByRole('button', { name: /অনুমোদন/ }).first().click();
  await a.waitForTimeout(900); await shot(a, 'admin-approve-dialog');
  const dlg = a.locator('[role="dialog"],[role="alertdialog"]').last();
  // ★ interlock — ডায়ালগ ঠিক এই দাবির না হলে নিশ্চিত করা হয় না
  const dlgText = await dlg.innerText().catch(() => '');
  if (!dlgText.includes(`#${dep.depositNo}`)) throw new Error(`ডায়ালগ অন্য দাবির: "${dlgText.slice(0, 60)}" — নিশ্চিত করা হলো না`);
  await dlg.getByRole('button', { name: /হ্যাঁ, অনুমোদন/ }).click();
  await a.waitForTimeout(2000);
  const d2 = await db.deposit.findUniqueOrThrow({ where: { id: dep.id } });
  await cap(a, 'ADMIN', `ডিপোজিট এখন: ${d2.status}`); await shot(a, 'admin-after-approve');

  // ── গ্রাহক: অর্ডার ──
  const cctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 430, height: 900 }, isMobile: true, hasTouch: true });
  await asCookie(cctx, await mintCookie(cust));
  const c = await cctx.newPage();
  await c.goto(`${BASE}/account/wallet/deposit`); await settle(c);
  await cap(c, 'REAL CUSTOMER', 'টাকা যোগ হয়েছে কিনা দেখি'); await shot(c, 'customer-deposit-approved');
  await c.goto(`${BASE}/product/${product.id}/${encodeURIComponent(product.slug)}`); await settle(c);
  await c.locator('[role="radio"]').filter({ hasText: variant.label }).first().click();
  await c.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
  await cap(c, 'REAL CUSTOMER', `${variant.label} — UID লিখছি`);
  await c.fill('#uid', '1234567890'); await c.fill('#uid2', '1234567890');
  await shot(c, 'customer-ready-funded');
  await c.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().click();
  await c.waitForTimeout(900);
  await cap(c, 'REAL CUSTOMER', 'নিশ্চিতকরণ — সব ঠিক আছে কিনা পড়ছি'); await shot(c, 'customer-confirm-funded');
  await c.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first().click();
  await c.waitForTimeout(3000);
  await cap(c, 'REAL CUSTOMER', 'অর্ডার হয়ে গেছে?'); await shot(c, 'customer-order-placed');

  // ── অ্যাডমিন: অর্ডার সম্পন্ন ──
  const ord = await db.order.findFirstOrThrow({ where: { userId: cust.id }, orderBy: { createdAt: 'desc' } });
  await a.bringToFront();
  await a.goto(`${BASE}/admin/orders?status=PENDING`); await settle(a);
  await cap(a, 'ADMIN', `অর্ডার #${ord.orderNo} — উপরের সার্চে খুঁজি`);
  await a.locator('input[placeholder*="TrxID"]').first().fill(String(ord.orderNo));
  await a.waitForTimeout(1800); await shot(a, 'admin-search-order-found');
  await a.keyboard.press('Escape').catch(() => {});
  const row = a.locator('tr').filter({ hasText: `#${ord.orderNo}` }).first();
  if (await row.count()) {
    await row.scrollIntoViewIfNeeded();
    await cap(a, 'ADMIN', 'সারিতে "সম্পন্ন" বোতাম');
    await row.getByRole('button', { name: /সম্পন্ন/ }).first().click();
    await a.waitForTimeout(900); await shot(a, 'admin-complete-dialog');
    await a.locator('[role="dialog"],[role="alertdialog"]').last().getByRole('button', { name: /সম্পন্ন|নিশ্চিত|হ্যাঁ/ }).last().click().catch(() => {});
    await a.waitForTimeout(2000);
  } else console.log(`[ADMIN] ⚠️ #${ord.orderNo} প্রথম ১০০-র মধ্যে নেই (কিউ পুরনো-আগে) — সার্চ থেকেই খুলতে হবে`);
  const o2 = await db.order.findUniqueOrThrow({ where: { id: ord.id } });
  await cap(a, 'ADMIN', `অর্ডার এখন: ${o2.status}`);

  await c.bringToFront();
  await c.goto(`${BASE}/account/orders/${ord.id}`); await settle(c);
  await cap(c, 'REAL CUSTOMER', 'গ্রাহক অবস্থা দেখছেন'); await shot(c, 'customer-order-status');
  console.log('[DONE]');
  await db.$disconnect(); process.exit(0);
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
