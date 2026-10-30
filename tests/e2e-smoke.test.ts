/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ব্রাউজার smoke — যা HTTP টেস্ট কখনো ধরতে পারে না (Group D / M4)
 *
 *   ── কেন এটি দরকার, বাকি ৪০টি টেস্ট থাকা সত্ত্বেও ──
 *   HTTP টেস্ট সার্ভারের **উত্তর** যাচাই করে। কিন্তু H3-তে
 *   nonce-ভিত্তিক CSP বসানো হয়েছে, আর CSP ভাঙলে সার্ভার দিব্যি
 *   200 ফেরত দেয় — পাতা শুধু **ব্রাউজারে** নীরবে মরে যায়:
 *   স্ক্রিপ্ট ব্লক হয়, hydration হয় না, বোতামে ক্লিক কাজ করে না।
 *   `curl` সেটি কখনো দেখবে না। তাই একটি আসল ব্রাউজার লাগে।
 *
 *   CLAUDE.md §3.2 H3 স্পষ্ট বলেছিল: "If nonce turns out to break
 *   Next hydration, stop and report — do not silently leave
 *   unsafe-inline while claiming it is fixed." এই টেস্টটিই সেই
 *   দাবির চলমান প্রমাণ।
 *
 *   ── M4 নিষ্পত্তি ──
 *   `playwright-core` কে CLAUDE.md §3.3 "devDependency with zero test
 *   files" বলেছিল। বাস্তবে সেটি **ভুল**: `scripts/` এর ২৩টি ফাইল
 *   ইতিমধ্যেই এটি ব্যবহার করে (audit-pages, auth-ui-test, …)। তাই
 *   নির্ভরতাটি সরানো ভুল হতো — সরালে ঐ ২৩টি স্ক্রিপ্ট ভেঙে যেত।
 *   এখন টেস্ট-স্যুটেও একটি বাস্তব ব্যবহার যোগ হলো।
 *
 *   ⚠️ `playwright-core` নিজে কোনো ব্রাউজার নামায় না — মেশিনে থাকা
 *   Chrome/Edge ব্যবহার করে (scripts/ এর প্রচলিত রীতি)। না পেলে
 *   টেস্ট **সরবে skip** হয় ও কারণ ছাপে; নীরব skip নয়, কারণ নীরব
 *   skip মানে কেউ ভাববে ব্রাউজার-যাচাই হয়েছে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { db } from '../vitest.setup';
import { baseUrl } from './helpers/app';
import { createUser, createAdmin, createVariant, createCompletedOrder, balanceOf, DEFAULT_PASSWORD } from './helpers/factories';
import { generateApiKey } from '../src/lib/apiKey';

const EXE = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find(existsSync);

if (!EXE) {
  console.warn(
    '\n⚠️  ব্রাউজার smoke skip — Chrome/Edge পাওয়া যায়নি।\n' +
      '   CSP/hydration যাচাই **হয়নি**। CI-তে ব্রাউজার ইনস্টল করলে চলবে।\n',
  );
}

/** ★ CSP লঙ্ঘন ও hydration ব্যর্থতা — এই দুটোই নীরব ঘাতক */
const isFatal = (text: string) =>
  /Content Security Policy|Refused to (execute|load|apply)|Hydration failed|did not match|Minified React error/i.test(
    text,
  );

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ব্রাউজার চালু করার **আগে** রুটগুলো compile করিয়ে নেওয়া
 *
 *   ⚠️ কোন ব্যর্থতা এটি সারায় (মাপা, অনুমান নয়): ১০টি পূর্ণ রানের
 *   একটিতে এই ফাইলের দুটি টেস্টই ব্যর্থ হয়েছিল, আর সেই রানটি
 *   ১৮৪s নিয়েছিল (বাকিগুলো ~১০০s)। দুটি লক্ষণ —
 *     · `waitForURL: Timeout 45000ms` — লগইনের পর গন্তব্য পাতাটি
 *       তখনো compile হচ্ছিল
 *     · `Unexpected token '<', "<!DOCTYPE "` — `/api/auth/session`
 *       compile হওয়ার আগে JSON-এর বদলে HTML ফেরত দিয়েছে
 *
 *   অর্থাৎ টেস্টগুলো `next dev`-এর চাহিদামতো কম্পাইলারের সাথে দৌড়
 *   দিচ্ছিল। টাইমআউট বাড়ানো এটি **ঢাকত**, সারাত না — মেশিন ধীর
 *   হলে আবার ফিরে আসত। `tests/order.test.ts` একই সমস্যার জন্য
 *   একই সমাধান ব্যবহার করে: আগে একবার হিট করে compile করিয়ে নেওয়া।
 *
 *   ⚠️ ব্যর্থতা গিলে ফেলা হয় — এটি কেবল গরম করা, যাচাই নয়।
 *   আসল দাবিগুলো নিচের টেস্টেই আছে।
 * ═══════════════════════════════════════════════════════════
 */
beforeAll(async () => {
  if (!EXE) return;
  const paths = [
    '/', '/login', '/account', '/account/orders',
    '/api/auth/session', '/api/auth/csrf', '/api/auth/providers',
    // ★ ডাইনামিক সেগমেন্ট — id যা-ই হোক, রুট মডিউলটি compile হয়
    '/admin/users/warmup',
  ];
  await Promise.all(
    paths.map((p) =>
      fetch(`${baseUrl()}${p}`, { redirect: 'follow' }).catch(() => null),
    ),
  );
}, 180_000);

describe('ব্রাউজার smoke (CSP + hydration)', () => {
  it.skipIf(!EXE)(
    'হোমপেজ ও লগইন — কোনো CSP লঙ্ঘন বা hydration ব্যর্থতা নেই',
    async () => {
      const user = await createUser(db, { balance: 250 });

      const browser = await chromium.launch({ headless: true, executablePath: EXE });
      const problems: string[] = [];

      try {
        const page = await browser.newPage();
        page.on('console', (m) => {
          if (m.type() === 'error' && isFatal(m.text())) problems.push(`console: ${m.text()}`);
        });
        page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

        // ── ১. হোমপেজ রেন্ডার ও hydrate হয় ──
        await page.goto(baseUrl(), { waitUntil: 'networkidle', timeout: 60_000 });
        expect(problems, `হোমপেজে সমস্যা:\n${problems.join('\n')}`).toEqual([]);

        // ── ২. আসল ফর্ম দিয়ে লগইন — ক্লায়েন্ট-সাইড JS চলছে কিনা তার
        //      প্রমাণ (স্ক্রিপ্ট ব্লক হলে submit হ্যান্ডলারই চলত না) ──
        await page.goto(`${baseUrl()}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.fill('#email', user.email);
        await page.fill('#pw', DEFAULT_PASSWORD);
        await page.click('button[type="submit"]');

        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 });

        // ── ৩. সেশন সত্যিই তৈরি হয়েছে ──
        /**
         * ⚠️ `r.json()` সরাসরি নয়: `next dev` কোনো রুট compile করার
         *   সময় JSON-এর বদলে HTML ফেরত দিতে পারে, আর তখন ব্যর্থতাটি
         *   `Unexpected token '<'` হয়ে আসে — যা পড়ে কেউ বুঝবে না
         *   আসল সমস্যা কী। উপরের warm-up এটি ঠেকায়; এখানে টেক্সট
         *   পড়ে নিজেরাই parse করি যাতে ব্যর্থ হলে **কারণটা দেখা যায়**।
         */
        const raw = await page.evaluate(async () => {
          const r = await fetch('/api/auth/session');
          return { status: r.status, ct: r.headers.get('content-type') ?? '', body: await r.text() };
        });
        expect(
          raw.ct.includes('application/json'),
          `/api/auth/session JSON দেয়নি (status ${raw.status}, type "${raw.ct}") — ` +
            `প্রথম ২০০ অক্ষর:\n${raw.body.slice(0, 200)}`,
        ).toBe(true);

        const session = JSON.parse(raw.body) as { user?: { id?: string } };
        expect(session?.user?.id).toBe(user.id);

        expect(problems, `লগইন প্রবাহে সমস্যা:\n${problems.join('\n')}`).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    150_000,
  );

  /**
   * ★★★ Group F — রিসেলার প্যানেল আসলেই hydrate হয়।
   *
   *   HTTP টেস্ট প্রমাণ করেছে সার্ভার-রেন্ডার করা HTML ঠিক আছে ও
   *   হ্যাশ ফাঁস হয় না। কিন্তু প্যানেলটি একটি **ক্লায়েন্ট** কম্পোনেন্ট:
   *   hydration ভাঙলে সার্ভার-HTML দিব্যি দেখা যেত, শুধু বোতামগুলো
   *   কিছুই করত না — আর অ্যাডমিন ভাবতেন ফিচারটা "কাজ করছে না"।
   *   তাই এখানে সত্যিকারের ক্লিক করে ডায়ালগ খোলা হয়।
   */
  it.skipIf(!EXE)(
    'অ্যাডমিন — রিসেলার প্যানেল ব্রাউজারে hydrate হয় ও বোতাম কাজ করে',
    async () => {
      const admin = await createAdmin(db);
      const target = await createUser(db, { balance: 100 });
      await db.user.update({ where: { id: target.id }, data: { tier: 'RESELLER' } });

      const { hash, prefix } = generateApiKey();
      await db.apiKey.create({
        data: { userId: target.id, label: 'ব্রাউজার কী', prefix, hash },
      });

      const browser = await chromium.launch({ headless: true, executablePath: EXE });
      const problems: string[] = [];

      try {
        const page = await browser.newPage();
        page.on('console', (m) => {
          if (m.type() === 'error' && isFatal(m.text())) problems.push(`console: ${m.text()}`);
        });
        page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

        await page.goto(`${baseUrl()}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.fill('#email', admin.email);
        await page.fill('#pw', DEFAULT_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 });

        await page.goto(`${baseUrl()}/admin/users/${target.id}`, {
          waitUntil: 'networkidle', timeout: 60_000,
        });

        // ★ কী তালিকা রেন্ডার হয়েছে (উপসর্গই দেখানো হয়, পুরো কী নয়)
        await page.waitForSelector(`text=${prefix}`, { timeout: 15_000 });

        // ★★★ hydration-এর আসল প্রমাণ: ক্লিকে ডায়ালগ খোলে। স্ক্রিপ্ট
        //     ব্লক হলে বা hydration ভাঙলে এখানেই টাইমআউট হতো।
        await page.click('text=সাধারণ স্তরে ফেরান');
        await page.waitForSelector('text=তাঁর সব API কী সাথে সাথে অকেজো', { timeout: 15_000 });

        expect(problems, `রিসেলার প্যানেলে সমস্যা:\n${problems.join('\n')}`).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    150_000,
  );

  /**
   * ═══════════════════════════════════════════════════════════
   * ★★★ ৩২০px — সবচেয়ে সরু ফোনে পাতা অনুভূমিকভাবে স্ক্রল করে না
   *
   *   ── কোন বাগটি এটি আটকায় (প্রোডাকশন বিল্ডে মাপা, ২০২৬-০৮-১৪) ──
   *   `Navbar.tsx` এর ব্র্যান্ড-লিংকে `shrink-0` ছিল। ৩২০px পর্দায়
   *   হেডার-সারিতে জায়গা ২৮৮px, অথচ লিংকটি একাই ১৮১px নিত, ডানে
   *   ব্যালেন্স-চিপ ও হ্যামবার্গার। সারিটি সংকুচিত হতে না পারায়
   *   **প্রতিটি `/account/*` পাতা ২৩px পাশে স্ক্রলযোগ্য** হয়ে যেত।
   *
   *   ⚠️ কেন ইউনিট টেস্টে ধরা পড়ত না: এটি সম্পূর্ণভাবে **লেআউটের**
   *   ব্যাপার — সার্ভার দিব্যি 200 আর সঠিক HTML দেয়। কেবল আসল
   *   ব্রাউজারে, আসল প্রস্থে মাপলেই ধরা পড়ে।
   *
   *   ⚠️ বুট-পর্দা সরার জন্য অপেক্ষা করা হয় — নাহলে মাপা হতো
   *   পর্দার নিচে থাকা অসম্পূর্ণ লেআউট, আর টেস্টটি মিথ্যা সবুজ হতো।
   * ═══════════════════════════════════════════════════════════
   */
  it.skipIf(!EXE)(
    '৩২০px ফোনে গ্রাহকের পাতাগুলো অনুভূমিকভাবে স্ক্রল করে না',
    async () => {
      const user = await createUser(db, { balance: 5000 });
      const browser = await chromium.launch({ headless: true, executablePath: EXE });

      try {
        const ctx = await browser.newContext({
          viewport: { width: 320, height: 568 },
          isMobile: true, hasTouch: true, deviceScaleFactor: 3,
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
            '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        });
        const page = await ctx.newPage();

        await page.goto(`${baseUrl()}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.fill('#email', user.email);
        await page.fill('#pw', DEFAULT_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 });

        for (const route of ['/account', '/account/orders', '/account/wallet/deposit']) {
          await page.goto(baseUrl() + route, { waitUntil: 'networkidle', timeout: 60_000 });
          await page
            .waitForFunction(`!document.getElementById('v-boot')`, null, { timeout: 30_000 })
            .catch(() => {});
          await page.waitForTimeout(300);

          const m = (await page.evaluate(`({
            sw: document.documentElement.scrollWidth,
            cw: document.documentElement.clientWidth,
          })`)) as { sw: number; cw: number };

          expect(
            m.sw,
            `${route} ৩২০px এ ${m.sw - m.cw}px পাশে উপচে পড়েছে (scrollWidth ${m.sw} > ${m.cw})`,
          ).toBeLessThanOrEqual(m.cw + 1);
        }
      } finally {
        await browser.close();
      }
    },
    150_000,
  );
  /**
   * ═══════════════════════════════════════════════════════════
   * ★★★ হোমপেজ, ৩৯০px ফোন — প্রি-প্রোডাকশন লক (২০২৬-০৯-২৭) এ পাওয়া দুটি ত্রুটি
   *
   *   ১. "সদ্য সম্পন্ন অর্ডার"-এর `ul.grid`-এ কোনো মূল কলাম ছিল না, তাই অন্তর্নিহিত
   *      `auto` কলাম লম্বা প্রোডাক্ট-নামের nowrap প্রস্থে (৫১৩px) বেড়ে যেত —
   *      প্রতিটি সারির ডানের "সম্পন্ন"/সময় ৩৫৮px কার্ডের বাইরে কাটা পড়ত।
   *   ২. নোটিশ-বারের ✕ ছিল ৩২×৩২ — প্রকল্পের ৪০px নিয়মের নিচে।
   *   ৩. reduced-motion-এ চলন থামলে লম্বা নোটিশের শেষটুকু পড়ার উপায় ছিল না —
   *      এখন জানালাটি আড়াআড়ি স্ক্রলযোগ্য।
   * ═══════════════════════════════════════════════════════════
   */
  it.skipIf(!EXE)(
    '৩৯০px হোমপেজ: লাইভ-অর্ডারের সারি কার্ডে ধরে, নোটিশের ✕ ≥৪০px, reduced-motion-এ নোটিশ স্ক্রলযোগ্য',
    async () => {
      const variant = await createVariant(db, { price: 100, stock: -1 });
      const buyer = await createUser(db, { name: 'মোহাম্মদ পরীক্ষক' });
      const order = await createCompletedOrder(db, { userId: buyer.id, variantId: variant.id });
      await db.order.update({
        where: { id: order.id },
        data: { productName: 'Free Fire [BD SERVER] — বাংলাদেশ সার্ভার (তাৎক্ষণিক ডেলিভারি) অনেক লম্বা নাম', variantName: '25 Diamond' },
      });
      const NOTICE = 'প্রতিটি পেমেন্ট আমরা নিজে যাচাই করি — অর্ডারের অবস্থা যেকোনো সময় অ্যাকাউন্টে দেখতে পারবেন। শেষ-চিহ্ন ZQ9END';
      await db.setting.upsert({ where: { key: 'site_notice' }, update: { value: NOTICE }, create: { key: 'site_notice', value: NOTICE } });

      const browser = await chromium.launch({ headless: true, executablePath: EXE });
      try {
        for (const reducedMotion of ['no-preference', 'reduce'] as const) {
          const ctx = await browser.newContext({
            viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion,
          });
          const page = await ctx.newPage();
          // ★ সার্ভারের সেটিং-ক্যাশ (৩০s) নতুন নোটিশ না দেখা পর্যন্ত আবার লোড
          for (let i = 0; i < 12; i++) {
            await page.goto(`${baseUrl()}/`, { waitUntil: 'networkidle', timeout: 60_000 });
            await page.waitForFunction(`!document.getElementById('v-boot')`, null, { timeout: 30_000 }).catch(() => {});
            if (await page.locator('.marquee-viewport').count()) break;
            await page.waitForTimeout(4000);
          }

          const m = (await page.evaluate(`(function(){
            var card = document.getElementById('live-orders-h').closest('.card').getBoundingClientRect();
            var rows = Array.prototype.map.call(document.querySelectorAll('#live-orders li'), function (li) {
              return Math.round(li.getBoundingClientRect().right - card.right);
            });
            var x = document.querySelector('button[aria-label="নোটিশ বন্ধ করুন"]').getBoundingClientRect();
            var vp = document.querySelector('.marquee-viewport');
            return { rows: rows, xw: x.width, xh: x.height, ox: getComputedStyle(vp).overflowX,
              scrollable: vp.scrollWidth > vp.clientWidth, dupHidden: vp.querySelectorAll('.marquee-track > [aria-hidden="true"]').length > 0
                && getComputedStyle(vp.querySelector('.marquee-track > [aria-hidden="true"]')).display === 'none' };
          })()`)) as { rows: number[]; xw: number; xh: number; ox: string; scrollable: boolean; dupHidden: boolean };

          expect(m.rows.length, 'লাইভ-অর্ডারে সারি নেই').toBeGreaterThan(0);
          expect(Math.max(...m.rows), `সারি কার্ডের ${Math.max(...m.rows)}px বাইরে (${reducedMotion})`).toBeLessThanOrEqual(1);
          expect(Math.min(m.xw, m.xh), `✕ ${m.xw}×${m.xh}`).toBeGreaterThanOrEqual(40);
          if (reducedMotion === 'reduce') {
            expect(m.ox, 'reduced-motion-এ নোটিশ-জানালা স্ক্রলযোগ্য নয়').toBe('auto');
            expect(m.scrollable, 'লম্বা নোটিশ জানালার চেয়ে চওড়া হওয়া উচিত').toBe(true);
            expect(m.dupHidden, 'লুপের দ্বিতীয় কপি লুকানো নয়').toBe(true);
          } else {
            expect(m.ox).toBe('hidden');
          }
          await ctx.close();
        }
      } finally {
        await browser.close();
        await db.setting.deleteMany({ where: { key: 'site_notice' } });
      }
    },
    240_000,
  );

  /**
   * ═══════════════════════════════════════════════════════════
   * ★★★ নিশ্চিতকরণ ডায়ালগে দুইবার ক্লিক — একটিই অর্ডার, একবারই চার্জ
   *
   *   ── কোন বাগটি এটি আটকায় (প্রোডাকশন বিল্ডে মাপা, ২০২৬-০৮-১৫) ──
   *   দ্রুত দুইবার ট্যাপে **দুটি অর্ডার** হতো ও ওয়ালেট থেকে **দুইবার**
   *   টাকা কাটত। কারণ দুটি, দুটোই "গার্ড আছে" মনে হওয়া সত্ত্বেও:
   *     · গার্ডগুলো React state-এ ছিল — পরের রেন্ডারে বসে, তাই একই
   *       টিকের দ্বিতীয় ক্লিক তখনো `false` দেখত
   *     · `ConfirmDialog` এর reset শর্ত ছিল `if (!open)`, আর কলার
   *       `onConfirm`-এর ভেতরেই ডায়ালগ বন্ধ করে — ফলে গার্ড সাথে
   *       সাথেই খুলে যেত, অথচ exit-অ্যানিমেশনে বোতামটি আরও ~২০০ms
   *       ক্লিকযোগ্য থাকত
   *
   *   ⚠️ HTTP টেস্ট এটি ধরতে পারে না — সার্ভারের দিক থেকে দুটি বৈধ
   *      অনুরোধ, ভিন্ন idempotency key নিয়ে। ধরা পড়ে কেবল আসল
   *      ব্রাউজারে, আসল ডায়ালগে দুইবার ক্লিক করলে।
   * ═══════════════════════════════════════════════════════════
   */
  it.skipIf(!EXE)(
    'অর্ডার নিশ্চিতকরণে দুইবার ক্লিকেও একটিই অর্ডার ও একবারই চার্জ',
    async () => {
      const variant = await createVariant(db, { price: 100, stock: -1 });
      const user = await createUser(db, { balance: 1000 });
      const product = await db.product.findFirst({
        where: { variants: { some: { id: variant.id } } },
        select: { id: true, slug: true },
      });

      const browser = await chromium.launch({ headless: true, executablePath: EXE });
      try {
        const page = await browser.newPage();
        await page.goto(`${baseUrl()}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.fill('#email', user.email);
        await page.fill('#pw', DEFAULT_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 });

        await page.goto(`${baseUrl()}/product/${product!.id}/${product!.slug}`, {
          waitUntil: 'networkidle', timeout: 60_000,
        });
        await page.waitForFunction(`!document.getElementById('v-boot')`, null, { timeout: 30_000 })
          .catch(() => {});

        await page.locator('[role="radio"]').first().click();
        await page.fill('#uid', '123456789');
        if (await page.locator('#uid2').count()) await page.fill('#uid2', '123456789');
        const wallet = page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first();
        if (await wallet.count()) await wallet.click().catch(() => {});
        await page.waitForTimeout(300);

        await page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().click({ timeout: 20_000 });
        await page.waitForTimeout(400);

        // ★★★ দুইবার ক্লিক — দ্বিতীয়টি জোর করে, exit-অ্যানিমেশনের ভেতরেই
        const ok = page.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first();
        await ok.click({ timeout: 15_000 });
        await page.waitForTimeout(60);
        await ok.click({ force: true, timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(6000);

        const orders = await db.order.count({ where: { userId: user.id } });
        const entries = await db.ledgerEntry.count({ where: { userId: user.id } });
        const bal = await balanceOf(db, user.id);

        expect(orders, `${orders}টি অর্ডার তৈরি হয়েছে`).toBe(1);
        expect(entries, `${entries}টি খতিয়ান এন্ট্রি`).toBe(1);
        expect(bal, `ব্যালেন্স ৳${bal}`).toBe(900);
      } finally {
        await browser.close();
      }
    },
    180_000,
  );
});