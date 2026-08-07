/**
 * টেলিগ্রাম উইজার্ড ও ড্যাশবোর্ড — লাইভ ব্রাউজার পরীক্ষা।
 * `npx tsx scripts/telegram-playwright.ts`        (headless)
 * `npx tsx scripts/telegram-playwright.ts --headed`
 *
 * playwright-core ব্যবহার করে সিস্টেমের Chrome চালায় (আলাদা ব্রাউজার
 * ডাউনলোড লাগে না)। ⚠️ কখনো টোকেন/পাসওয়ার্ড ছাপে না।
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync } from 'fs';

const BASE = 'http://localhost:3000';
const HEADED = process.argv.includes('--headed');
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const SECRET = TOKEN.split(':')[1] || '';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const section = (t: string) => console.log(`\n═══ ${t} ═══`);

/**
 * লগইন — এবং **সত্যিই** হয়েছে কিনা তা যাচাই।
 *
 * ⚠️ কেন আলাদা করে যাচাই: বারবার স্বয়ংক্রিয় টেস্ট চালালে লগইন
 *    rate-limit (৫/১৫ মিনিট) ধরে ফেলে। তখন `/admin/*` চুপচাপ
 *    `/login`-এ রিডাইরেক্ট হয়, আর নিচের প্রতিটি কনটেন্ট-চেক
 *    "পাওয়া যায়নি" বলে ব্যর্থ হয় — যা দেখে মনে হয় UI ভেঙে গেছে।
 *    একবার এই বিভ্রান্তি ঘটেছিল, তাই এখানে জোরে থামা হয়।
 */
async function login(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  // সেশন সত্যিই আছে কিনা — অ্যাডমিন API সরাসরি জিজ্ঞাসা করে দেখি
  const status = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/admin/telegram`);
    return r.status;
  }, BASE);
  return status === 200;
}

async function main() {
  const exe = CHROME_PATHS.find((p) => existsSync(p));
  if (!exe) { console.log('FATAL: no Chrome/Edge found'); process.exit(1); }

  const browser: Browser = await chromium.launch({ headless: !HEADED, executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  try {
    const authed = await login(page);
    if (!authed) {
      console.log('\nFATAL: admin login failed — almost certainly the login rate limit');
      console.log('(5 attempts / 15 min per email). Clear it and re-run:');
      console.log('  npx prisma db execute --file <(echo \'DELETE FROM "RateLimitBucket";\') --schema prisma/schema.prisma');
      await browser.close();
      process.exit(1);
    }
    await page.goto(`${BASE}/admin/telegram`, { waitUntil: 'networkidle' });

    // ══════════ ১. ড্যাশবোর্ড রেন্ডার ══════════
    section('1. Dashboard renders');
    const body = await page.textContent('body') ?? '';
    check('page loaded', body.length > 500, `${body.length} chars`);
    check('connection panel present', body.includes('বট ID'));
    check('stats panel present', body.includes('বার্তা পরিসংখ্যান'));
    check('management panel present', body.includes('ব্যবস্থাপনা'));
    check('encrypted badge shown', body.includes('এনক্রিপ্টেড'));

    // ══════════ ২. গোপনীয়তা (DOM-এর ভেতরে) ══════════
    section('2. Secret exposure in live DOM');
    const html = await page.content();
    check('token absent from rendered DOM', !html.includes(TOKEN));
    check('token secret half absent', SECRET.length > 10 && !html.includes(SECRET));
    // ★ ক্লায়েন্ট JS বান্ডলেও যেন না থাকে
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).src));
    let bundleLeak = false;
    for (const src of scripts.slice(0, 25)) {
      try {
        const t = await (await fetch(src)).text();
        if (SECRET.length > 10 && t.includes(SECRET)) { bundleLeak = true; break; }
      } catch { /* উপেক্ষা */ }
    }
    check('token absent from client JS bundles', !bundleLeak, `${scripts.length} scripts scanned`);

    // ══════════ ৩. ১৬টি ইভেন্ট চেকবক্স ══════════
    section('3. Notification preferences');
    const boxes = await page.locator('input[type="checkbox"]').count();
    check('event checkboxes rendered', boxes >= 16, `${boxes} checkboxes (16 events + master)`);
    for (const label of ['নতুন ডিপোজিট', 'ওয়ালেট ক্রেডিট', 'সার্ভার সতর্কতা', 'নিরাপত্তা সতর্কতা', 'দৈনিক সারসংক্ষেপ']) {
      check(`event "${label}" visible`, body.includes(label));
    }
    check('scheduler-required badge shown', body.includes('শিডিউলার দরকার'));

    // ══════════ ৪. উইজার্ড খোলা ও ধাপ চলাচল ══════════
    section('4. Connection Wizard flow');
    await page.click('text=Connection Wizard');
    await page.waitForTimeout(500);
    const w1 = await page.textContent('body') ?? '';
    check('wizard step 1 (welcome) shown', w1.includes('টেলিগ্রাম সংযোগ সহায়িকা'));
    check('shows ~2 minute estimate', w1.includes('~২ মিনিট'));
    check('progress indicator present', (await page.locator('.wz-dot').count()) === 6,
      `${await page.locator('.wz-dot').count()} steps`);

    await page.click('text=শুরু করুন');
    await page.waitForTimeout(450);
    check('step 2 (token) shown', (await page.textContent('body') ?? '').includes('Bot Token'));

    // ★ পরবর্তী বোতাম যাচাই ছাড়া নিষ্ক্রিয় থাকতে হবে
    const nextDisabled = await page.locator('button:has-text("পরবর্তী")').first().isDisabled();
    check('cannot advance before token validation', nextDisabled);

    // ★ নির্দিষ্ট সময় অপেক্ষা করা **যাবে না** — dev-এ কোনো রুটে প্রথম
    //   আঘাতে Next সেটি কম্পাইল করে, যা কয়েক সেকেন্ড নিতে পারে। আগে
    //   fixed sleep দেওয়ায় টেস্ট মিথ্যা ব্যর্থ হয়েছিল। তাই সত্যিকারের
    //   রেসপন্সের জন্য অপেক্ষা।
    const awaitVerify = () =>
      page.waitForResponse((r) => r.url().includes('/telegram/verify'), { timeout: 30000 });

    // ভুল ফরম্যাট → ত্রুটি
    await page.fill('#wz-token', 'obviously-not-a-token');
    const badResp = awaitVerify();
    await page.click('button:has-text("টোকেন যাচাই করুন")');
    await badResp;
    await page.waitForTimeout(400); // React রি-রেন্ডার
    const errBody = await page.textContent('body') ?? '';
    check('invalid token shows clear error',
      errBody.includes('ফরম্যাট ভুল') || errBody.includes('কোলন') || errBody.includes('অবৈধ'),
      'format error surfaced');
    check('error animation class applied', (await page.locator('.wz-error').count()) > 0);

    // সঠিক টোকেন → বট কার্ড
    await page.fill('#wz-token', TOKEN);
    const okResp = awaitVerify();
    await page.click('button:has-text("টোকেন যাচাই করুন")');
    await okResp;
    await page.waitForTimeout(500);
    const okBody = await page.textContent('body') ?? '';
    check('valid token shows bot identity', okBody.includes('uidtopup1bot'), '@uidtopup1bot');
    check('bot id displayed', okBody.includes('8801466881'));
    check('success animation applied', (await page.locator('.wz-success').count()) > 0);
    check('next button now enabled',
      !(await page.locator('button:has-text("পরবর্তী")').first().isDisabled()));

    // ★ টোকেন ইনপুটে থাকলেও DOM-এর বাইরে যেন না যায় — এটি অ্যাডমিনের
    //   নিজের টাইপ করা মান, তাই ইনপুটে থাকা স্বাভাবিক ও নিরাপদ।
    const tokenInputValue = await page.inputValue('#wz-token');
    check('token stays in the input the admin typed', tokenInputValue === TOKEN);

    await page.click('button:has-text("পরবর্তী")');
    await page.waitForTimeout(450);
    const s3 = await page.textContent('body') ?? '';
    check('step 3 (chat id) shown', s3.includes('Chat ID'));
    check('all 4 chat types explained',
      s3.includes('ব্যক্তিগত চ্যাট') && s3.includes('গ্রুপ') && s3.includes('চ্যানেল'));

    // ══════════ ৫. রেসপন্সিভ ══════════
    section('5. Responsive audit');
    for (const [w, h, name] of [[390, 844, 'mobile 390'], [768, 1024, 'tablet 768'], [1440, 900, 'desktop 1440']] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(350);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${name}: no horizontal overflow`, overflow <= 1, `${overflow}px`);
      const dots = await page.locator('.wz-dot').first().boundingBox();
      check(`${name}: progress indicator visible`, Boolean(dots && dots.width > 0));
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // ══════════ ৬. থিম ══════════
    //   ⚠️ `.card` এর ব্যাকগ্রাউন্ড একটি **gradient** (background-image),
    //   তাই `backgroundColor` স্বাভাবিকভাবেই transparent — সেটি দিয়ে
    //   থিম পরীক্ষা করা ভুল ছিল। আসল প্রশ্ন: থিম বদলালে টোকেনগুলো
    //   সত্যিই বদলায় কি না।
    section('6. Theme support');
    const themeTokens: Record<string, { void_: string; ink: string; cardBg: string }> = {};
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(350);
      themeTokens[theme] = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const card = document.querySelector('.card');
        return {
          void_: cs.getPropertyValue('--v-void').trim(),
          ink: cs.getPropertyValue('--v-ink').trim(),
          cardBg: card ? getComputedStyle(card).backgroundImage : '',
        };
      });
      check(`${theme} theme: tokens resolve`,
        Boolean(themeTokens[theme].void_ && themeTokens[theme].ink),
        `bg=${themeTokens[theme].void_} ink=${themeTokens[theme].ink}`);
      check(`${theme} theme: card paints a gradient`,
        themeTokens[theme].cardBg.includes('gradient'));
    }
    check('themes produce different palettes',
      themeTokens.dark.void_ !== themeTokens.light.void_ &&
      themeTokens.dark.ink !== themeTokens.light.ink);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(600); // থিম-ট্রানজিশন শেষ হতে দিই

    // ══════════ ৭. অ্যানিমেশন কম্পোজিটর-নিরাপদ ══════════
    //   ⚠️ শুধু **CSSAnimation** গোনা হয়, CSSTransition নয়। থিম
    //   বদলানোর সময় প্রকল্পের নিজস্ব `.theme-anim` রঙ-ট্রানজিশন চালায় —
    //   সেটি ক্ষণস্থায়ী ও ইচ্ছাকৃত, ক্রমাগত অ্যানিমেশন নয়। আগে সেগুলো
    //   গুনে টেস্ট মিথ্যা ব্যর্থ হয়েছিল।
    section('7. Animation performance (continuous animations only)');
    const anims = await page.evaluate(() =>
      document.getAnimations()
        .filter((a) => a.constructor.name === 'CSSAnimation')
        .map((a) => {
          const eff = a.effect as KeyframeEffect | null;
          const frames = eff?.getKeyframes?.() ?? [];
          const props = new Set<string>();
          for (const f of frames) for (const k of Object.keys(f)) {
            if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
          }
          return [...props];
        }));
    const flat = [...new Set(anims.flat())];
    const nonComposited = flat.filter((p) => !['transform', 'opacity'].includes(p));
    check('all CSS animations are compositor-only',
      nonComposited.length === 0,
      nonComposited.join(', ') || `${anims.length} animations, props: ${flat.join(', ') || 'none'}`);

    // ══════════ ৮. কনসোল ══════════
    section('8. Console');
    const real = consoleErrors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
    check('no console errors', real.length === 0, real.slice(0, 2).join(' | '));

    if (HEADED) { console.log('\n(headed mode — browser stays open 20s)'); await page.waitForTimeout(20000); }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  if (passed !== results.length) {
    results.filter((r) => !r.ok).forEach((r) => console.log(`  FAILED: ${r.name} — ${r.note}`));
  }
  process.exit(passed === results.length ? 0 : 1);
}

main();
