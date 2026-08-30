/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ M1/M2/M5 যাচাই
 *
 *   `npx tsx scripts/verify/theme-meta-token.ts`
 *
 *   M1 — `globals.css` এর শীর্ষ-মন্তব্য আর "LIGHT THEME" দাবি করে না
 *        (নিচের ব্লক আসলে dark)
 *   M2 — `--gold` অলিভ-সবুজ বলে ডকুমেন্টেড, পুনঃনামকরণ হয়নি
 *   M5 — মেটা `theme-color` টোকেন থেকে আসে; থিম বদলালে **প্রকৃত
 *        ব্রাউজারে** মান বদলায় ও `--v-void` এর সমান হয়
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { openBrowser } from './_browser';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = `http://localhost:${process.argv.find((a) => a.startsWith('--port='))?.slice(7) || '3000'}`;

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/** থিম বসিয়ে meta theme-color ও --v-void পড়ে */
const READ = (theme: string) => `(function () {
  document.documentElement.setAttribute('data-theme', '${theme}');
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  return {
    token: getComputedStyle(html).getPropertyValue('--v-void').trim(),
    meta: meta ? meta.getAttribute('content') : null
  };
})()`;

(async () => {
  console.log('═══ M1 / M2 / M5 যাচাই ═══\n');

  // ── M1 ও M2: সোর্স ──
  console.log('── M1 / M2 (সোর্স) ──');
  const css = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const head = css.slice(0, 1600);
  // ⚠️ স্ট্রিংটি নতুন মন্তব্যের **ব্যাখ্যায়** উদ্ধৃত আছে ("আগে লেখা ছিল…"),
  //   তাই কেবল উপস্থিতি দেখলে মিথ্যা ব্যর্থতা হয়। আসল প্রশ্ন: এটি
  //   এখনো **শিরোনাম** হিসেবে ব্যবহৃত হচ্ছে কিনা (═ দিয়ে ঘেরা)।
  check('M1: শীর্ষ-মন্তব্য আর "LIGHT THEME" শিরোনাম নয়',
    !/═+\s*STOREFRONT\s+—\s+LIGHT THEME\s*═+/.test(head));
  check('M1: শীর্ষ-মন্তব্য ব্লকটিকে DARK বলে চিহ্নিত করে',
    /ডিফল্ট থিম\s+—\s+DARK/.test(head));
  check('M2: --gold এর নাম-ভুল ডকুমেন্টেড', /`--gold` নামটি \*\*ভুল\*\*/.test(css));
  check('M2: --gold পুনঃনামকরণ হয়নি', /--gold:#bef264/.test(css) && /--gold:#5a8a00/.test(css));

  const tp = readFileSync(path.join(process.cwd(), 'src/components/theme/ThemeProvider.tsx'), 'utf8');
  check('M5: ThemeProvider এ হার্ডকোড হেক্স আর প্রাথমিক পছন্দ নয়',
    /getPropertyValue\('--v-void'\)/.test(tp));

  // ── M5: প্রকৃত ব্রাউজার ──
  console.log('\n── M5 (ব্রাউজার) ──');
  const browser = await openBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    for (const theme of ['dark', 'light'] as const) {
      // থিম বসিয়ে ThemeProvider-কে চলতে সময় দিই
      await page.evaluate(READ(theme));
      await page.waitForTimeout(400);
      const r = await page.evaluate(READ(theme)) as { token: string; meta: string | null };
      console.log(`  ${theme.padEnd(6)} --v-void=${r.token.padEnd(9)} meta=${r.meta}`);
      check(`${theme}: --v-void টোকেন আছে`, Boolean(r.token), r.token);
      check(`${theme}: meta theme-color সেট আছে`, Boolean(r.meta), r.meta || '(নেই)');
    }

    /**
     * ★★★ আসল end-to-end দাবি: **ThemeProvider নিজে** meta বসায় ও
     *   সেটি টোকেনের সমান হয়।
     *   উপরে `data-theme` হাতে বসানো হয়েছিল, তাই React-এর `apply()`
     *   চলেনি — সেই পরিমাপ দুর্বল। এখানে `localStorage` দিয়ে পছন্দ
     *   সেট করে **পাতা রিলোড** করি, যাতে ThemeProvider mount-এ নিজেই
     *   থিম প্রয়োগ করে। তখনই meta-র মান প্রকৃত।
     */
    /**
     * ⚠️ আগে এখানে প্রত্যাশিত হেক্স **হার্ডকোড** ছিল
     *   (`['light', '#f4f6fb']`)। Group C-তে `--v-void` বদলে
     *   `#f6f7f9` হতেই পরীক্ষা ভেঙে পড়ে — অথচ কোড ঠিকই ছিল।
     *   এটি ঠিক সেই ভুল যা M5 সারাতে চেয়েছিল: একই মান দুই জায়গায়।
     *   আসল দাবি হলো **meta = টোকেন**, মানটি যাই হোক।
     */
    const seen: Record<string, string> = {};
    for (const choice of ['dark', 'light'] as const) {
      await page.evaluate(`localStorage.setItem('theme','${choice}')`);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const got = await page.evaluate(
        `(function(){var m=document.querySelector('meta[name="theme-color"]');return {
           meta: m ? m.getAttribute('content') : null,
           token: getComputedStyle(document.documentElement).getPropertyValue('--v-void').trim(),
           theme: document.documentElement.dataset.theme
         };})()`,
      ) as { meta: string | null; token: string; theme: string };
      console.log(`  reload(${choice}) → data-theme=${got.theme} token=${got.token} meta=${got.meta}`);
      check(`★ ${choice}: ThemeProvider meta = --v-void টোকেন`,
        Boolean(got.token) && got.meta === got.token,
        `meta=${got.meta} token=${got.token}`);
      check(`${choice}: data-theme সঠিকভাবে প্রয়োগ হয়েছে`, got.theme === choice, got.theme);
      seen[choice] = got.token;
    }
    // দুই থিমে পৃষ্ঠতল আলাদা না হলে meta বদলানোর দাবিটাই অর্থহীন
    check('dark ও light এর --v-void আলাদা', seen.dark !== seen.light,
      `${seen.dark} vs ${seen.light}`);
    await page.evaluate(`localStorage.removeItem('theme')`);
  } finally {
    await ctx.close();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
