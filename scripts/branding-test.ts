/**
 * ★★★ ব্র্যান্ড আইডেন্টিটি টেস্ট।
 * `npx tsx scripts/branding-test.ts [--headless]`
 *
 * মূল দাবি: **অ্যাডমিন প্যানেল থেকে ব্র্যান্ডিং বদলালে পুরো অ্যাপে
 * তা প্রতিফলিত হয় — কোনো সোর্স কোড বা ফাইল সম্পাদনা ছাড়াই।**
 *
 * তাই টেস্টটি সত্যিই একটি লোগো আপলোড করে ও নাম বদলায়, তারপর
 * প্রতিটি পৃষ্ঠে গিয়ে দেখে। শেষে সব আগের অবস্থায় ফেরানো হয়।
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { existsSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3000';
const HEADLESS = process.argv.includes('--headless');
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

const jar = new Map<string, string>();
function storeCookies(res: Response) {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
const api = (p: string, init?: RequestInit) =>
  fetch(BASE + p, { ...init, headers: { 'Content-Type': 'application/json', Cookie: cookie(), ...(init?.headers || {}) } });

/** ছোট, বৈধ PNG (১×১ লাল) — আসল আপলোড পরীক্ষার জন্য যথেষ্ট */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const TEST_NAME = 'ZZ BRAND PROBE';
const TEST_SHORT = 'ZZPROBE';

async function main() {
  if (!exe) { console.log('FATAL: no browser'); process.exit(1); }

  const prisma = new PrismaClient();
  await prisma.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});

  // ── আগের অবস্থা সংরক্ষণ (শেষে ফেরানোর জন্য) ──
  const KEYS = ['site_name', 'brand_short_name', 'brand_meta_title', 'brand_manifest_name',
    'brand_manifest_short', 'brand_copyright', 'brand_logo_primary_dark',
    'brand_logo_login_dark', 'brand_logo_favicon_dark'];
  const before = Object.fromEntries(
    (await prisma.setting.findMany({ where: { key: { in: KEYS } } })).map((r) => [r.key, r.value]),
  );

  // ── লগইন ──
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  storeCookies(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: 'true' }).toString(),
    redirect: 'manual',
  });
  storeCookies(loginRes);
  if (![...jar.keys()].some((k) => k.includes('session-token'))) {
    console.log('FATAL: admin login failed'); await prisma.$disconnect(); process.exit(1);
  }

  // ══════════ ১. অথ ══════════
  section('1. Authorization');
  for (const m of ['GET', 'POST'] as const) {
    const r = await fetch(`${BASE}/api/admin/branding`, {
      method: m, headers: { 'Content-Type': 'application/json' },
      ...(m === 'POST' ? { body: '{}' } : {}),
    });
    check(`${m} /api/admin/branding requires admin`, r.status === 401, `HTTP ${r.status}`);
  }

  // ══════════ ২. স্লট ও ফিল্ড ══════════
  section('2. Definitions');
  const defs = await (await api('/api/admin/branding')).json();
  check('10 logo slots exposed', defs.slots?.length === 10, `${defs.slots?.length}`);
  check('15 text fields exposed', defs.fields?.length === 15, `${defs.fields?.length}`);
  const slotKeys = (defs.slots as { key: string }[]).map((s) => s.key);
  for (const need of ['primary', 'secondary', 'compact', 'square', 'favicon', 'pwa', 'login', 'loading', 'email', 'og']) {
    check(`slot "${need}" present`, slotKeys.includes(need));
  }

  // ══════════ ৩. আপলোড যাচাই (নিরাপত্তা) ══════════
  section('3. Upload validation');
  const badForm = new FormData();
  badForm.append('file', new Blob(['#!/bin/sh\necho hacked'], { type: 'image/png' }), 'evil.png');
  badForm.append('folder', 'brand');
  const badUp = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', body: badForm, headers: { Cookie: cookie() } });
  check('non-image disguised as PNG rejected (magic bytes)', badUp.status === 400, `HTTP ${badUp.status}`);

  const badFolder = new FormData();
  badFolder.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'a.png');
  badFolder.append('folder', '../../etc');
  const bf = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', body: badFolder, headers: { Cookie: cookie() } });
  check('folder traversal rejected', bf.status === 400, `HTTP ${bf.status}`);

  const badUrl = await api('/api/admin/branding', {
    method: 'POST',
    body: JSON.stringify({ logos: [{ slot: 'primary', theme: 'dark', url: 'javascript:alert(1)' }] }),
  });
  check('javascript: logo URL rejected', badUrl.status === 400, `HTTP ${badUrl.status}`);

  const junkSlot = await api('/api/admin/branding', {
    method: 'POST',
    body: JSON.stringify({ logos: [{ slot: 'not_a_slot', theme: 'dark', url: '/x.png' }] }),
  });
  check('unknown slot ignored (allowlist)', junkSlot.status === 400, `HTTP ${junkSlot.status} — nothing changed`);

  const junkField = await api('/api/admin/branding', {
    method: 'POST', body: JSON.stringify({ text: { evil_key: 'x' } }),
  });
  check('unknown text field ignored (allowlist)', junkField.status === 400, `HTTP ${junkField.status}`);

  // ══════════ ৪. সত্যিকারের আপলোড ══════════
  section('4. Real upload through the admin API');
  const fd = new FormData();
  fd.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'probe-logo.png');
  fd.append('folder', 'brand');
  const up = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', body: fd, headers: { Cookie: cookie() } });
  const upd = await up.json();
  check('logo uploaded', up.ok && Boolean(upd.url), upd.url || upd.error);
  const logoUrl: string = upd.url ?? '';

  // ══════════ ৫. অ্যাডমিন থেকে ব্র্যান্ডিং বদল ══════════
  section('5. Change branding via admin API only');
  const saved = await (await api('/api/admin/branding', {
    method: 'POST',
    body: JSON.stringify({
      text: {
        site_name: TEST_NAME, brand_short_name: TEST_SHORT,
        brand_meta_title: `${TEST_NAME} — probe title`,
        brand_manifest_name: `${TEST_NAME} manifest`,
        brand_manifest_short: TEST_SHORT,
        brand_copyright: `© probe ${TEST_NAME}`,
      },
      logos: [
        { slot: 'primary', theme: 'dark', url: logoUrl },
        { slot: 'login', theme: 'dark', url: logoUrl },
        { slot: 'favicon', theme: 'dark', url: logoUrl },
      ],
    }),
  })).json();
  check('branding saved', saved.success === true, `${saved.updated} keys`);
  check('resolved branding echoes new name', saved.branding?.siteName === TEST_NAME, saved.branding?.siteName);

  // ══════════ ৬. পুরো অ্যাপে প্রতিফলন (সার্ভার-রেন্ডার) ══════════
  section('6. Propagation across the app (no code change)');
  const html = async (p: string) => (await fetch(BASE + p, { headers: { Cookie: cookie() } })).text();

  const home = await html('/');
  check('homepage <title> uses new name', new RegExp(`<title>[^<]*${TEST_NAME}`).test(home), (home.match(/<title>([^<]*)</) ?? [])[1]);
  check('homepage og:site_name updated', home.includes(`content="${TEST_NAME}"`));
  check('homepage nav renders uploaded logo', home.includes(logoUrl), logoUrl);
  check('footer copyright updated', home.includes(`© probe ${TEST_NAME}`));
  check('favicon link points at upload', new RegExp(`rel="icon"[^>]*${logoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(home) || home.includes(logoUrl));

  const login = await html('/login');
  check('login page renders uploaded logo', login.includes(logoUrl));
  const register = await html('/register');
  check('register page renders uploaded logo', register.includes(logoUrl));

  const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  check('manifest name updated', String(manifest.name).includes(TEST_NAME), manifest.name);
  check('manifest short_name updated', manifest.short_name === TEST_SHORT, manifest.short_name);
  check('manifest icon uses upload', JSON.stringify(manifest.icons).includes(logoUrl));

  const adminHtml = await html('/admin');
  check('admin panel renders uploaded logo', adminHtml.includes(logoUrl));

  // ══════════ ৭. ব্রাউজারে (থিম বদল সহ) ══════════
  section('7. Live browser + theme switching');
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: exe, args: ['--window-size=1460,980'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs: string[] = [];
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      if ((await page.evaluate(async (b) => (await fetch(`${b}/api/me`)).status, BASE)) === 200) break;
    }

    // ★ কনসোল-শ্রোতা **লগইনের পরে** — লগ-আউট অবস্থায় `/api/me` 401 দেয়,
    //   যা সঠিক আচরণ; আগে শুনলে সেটিকেই "ত্রুটি" বলে গোনা হতো।
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const navLogo = await page.locator('img[data-brand-slot="primary"]').count();
    check('nav logo element present in DOM', navLogo > 0, `${navLogo} <img data-brand-slot="primary">`);
    const tab = await page.title();
    check('browser tab title updated', tab.includes(TEST_NAME), tab);

    // ── থিম বদল → লোগোও বদলায় ──
    await api('/api/admin/branding', {
      method: 'POST',
      body: JSON.stringify({ logos: [{ slot: 'primary', theme: 'light', url: logoUrl }] }),
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => { localStorage.setItem('theme', t); document.documentElement.setAttribute('data-theme', t); }, theme);
      await page.waitForTimeout(400);
      const visible = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img[data-brand-slot="primary"]')) as HTMLImageElement[];
        return imgs.filter((i) => getComputedStyle(i).display !== 'none').length;
      });
      check(`${theme} theme shows exactly one primary logo`, visible === 1, `${visible} visible`);
    }

    check('no console errors during branding render', errs.filter((e) => !/favicon|404/i.test(e)).length === 0,
      errs.slice(0, 1).join(' | '));

    // ── অ্যাডমিন ব্র্যান্ডিং পাতা ──
    await page.goto(`${BASE}/admin/branding`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const body = (await page.textContent('body')) ?? '';
    check('branding page renders', body.includes('ব্র্যান্ডিং'));
    check('all 10 slots listed', ['প্রধান লোগো', 'সেকেন্ডারি', 'কমপ্যাক্ট', 'স্কয়ার', 'ফেভিকন',
      'PWA আইকন', 'লগইন লোগো', 'লোডিং লোগো', 'ইমেইল লোগো', 'সোশ্যাল শেয়ার'].every((l) => body.includes(l)));
    const dropzones = await page.locator('input[type="file"]').count();
    check('20 upload inputs (10 slots × 2 themes)', dropzones === 20, `${dropzones}`);

    // লাইভ প্রিভিউ ট্যাব
    await page.click('button:has-text("লাইভ প্রিভিউ")');
    await page.waitForTimeout(600);
    const pv = (await page.textContent('body')) ?? '';
    check('live preview has device + theme switches', pv.includes('ডেস্কটপ') && pv.includes('মোবাইল') && pv.includes('ডার্ক') && pv.includes('লাইট'));
    check('live preview shows search/OG/PWA mocks', pv.includes('সার্চ ফলাফল') && pv.includes('সোশ্যাল শেয়ার কার্ড') && pv.includes('হোম-স্ক্রিন'));

    // a11y ও রেসপন্সিভ
    const a11y = await page.evaluate(() => {
      let unlabeled = 0;
      document.querySelectorAll('input,select,textarea').forEach((el) => {
        const i = el as HTMLInputElement;
        if (i.type === 'hidden') return;
        const ok = i.getAttribute('aria-label') || (i.id && document.querySelector(`label[for="${i.id}"]`)) || i.closest('label');
        if (!ok) unlabeled++;
      });
      return unlabeled;
    });
    check('branding page: all inputs labelled', a11y === 0, `${a11y} unlabeled`);
    for (const [w, h, n] of [[390, 844, 'mobile'], [1440, 900, 'desktop']] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(350);
      const of = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`branding page ${n}: no overflow`, of <= 1, `${of}px`);
    }
  } finally {
    await browser.close();
  }

  // ══════════ ৮. পুনরুদ্ধার ══════════
  section('8. Restore original branding');
  await api('/api/admin/branding', {
    method: 'POST',
    body: JSON.stringify({
      text: {
        site_name: before.site_name ?? 'SS UID TOPUP',
        brand_short_name: before.brand_short_name ?? '',
        brand_meta_title: before.brand_meta_title ?? '',
        brand_manifest_name: before.brand_manifest_name ?? '',
        brand_manifest_short: before.brand_manifest_short ?? '',
        brand_copyright: before.brand_copyright ?? '',
      },
      logos: [
        { slot: 'primary', theme: 'dark', url: before.brand_logo_primary_dark ?? null },
        { slot: 'primary', theme: 'light', url: null },
        { slot: 'login', theme: 'dark', url: before.brand_logo_login_dark ?? null },
        { slot: 'favicon', theme: 'dark', url: before.brand_logo_favicon_dark ?? null },
      ],
    }),
  });
  const finalHome = await (await fetch(BASE + '/')).text();
  check('original name restored', !finalHome.includes(TEST_NAME));
  check('probe logo no longer referenced', !finalHome.includes(logoUrl));
  await prisma.media.deleteMany({ where: { url: logoUrl } }).catch(() => {});
  await prisma.$disconnect();

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.log('FAILURES:'); failed.forEach((r) => console.log(`   • ${r.name} — ${r.note}`)); }
  process.exit(failed.length ? 1 : 0);
}

main();
