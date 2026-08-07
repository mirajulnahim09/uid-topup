/**
 * এন্টারপ্রাইজ UI — লাইভ ব্রাউজার পরীক্ষা (রেসপন্সিভ + a11y + নিরাপত্তা)।
 * `npx tsx scripts/telegram-enterprise-playwright.ts [--headed]`
 * ⚠️ কখনো টোকেন/পাসওয়ার্ড ছাপে না।
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { chromium, type Page } from 'playwright-core';
import { existsSync } from 'fs';

const BASE = 'http://localhost:3000';
const HEADED = process.argv.includes('--headed');
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const SECRET = TOKEN.split(':')[1] || '';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const section = (t: string) => console.log(`\n═══ ${t} ═══`);

const TABS = ['🤖 বট', '⏰ শিডিউলার', '✍️ টেমপ্লেট', '📈 বিশ্লেষণ', '💾 ব্যাকআপ'];

async function openTab(page: Page, label: string) {
  await page.click(`button:has-text("${label}")`);
  // ★ প্যানেল নিজের ডেটা নিজে আনে — "লোড হচ্ছে…" চলে যাওয়া পর্যন্ত অপেক্ষা
  await page.waitForFunction(
    () => !(document.body.innerText.includes('লোড হচ্ছে…')),
    undefined, { timeout: 30000 },
  ).catch(() => {});
  await page.waitForTimeout(350);
}

async function main() {
  if (!exe) { console.log('FATAL: no Chrome/Edge found'); process.exit(1); }
  const browser = await chromium.launch({ headless: !HEADED, executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);
    const authed = await page.evaluate(async (b) => (await fetch(`${b}/api/admin/telegram`)).status, BASE);
    if (authed !== 200) {
      console.log('\nFATAL: admin login failed — likely the login rate limit (5/15min).');
      console.log('Clear "RateLimitBucket" and re-run.');
      await browser.close(); process.exit(1);
    }

    await page.goto(`${BASE}/admin/telegram`, { waitUntil: 'networkidle' });

    // ═══ ১. ট্যাব ═══
    section('1. Tabs render and switch');
    const tabCount = await page.locator('[role="tab"]').count();
    check('6 tabs present', tabCount === 6, `${tabCount}`);

    // ★ "লোড হচ্ছে…" এর অনুপস্থিতি দিয়ে যাচাই করা **যাবে না** — গ্লোবাল
    //   লোডিং-ওভারলে (§22) এর মার্কআপে ঐ লেখাটি সবসময়ই DOM-এ থাকে
    //   (লুকানো অবস্থায়)। তাই প্রতিটি ট্যাবের **নিজস্ব** কনটেন্ট খুঁজি।
    const TAB_MARKER: Record<string, string> = {
      '🤖 বট': 'নতুন বট',
      '⏰ শিডিউলার': 'মোট জব',
      '✍️ টেমপ্লেট': 'লাইভ প্রিভিউ',
      '📈 বিশ্লেষণ': 'সাম্প্রতিক ডেলিভারি',
      '💾 ব্যাকআপ': 'ব্যাকআপ ডাউনলোড',
    };
    for (const t of TABS) {
      await openTab(page, t);
      const body = await page.textContent('body') ?? '';
      check(`tab "${t}" loads its own content`, body.includes(TAB_MARKER[t]), TAB_MARKER[t]);
    }

    // ═══ ২. প্রতিটি প্যানেলের মূল উপাদান ═══
    section('2. Panel contents');
    await openTab(page, '🤖 বট');
    let body = await page.textContent('body') ?? '';
    check('bots panel: add button', body.includes('নতুন বট'));
    check('bots panel: drag hint', body.includes('অগ্রাধিকার'));

    await openTab(page, '⏰ শিডিউলার');
    body = await page.textContent('body') ?? '';
    check('scheduler: engine status', body.includes('ইঞ্জিন'));
    check('scheduler: job summary tiles', body.includes('মোট জব'));
    check('scheduler: history section', body.includes('চালানোর ইতিহাস'));
    check('scheduler: 16 jobs listed', (body.match(/এখনই চালান/g) ?? []).length === 16,
      `${(body.match(/এখনই চালান/g) ?? []).length} run buttons`);

    await openTab(page, '✍️ টেমপ্লেট');
    body = await page.textContent('body') ?? '';
    check('templates: live preview panel', body.includes('লাইভ প্রিভিউ'));
    check('templates: variable chips', body.includes('{{'));

    // লাইভ প্রিভিউ সত্যিই কাজ করে?
    const ta = page.locator('#tpl-body');
    if (await ta.count()) {
      await ta.fill('পরীক্ষা {{customer_name}} — {{amount}}');
      await page.waitForTimeout(1200);
      const after = await page.textContent('body') ?? '';
      check('LIVE PREVIEW updates as you type', after.includes('রহিম উদ্দিন'), 'sample value rendered');
    } else check('template textarea present', false);

    await openTab(page, '📈 বিশ্লেষণ');
    body = await page.textContent('body') ?? '';
    check('analytics: usage tiles', body.includes('আজ') && body.includes('৩০ দিন'));
    check('analytics: delivery log table', body.includes('সাম্প্রতিক ডেলিভারি'));
    check('analytics: latency stats', body.includes('p95'));

    await openTab(page, '💾 ব্যাকআপ');
    body = await page.textContent('body') ?? '';
    check('backup: download section', body.includes('ব্যাকআপ ডাউনলোড'));
    check('backup: validate-first flow', body.includes('কিছু বদলাবে না'));
    check('backup: passphrase explained', body.includes('পাসফ্রেজ'));

    // ═══ ৩. নিরাপত্তা ═══
    section('3. Security in live DOM');
    const html = await page.content();
    check('token absent from DOM (all tabs visited)', !html.includes(TOKEN));
    check('token secret half absent', SECRET.length > 10 && !html.includes(SECRET));
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).src));
    let leak = false;
    for (const src of scripts.slice(0, 30)) {
      try { const t = await (await fetch(src)).text(); if (SECRET.length > 10 && t.includes(SECRET)) { leak = true; break; } }
      catch { /* skip */ }
    }
    check('token absent from client JS bundles', !leak, `${scripts.length} scripts scanned`);
    const passInputs = await page.locator('input[type="password"]').count();
    check('passphrase fields use type=password', passInputs >= 2, `${passInputs} masked inputs`);

    // ═══ ৪. অ্যাক্সেসিবিলিটি ═══
    section('4. Accessibility audit');
    const a11y = await page.evaluate(() => {
      const out = { unlabeledInputs: 0, unlabeledButtons: 0, imgNoAlt: 0, tabsOk: 0, tablist: 0 };
      document.querySelectorAll('input, select, textarea').forEach((el) => {
        const i = el as HTMLInputElement;
        if (i.type === 'hidden') return;
        const hasLabel = Boolean(i.getAttribute('aria-label'))
          || Boolean(i.id && document.querySelector(`label[for="${i.id}"]`))
          || Boolean(i.closest('label'));
        if (!hasLabel) out.unlabeledInputs++;
      });
      document.querySelectorAll('button').forEach((b) => {
        if (!(b.textContent || '').trim() && !b.getAttribute('aria-label')) out.unlabeledButtons++;
      });
      document.querySelectorAll('img').forEach((im) => {
        if (!im.hasAttribute('alt')) out.imgNoAlt++;
      });
      out.tabsOk = document.querySelectorAll('[role="tab"][aria-selected]').length;
      out.tablist = document.querySelectorAll('[role="tablist"]').length;
      return out;
    });
    check('every input has a label', a11y.unlabeledInputs === 0, `${a11y.unlabeledInputs} unlabeled`);
    check('every button has an accessible name', a11y.unlabeledButtons === 0, `${a11y.unlabeledButtons} unnamed`);
    check('every image has alt', a11y.imgNoAlt === 0, `${a11y.imgNoAlt} missing`);
    check('tabs expose role + aria-selected', a11y.tabsOk === 6 && a11y.tablist === 1,
      `${a11y.tabsOk} tabs, ${a11y.tablist} tablist`);

    const focusable = await page.evaluate(() =>
      document.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select, textarea').length);
    check('keyboard-focusable controls present', focusable > 10, `${focusable}`);

    // ═══ ৫. রেসপন্সিভ ═══
    section('5. Responsive audit');
    for (const [w, h, name] of [[390, 844, 'mobile 390'], [768, 1024, 'tablet 768'], [1440, 900, 'desktop 1440']] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const t of ['🤖 বট', '⏰ শিডিউলার', '💾 ব্যাকআপ']) {
        await openTab(page, t);
        const of = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`${name} · ${t}: no horizontal overflow`, of <= 1, `${of}px`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // ═══ ৬. থিম ═══
    section('6. Theme support');
    await openTab(page, '📈 বিশ্লেষণ');
    const themes: Record<string, string> = {};
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(350);
      themes[theme] = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--v-void').trim());
      check(`${theme} theme resolves tokens`, Boolean(themes[theme]), themes[theme]);
    }
    check('themes differ', themes.dark !== themes.light);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(700);

    // ═══ ৭. অ্যানিমেশন ═══
    section('7. Animation performance');
    const anims = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.constructor.name === 'CSSAnimation').map((a) => {
        const eff = a.effect as KeyframeEffect | null;
        const props = new Set<string>();
        for (const f of eff?.getKeyframes?.() ?? []) {
          for (const k of Object.keys(f)) {
            if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
          }
        }
        return [...props];
      }));
    const flat = [...new Set(anims.flat())];
    const nonComp = flat.filter((p) => !['transform', 'opacity'].includes(p));
    check('CSS animations are compositor-only', nonComp.length === 0,
      nonComp.join(', ') || `${anims.length} animations: ${flat.join(', ') || 'none'}`);

    // ═══ ৮. কনসোল ═══
    section('8. Console');
    const real = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
    check('no console errors', real.length === 0, real.slice(0, 2).join(' | '));

    if (HEADED) { console.log('\n(headed — 20s)'); await page.waitForTimeout(20000); }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  if (passed !== results.length) results.filter((r) => !r.ok).forEach((r) => console.log(`  FAILED: ${r.name} — ${r.note}`));
  process.exit(passed === results.length ? 0 : 1);
}

main();
