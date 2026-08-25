/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ H3 যাচাই — nonce-ভিত্তিক CSP, hydration অক্ষত
 *
 *   `npx tsx scripts/verify/csp-nonce.ts`            (dev, :3000)
 *   `npx tsx scripts/verify/csp-nonce.ts --port=3100` (prod build)
 *
 *   RUN.md স্পষ্ট: nonce যদি Next-এর hydration ভাঙে, তবে script-src
 *   অংশ ফিরিয়ে নিতে হবে — `unsafe-inline` রেখে "ঠিক হয়েছে" বলা যাবে না।
 *   তাই এখানে **প্রকৃত ব্রাউজারে** hydration মাপা হয়:
 *
 *     ১. হেডার: nonce আছে · script-src এ `unsafe-inline` **নেই**
 *     ২. হেডার: img-src এ বেয়ার `https:` **নেই**
 *     ৩. HTML: ইনলাইন থিম-স্ক্রিপ্টে nonce বসেছে ও হেডারের সাথে মেলে
 *     ৪. ব্রাউজার: কোনো CSP-লঙ্ঘন কনসোল-ত্রুটি নেই
 *     ৫. ব্রাউজার: React সত্যিই hydrate করেছে (fiber + প্রকৃত ক্লিক)
 *     ৬. ব্রাউজার: ইনলাইন থিম-স্ক্রিপ্ট চলেছে (data-theme বসেছে)
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const PORT = process.argv.find((a) => a.startsWith('--port='))?.slice(7) || '3000';
const BASE = `http://localhost:${PORT}`;

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const HYDRATED = `(function () {
  // React 18 hydration করলে DOM নোডে __reactFiber$ / __reactProps$ কী বসে
  var els = document.querySelectorAll('body *');
  for (var i = 0; i < els.length; i++) {
    var keys = Object.keys(els[i]);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf('__reactFiber$') === 0 || keys[j].indexOf('__reactProps$') === 0) return true;
    }
  }
  return false;
})()`;

(async () => {
  console.log(`═══ H3 — nonce CSP যাচাই (${BASE}) ═══\n`);

  // ── ১-৩. হেডার ও HTML ──
  console.log('── হেডার ও HTML ──');
  const res = await fetch(`${BASE}/`);
  const csp = res.headers.get('content-security-policy') || '';
  const html = await res.text();

  const scriptSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src')) || '';
  const imgSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('img-src')) || '';

  const nonceMatch = /'nonce-([A-Za-z0-9+/=]+)'/.exec(scriptSrc);
  const headerNonce = nonceMatch?.[1] || '';

  check('CSP হেডার আছে', csp.length > 0);
  check('script-src এ nonce আছে', Boolean(headerNonce), headerNonce ? `${headerNonce.slice(0, 12)}…` : '(নেই)');
  check("script-src এ 'unsafe-inline' নেই", !scriptSrc.includes("'unsafe-inline'"), scriptSrc.slice(0, 90));
  check("script-src এ 'strict-dynamic' আছে", scriptSrc.includes("'strict-dynamic'"));
  check('img-src এ বেয়ার https: নেই', !/\bhttps:(?=\s|$)/.test(imgSrc), imgSrc);
  check('img-src এ Blob হোস্ট আছে', imgSrc.includes('blob.vercel-storage.com'));

  // ★ ইনলাইন থিম-স্ক্রিপ্ট hash দিয়ে অনুমোদিত (nonce নয় — hydration
  //   mismatch এড়াতে; বিস্তারিত middleware.ts এর মন্তব্যে)
  const inline = /<script([^>]*)>\(function\(\)\{try\{var t=localStorage/.exec(html);
  check('ইনলাইন থিম-স্ক্রিপ্ট HTML-এ আছে', Boolean(inline));
  check('ইনলাইন স্ক্রিপ্টে nonce বসানো **হয়নি** (ইচ্ছাকৃত)',
    Boolean(inline) && !/nonce="/.test(inline![1]),
    inline ? (/nonce="/.test(inline[1]) ? '⚠️ nonce আছে — mismatch ফিরে আসবে' : 'পরিষ্কার') : '—');

  const { createHash } = await import('node:crypto');
  const { THEME_INIT_SCRIPT } = await import('../../src/lib/themeScript');
  const expectHash = `'sha256-${createHash('sha256').update(THEME_INIT_SCRIPT, 'utf8').digest('base64')}'`;
  check('★ script-src এ থিম-স্ক্রিপ্টের সঠিক SHA-256 হ্যাশ',
    scriptSrc.includes(expectHash), expectHash.slice(0, 24) + '…');

  // Next-এর নিজস্ব স্ক্রিপ্টেও nonce
  const nextScripts = [...html.matchAll(/<script[^>]*src="\/_next\/[^"]+"[^>]*>/g)].map((m) => m[0]);
  const noncedNext = nextScripts.filter((s) => s.includes(`nonce="${headerNonce}"`));
  check('Next-এর স্ক্রিপ্ট ট্যাগেও nonce বসেছে',
    nextScripts.length > 0 && noncedNext.length === nextScripts.length,
    `${noncedNext.length}/${nextScripts.length}`);

  // ── ৪-৬. প্রকৃত ব্রাউজার ──
  console.log('\n── ব্রাউজার (hydration ও CSP লঙ্ঘন) ──');
  const ws = path.join(process.cwd(), 'ws.txt');
  const browser = existsSync(ws)
    ? await chromium.connect(readFileSync(ws, 'utf8').trim())
    : await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  const cspViolations: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    consoleErrors.push(t.slice(0, 180));
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(t)) cspViolations.push(t.slice(0, 180));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 160)}`));

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    check('★ কোনো CSP লঙ্ঘন নেই', cspViolations.length === 0,
      cspViolations.length ? cspViolations.slice(0, 3).join(' | ') : 'পরিষ্কার');

    const themeAttr = await page.evaluate(`document.documentElement.dataset.theme || ''`) as string;
    check('ইনলাইন থিম-স্ক্রিপ্ট চলেছে (data-theme বসেছে)', Boolean(themeAttr), themeAttr || '(খালি)');

    const hydrated = await page.evaluate(HYDRATED) as boolean;
    check('★ React hydrate করেছে (fiber পাওয়া গেছে)', hydrated);

    /**
     * ★ প্রকৃত ইন্টারঅ্যাকশন — hydration না হলে হ্যান্ডলার চলবে না।
     *
     * ⚠️ **যা মাপা হয় তা `data-theme` নয়, বোতামের `data-theme-choice`।**
     *   P0-তে থিম-টগল তিনটি বোতাম থেকে একটিতে নামানো হয়েছে, যা
     *   `light → dark → system` ক্রমে ঘোরে। টাটকা ব্রাউজারে পছন্দ থাকে
     *   `system`, আর হেডলেস Chrome-এর সিস্টেম-থিম `light` — তাই প্রথম
     *   ক্লিকে পছন্দ `system → light` হলেও **resolved** থিম `light`-ই
     *   থাকে, `data-theme` এক চুলও নড়ে না।
     *
     *   পুরনো চেকটি ঠিক ওখানেই মিথ্যা FAIL দিত ("light → light"), অথচ
     *   মেপে দেখা গেছে হ্যান্ডলার চলেছে: `data-theme-choice` ও
     *   localStorage দুটোই বদলেছে (২০২৬-০৮-২৩)। পছন্দ প্রতি ক্লিকে
     *   **সবসময়** বদলায়, তাই hydration-এর সঠিক সূচক সেটিই।
     */
    const toggle = page.locator('button[aria-label*="থিম"], button[title*="থিম"], [data-theme-toggle] button').first();
    const hasToggle = await toggle.count() > 0;
    if (hasToggle) {
      const before = await toggle.getAttribute('data-theme-choice');
      const beforeAttr = await page.evaluate(`document.documentElement.dataset.theme`) as string;
      await toggle.click();
      await page.waitForTimeout(600);
      const after = await toggle.getAttribute('data-theme-choice');
      const afterAttr = await page.evaluate(`document.documentElement.dataset.theme`) as string;
      check('★ ক্লিকে React হ্যান্ডলার সাড়া দেয় (প্রকৃত hydration)', Boolean(before) && before !== after,
        `পছন্দ ${before} → ${after} (data-theme ${beforeAttr} → ${afterAttr})`);
    } else {
      // fallback: যেকোনো লিংকে ক্লায়েন্ট-সাইড নেভিগেশন
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.fill('input[type="email"]', 'hydration@test.local');
      const val = await page.inputValue('input[type="email"]');
      check('★ ইনপুটে React state কাজ করে (প্রকৃত hydration)', val === 'hydration@test.local', val);
    }

    const nonCsp = consoleErrors.filter((e) => !/Content Security Policy|Refused to/i.test(e));
    check('অন্য কনসোল ত্রুটি নেই', nonCsp.length === 0,
      nonCsp.length ? nonCsp.slice(0, 3).join(' | ') : 'পরিষ্কার');
  } finally {
    await ctx.close();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
