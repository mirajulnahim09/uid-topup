/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Responsive matrix — every route × every viewport, measured in a real browser
 *
 *   npx tsx scripts/verify/responsive-matrix.ts                 (all routes, all sizes)
 *   RSP_SIZES=1440x900,390x844 RSP_ROUTES=/login,/ npx tsx …    (subset)
 *   VERIFY_BROWSER=edge|firefox|webkit                          (engine; default Chrome)
 *   RSP_SHOTS=1                                                 (screenshots at 1440/768/390)
 *
 *   Local dev/test database only (`_db.ts` refuses anything else). Logs in
 *   with the local seed accounts (admin from prisma/seed.ts defaults, customer
 *   from scripts/dev-make-customer.mjs); passwords are never printed.
 *
 *   Per page it asserts:
 *     H  no element sticks out of the viewport horizontally (unless it sits
 *        inside its own horizontal scroller) — body has overflow-x:hidden, so
 *        `scrollWidth` alone would hide real overflow
 *     C  no clipped control: a button/link/input whose content is cut off
 *     O  no two interactive controls overlap each other
 *     B  at the bottom of the page, nothing interactive hides under the mobile tab bar
 *     M  open dialogs fit inside the viewport
 *   Exit 1 on any finding; JSON report in audit/runs/responsive-<engine>.json.
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE } from './_db';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SEED_ADMIN_EMAIL, DEFAULT_SEED_ADMIN_PASSWORD } from '../../src/lib/seedDefaults';
import { MATRIX } from './responsive-matrix-sizes';

// same local test account as scripts/dev-make-customer.mjs
const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };
const ADMIN = { email: DEFAULT_SEED_ADMIN_EMAIL, password: DEFAULT_SEED_ADMIN_PASSWORD };


type Role = 'guest' | 'customer' | 'admin';
type RouteDef = { path: string; role: Role };

async function routes(): Promise<RouteDef[]> {
  const product = await db.product.findFirst({ where: { isActive: true }, select: { id: true, slug: true } });
  const customer = await db.user.findUnique({ where: { email: CUSTOMER.email }, select: { id: true } });
  const order = customer && await db.order.findFirst({ where: { userId: customer.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  const ticket = customer && await db.ticket.findFirst({ where: { userId: customer.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  const anyUser = customer?.id;
  const guest = ['/', '/about', '/contact', '/delete-account', '/developers', '/faq', '/forgot-password', '/login',
    '/privacy', '/refund', '/register', '/reset-password', '/search', '/terms', '/track', '/tutorial'];
  if (product) guest.push(`/product/${product.id}`, `/product/${product.id}/${product.slug}`);
  const cust = ['/account', '/account/codes', '/account/notifications', '/account/orders', '/account/profile',
    '/account/smm-orders', '/account/tickets', '/account/wallet/deposit', '/account/wallet/withdraw'];
  if (order) cust.push(`/account/orders/${order.id}`, `/account/orders/${order.id}/invoice`);
  if (ticket) cust.push(`/account/tickets/${ticket.id}`);
  const adm = ['/admin', '/admin/banners', '/admin/branding', '/admin/codes', '/admin/coupons', '/admin/deposits',
    '/admin/homepage', '/admin/integrations', '/admin/logs', '/admin/media', '/admin/orders', '/admin/otp',
    '/admin/payments', '/admin/products', '/admin/reports', '/admin/site', '/admin/telegram', '/admin/tickets',
    '/admin/tools', '/admin/users', '/admin/withdrawals'];
  if (anyUser) adm.push(`/admin/users/${anyUser}`);
  return [
    ...guest.map((p) => ({ path: p, role: 'guest' as const })),
    ...cust.map((p) => ({ path: p, role: 'customer' as const })),
    ...adm.map((p) => ({ path: p, role: 'admin' as const })),
  ];
}

async function launch(engine: string): Promise<Browser> {
  if (engine === 'firefox') return firefox.launch();
  if (engine === 'webkit') return webkit.launch();
  const exe = engine === 'edge'
    ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    : 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  return chromium.launch({ executablePath: exe });
}

async function signedInContext(b: Browser, who: { email: string; password: string }): Promise<BrowserContext> {
  await db.rateLimitBucket.deleteMany({});
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  for (let attempt = 0; attempt < 3 && (attempt === 0 || new URL(p.url()).pathname.startsWith('/login')); attempt++) {
    await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 90_000 });
    await p.waitForSelector('#email', { timeout: 60_000 });
    await p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {}); // let React hydrate before submitting
    await p.fill('#email', who.email);
    await p.fill('#pw', who.password);
    await p.click('button[type="submit"]');
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
  }
  if (new URL(p.url()).pathname.startsWith('/login')) throw new Error(`login failed for the local ${who === ADMIN ? 'admin' : 'customer'} test account`);
  await p.close();
  return ctx;
}

/** In-page measurement. A string, so tsx helpers never leak into the page. */
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const hiddenByAncestor = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { if (a.getAttribute('aria-hidden') === 'true' || a.inert) return true; const s = getComputedStyle(a); if (s.visibility === 'hidden' || +s.opacity === 0) return true; } return false; };
  const clippedByScroller = (el) => { for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox !== 'visible') { const r = a.getBoundingClientRect(); return r.left >= -1 && r.right <= vw + 1; } } return false; };
  const name = (el) => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; const c = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 3); if (c.length) s += '.' + c.join('.'); const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30); return t ? s + ' "' + t + '"' : s; };
  const out = { H: [], C: [], O: [], B: [], M: [] };
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      const pos = getComputedStyle(el).position;
      if (!vis(el) || hiddenByAncestor(el) || clippedByScroller(el)) continue;
      if (pos === 'fixed' && (r.left >= vw || r.right <= 0)) continue; // off-canvas drawer, closed
      // report only the outermost offender
      const p = el.parentElement; const pr = p && p.getBoundingClientRect();
      if (p && p !== document.body && pr && (pr.right > vw + 1 || pr.left < -1) && vis(p)) continue;
      out.H.push(name(el) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw + ']');
    }
  }
  const controls = [...document.querySelectorAll('main button, main a[href], main input, main select, main textarea, header button, header a[href]')].filter((el) => vis(el) && !hiddenByAncestor(el));
  for (const el of controls) {
    const s = getComputedStyle(el);
    if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT')
      out.C.push(name(el) + ' [content ' + el.scrollWidth + ' > box ' + el.clientWidth + ']');
  }
  const rects = controls.map((el) => [el, el.getBoundingClientRect()]);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, ra] = rects[i], [b, rb] = rects[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ix > 4 && iy > 4) {
      const pa = getComputedStyle(a).position, pb = getComputedStyle(b).position;
      if (pa === 'absolute' || pb === 'absolute') { const host = a.parentElement && a.parentElement.contains(b) ? a.parentElement : null; if (host && getComputedStyle(host).position === 'relative') continue; } // intentional overlay (e.g. eye icon in input)
      out.O.push(name(a) + ' × ' + name(b));
      if (out.O.length > 8) break;
    }
  }
  for (const d of document.querySelectorAll('[role="dialog"], dialog[open]')) {
    if (!vis(d)) continue; const r = d.getBoundingClientRect();
    if (r.top < -1 || r.left < -1 || r.right > vw + 1 || (r.bottom > vh + 1 && getComputedStyle(d).overflowY === 'visible')) out.M.push(name(d) + ' [' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + ' in ' + vw + 'x' + vh + ']');
  }
  return out;
})()`;

const BOTTOM = `(() => {
  const bar = document.querySelector('nav[aria-label="মোবাইল নেভিগেশন"]');
  if (!bar || getComputedStyle(bar).display === 'none') return [];
  const top = bar.getBoundingClientRect().top - 19; // the centre FAB rises 19px above the bar
  const hits = [];
  for (const el of document.querySelectorAll('main a[href], main button, main input, footer a[href]')) {
    const r = el.getBoundingClientRect(); if (!r.height) continue;
    if (r.bottom > top + 1 && r.top < innerHeight) {
      // covered only if the bar is really on top at that point
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(r.bottom - 2, innerHeight - 1);
      const topEl = document.elementFromPoint(x, y);
      if (topEl && bar.contains(topEl)) hits.push(el.tagName.toLowerCase() + ' "' + (el.textContent || '').trim().slice(0, 25) + '"');
    }
  }
  return hits;
})()`;

type Measured = { status: number; finalPath: string } & Record<'H' | 'C' | 'O' | 'B' | 'M', string[]>;

async function audit(page: Page, url: string): Promise<Measured> {
  // `load`, not `networkidle`: signed-in pages poll /api/me and notifications forever
  const res = await page.goto(url, { waitUntil: 'load', timeout: 90_000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const status = res?.status() ?? 0;
  const m = (await page.evaluate(MEASURE)) as Record<string, string[]>;
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
  await page.waitForTimeout(250);
  m.B = (await page.evaluate(BOTTOM)) as string[];
  await page.evaluate('window.scrollTo(0, 0)');
  return { status, finalPath: new URL(page.url()).pathname, H: m.H ?? [], C: m.C ?? [], O: m.O ?? [], B: m.B ?? [], M: m.M ?? [] };
}

async function main() {
  const engine = (process.env.VERIFY_BROWSER || 'chrome').toLowerCase();
  const sizes = process.env.RSP_SIZES
    ? process.env.RSP_SIZES.split(',').map((s) => s.split('x').map(Number) as [number, number])
    : MATRIX;
  let list = await routes();
  if (process.env.RSP_ROUTES) { const want = new Set(process.env.RSP_ROUTES.split(',')); list = list.filter((r) => want.has(r.path)); }
  const shots = process.env.RSP_SHOTS === '1';
  const shotDir = path.join('audit', 'responsive', engine);
  if (shots) mkdirSync(shotDir, { recursive: true });

  const b = await launch(engine);
  const ctxs: Record<Role, BrowserContext> = {
    guest: await b.newContext({ ignoreHTTPSErrors: true }),
    customer: list.some((r) => r.role === 'customer') ? await signedInContext(b, CUSTOMER) : await b.newContext({ ignoreHTTPSErrors: true }),
    admin: list.some((r) => r.role === 'admin') ? await signedInContext(b, ADMIN) : await b.newContext({ ignoreHTTPSErrors: true }),
  };
  const pages: Record<Role, Page> = { guest: await ctxs.guest.newPage(), customer: await ctxs.customer.newPage(), admin: await ctxs.admin.newPage() };

  const report: Array<Record<string, unknown>> = [];
  let failures = 0;
  for (const [w, h] of sizes) {
    for (const r of list) {
      const page = pages[r.role];
      await page.setViewportSize({ width: w, height: h });
      const res = await audit(page, BASE + r.path);
      const issues = (['H', 'C', 'O', 'B', 'M'] as const).flatMap((k) => res[k].map((x) => `${k}: ${x}`));
      if (res.status >= 400 || res.finalPath.startsWith('/login') && !r.path.startsWith('/login')) issues.push(`NAV: status ${res.status}, ended at ${res.finalPath}`);
      if (issues.length) failures++;
      report.push({ size: `${w}x${h}`, route: r.path, role: r.role, status: res.status, issues });
      if (issues.length) console.log(`  ✗ ${w}x${h} ${r.path}\n      ${issues.slice(0, 6).join('\n      ')}`);
      if (shots && ['1440x900', '768x1024', '390x844'].includes(`${w}x${h}`)) {
        const file = path.join(shotDir, `${r.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${w}x${h}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 60 });
      }
    }
    console.log(`${w}x${h}: ${list.length} routes done`);
  }
  await b.close();
  mkdirSync(path.join('audit', 'runs'), { recursive: true });
  writeFileSync(path.join('audit', 'runs', `responsive-${engine}.json`), JSON.stringify(report, null, 1));
  console.log(`\n${engine}: ${report.length} page checks, ${failures} with findings`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
