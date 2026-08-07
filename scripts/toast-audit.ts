/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টোস্ট / নোটিফিকেশন — দৃশ্য-নিরীক্ষা (দুই থিমেই)
 *
 *   `npx tsx scripts/toast-audit.ts --tag=before`
 *   `npx tsx scripts/toast-audit.ts --tag=after`
 *
 *   দুটি জিনিস মাপে:
 *     ১. **আসল** টোস্ট — ভুল পাসওয়ার্ড দিয়ে সত্যিকারের error টোস্ট
 *        আনা হয় (ব্যবহারকারী ঠিক যেটি দেখেছেন)।
 *     ২. **চার ধরনের ম্যাট্রিক্স** — success/error/warning/info একসাথে
 *        স্ট্যাক করে, যাতে ভূমিকা-রঙ গুলিয়ে গেলে ধরা পড়ে।
 *
 *   প্রতিটির জন্য: প্রকৃত computed রঙ, WCAG কন্ট্রাস্ট অনুপাত,
 *   বাক্সের মাপ, পরস্পর ওভারল্যাপ।
 *
 *   ⚠️ `page.evaluate` এর কলব্যাক **স্ট্রিং** হিসেবে পাঠানো হয়:
 *      tsx/esbuild এর `keepNames` ট্রান্সফর্ম নামযুক্ত ফাংশনে `__name`
 *      হেল্পার ঢোকায়, যা ব্রাউজারে নেই → "ReferenceError: __name is
 *      not defined"। স্ট্রিং esbuild ছোঁয় না।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const SHOTS = path.join(process.cwd(), 'audit', 'screens');
mkdirSync(SHOTS, { recursive: true });
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) || 'after';

/** ★ নামযুক্ত টাইপ — `as typeof real` লিখলে TS নিজের narrow-করা
 *   `null` টাইপেই cast করত, ফলে পরে `real.text` → `never`। */
type RealToast = { text: string; x: number; y: number; w: number; h: number };

type ToastMetric = {
  kind: string; color: string; accent: string; bg: string; border: string;
  contrast: number; rect: { x: number; y: number; w: number; h: number }; fontSize: string;
};

/** কম্পোনেন্টের আসল SVG আইকন (Toast.tsx এর সাথে মিল) */
const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/** কম্পোনেন্টের ক্লাস — before/after তুলনার জন্য */
const VARIANTS: Record<string, {
  host: string; wrap: string; kinds: Record<string, { cls: string; icon: string }>;
}> = {
  before: {
    host: 'pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end',
    wrap: 'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border-2 px-4 py-3 shadow-xl',
    kinds: {
      success: { cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', icon: '✓' },
      error: { cls: 'border-red-300 bg-red-50 text-red-800', icon: '✕' },
      warning: { cls: 'border-amber-300 bg-amber-50 text-amber-800', icon: '⚠' },
      info: { cls: 'border-rose-300 bg-rose-50 text-rose-800', icon: 'ℹ' },
    },
  },
  after: {
    host: 'v-toast-host',
    wrap: 'v-toast',
    kinds: {
      success: { cls: 'v-toast--success', icon: svg('<path d="M20 6L9 17l-5-5"/>') },
      error: { cls: 'v-toast--error', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>') },
      warning: { cls: 'v-toast--warning', icon: svg('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>') },
      info: { cls: 'v-toast--info', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>') },
    },
  },
};

const MESSAGES: Record<string, string> = {
  success: 'লগইন সফল — অ্যাডমিন প্যানেলে নিয়ে যাওয়া হচ্ছে',
  error: 'ইমেইল বা পাসওয়ার্ড ভুল',
  warning: 'অনেকবার চেষ্টা হয়েছে — ১৪ মিনিট পর আবার চেষ্টা করুন',
  info: 'আপনার Authenticator অ্যাপের ৬-অঙ্কের কোডটি দিন',
};

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/**
 * ব্রাউজারে চলবে — স্ট্রিং, তাই esbuild ট্রান্সফর্ম হয় না।
 * ★ ডেটা স্ট্রিং-এর **ভেতরেই** JSON হিসেবে বসানো হয়: Playwright-এ
 *   স্ট্রিং-ফর্ম কলব্যাকে `arg` নির্ভরযোগ্যভাবে পৌঁছায় না।
 */
const injectAndMeasure = (variantJson: string, messagesJson: string) => `(function () {
  var variant = ${variantJson}, messages = ${messagesJson};
  var old = document.getElementById('toast-audit');
  if (old) old.remove();

  var host = document.createElement('div');
  host.id = 'toast-audit';
  host.className = variant.host;
  // অ্যাডমিন/পাবলিক হেডারের নিচে — কম্পোনেন্ট যেভাবে রানটাইমে মাপে
  host.style.setProperty('--v-toast-top', '5.5rem');

  var html = '';
  for (var kind in variant.kinds) {
    var k = variant.kinds[kind];
    html += '<div class="' + variant.wrap + ' ' + k.cls + '" data-kind="' + kind + '">'
      + '<span aria-hidden="true" class="v-toast__icon mt-0.5 shrink-0 font-bold">' + k.icon + '</span>'
      + '<p class="v-toast__msg flex-1 text-sm leading-relaxed">' + messages[kind] + '</p>'
      + '<button class="v-toast__x shrink-0 rounded p-0.5" aria-label="বন্ধ">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>'
      + '</button></div>';
  }
  host.innerHTML = html;
  document.body.appendChild(host);

  function parseRgb(s) {
    var m = s.match(/[\\d.]+/g) || ['0','0','0'];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  function alphaOf(s) {
    var m = s.match(/[\\d.]+/g);
    return (m && m.length > 3) ? Number(m[3]) : 1;
  }
  function luminance(c) {
    var out = [];
    for (var i = 0; i < 3; i++) {
      var s = c[i] / 255;
      out.push(s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
    }
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  }

  // পাতার প্রকৃত পটভূমি — স্বচ্ছ টোস্ট-ব্যাকগ্রাউন্ড এর সাথে মিশিয়ে হিসাব
  var pageBg = parseRgb(getComputedStyle(document.body).backgroundColor);
  if (alphaOf(getComputedStyle(document.body).backgroundColor) === 0) {
    pageBg = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
  }

  var out = [];
  var nodes = host.children;
  for (var n = 0; n < nodes.length; n++) {
    var box = nodes[n];
    var msg = box.querySelector('p');
    var ico = box.querySelector('.v-toast__icon');
    var cs = getComputedStyle(box);
    var ms = getComputedStyle(msg);
    var icoColor = ico ? getComputedStyle(ico).color : ms.color;
    var bgRaw = cs.backgroundColor;
    var a = alphaOf(bgRaw);
    var bgParsed = parseRgb(bgRaw);
    var bg = [
      bgParsed[0] * a + pageBg[0] * (1 - a),
      bgParsed[1] * a + pageBg[1] * (1 - a),
      bgParsed[2] * a + pageBg[2] * (1 - a)
    ];
    var fg = parseRgb(ms.color);
    var l1 = luminance(fg), l2 = luminance(bg);
    var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    var r = box.getBoundingClientRect();
    out.push({
      kind: box.getAttribute('data-kind'),
      color: ms.color,
      accent: icoColor,
      bg: bgRaw,
      border: cs.borderLeftColor,
      contrast: Math.round(ratio * 100) / 100,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      fontSize: ms.fontSize
    });
  }
  return out;
})()`;

/**
 * ★ ইনলাইন `.alert-*` — টোস্টের পাশাপাশি দ্বিতীয় বার্তা-পৃষ্ঠ।
 *   লগইন পাতা ত্রুটি দেখাতে `.alert-error` ব্যবহার করে, তাই এটিও
 *   দুই থিমে পড়ার যোগ্য হতে হবে।
 */
const MEASURE_ALERTS = `(function () {
  var old = document.getElementById('alert-audit');
  if (old) old.remove();
  var host = document.createElement('div');
  host.id = 'alert-audit';
  host.style.cssText = 'position:fixed;left:16px;top:120px;width:380px;z-index:130;display:flex;flex-direction:column;gap:8px';
  host.innerHTML =
      '<div class="alert-error" data-k="error">ইমেইল বা পাসওয়ার্ড ভুল</div>'
    + '<div class="alert-success" data-k="success">সফলভাবে সংরক্ষিত হয়েছে</div>'
    + '<div class="alert-warn" data-k="warn">অনেকবার চেষ্টা হয়েছে</div>';
  document.body.appendChild(host);

  function parseRgb(s) { var m = s.match(/[\\d.]+/g) || ['0','0','0']; return [Number(m[0]),Number(m[1]),Number(m[2])]; }
  function alphaOf(s) { var m = s.match(/[\\d.]+/g); return (m && m.length > 3) ? Number(m[3]) : 1; }
  function lum(c) {
    var o = [];
    for (var i = 0; i < 3; i++) { var s = c[i]/255; o.push(s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4)); }
    return 0.2126*o[0] + 0.7152*o[1] + 0.0722*o[2];
  }
  var pageBg = parseRgb(getComputedStyle(document.body).backgroundColor);
  if (alphaOf(getComputedStyle(document.body).backgroundColor) === 0) {
    pageBg = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
  }

  var out = [];
  for (var i = 0; i < host.children.length; i++) {
    var el = host.children[i];
    var cs = getComputedStyle(el);
    var a = alphaOf(cs.backgroundColor);
    var bp = parseRgb(cs.backgroundColor);
    var bg = [bp[0]*a + pageBg[0]*(1-a), bp[1]*a + pageBg[1]*(1-a), bp[2]*a + pageBg[2]*(1-a)];
    var fg = parseRgb(cs.color);
    var l1 = lum(fg), l2 = lum(bg);
    out.push({
      kind: el.getAttribute('data-k'),
      color: cs.color,
      contrast: Math.round(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)) * 100) / 100
    });
  }
  host.remove();
  return out;
})()`;

const READ_REAL_TOAST = `(function () {
  // ★ .v-toast দিয়ে খুঁজি — শুধু role=status দিলে LoadingProvider-এর
  //   ওভারলে আগে ম্যাচ করত, টোস্ট নয়।
  var el = document.querySelector('.v-toast')
        || document.querySelector('.v-toast-host [role="alert"], .v-toast-host [role="status"]');
  if (!el) return null;
  var r = el.getBoundingClientRect();
  return {
    text: (el.textContent || '').trim(),
    x: Math.round(r.x), y: Math.round(r.y),
    w: Math.round(r.width), h: Math.round(r.height)
  };
})()`;

(async () => {
  console.log(`═══ টোস্ট দৃশ্য-নিরীক্ষা (${TAG}) ═══\n`);
  const ws = path.join(process.cwd(), 'ws.txt');
  const browser = existsSync(ws)
    ? await chromium.connect(readFileSync(ws, 'utf8').trim())
    : await chromium.launch({ headless: false });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const variant = VARIANTS[TAG] || VARIANTS.after;

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    for (const theme of ['dark', 'light'] as const) {
      console.log(`\n── থিম: ${theme} ──`);
      await page.evaluate(`document.documentElement.setAttribute('data-theme','${theme}')`);
      await page.waitForTimeout(400);

      const metrics: ToastMetric[] = await page.evaluate(
        injectAndMeasure(JSON.stringify(variant), JSON.stringify(MESSAGES)),
      );

      for (const m of metrics) {
        console.log(`  ${String(m.kind).padEnd(8)} লেখা ${m.color.padEnd(19)} accent ${m.accent.padEnd(19)} → ${m.contrast}:1`);
      }

      // ★ WCAG AA — সাধারণ লেখা ৪.৫:১
      for (const m of metrics) {
        check(`${theme}/${m.kind}: লেখার কন্ট্রাস্ট ≥ 4.5:1`, m.contrast >= 4.5, `${m.contrast}:1`);
      }

      // ★ ভূমিকা আলাদাভাবে চেনা যায় কিনা — **accent** (আইকন + বাঁ-বার)
      //   দিয়ে, লেখার রঙ দিয়ে নয়। ফিক্সের পর সব লেখা `--v-ink`, তাই
      //   ভূমিকা বোঝায় আইকন; সেটিই আলাদা হতে হবে।
      const by = (k: string) => metrics.find((m) => m.kind === k);
      const err = by('error'), inf = by('info'), suc = by('success'), wrn = by('warning');
      const accents = [suc, err, wrn, inf].map((m) => m?.accent);
      check(`${theme}: চারটি ভূমিকার accent আলাদা`,
        new Set(accents).size === 4, accents.join(' · '));
      check(`${theme}: info ≠ error`, inf?.accent !== err?.accent,
        `info ${inf?.accent} · error ${err?.accent}`);
      check(`${theme}: warning ≠ success`, wrn?.accent !== suc?.accent,
        `warning ${wrn?.accent} · success ${suc?.accent}`);

      // ★ ওভারল্যাপ
      let overlaps = 0;
      for (let i = 0; i < metrics.length; i++) {
        for (let j = i + 1; j < metrics.length; j++) {
          const a = metrics[i].rect, b = metrics[j].rect;
          if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps++;
        }
      }
      check(`${theme}: টোস্ট পরস্পর ওভারল্যাপ করে না`, overlaps === 0, `${overlaps} টি`);

      const off = metrics.filter((m) => m.rect.x < 0 || m.rect.x + m.rect.w > 1440);
      check(`${theme}: ভিউপোর্টের বাইরে যায় না`, off.length === 0, `${off.length} টি`);

      // ── ইনলাইন alert-* পৃষ্ঠ ──
      const alerts = await page.evaluate(MEASURE_ALERTS) as { kind: string; color: string; contrast: number }[];
      for (const a of alerts) {
        check(`${theme}/alert-${a.kind}: কন্ট্রাস্ট ≥ 4.5:1`, a.contrast >= 4.5,
          `${a.color} → ${a.contrast}:1`);
      }

      await page.screenshot({
        path: path.join(SHOTS, `toast_${TAG}_${theme}.png`),
        clip: { x: 920, y: 0, width: 520, height: 440 },
      });
      console.log(`  → audit/screens/toast_${TAG}_${theme}.png`);
    }

    // ── আসল error টোস্ট ──
    console.log('\n── আসল টোস্ট (ভুল পাসওয়ার্ড) ──');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.evaluate(`document.documentElement.setAttribute('data-theme','dark')`);
    await page.waitForTimeout(1000);
    await page.fill('input[type="email"]', 'admin@uidtopup.local');
    await page.fill('input[type="password"]', 'definitely-not-the-password');
    await page.click('button[type="submit"]');

    // ★ টোস্ট আসতে সময় লাগে: 2fa-check → signIn → login-status → render।
    //   স্থির অপেক্ষার বদলে পোল করি, নাহলে দেরি হলে "পাওয়া যায়নি" বলত।
    let real: RealToast | null = null;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(500);
      real = await page.evaluate(READ_REAL_TOAST) as RealToast | null;
      if (real) break;
    }
    check('আসল টোস্ট দেখা যাচ্ছে', Boolean(real),
      real ? `"${real.text}" @ ${real.x},${real.y} ${real.w}×${real.h}` : 'পাওয়া যায়নি');
    // ★ ডেস্কটপে টোস্ট ডানদিকে ও sticky হেডারের **নিচে** থাকতে হবে
    if (real) {
      check('আসল টোস্ট হেডারের নিচে (navbar ঢাকে না)', real.y >= 70,
        `y=${real.y} (পাবলিক হেডার ৭০px)`);
      check('আসল টোস্ট ডানদিকে', real.x > 720, `x=${real.x}`);
    }
    await page.screenshot({
      path: path.join(SHOTS, `toast_${TAG}_real.png`),
      clip: { x: 920, y: 0, width: 520, height: 280 },
    });
    console.log(`  → audit/screens/toast_${TAG}_real.png`);
  } finally {
    await ctx.close();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
