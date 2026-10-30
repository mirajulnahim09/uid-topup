/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ যাচাই-স্ক্রিপ্টগুলোর জন্য **একটিমাত্র** ব্রাউজার-খোলার পথ
 *
 *   ── কোন দুটি সমস্যা এটি ঠেকায় (দুটোই মাপা, ২০২৬-০৮-৩০) ──
 *
 *   ১. **বাসি `ws.txt`।** স্ক্রিপ্টগুলো কেবল ফাইলটির *অস্তিত্ব*
 *      দেখত, endpoint-টি **জীবিত** কি না নয়। ২৮ আগস্টের একটি মৃত
 *      endpoint পড়ে থাকায় প্রতিটি ব্রাউজার-ভিত্তিক যাচাই
 *      `ECONNREFUSED ::1:55526` দিয়ে **uncaught rejection**-এ মরত —
 *      অর্থাৎ গেট লাল হতো, কিন্তু কারণটি অ্যাপের সাথে সম্পর্কহীন।
 *
 *   ২. **fallback-এ ব্রাউজার নেই।** `playwright-core` কোনো ব্রাউজার
 *      বান্ডল করে না। কয়েকটি স্ক্রিপ্ট `chromium.launch({ headless })`
 *      ডাকত `executablePath` **ছাড়া**, তাই ws.txt না থাকলে
 *      "chrome-headless-shell নেই" বলে ব্যর্থ হতো। শাখাটি কখনো
 *      পরীক্ষিত হয়নি কারণ ws.txt সাধারণত থাকত।
 *
 *   ── নীতি ──
 *   • ws.txt থাকলে **চেষ্টা** করা হয়, ব্যর্থ হলে কারণ **ছেপে**
 *     নিজের ব্রাউজারে ফেরত যাওয়া হয় — নীরব fallback নয়
 *     (`GROUP D`-র "নীরব skip নয়" রীতির মতোই)।
 *   • সিস্টেমে Chrome না থাকলে স্পষ্ট বার্তায় থামা হয়, obscure
 *     playwright ত্রুটি নয়।
 * ═══════════════════════════════════════════════════════════
 */
import { chromium, firefox, webkit, type Browser } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * সিস্টেমে ইনস্টল করা Chrome — তিনটি স্বাভাবিক জায়গা।
 * ⚠️ **ফরওয়ার্ড স্ল্যাশ ইচ্ছাকৃত** — Node উইন্ডোজে দুটোই মানে, আর
 *   ব্যাকস্ল্যাশে TS-এ `\P` লিখতে ভুল হলে পথটি নীরবে বিকৃত হয়
 *   (`C:Program Files…`) এবং `existsSync` চুপচাপ false দেয়।
 *   ঠিক এই ভুলটিই এই ফাইলের প্রথম সংস্করণে হয়েছিল।
 */
const SYSTEM_CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
];

export async function openBrowser(opts: { headless?: boolean } = {}): Promise<Browser> {
  /**
   * ★ ক্রস-ব্রাউজার (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭) — `VERIFY_BROWSER=firefox|webkit`
   *   দিলে একই যাচাই-স্ক্রিপ্ট playwright-core-এর নিজস্ব ইঞ্জিনে চলে
   *   (`npx playwright-core install firefox webkit` দিয়ে নামানো)। Safari-র ইঞ্জিন
   *   WebKit — আইফোন-গ্রাহকের সবচেয়ে কাছের পরীক্ষা। ডিফল্ট আগের মতোই Chrome।
   */
  const engine = (process.env.VERIFY_BROWSER || 'chromium').trim().toLowerCase();
  if (engine === 'firefox' || engine === 'webkit') {
    return (engine === 'firefox' ? firefox : webkit).launch({ headless: opts.headless ?? true });
  }

  const wsPath = path.join(process.cwd(), 'ws.txt');

  if (existsSync(wsPath)) {
    const endpoint = readFileSync(wsPath, 'utf8').trim();
    try {
      // ★ ছোট timeout — মৃত endpoint-এ ৩০s ঝুলে থাকার মানে নেই
      return await chromium.connect(endpoint, { timeout: 5_000 });
    } catch (e) {
      console.log(
        `  ⚠️ ws.txt এর ব্রাউজার-সার্ভারে যুক্ত হওয়া গেল না — নিজের ব্রাউজার চালু করা হচ্ছে\n` +
        `     (${String(e).split('\n')[0]})`,
      );
    }
  }

  const exe = SYSTEM_CHROME.find(existsSync);
  if (!exe) {
    throw new Error(
      'সিস্টেমে Chrome পাওয়া যায়নি। `playwright-core` ব্রাউজার বান্ডল করে না — ' +
      'Chrome ইনস্টল করুন, অথবা `npx tsx scripts/pw-server.ts` চালিয়ে ws.txt তৈরি করুন।',
    );
  }
  /**
   * ⚠️ `--ignore-certificate-errors` — যাচাই-রিগের সার্টিফিকেট স্ব-স্বাক্ষরিত।
   *   কনটেক্সট-স্তরের `ignoreHTTPSErrors` **service worker** নিবন্ধনে খাটে না,
   *   তাই ছাড়া চললে Chrome লেখে "An SSL certificate error occurred when
   *   fetching the script" — অ্যাপ `/sw.js` নিবন্ধন করে (`PWA.tsx`), আর
   *   সেটি `.catch()` করা সত্ত্বেও বার্তাটি কনসোলে ওঠে ও ত্রুটি হিসেবে
   *   গোনা হতো। প্রোডাকশনে সার্ট বৈধ, তাই সমস্যাটি কেবল রিগের।
   *   মাপা: ফ্ল্যাগ ছাড়া ১টি ত্রুটি, ফ্ল্যাগসহ ০।
   *   অডিট-হারনেস আগে থেকেই একই ফ্ল্যাগ দেয়।
   */
  return chromium.launch({
    headless: opts.headless ?? true,
    executablePath: exe,
    args: ['--ignore-certificate-errors'],
  });
}
