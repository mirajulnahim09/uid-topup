// ★ দৃশ্যমান পুনঃযাচাই — অ্যাডমিন সার্চ → নির্দিষ্ট অর্ডার → সম্পন্ন; ফুটার/সার্ভিস-কপি
//   কেবল সিম-রিগ ও সিম-DB (সিন্থেটিক গ্রাহক); ws.txt-এর headed Chrome-এ যুক্ত হয়।
import { db, BASE, mintCookie } from '../_lib';
import { chromium, type Page } from 'playwright-core';
import { readFileSync } from 'node:fs';

const PAUSE = Number(process.env.PAUSE || 1200);
let n = 50;
async function cap(p: Page, who: string, t: string) {
  console.log(`[${who}] ${t}`);
  await p.evaluate(`(() => { let el = document.getElementById('__qa_caption'); if (!el) { el = document.createElement('div'); el.id='__qa_caption';
    el.style.cssText='position:fixed;left:8px;bottom:84px;z-index:2147483647;background:#111;color:#c8ff3d;font:600 13px system-ui;padding:6px 10px;border-radius:8px;opacity:.92;pointer-events:none'; document.body.appendChild(el); }
    el.textContent = ${JSON.stringify(`${who} · ${t}`)}; })()`).catch(() => {});
  await p.waitForTimeout(PAUSE);
}
const settle = async (p: Page) => { await p.waitForLoadState('domcontentloaded').catch(() => {}); await p.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 20_000 }).catch(() => {}); await p.waitForTimeout(500); };
const shot = async (p: Page, name: string, full = false) => { const f = `audit/sim/visible/${++n}-${name}.png`; await p.screenshot({ path: f, fullPage: full }); console.log(`[SCREENSHOT] ${f}`); };

(async () => {
  const browser = await chromium.connect(readFileSync('ws.txt', 'utf8').trim(), { slowMo: 250 });
  await db.rateLimitBucket.deleteMany({});
  const cust = await db.user.findFirstOrThrow({ where: { email: { startsWith: 'visible-' } }, orderBy: { createdAt: 'desc' } });
  const ord = await db.order.findFirstOrThrow({ where: { userId: cust.id }, orderBy: { createdAt: 'desc' } });

  const actx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const [k, ...v] = (await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }))).split('=');
  await actx.addCookies([{ name: k, value: v.join('='), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const a = await actx.newPage();
  await a.goto(`${BASE}/admin/orders?status=PENDING`); await settle(a);
  await cap(a, 'VERIFY', `অ্যাডমিন সার্চে #${ord.orderNo}`);
  await a.locator('input[placeholder*="TrxID"]').first().fill(String(ord.orderNo));
  await a.waitForTimeout(1800);
  const hit = a.locator('[aria-label="সার্চ ফলাফল"] a').filter({ hasText: `#${ord.orderNo}` }).first();
  await shot(a, 'verify-search-hit');
  await hit.click();
  await a.waitForURL(/\/admin\/orders\?order=/, { timeout: 20_000 }); await settle(a);
  console.log(`[VERIFY] URL → ${new URL(a.url()).pathname}${new URL(a.url()).search}`);
  const rows = a.locator('tr').filter({ hasText: `#${ord.orderNo}` });
  console.log(`[VERIFY] টেবিলে এই অর্ডারের সারি: ${await rows.count()}`);
  await cap(a, 'VERIFY', 'কেবল এই অর্ডার, বোতামসহ'); await shot(a, 'verify-single-order');

  if (ord.status === 'PENDING' || ord.status === 'PROCESSING') {
    const row = rows.first();
    await row.getByRole('button', { name: /সম্পন্ন/ }).first().click();
    await a.waitForTimeout(900); await shot(a, 'verify-complete-dialog');
    const dlg = a.locator('[role="dialog"],[role="alertdialog"]').last();
    const txt = await dlg.innerText().catch(() => '');
    // ★ interlock — ডায়ালগে ঠিক এই অর্ডার নম্বর না থাকলে নিশ্চিত করা হয় না
    if (!txt.includes(String(ord.orderNo))) {
      console.log(`[VERIFY] ⚠️ ডায়ালগে #${ord.orderNo} নেই — নিশ্চিত করলাম না: "${txt.slice(0, 80)}"`);
    } else {
      await dlg.getByRole('button', { name: /সম্পন্ন|নিশ্চিত|হ্যাঁ/ }).last().click();
      await a.waitForTimeout(2200);
    }
  }
  const o2 = await db.order.findUniqueOrThrow({ where: { id: ord.id } });
  await cap(a, 'VERIFY', `অর্ডার এখন: ${o2.status}`); await shot(a, 'verify-after-complete');

  // ── গ্রাহক: হোম সার্ভিস-কার্ড ও ফুটার ──
  const cctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const c = await cctx.newPage();
  await c.goto(`${BASE}/`); await settle(c);
  const svc = c.getByText('প্রতিটি পেমেন্ট হাতে যাচাই').first();
  console.log(`[VERIFY] সার্ভিস-সারি নতুন লেখা দৃশ্যমান: ${await svc.isVisible().catch(() => false)}`);
  await svc.scrollIntoViewIfNeeded().catch(() => {});
  await cap(c, 'VERIFY', 'সার্ভিস-কার্ড'); await shot(c, 'verify-service-card');
  const foot = c.locator('footer').first();
  await foot.scrollIntoViewIfNeeded();
  const heads = await foot.locator('h2').allInnerTexts();
  console.log(`[VERIFY] ফুটার হেডিং: ${heads.join(' | ')}`);
  await cap(c, 'VERIFY', 'ফুটার'); await shot(c, 'verify-footer');
  await db.$disconnect(); process.exit(0);
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
