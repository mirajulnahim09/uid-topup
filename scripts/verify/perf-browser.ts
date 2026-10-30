/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ আসল ব্রাউজারে পারফরম্যান্স (চূড়ান্ত অডিট, ২০২৬-০৯-১৭)
 *
 *   `audit-perf.ts` কেবল `fetch()` দিয়ে HTML-এর সময় মাপে — ব্রাউজার
 *   যা অনুভব করে (LCP, লেআউট-সরা, মূল থ্রেড আটকানো, JS-এর ওজন) তা নয়।
 *   এটি প্রোডাকশন বিল্ডে প্রতিটি মূল পাতা খুলে Navigation/Paint API ও
 *   CDP থেকে সংখ্যা নেয়:
 *
 *     TTFB · DOMContentLoaded · load · LCP · CLS · long task (>৫০ms) মোট ·
 *     অনুরোধ-সংখ্যা · JS ও মোট স্থানান্তরিত KB
 *
 *   দুটি প্রোফাইল: ডেস্কটপ (থ্রটল নেই) ও মোবাইল (৪× ধীর CPU + ১.৬ Mbps,
 *   বাজেট-ফোনের কাছাকাছি)। প্রতিটি পাতা ওয়ার্ম-আপের পর দুবার, ভালোটি।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/perf-browser.ts
 *   ফল: audit/perf-browser.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE } from './_db';
import { openBrowser } from './_browser';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Browser, BrowserContext, Page } from 'playwright-core';

type Metrics = {
  ttfb: number; dcl: number; load: number; lcp: number; cls: number;
  longTaskMs: number; requests: number; jsKB: number; totalKB: number;
};

const INIT = () => {
  const w = window as unknown as { __lcp: number; __cls: number; __lt: number };
  w.__lcp = 0; w.__cls = 0; w.__lt = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
        if (!e.hadRecentInput) w.__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt += e.duration - 50; })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* পুরনো ব্রাউজার */ }
};

async function measure(ctx: BrowserContext, path: string, mobile: boolean): Promise<Metrics> {
  const page: Page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (mobile) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
    });
  }
  let requests = 0; let jsBytes = 0; let totalBytes = 0;
  const types = new Map<string, string>();
  cdp.on('Network.responseReceived', (e: { requestId: string; type: string }) => { types.set(e.requestId, e.type); });
  cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
    requests++; totalBytes += e.encodedDataLength;
    if (types.get(e.requestId) === 'Script') jsBytes += e.encodedDataLength;
  });
  await page.addInitScript(INIT);
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForTimeout(mobile ? 3500 : 2000);
  const m = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const w = window as unknown as { __lcp: number; __cls: number; __lt: number };
    return {
      ttfb: Math.round(n.responseStart - n.startTime), dcl: Math.round(n.domContentLoadedEventEnd - n.startTime),
      load: Math.round(n.loadEventEnd - n.startTime), lcp: Math.round(w.__lcp), cls: Math.round(w.__cls * 1000) / 1000,
      longTaskMs: Math.round(w.__lt),
    };
  });
  await page.close();
  return { ...m, requests, jsKB: Math.round(jsBytes / 1024), totalKB: Math.round(totalBytes / 1024) };
}

async function signedInContext(browser: Browser, email: string, password: string, mobile: boolean) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 },
    isMobile: mobile, hasTouch: mobile,
  });
  if (email) {
    await db.rateLimitBucket.deleteMany({});
    const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
    await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
      form: { csrfToken, email, password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
    });
  }
  return ctx;
}

async function main() {
  const product = await db.product.findFirst({ where: { isActive: true }, select: { id: true, slug: true } });
  const SETS = [
    { who: 'অতিথি', email: '', password: '', pages: ['/', '/search?q=diamond', `/product/${product?.id}/${product?.slug}`, '/login', '/track', '/faq'] },
    { who: 'গ্রাহক', email: 'customer@uidtopup.local', password: 'Customer@2026Secure', pages: ['/account', '/account/orders', '/account/wallet/deposit'] },
    { who: 'অ্যাডমিন', email: 'admin@uidtopup.local', password: 'Admin@2026Secure', pages: ['/admin', '/admin/orders', '/admin/deposits', '/admin/users', '/admin/products'] },
  ];
  const browser = await openBrowser({ headless: true });
  const out: Array<{ profile: string; who: string; path: string } & Metrics> = [];

  for (const mobile of [false, true]) {
    const profile = mobile ? 'মোবাইল (৪× CPU, ১.৬Mbps)' : 'ডেস্কটপ';
    console.log(`\n═══ ${profile} ═══`);
    console.log('  পাতা                              TTFB   DCL    load   LCP    CLS    longTask req  JS KB  মোট KB');
    for (const set of SETS) {
      const ctx = await signedInContext(browser, set.email, set.password, mobile);
      for (const p of set.pages) {
        await measure(ctx, p, false).catch(() => null); // ওয়ার্ম-আপ (সার্ভার-ক্যাশ)
        const runs = [await measure(ctx, p, mobile), await measure(ctx, p, mobile)];
        const best = runs.sort((a, b) => a.lcp - b.lcp)[0];
        out.push({ profile, who: set.who, path: p, ...best });
        const label = `${set.who} ${p}`.slice(0, 34).padEnd(34);
        console.log(`  ${label} ${String(best.ttfb).padStart(5)} ${String(best.dcl).padStart(6)} ${String(best.load).padStart(6)} ${String(best.lcp).padStart(6)} ${String(best.cls).padStart(6)} ${String(best.longTaskMs).padStart(8)} ${String(best.requests).padStart(4)} ${String(best.jsKB).padStart(6)} ${String(best.totalKB).padStart(7)}`);
      }
      await ctx.close();
    }
  }

  // ★ Core Web Vitals "ভালো" সীমা: LCP ≤ ২৫০০ms, CLS ≤ ০.১
  const poor = out.filter((r) => r.lcp > 2500 || r.cls > 0.1);
  console.log(`\n  CWV সীমা ছাড়ানো (LCP>2500ms বা CLS>0.1): ${poor.length}/${out.length}`);
  for (const r of poor) console.log(`    · [${r.profile}] ${r.who} ${r.path} — LCP ${r.lcp}ms · CLS ${r.cls}`);

  mkdirSync('audit', { recursive: true });
  writeFileSync('audit/perf-browser.json', JSON.stringify(out, null, 2));
  await db.rateLimitBucket.deleteMany({});
  await browser.close();
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
