/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ প্রতিটি নোটিফিকেশন-পৃষ্ঠ — দুই থিমে
 *
 *   `npx tsx scripts/notification-surfaces-audit.ts`
 *
 *   টোস্ট ও ইনলাইন alert আলাদা করে `toast-audit.ts` দেখে। এটি বাকি
 *   পৃষ্ঠগুলো দেখে: লাইভ নোটিফিকেশন তালিকা, ঘোষণা-বার (NoticeBar),
 *   পপ-আপ, টেলিগ্রাম স্ট্যাটাস। প্রতিটির জন্য —
 *     · কনসোল/রানটাইম ত্রুটি
 *     · ভিউপোর্ট-ওভারফ্লো (আনুভূমিক)
 *     · ভাসমান উপাদান navbar ঢেকে দিচ্ছে কিনা
 *     · স্ক্রিনশট (dark + light)
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const SHOTS = path.join(process.cwd(), 'audit', 'screens');
mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/**
 * আনুভূমিক ওভারফ্লো + ভাসমান উপাদান navbar ঢাকছে কিনা।
 *
 * ⚠️ প্রথম সংস্করণ ভুল ছিল — প্রতিটি এমন এলিমেন্ট ধরত যার rect
 *    ভিউপোর্ট ছাড়ায়। কিন্তু marquee-এর ট্র্যাক, `v-ambient` রশ্মি,
 *    সাজসজ্জার `v-lift`/`v-breathe` — এগুলো ইচ্ছাকৃতভাবে চওড়া এবং
 *    পূর্বপুরুষের `overflow:hidden` কেটে দেয়, ব্যবহারকারী কখনো
 *    আনুভূমিক স্ক্রলবার দেখেন না। তাই এখন **আসল উপসর্গ** মাপি:
 *    ডকুমেন্ট সত্যিই আনুভূমিকভাবে স্ক্রল করে কিনা।
 *    (`audit-pages.ts` ৩২ পাতায় ৬ ভিউপোর্টে ০ ওভারফ্লো বলে — সেটিই সঠিক।)
 *
 * ⚠️ একইভাবে "navbar ঢাকছে" শুধু তখনই সমস্যা যখন উপাদানটি
 *    **অস্বচ্ছ ও ক্লিকযোগ্য**। কাস্টম কার্সার (`z-9999`,
 *    `pointer-events:none`, স্বচ্ছ) কিছুই ঢাকে না — সেটিকে ত্রুটি
 *    বলা harness-এর ভুল হতো।
 */
const PROBE = `(function () {
  var de = document.documentElement;
  var scrolls = de.scrollWidth > de.clientWidth + 1;

  var navBottom = 0;
  document.querySelectorAll('header, nav').forEach(function (el) {
    var cs = getComputedStyle(el);
    if (cs.position !== 'sticky' && cs.position !== 'fixed') return;
    var r = el.getBoundingClientRect();
    if (r.height > 0 && r.top < 200 && r.bottom > navBottom) navBottom = r.bottom;
  });

  var covering = [];
  document.querySelectorAll('body *').forEach(function (el) {
    var cs = getComputedStyle(el);
    if (cs.position !== 'fixed') return;
    if (cs.pointerEvents === 'none') return;          // সাজসজ্জা / কার্সার
    if (cs.visibility === 'hidden' || cs.opacity === '0') return;
    var bg = cs.backgroundColor || '';
    var m = bg.match(/[\\d.]+/g);
    var alpha = (m && m.length > 3) ? Number(m[3]) : (bg === 'transparent' || !m ? 0 : 1);
    if (alpha < 0.5) return;                           // স্বচ্ছ — কিছু ঢাকে না
    var z = parseInt(cs.zIndex || '0', 10) || 0;
    if (z < 40) return;
    var r = el.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) return;
    if (r.top < navBottom - 4 && r.bottom > 4) {
      covering.push(el.tagName + '.' + String(el.className).slice(0, 40) + ' z=' + z + ' top=' + Math.round(r.top));
    }
  });
  return { scrolls: scrolls, scrollW: de.scrollWidth, clientW: de.clientWidth, navBottom: Math.round(navBottom), covering: covering };
})()`;

const PAGES: { label: string; url: string; slug: string }[] = [
  { label: 'লাইভ নোটিফিকেশন তালিকা', url: '/account/notifications', slug: 'notif_list' },
  { label: 'ঘোষণা-বার + পপ-আপ (হোম)', url: '/', slug: 'notif_home' },
  { label: 'টেলিগ্রাম স্ট্যাটাস', url: '/admin/telegram', slug: 'notif_telegram' },
  { label: 'অ্যাডমিন ইন্টিগ্রেশন স্ট্যাটাস', url: '/admin/integrations', slug: 'notif_integrations' },
];

(async () => {
  console.log('═══ নোটিফিকেশন-পৃষ্ঠ নিরীক্ষা ═══\n');
  const ws = path.join(process.cwd(), 'ws.txt');
  const browser = existsSync(ws)
    ? await chromium.connect(readFileSync(ws, 'utf8').trim())
    : await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 160)));

  try {
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
    check('অ্যাডমিন লগইন', authed);

    for (const { label, url, slug } of PAGES) {
      console.log(`\n── ${label}  (${url}) ──`);
      for (const theme of ['dark', 'light'] as const) {
        await page.goto(BASE + url, { waitUntil: 'networkidle' });
        await page.evaluate(`document.documentElement.setAttribute('data-theme','${theme}')`);
        await page.waitForTimeout(1800);

        const r = await page.evaluate(PROBE) as {
          scrolls: boolean; scrollW: number; clientW: number; navBottom: number; covering: string[];
        };
        check(`${theme}: পাতা আনুভূমিকভাবে স্ক্রল করে না`, !r.scrolls,
          `scrollWidth ${r.scrollW} vs clientWidth ${r.clientW}`);
        check(`${theme}: ভাসমান কিছু navbar ঢাকছে না`, r.covering.length === 0,
          r.covering.length ? r.covering.join(' | ') : `navbar নিচের প্রান্ত ${r.navBottom}px`);

        await page.screenshot({ path: path.join(SHOTS, `${slug}_${theme}.png`), fullPage: false });
      }
      console.log(`  → audit/screens/${slug}_dark.png · ${slug}_light.png`);
    }

    // ── টোস্ট-অফসেট পাতাভেদে মানিয়ে নেয় কিনা ──
    //   ToastProvider যে হিসাবটি রানটাইমে করে, হুবহু সেটিই এখানে চালাই।
    //   পাবলিক (৭০px) ও অ্যাডমিন (৬৯+৫৯=১২৮px) — দুই জায়গায় ভিন্ন মান
    //   আসা চাই, নাহলে স্থির মান বসালে এক পাশে ভুল হতো।
    const OFFSET_CALC = `(function () {
      var bottom = 0;
      document.querySelectorAll('header, nav').forEach(function (el) {
        var pos = getComputedStyle(el).position;
        if (pos !== 'sticky' && pos !== 'fixed') return;
        var r = el.getBoundingClientRect();
        if (r.height > 0 && r.top <= 8 && r.bottom > bottom) bottom = r.bottom;
        else if (r.height > 0 && r.top > 0 && r.top < 200 && r.bottom > bottom) bottom = r.bottom;
      });
      return Math.round(bottom) + 12;
    })()`;

    console.log('\n── টোস্ট-অফসেট (রানটাইম হিসাব) ──');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const pubOffset = await page.evaluate(OFFSET_CALC) as number;
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const admOffset = await page.evaluate(OFFSET_CALC) as number;
    console.log(`  পাবলিক /login : ${pubOffset}px · অ্যাডমিন /admin : ${admOffset}px`);
    check('পাবলিক অফসেট হেডারের নিচে', pubOffset >= 70, `${pubOffset}px ≥ 70px`);
    check('অ্যাডমিন অফসেট ট্যাব-বারেরও নিচে', admOffset >= 128, `${admOffset}px ≥ 128px`);
    check('দুই লেআউটে অফসেট আলাদা (স্থির মান নয়)', admOffset > pubOffset,
      `${pubOffset} → ${admOffset}`);

    check('কনসোল ত্রুটি নেই', consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'পরিষ্কার');
    check('রানটাইম ত্রুটি নেই', pageErrors.length === 0,
      pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'পরিষ্কার');
  } finally {
    await ctx.close();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
