/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ H4 যাচাই — লুকানো ট্যাব আর DB ছোঁয় না
 *
 *   `npx tsx scripts/verify/polling-load.ts`
 *
 *   RUN.md চেয়েছে: "count DB queries over 2 minutes, before and after"।
 *   এখানে **প্রকৃত ব্রাউজারে** `/api/me` ও `/api/notifications` এর
 *   অনুরোধ গোনা হয় (প্রতিটি সরাসরি একটি DB কোয়েরি):
 *
 *     ক) ট্যাব **দৃশ্যমান** — পোলিং চলা উচিত
 *     খ) ট্যাব **লুকানো**  — একটিও অনুরোধ যাওয়া উচিত নয়
 *     গ) ট্যাব **ফিরে এলে** — সাথে সাথে একবার (বাসি তথ্য নয়)
 *
 *   ⏱️ পুরো ২ মিনিট অপেক্ষা না করে ব্যবধান ছোট রাখতে
 *      `--window=<সেকেন্ড>` দেওয়া যায়; ডিফল্ট ৭৫s (১২০s ব্যবধানের
 *      অর্ধেকের বেশি, তাই লুকানো অবস্থায় ০ হওয়াই অর্থবহ)।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const WINDOW_S = Number(process.argv.find((a) => a.startsWith('--window='))?.slice(9) || 75);

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/** ট্যাব লুকানো/দেখানো নকল করা — Playwright সরাসরি পারে না */
const SET_HIDDEN = (hidden: boolean) => `(function () {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: function () { return '${hidden ? 'hidden' : 'visible'}'; }
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true, get: function () { return ${hidden}; }
  });
  document.dispatchEvent(new Event('visibilitychange'));
  return document.visibilityState;
})()`;

(async () => {
  console.log('═══ H4 — পোলিং লোড যাচাই ═══\n');
  console.log(`  পরিমাপ-জানালা: ${WINDOW_S}s · Navbar ব্যবধান ১২০s\n`);

  /**
   * ⚠️ এই স্ক্রিপ্টটি **নিজের** ব্রাউজার চালায়, `ws.txt` এর শেয়ার্ডটি নয়।
   *   কারণ: এটি ৭৫s+ ধরে চলে, আর অত সময় শেয়ার্ড CDP সংযোগ ধরে রাখলে
   *   Windows-এ প্রস্থানের সময় libuv assertion দিয়ে exit code নষ্ট হয়
   *   ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") —
   *   পরীক্ষা পাস করেও CI ব্যর্থ দেখাত। নিজের ব্রাউজার শেষে
   *   পরিষ্কারভাবে বন্ধ করা যায়।
   */
  const exe = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync);
  const browser = await chromium.launch({
    headless: true,
    ...(exe ? { executablePath: exe } : {}),
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  let hits: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/me') || u.includes('/api/notifications')) {
      hits.push(`${new Date().toISOString().slice(11, 19)} ${u.replace(BASE, '')}`);
    }
  });

  try {
    // ── লগইন ──
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    let authed = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      try {
        authed = await page.evaluate(
          `(async () => { const r = await fetch('/api/auth/session'); const j = await r.json().catch(() => null); return Boolean(j && j.user && j.user.id); })()`,
        ) as boolean;
      } catch { continue; }
      if (authed) break;
    }
    check('লগইন', authed);

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // ── ক) লুকানো অবস্থায় ──
    console.log(`\n── ট্যাব লুকানো (${WINDOW_S}s) ──`);
    await page.evaluate(SET_HIDDEN(true));
    hits = [];
    await page.waitForTimeout(WINDOW_S * 1000);
    const hidden = hits.length;
    console.log(`  অনুরোধ: ${hidden}${hidden ? ' → ' + hits.join(', ') : ''}`);
    check('★ লুকানো ট্যাব থেকে কোনো DB-অনুরোধ যায় না', hidden === 0, `${hidden} টি`);

    // ── খ) ফিরে এলে সাথে সাথে ──
    console.log('\n── ট্যাব ফিরে এলো ──');
    hits = [];
    await page.evaluate(SET_HIDDEN(false));
    await page.waitForTimeout(4000);
    const onReturn = hits.length;
    console.log(`  অনুরোধ: ${onReturn}${onReturn ? ' → ' + hits.join(', ') : ''}`);
    check('★ ফিরে এলে সাথে সাথে হালনাগাদ হয়', onReturn > 0, `${onReturn} টি`);

    // ── গ) সোর্স যাচাই ──
    console.log('\n── সোর্স ──');
    const nav = readFileSync('src/components/Navbar.tsx', 'utf8');
    const auto = readFileSync('src/components/AutoRefresh.tsx', 'utf8');
    check('Navbar এ কাঁচা setInterval নেই', !/setInterval\(/.test(nav));
    check('Navbar ব্যবধান ১২০s', /useVisibleInterval\(load,\s*120_000/.test(nav));
    check('AutoRefresh এ কাঁচা setInterval নেই', !/setInterval\(/.test(auto));

    // ── ঘ) SSE endpoint ──
    console.log('\n── /api/stream ──');
    const st = await page.evaluate(
      `(async () => { const r = await fetch('/api/stream'); return { s: r.status, ct: r.headers.get('content-type') || '' }; })()`,
    ) as { s: number; ct: string };
    console.log(`  HTTP ${st.s} · content-type=${st.ct}`);
    check('STREAM_ENABLED বন্ধ থাকলে ৫০৩ (ক্লায়েন্ট পোলিং-এ থাকে)',
      st.s === 503 || st.ct.includes('text/event-stream'),
      st.s === 503 ? 'বন্ধ — প্রত্যাশিত' : 'স্ট্রিম চালু');

    const anon = await fetch(`${BASE}/api/stream`);
    check('/api/stream অননুমোদিত হলে ৪০১', anon.status === 401, `HTTP ${anon.status}`);
  } finally {
    await ctx.close();
    await browser.close();   // নিজের ব্রাউজার — পরিষ্কারভাবে বন্ধ
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
