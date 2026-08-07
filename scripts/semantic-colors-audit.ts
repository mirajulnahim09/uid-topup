/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ সেমান্টিক রঙ যাচাই (C3)
 *
 *   `npx tsx scripts/semantic-colors-audit.ts`
 *
 *   C3-এর অভিযোগ ছিল: `.text-emerald-*` ও `.text-amber-*` — দুটোই
 *   `--v-volt`-এ যেত, তাই **সফল ও সতর্কতা হুবহু একই** দেখাত।
 *   এখানে সেটি সংখ্যায় প্রমাণ হয়:
 *     ১. চারটি ভূমিকার computed রঙ পরস্পর আলাদা
 *     ২. প্রতিটির কন্ট্রাস্ট ≥ ৪.৫:১ (WCAG AA, সাধারণ লেখা)
 *     ৩. accent প্রিসেট বদলালেও ভূমিকার রঙ **বদলায় না**
 *        (আগে `--v-volt` accent-চালিত ছিল, তাই লাল accent-এ
 *         "সফল" বার্তাও লাল হয়ে যেত)
 *   দুই থিমেই।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';

type Row = { role: string; cls: string; color: string; contrast: number };

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const MEASURE = `(function () {
  var old = document.getElementById('sem-audit');
  if (old) old.remove();
  var host = document.createElement('div');
  host.id = 'sem-audit';
  host.style.cssText = 'position:fixed;left:8px;top:200px;z-index:140';
  var roles = [
    ['success', 'text-emerald-700'],
    ['warning', 'text-amber-700'],
    ['danger',  'text-rose-700'],
    ['info',    'text-sky-700']
  ];
  var html = '';
  for (var i = 0; i < roles.length; i++) {
    html += '<p class="' + roles[i][1] + '" data-role="' + roles[i][0] + '">নমুনা লেখা</p>';
  }
  host.innerHTML = html;
  document.body.appendChild(host);

  function parseRgb(s) { var m = s.match(/[\\d.]+/g) || ['0','0','0']; return [Number(m[0]),Number(m[1]),Number(m[2])]; }
  function lum(c) {
    var o = [];
    for (var i = 0; i < 3; i++) { var s = c[i]/255; o.push(s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4)); }
    return 0.2126*o[0] + 0.7152*o[1] + 0.0722*o[2];
  }
  var pageBg = parseRgb(getComputedStyle(document.body).backgroundColor);
  if (pageBg[0] === 0 && pageBg[1] === 0 && pageBg[2] === 0) {
    pageBg = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
  }

  var out = [];
  for (var n = 0; n < host.children.length; n++) {
    var el = host.children[n];
    var cs = getComputedStyle(el);
    var fg = parseRgb(cs.color);
    var l1 = lum(fg), l2 = lum(pageBg);
    out.push({
      role: el.getAttribute('data-role'),
      cls: el.className,
      color: cs.color,
      contrast: Math.round(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)) * 100) / 100
    });
  }
  host.remove();
  return out;
})()`;

(async () => {
  console.log('═══ সেমান্টিক রঙ যাচাই (C3) ═══\n');
  const ws = path.join(process.cwd(), 'ws.txt');
  const browser = existsSync(ws)
    ? await chromium.connect(readFileSync(ws, 'utf8').trim())
    : await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    for (const theme of ['dark', 'light'] as const) {
      console.log(`── থিম: ${theme} ──`);
      await page.evaluate(`document.documentElement.setAttribute('data-theme','${theme}')`);
      await page.waitForTimeout(300);

      const rows = await page.evaluate(MEASURE) as Row[];
      for (const r of rows) {
        console.log(`  ${r.role.padEnd(8)} ${r.cls.padEnd(18)} ${r.color.padEnd(20)} ${r.contrast}:1`);
      }

      const colors = rows.map((r) => r.color);
      check(`${theme}: চারটি ভূমিকার রঙ আলাদা`, new Set(colors).size === 4, colors.join(' · '));

      const suc = rows.find((r) => r.role === 'success');
      const wrn = rows.find((r) => r.role === 'warning');
      check(`${theme}: success ≠ warning (C3-এর মূল অভিযোগ)`,
        suc?.color !== wrn?.color, `${suc?.color} vs ${wrn?.color}`);

      for (const r of rows) {
        check(`${theme}/${r.role}: কন্ট্রাস্ট ≥ 4.5:1`, r.contrast >= 4.5, `${r.contrast}:1`);
      }
      console.log('');
    }

    // ── accent প্রিসেট বদলালে ভূমিকার রঙ অপরিবর্তিত থাকে? ──
    console.log('── accent প্রিসেট বদলে যাচাই (dark) ──');
    await page.evaluate(`document.documentElement.setAttribute('data-theme','dark')`);
    const byAccent: Record<string, string[]> = {};
    for (const accent of ['', 'purple', 'blue', 'red', 'orange']) {
      await page.evaluate(
        accent
          ? `document.documentElement.setAttribute('data-accent','${accent}')`
          : `document.documentElement.removeAttribute('data-accent')`,
      );
      await page.waitForTimeout(200);
      const rows = await page.evaluate(MEASURE) as Row[];
      byAccent[accent || '(default)'] = rows.map((r) => r.color);
      console.log(`  ${(accent || 'default').padEnd(8)} → ${rows.map((r) => r.role + ':' + r.color.replace(/\s/g, '')).join(' ')}`);
    }
    const sets = Object.values(byAccent).map((v) => v.join('|'));
    check('accent বদলালেও ভূমিকার রঙ অপরিবর্তিত', new Set(sets).size === 1,
      new Set(sets).size === 1 ? 'পাঁচটি প্রিসেটেই এক' : `${new Set(sets).size} রকম`);
    await page.evaluate(`document.documentElement.removeAttribute('data-accent')`);
  } finally {
    await ctx.close();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
