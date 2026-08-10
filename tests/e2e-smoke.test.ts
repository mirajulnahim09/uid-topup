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
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { db } from '../vitest.setup';
import { baseUrl } from './helpers/app';
import { createUser, createAdmin, DEFAULT_PASSWORD } from './helpers/factories';
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
        const session = await page.evaluate(async () => {
          const r = await fetch('/api/auth/session');
          return r.json() as Promise<{ user?: { id?: string } }>;
        });
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
});
