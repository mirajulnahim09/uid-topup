/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group C যাচাই — CLAUDE.md §5.5 গ্রহণযোগ্যতা
 *
 *   `npx tsx scripts/verify/theme-contrast.ts`
 *
 *   §5.5 যা দাবি করে, প্রতিটি এখানে assert হয়:
 *     · প্রতিটি লেখা/পটভূমি জোড়া ≥ ৪.৫:১ (UI/বর্ডার ≥ ৩:১)
 *     · **দুই থিম × পাঁচটি accent প্রিসেট** — মোট ১০টি সমন্বয়
 *     · কোনো JSX/TSX ফাইল বদলায়নি
 *     · নতুন কোনো `!important` যোগ হয়নি
 *
 *   অনুপাত প্রকৃত ব্রাউজারে **computed** টোকেন থেকে মাপা — হাতে
 *   লেখা হেক্স থেকে নয়, নাহলে টোকেন বদলালে সংখ্যা মিথ্যা হয়ে যেত।
 *   স্বচ্ছ (rgba) টোকেন তার পৃষ্ঠতলের উপর composite করে মাপা হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { openBrowser } from './_browser';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const ACCENTS = ['', 'purple', 'blue', 'red', 'orange'] as const;
const THEMES = ['dark', 'light'] as const;

let fail = 0;
const gaps = new Set<string>();
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/**
 * ব্রাউজারে চলে: টোকেন পড়ে, rgba হলে পৃষ্ঠতলের উপর composite করে,
 * তারপর WCAG অনুপাত বের করে।
 */
const MEASURE = `(function () {
  var cs = getComputedStyle(document.documentElement);
  function tok(n) { return cs.getPropertyValue(n).trim(); }

  function parse(c) {
    c = c.trim();
    if (c.charAt(0) === '#') {
      var h = c.slice(1);
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 1];
    }
    var m = c.match(/[\\d.]+/g) || ['0','0','0'];
    return [Number(m[0]), Number(m[1]), Number(m[2]), m.length > 3 ? Number(m[3]) : 1];
  }
  function over(fg, bg) {
    var a = fg[3];
    return [fg[0]*a + bg[0]*(1-a), fg[1]*a + bg[1]*(1-a), fg[2]*a + bg[2]*(1-a), 1];
  }
  function lum(c) {
    var o = [];
    for (var i = 0; i < 3; i++) { var s = c[i]/255; o.push(s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4)); }
    return 0.2126*o[0] + 0.7152*o[1] + 0.0722*o[2];
  }
  function ratio(fgTok, bgTok) {
    var bg = parse(tok(bgTok));
    var fg = over(parse(tok(fgTok)), bg);
    var l1 = lum(fg), l2 = lum(bg);
    return Math.round(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)) * 100) / 100;
  }

  return {
    'প্রাথমিক বোতাম (accent-ink / accent)':      ratio('--accent-ink', '--accent'),
    'সেকেন্ডারি বোতাম (v-ink / v-steel)':        ratio('--v-ink', '--v-steel'),
    'মূল লেখা (v-ink / v-pit)':                   ratio('--v-ink', '--v-pit'),
    'মূল লেখা পাতায় (v-ink / v-void)':            ratio('--v-ink', '--v-void'),
    'সহায়ক লেখা (v-mut / v-pit)':                 ratio('--v-mut', '--v-pit'),
    'লিংক (v-ice / v-pit)':                       ratio('--v-ice', '--v-pit'),
    'অ্যাকসেন্ট-লেখা (accent-text / v-void)':     ratio('--accent-text', '--v-void'),
    'সফল (sem-success / v-pit)':                  ratio('--sem-success', '--v-pit'),
    'সতর্কতা (sem-warning / v-pit)':              ratio('--sem-warning', '--v-pit'),
    'ত্রুটি (sem-danger / v-pit)':                ratio('--sem-danger', '--v-pit'),
    'তথ্য (sem-info / v-pit)':                    ratio('--sem-info', '--v-pit'),
    'প্লেসহোল্ডার (v-dim / v-field)':             ratio('--v-dim', '--v-field'),
    'ইনপুট বর্ডার (v-edge-field / v-field)':      ratio('--v-edge-field', '--v-field'),
    'ফোকাস রিং (v-focus-ring / v-field)':         ratio('--v-focus-ring', '--v-field'),
    'কার্ড hairline (v-edge2 / v-pit)':           ratio('--v-edge2', '--v-pit'),
    'এলিভেশন ধাপ (v-steel / v-pit)':              ratio('--v-steel', '--v-pit')
  };
})()`;

/** কেবল তথ্য — এলিভেশন ধাপ যত কম তত ভালো, এটি কন্ট্রাস্ট-দাবি নয় */
const INFO_ONLY = new Set(['এলিভেশন ধাপ (v-steel / v-pit)']);

/** UI উপাদান — WCAG 1.4.11 অনুযায়ী ৩:১ যথেষ্ট (লেখা নয়) */
const UI_3TO1 = new Set([
  'ইনপুট বর্ডার (v-edge-field / v-field)',
  'ফোকাস রিং (v-focus-ring / v-field)',
]);

/**
 * ★★★ ইচ্ছাকৃত নকশা-সিদ্ধান্ত (মালিকের অনুমোদিত) — ঘাটতি নয়।
 *
 *   কার্ডের hairline (`--v-edge2`) ইচ্ছাকৃতভাবে **নরম** (~১.৪–১.৬:১),
 *   §5.4 যেমন চেয়েছে। WCAG 1.4.11 প্রতিটি সাজসজ্জার রেখায় ৩:১ চায় না —
 *   চায় সেখানে, যেখানে **উপাদান চেনা** বা **অবস্থা বোঝা** ওই রেখার
 *   উপর নির্ভর করে। সেই দুটি জায়গা আলাদা করে শক্ত করা হয়েছে:
 *     · ইনপুটের সীমানা → `--v-edge-field` (≥৩:১)
 *     · ফোকাসের অবস্থান → `--v-focus-ring` (≥৩:১)
 *   কার্ডের প্রান্ত চেনার জন্য বর্ডার লাগে না — পৃষ্ঠতল ও ছায়াই
 *   যথেষ্ট। তাই এটি রিপোর্ট হয়, কিন্তু ব্যর্থতা নয়।
 */
const BY_DESIGN: { pair: string; ceiling: number; why: string }[] = [
  {
    pair: 'কার্ড hairline (v-edge2 / v-pit)', ceiling: 2.2,
    why: 'ইচ্ছাকৃতভাবে নরম (§5.4)। উপাদান-চেনা ইনপুট-বর্ডার ও ফোকাস-রিং দিয়ে হয়, যেগুলো আলাদাভাবে ≥৩:১ enforce করা।',
  },
];

function byDesign(pair: string) {
  return BY_DESIGN.find((g) => g.pair === pair);
}

(async () => {
  console.log('═══ Group C — লাইট থিম গ্রহণযোগ্যতা (§5.5) ═══\n');

  // ── ক) কোনো JSX/TSX বদলায়নি? ──
  console.log('── §5.5: কোনো JSX/TSX ফাইল বদলায়নি ──');
  const changed = execSync('git diff --name-only HEAD', { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const jsx = changed.filter((f) => f.endsWith('.tsx') || f.endsWith('.jsx'));
  console.log(`  বদলানো ফাইল: ${changed.join(', ') || '(কিছু নেই)'}`);
  check('০টি JSX/TSX ফাইল বদলেছে', jsx.length === 0, jsx.join(', ') || 'কেবল CSS');

  // ── খ) নতুন !important নেই? ──
  // ⚠️ শেল-পাইপ (`| grep -c`) Windows-এ চলে না — গণনা Node-এই করি
  const prevCss = execSync('git show HEAD:src/app/globals.css', {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  /**
   * ⚠️ **মন্তব্য বাদ দিয়ে** গোনা হয়। দাবিটি "নতুন !important **ঘোষণা**
   *   নয়" — কিন্তু গণনা কাঁচা স্ট্রিংয়ে হওয়ায় কোনো মন্তব্যে শব্দটি
   *   লিখলেই (যেমন "এখানে !important লাগে না, কারণ…") চেকটি লাল হতো।
   *   ২০২৬-০৮-২৬ এ ঠিক তাই ঘটেছিল: প্রিন্ট-নিয়মে একটি ব্যাখ্যা লিখতেই
   *   গণনা ৬৬ → ৭০, অথচ ঘোষণার সংখ্যা এক চুলও নড়েনি। এতে চেকটি
   *   ডকুমেন্টেশনকে শাস্তি দিত — অর্থাৎ ভুল আচরণকে উৎসাহ দিত।
   *   দুই পাশেই একই ভাবে ছাঁটা হয়, তাই তুলনা সৎ থাকে।
   */
  const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const before = (stripComments(prevCss).match(/!important/g) || []).length;
  const after = (stripComments(readFileSync('src/app/globals.css', 'utf8')).match(/!important/g) || []).length;
  check('নতুন !important যোগ হয়নি (মন্তব্য বাদে)', after <= before, `আগে ${before} · এখন ${after}`);

  // ── গ) কন্ট্রাস্ট: ২ থিম × ৫ প্রিসেট ──
  const browser = await openBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    for (const theme of THEMES) {
      for (const accent of ACCENTS) {
        const label = `${theme}/${accent || 'lime'}`;
        await page.evaluate(
          `document.documentElement.setAttribute('data-theme','${theme}');` +
          (accent
            ? `document.documentElement.setAttribute('data-accent','${accent}');`
            : `document.documentElement.removeAttribute('data-accent');`),
        );
        await page.waitForTimeout(150);

        const r = await page.evaluate(MEASURE) as Record<string, number>;
        console.log(`\n── ${label} ──`);
        for (const [pair, val] of Object.entries(r)) {
          if (INFO_ONLY.has(pair)) { console.log(`  info  ${pair.padEnd(42)} ${val}:1`); continue; }

          const design = byDesign(pair);
          if (design) {
            // ★ নকশা-সিদ্ধান্ত — নরম রাখা **উদ্দেশ্য**, তাই ব্যর্থতা নয়।
            //   তবু ছাপা হয়, আর "অকারণে গাঢ় হয়ে যায়নি" যাচাই হয়।
            console.log(`  by-design  ${pair.padEnd(38)} ${val}:1`);
            check(`${label} · ${pair} নরমই আছে (≤${design.ceiling})`,
              val <= design.ceiling, `${val}:1`);
            gaps.add(`${pair} — ${design.why}`);
            continue;
          }
          const need = UI_3TO1.has(pair) ? 3 : 4.5;
          check(`${label} · ${pair} ≥ ${need}:1`, val >= need, `${val}:1`);
        }
      }
    }

    await page.evaluate(`document.documentElement.removeAttribute('data-accent')`);
  } finally {
    await ctx.close();
  }

  if (gaps.size) {
    console.log('\n── ইচ্ছাকৃত নকশা-সিদ্ধান্ত (ঘাটতি নয়) ──');
    for (const g of gaps) console.log(`  · ${g}`);
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
