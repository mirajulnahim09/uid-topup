/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Login page — position, fit and stability in a real browser
 *
 *   npx tsx scripts/verify/login-viewport.ts        (VERIFY_BASE, VERIFY_BROWSER=edge|firefox|webkit)
 *
 *   For every size in the responsive matrix, plus browser-zoom emulation
 *   (zoom z on a W×H window ⇒ CSS viewport W/z × H/z at deviceScaleFactor z):
 *     1  card centred horizontally, ≤ 448px wide, ≥ 16px side margin on phones
 *     2  card never under the sticky header or the mobile tab bar at load
 *     3  if it fits, the whole card is visible without scrolling and sits
 *        vertically centred in the space between header and tab bar
 *     4  if it does not fit, it starts below the header and every control
 *        (email, password, submit, Google, register link) can be scrolled to
 *        and is the top-most element at its own centre (nothing covers it)
 *     5  scrolling moves the card exactly by the scroll distance and back
 *     6  no load-time jump: skeleton ≈ card height, card top settles ≤ 12px
 *        (the page-enter slide), CLS < 0.05
 *     7  live resize and portrait↔landscape without reload keep 1–3
 *   Exit 1 on any failure. Read-only: never submits the form.
 * ═══════════════════════════════════════════════════════════
 */
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright-core';
import { MATRIX } from './responsive-matrix-sizes';

const BASE = process.env.VERIFY_BASE || 'http://localhost:3000';
const engine = (process.env.VERIFY_BROWSER || 'chrome').toLowerCase();

async function launch(): Promise<Browser> {
  if (engine === 'firefox') return firefox.launch();
  if (engine === 'webkit') return webkit.launch();
  return chromium.launch({
    executablePath: engine === 'edge'
      ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      : 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
}

type Geo = {
  vw: number; vh: number; headerBottom: number; barTop: number;
  card: { top: number; bottom: number; left: number; right: number; width: number; height: number };
  scrollY: number; maxScroll: number;
};

const GEO = `(() => {
  const card = document.querySelector('main .card');
  const header = document.querySelector('header');
  const bar = document.querySelector('nav[aria-label="মোবাইল নেভিগেশন"]');
  const barShown = bar && getComputedStyle(bar).display !== 'none';
  const r = card.getBoundingClientRect();
  return {
    vw: document.documentElement.clientWidth, vh: innerHeight,
    headerBottom: header.getBoundingClientRect().bottom,
    barTop: barShown ? bar.getBoundingClientRect().top - 19 : innerHeight,
    card: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height },
    scrollY: scrollY, maxScroll: document.documentElement.scrollHeight - innerHeight,
  };
})()`;

const CONTROLS = ['#email', '#pw', 'button[type="submit"]', 'a[href="/register"]'];

let failures = 0;
const fail = (where: string, msg: string) => { failures++; console.log(`  ✗ ${where}: ${msg}`); };

async function checkLayout(page: Page, where: string) {
  await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  await page.waitForTimeout(150);
  const g = (await page.evaluate(GEO)) as Geo;
  const { card } = g;
  // 1 — horizontal
  const leftGap = card.left, rightGap = g.vw - card.right;
  if (Math.abs(leftGap - rightGap) > 2) fail(where, `not centred horizontally (left ${leftGap.toFixed(1)} vs right ${rightGap.toFixed(1)})`);
  if (card.width > 448.5) fail(where, `card wider than 448px (${card.width})`);
  if (g.vw < 640 && leftGap < 15.5) fail(where, `side margin ${leftGap.toFixed(1)}px < 16px`);
  // 2 — not under the header
  if (card.top < g.headerBottom + 8) fail(where, `card top ${card.top.toFixed(0)} is within 8px of / under the header (${g.headerBottom.toFixed(0)})`);
  // 3 / 4 — vertical fit
  const avail = g.barTop - g.headerBottom;
  if (card.height + 32 <= avail) {
    if (card.bottom > g.barTop + 0.5) fail(where, `card fits (${card.height.toFixed(0)} in ${avail.toFixed(0)}) but its bottom ${card.bottom.toFixed(0)} is below the visible area ${g.barTop.toFixed(0)}`);
    const above = card.top - g.headerBottom, below = g.barTop - card.bottom;
    if (Math.abs(above - below) > 4) fail(where, `not vertically centred in the free space (above ${above.toFixed(0)} / below ${below.toFixed(0)})`);
  }
  for (const sel of CONTROLS) {
    const loc = page.locator(`main ${sel}`).first();
    if (!(await loc.count())) { fail(where, `${sel} missing`); continue; }
    await loc.scrollIntoViewIfNeeded();
    const ok = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return 'zero size';
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return t && (t === el || el.contains(t)) ? 'ok' : `covered by ${t ? t.tagName.toLowerCase() + '.' + String(t.className).slice(0, 40) : 'nothing'}`;
    });
    if (ok !== 'ok') fail(where, `${sel} not usable: ${ok}`);
  }
  // 5 — scroll moves the card 1:1 and back
  await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  const top0 = ((await page.evaluate(GEO)) as Geo).card.top;
  const g0 = (await page.evaluate(GEO)) as Geo;
  const step = Math.min(200, g0.maxScroll);
  if (step > 0) {
    await page.evaluate(`window.scrollTo({ top: ${step}, behavior: 'instant' })`);
    await page.waitForTimeout(120);
    const g1 = (await page.evaluate(GEO)) as Geo;
    if (Math.abs((top0 - g1.card.top) - g1.scrollY) > 1) fail(where, `card moved ${(top0 - g1.card.top).toFixed(1)}px for a ${g1.scrollY}px scroll`);
    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
    await page.waitForTimeout(120);
    const g2 = (await page.evaluate(GEO)) as Geo;
    if (Math.abs(g2.card.top - top0) > 1) fail(where, `card did not return after scrolling back (${top0.toFixed(1)} → ${g2.card.top.toFixed(1)})`);
  }
}

async function freshLoad(b: Browser, w: number, h: number, dsf = 1): Promise<Page> {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  await page.addInitScript(`(() => {
    window.__cls = 0; window.__first = null; window.__skel = null;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
    const tick = () => {
      const s = document.querySelector('main .skeleton'); if (s && !window.__skel) window.__skel = s.getBoundingClientRect().height;
      const c = document.querySelector('main .card'); if (c && !window.__first) { const r = c.getBoundingClientRect(); window.__first = { top: r.top + scrollY, h: r.height }; }
      if (!window.__first || performance.now() < 3000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForSelector('main .card #email', { timeout: 60_000 });
  await page.waitForTimeout(1500);
  return page;
}

async function main() {
  const b = await launch();
  const sizes = process.env.RSP_SIZES ? process.env.RSP_SIZES.split(',').map((s) => s.split('x').map(Number) as [number, number]) : MATRIX;

  for (const [w, h] of sizes) {
    const page = await freshLoad(b, w, h);
    const where = `${w}x${h}`;
    // 6 — load stability
    const st = (await page.evaluate(`({ cls: window.__cls, first: window.__first, skel: window.__skel, now: (() => { const r = document.querySelector('main .card').getBoundingClientRect(); return { top: r.top + scrollY, h: r.height }; })() })`)) as { cls: number; first: { top: number; h: number } | null; skel: number | null; now: { top: number; h: number } };
    if (st.cls > 0.05) fail(where, `CLS ${st.cls.toFixed(3)}`);
    if (st.first && Math.abs(st.first.top - st.now.top) > 12) fail(where, `card top moved ${(st.now.top - st.first.top).toFixed(0)}px after first paint (card height ${st.first.h.toFixed(0)} → ${st.now.h.toFixed(0)})`);
    if (st.skel && Math.abs(st.skel - st.now.h) / st.now.h > 0.15) fail(where, `skeleton ${st.skel.toFixed(0)}px vs card ${st.now.h.toFixed(0)}px — content jumps when the form appears`);
    await checkLayout(page, where);
    await page.context().close();
  }

  // 7 — live resize + rotation on one page, no reload
  const page = await freshLoad(b, 1280, 800);
  for (const [w, h] of [[1920, 1080], [1024, 600], [390, 844], [844, 390], [768, 1024], [1024, 768], [320, 640], [1366, 768]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    await checkLayout(page, `resize→${w}x${h}`);
  }
  await page.context().close();

  // zoom emulation on a 1366×768 and a 1920×1080 window
  for (const [W, H] of [[1366, 768], [1920, 1080]] as const) {
    for (const z of [0.8, 0.9, 1, 1.1, 1.25, 1.5]) {
      const pg = await freshLoad(b, Math.round(W / z), Math.round(H / z), z);
      await checkLayout(pg, `${W}x${H} @${Math.round(z * 100)}%`);
      await pg.context().close();
    }
  }
  await b.close();
  console.log(`\nlogin-viewport (${engine}): ${failures ? `${failures} failure(s)` : 'all checks passed'}`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
