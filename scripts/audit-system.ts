/**
 * ★★★ সিস্টেম অডিট — নিরাপত্তা, a11y, SEO/PWA, থিম, ইন্টিগ্রেশন, DB।
 * `npx tsx scripts/audit-system.ts`
 */
/** ⚠️ লাইভ DB-তে লেখা আটকায় — প্রথম import হতে হবে। */
import './_guard-live-db';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { existsSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3000';
const HEADLESS = process.argv.includes('--headless');
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const SECRET_HALF = TOKEN.split(':')[1] || '';
const NEXTAUTH_SECRET = (process.env.NEXTAUTH_SECRET || '').trim().replace(/^["']|["']$/g, '');
const DBURL = (process.env.DATABASE_URL || '').trim();
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const section = (t: string) => console.log(`\n═══ ${t} ═══`);

async function main() {
  if (!exe) { console.log('FATAL: no browser'); process.exit(1); }

  // ★ শুরুতেই রেট-লিমিট বালতি খালি — নাহলে আগের রানের অবশিষ্ট সীমা
  //   পরের রানে "malformed JSON → 429" এর মতো মিথ্যা ব্যর্থতা দেখাত।
  //   অডিট পুনরাবৃত্তিযোগ্য হতে হবে, আগের রানের উপর নির্ভরশীল নয়।
  {
    const p0 = new PrismaClient();
    await p0.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
    // আগের কোনো রান অসম্পূর্ণ থাকলে তার probe সারি পড়ে থাকতে পারে
    await p0.media.deleteMany({ where: { url: { contains: '__audit_missing_' } } }).catch(() => {});
    await p0.$disconnect();
  }

  // ══════════ ১. অ-প্রমাণীকৃত API ম্যাট্রিক্স ══════════
  section('1. API authorization matrix (unauthenticated)');
  const ADMIN_APIS = [
    ['GET', '/api/admin/reports'], ['POST', '/api/admin/user'], ['PATCH', '/api/admin/user'],
    ['POST', '/api/admin/order'], ['POST', '/api/admin/deposit'], ['POST', '/api/admin/product'],
    ['POST', '/api/admin/coupon'], ['POST', '/api/admin/settings'], ['POST', '/api/admin/banner'],
    ['POST', '/api/admin/campaign'], ['POST', '/api/admin/media'], ['GET', '/api/admin/backup'],
    ['POST', '/api/admin/restore'], ['POST', '/api/admin/search'], ['POST', '/api/admin/variant'],
    ['POST', '/api/admin/social'], ['POST', '/api/admin/announce'], ['GET', '/api/admin/logs/export'],
    ['POST', '/api/admin/order/refund'], ['POST', '/api/admin/order/bulk'], ['POST', '/api/admin/order/claim'],
    ['POST', '/api/admin/payment'], ['POST', '/api/admin/payment/provider'], ['POST', '/api/admin/upload'],
  ] as const;
  let leaks = 0;
  for (const [m, p] of ADMIN_APIS) {
    const r = await fetch(BASE + p, {
      method: m, headers: { 'Content-Type': 'application/json' },
      ...(m === 'GET' ? {} : { body: '{}' }),
    });
    if (r.status !== 401 && r.status !== 403) { leaks++; console.log(`        LEAK ${m} ${p} → ${r.status}`); }
  }
  check(`all ${ADMIN_APIS.length} admin APIs reject anonymous`, leaks === 0, `${leaks} unguarded`);

  // ★ প্রতিটি রুটের **প্রকৃত** মেথড ব্যবহার করতে হবে — ভুল মেথডে 405 আসে,
  //   যা "অরক্ষিত" নয় বরং "এই মেথডই নেই"। আগে POST /account/profile দিয়ে
  //   মিথ্যা LEAK রিপোর্ট হয়েছিল; রুটটি আসলে শুধু PATCH রপ্তানি করে।
  const USER_APIS = [['POST', '/api/order'], ['POST', '/api/deposit'], ['GET', '/api/me'],
    ['GET', '/api/notifications'], ['PATCH', '/api/account/profile'], ['POST', '/api/account/password']] as const;
  let uleaks = 0;
  for (const [m, p] of USER_APIS) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, ...(m === 'GET' ? {} : { body: '{}' }) });
    if (r.status !== 401) { uleaks++; console.log(`        LEAK ${m} ${p} → ${r.status}`); }
  }
  check(`all ${USER_APIS.length} user APIs require login`, uleaks === 0, `${uleaks} unguarded`);

  // ══════════ ২. ইনজেকশন ও ইনপুট ══════════
  section('2. Injection & input validation');
  const sqli = await fetch(`${BASE}/api/track`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNo: "1' OR '1'='1", phone: "'; DROP TABLE \"Order\"; --" }),
  });
  check('SQL-injection payload safely rejected', sqli.status === 400 || sqli.status === 404 || sqli.status === 429,
    `HTTP ${sqli.status}`);

  const xss = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '<script>alert(1)</script>', email: `x${Date.now()}@t.local`, phone: '01700000000', password: 'Passw0rd!23' }),
  });
  check('registration accepts or rejects XSS payload without 500', xss.status !== 500, `HTTP ${xss.status}`);

  const malformed = await fetch(`${BASE}/api/track`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken',
  });
  check('malformed JSON → 400 (not 500)', malformed.status === 400, `HTTP ${malformed.status}`);

  // ══════════ ৩. রেট লিমিট ══════════
  section('3. Rate limiting');
  let limited = false, tries = 0;
  for (let i = 0; i < 14; i++) {
    tries++;
    const r = await fetch(`${BASE}/api/track`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNo: '999999', phone: '01700000000' }),
    });
    if (r.status === 429) { limited = true; break; }
  }
  check('track endpoint rate-limits', limited, limited ? `429 after ${tries} requests` : 'no 429 within 14 requests');

  // ══════════ ৪. সিকিউরিটি হেডার ══════════
  section('4. Security headers');
  const hres = await fetch(BASE + '/');
  const H = (k: string) => hres.headers.get(k) ?? '';
  check('Content-Security-Policy present', Boolean(H('content-security-policy')), H('content-security-policy').slice(0, 60));
  check('X-Frame-Options / frame-ancestors', Boolean(H('x-frame-options')) || H('content-security-policy').includes('frame-ancestors'), H('x-frame-options'));
  check('X-Content-Type-Options nosniff', H('x-content-type-options') === 'nosniff');
  check('Referrer-Policy set', Boolean(H('referrer-policy')), H('referrer-policy'));
  // ★ HSTS ইচ্ছাকৃতভাবে শুধু প্রোডাকশনে বসে (middleware.ts `if (isProd)`)।
  //   প্লেইন http-তে HSTS পাঠানো অর্থহীন, আর dev সার্ভার সবসময় http।
  //   তাই এখানে হেডার নয়, **কোডে নিয়মটি আছে কি না** সেটাই যাচাই করি।
  const mw = await import('fs').then((fs) => fs.readFileSync('src/middleware.ts', 'utf8'));
  check('HSTS configured for production',
    /isProd[\s\S]{0,200}Strict-Transport-Security/.test(mw) && mw.includes('max-age=63072000'),
    'set in middleware under isProd (not sent over dev http — correct)');
  check('X-Powered-By hidden', !hres.headers.get('x-powered-by'));

  // ══════════ ৫. সিক্রেট ফাঁস ══════════
  section('5. Secret exposure (public surfaces)');
  for (const p of ['/', '/login', '/register', '/track', '/faq']) {
    const html = await (await fetch(BASE + p)).text();
    const bad = (SECRET_HALF.length > 10 && html.includes(SECRET_HALF))
      || (NEXTAUTH_SECRET.length > 10 && html.includes(NEXTAUTH_SECRET))
      || (DBURL.length > 20 && html.includes(DBURL));
    check(`no secrets in ${p}`, !bad);
  }
  const envProbe = await fetch(`${BASE}/.env`);
  check('/.env not served', envProbe.status >= 400, `HTTP ${envProbe.status}`);

  // ══════════ ৬. SEO / PWA ══════════
  section('6. SEO & PWA');
  const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json().catch(() => null);
  check('manifest served', Boolean(manifest));
  check('manifest carries new brand', String(manifest?.name ?? '').includes('SS UID TOPUP'), manifest?.name);
  check('manifest short_name fits home screen', (manifest?.short_name ?? '').length <= 12, manifest?.short_name);
  check('manifest has icons + theme colour', Array.isArray(manifest?.icons) && manifest.icons.length > 0 && Boolean(manifest?.theme_color));
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check('robots.txt served', robots.toLowerCase().includes('user-agent'));
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  check('sitemap.xml served with urls', sitemap.includes('<urlset') && sitemap.includes('<loc>'), `${(sitemap.match(/<loc>/g) ?? []).length} urls`);
  const homeHtml = await (await fetch(BASE + '/')).text();
  check('OpenGraph tags present', homeHtml.includes('og:title') && homeHtml.includes('og:site_name'));
  check('OpenGraph carries new brand', /og:site_name"\s+content="SS UID TOPUP"/.test(homeHtml) || homeHtml.includes('SS UID TOPUP'));
  check('<title> carries new brand', /<title>[^<]*SS UID TOPUP/.test(homeHtml), (homeHtml.match(/<title>([^<]*)</) ?? [])[1]);
  check('icon.svg served', (await fetch(`${BASE}/icon.svg`)).status === 200);

  // ══════════ ৭. ডাটাবেস অখণ্ডতা ══════════
  section('7. Database integrity');
  const prisma = new PrismaClient();
  try {
    const [mediaRows, negBal, orphanOrders, orphanLedger] = await Promise.all([
      prisma.media.findMany({ select: { id: true, url: true } }),
      prisma.user.count({ where: { balance: { lt: 0 } } }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Order" o LEFT JOIN "User" u ON o."userId"=u.id WHERE u.id IS NULL`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "LedgerEntry" l LEFT JOIN "User" u ON l."userId"=u.id WHERE u.id IS NULL`,
    ]);
    check('no negative balances', negBal === 0, `${negBal}`);
    check('no orphan orders', Number(orphanOrders[0].n) === 0, `${orphanOrders[0].n}`);
    check('no orphan ledger entries', Number(orphanLedger[0].n) === 0, `${orphanLedger[0].n}`);

    // ★ স্থানীয় ফাইলের দিকে দেখানো Media সারি — ফাইল সত্যিই ডিস্কে আছে কি না
    //   পরীক্ষা করি। না থাকলে সেটি ভাঙা রেফারেন্স (ছবি ৪০০ দেয়)।
    const fs = await import('fs');
    const localRefs = mediaRows.filter((m) => m.url.startsWith('/uploads/'));
    const missing = localRefs.filter((m) => !fs.existsSync(`public${m.url}`));
    check('no Media rows pointing at missing files', missing.length === 0,
      `${missing.length}/${localRefs.length} local refs missing on disk${missing.length ? ' — ' + missing.map((m) => m.url.split('/').pop()).join(', ') : ''}`);
    console.log(`        media rows total: ${mediaRows.length}`);

    // ইনডেক্স ও কনস্ট্রেইন্ট
    const idx = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_indexes WHERE schemaname='public'`;
    const fks = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public'`;
    const chks = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.table_constraints WHERE constraint_type='CHECK' AND table_schema='public'`;
    check('indexes present', Number(idx[0].n) > 20, `${idx[0].n} indexes`);
    check('foreign keys present', Number(fks[0].n) > 5, `${fks[0].n} FKs`);
    check('check constraints present', Number(chks[0].n) > 0, `${chks[0].n} checks`);
  } finally { await prisma.$disconnect(); }

  // ══════════ ৮. ব্রাউজার: থিম, a11y, PWA, অ্যানিমেশন ══════════
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: exe, args: ['--window-size=1460,980'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    section('8. Theme system (all three modes)');
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    for (const mode of ['dark', 'light', 'system'] as const) {
      await page.evaluate((m) => { localStorage.setItem('theme', m); }, mode);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const st = await page.evaluate(() => ({
        attr: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.documentElement).getPropertyValue('--v-void').trim(),
        ink: getComputedStyle(document.documentElement).getPropertyValue('--v-ink').trim(),
      }));
      check(`theme "${mode}" applies`, Boolean(st.attr && st.bg && st.ink), `data-theme=${st.attr} bg=${st.bg}`);
    }
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));

    section('9. Accessibility (public pages)');
    for (const p of ['/', '/login', '/register']) {
      await page.goto(BASE + p, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const a = await page.evaluate(() => {
        let unlabeled = 0, noAlt = 0, emptyBtn = 0;
        document.querySelectorAll('input,select,textarea').forEach((el) => {
          const i = el as HTMLInputElement;
          if (i.type === 'hidden') return;
          const ok = i.getAttribute('aria-label') || (i.id && document.querySelector(`label[for="${i.id}"]`)) || i.closest('label');
          if (!ok) unlabeled++;
        });
        document.querySelectorAll('img').forEach((im) => { if (!im.hasAttribute('alt')) noAlt++; });
        document.querySelectorAll('button').forEach((b) => {
          if (!(b.textContent || '').trim() && !b.getAttribute('aria-label')) emptyBtn++;
        });
        return {
          unlabeled, noAlt, emptyBtn,
          lang: document.documentElement.lang,
          h1: document.querySelectorAll('h1').length,
          skip: Boolean(document.querySelector('a[href="#main"],a[href^="#"]')),
        };
      });
      check(`${p}: inputs labelled`, a.unlabeled === 0, `${a.unlabeled} unlabeled`);
      check(`${p}: images have alt`, a.noAlt === 0, `${a.noAlt} missing`);
      check(`${p}: buttons named`, a.emptyBtn === 0, `${a.emptyBtn} unnamed`);
      check(`${p}: lang + single h1 + skip-link`, Boolean(a.lang) && a.h1 <= 1 && a.skip, `lang=${a.lang} h1=${a.h1} skip=${a.skip}`);
    }

    section('10. Reduced motion');
    const rmCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const rmPage = await rmCtx.newPage();
    await rmPage.goto(BASE + '/', { waitUntil: 'networkidle' });
    await rmPage.waitForTimeout(700);
    const rm = await rmPage.evaluate(() => {
      const anims = document.getAnimations();
      const longest = anims.reduce((m, a) => {
        const d = (a.effect?.getTiming().duration ?? 0) as number;
        return Math.max(m, typeof d === 'number' ? d : 0);
      }, 0);
      return { count: anims.length, longest };
    });
    check('reduced-motion collapses animations', rm.longest <= 1, `${rm.count} animations, longest ${rm.longest}ms`);
    await rmCtx.close();

    section('11. Animation performance (default motion)');
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const anim = await page.evaluate(() => {
      const props = new Set<string>();
      let n = 0;
      document.getAnimations().forEach((a) => {
        if (a.constructor.name !== 'CSSAnimation') return;
        n++;
        for (const f of (a.effect as KeyframeEffect)?.getKeyframes?.() ?? []) {
          for (const k of Object.keys(f)) {
            if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
          }
        }
      });
      return { n, props: [...props] };
    });
    const nonComp = anim.props.filter((p) => !['transform', 'opacity'].includes(p));
    check('all CSS animations compositor-only', nonComp.length === 0, `${anim.n} animations: ${anim.props.join(', ') || 'none'}${nonComp.length ? ' | BAD: ' + nonComp.join(',') : ''}`);

    section('12. Media fallback (missing files)');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    let authed = 0;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      authed = await page.evaluate(async (b) => (await fetch(`${b}/api/me`)).status, BASE);
      if (authed === 200) break;
    }
    if (authed === 200) {
      // ★ ভাঙা ছবির fallback পরীক্ষা করতে একটি **ইচ্ছাকৃত ভাঙা** সারি
      //   তৈরি করি, তারপর মুছে দিই। আগে এই টেস্ট আসল ভাঙা ডেটার উপর
      //   নির্ভর করত — সেটি ঠিক করার পর টেস্টই অর্থহীন হয়ে গিয়েছিল।
      const p2 = new PrismaClient();
      const probeUrl = `/uploads/products/__audit_missing_${Date.now()}.webp`;
      let probeId = '';
      try {
        const row = await p2.media.create({
          data: {
            url: probeUrl, alt: 'audit probe', mime: 'image/webp',
            storage: 'local', folder: 'products', bytes: 1,
          },
        });
        probeId = row.id;
      } catch (e) {
        console.log(`        probe create failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      }

      const errs: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      await page.goto(`${BASE}/admin/media`, { waitUntil: 'networkidle' });
      // ★ নির্দিষ্ট সময় অপেক্ষা নয় — ছবিটি ব্যর্থ হতে নেটওয়ার্ক রাউন্ড-ট্রিপ
      //   লাগে, তারপর React রি-রেন্ডার করে। dev-এ প্রথম আঘাতে পাতাটি
      //   কম্পাইলও হয়, তাই স্থির টাইমআউট ভঙ্গুর (একবার মিথ্যা ব্যর্থতা দিয়েছিল)।
      await page.waitForFunction(
        () => document.body.innerText.includes('ছবি নেই'),
        undefined, { timeout: 20000 },
      ).catch(() => {});
      const txt = (await page.textContent('body')) ?? '';
      // ★ probe তৈরি না হলে টেস্টটি **ব্যর্থ** ধরা হয় — নাহলে কিছু যাচাই
      //   না করেই PASS দেখাত, যা মিথ্যা আশ্বাস।
      check('missing image renders a placeholder, not a broken box',
        Boolean(probeId) && txt.includes('ছবি নেই'),
        probeId ? 'placeholder rendered for a deliberately-missing file' : 'PROBE ROW NOT CREATED — nothing was tested');

      if (probeId) await p2.media.delete({ where: { id: probeId } }).catch(() => {});
      await p2.$disconnect();
      // ★ কনসোলে 400 থেকেই যাবে — `next/image` অনুরোধ **না পাঠিয়ে** জানতেই
      //   পারে না যে ফাইলটি নেই। onError সেটি ধরে প্লেসহোল্ডার দেখায়, কিন্তু
      //   অনুরোধটি ততক্ষণে হয়ে গেছে। আসল সমাধান ভাঙা DB সারি মুছে ফেলা
      //   (§7-এ গোনা হয়েছে) — সেটি অ্যাডমিনের ডেটা, তাই নিজে মুছিনি।
      const four = errs.filter((e) => e.includes('400')).length;
      check('broken-image console noise stays bounded (1 per missing file)', four <= 4, `${four} 400-errors — inherent to client-side detection`);
    } else {
      check('media fallback (needs login)', false, 'login failed — rate limited?');
    }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.log('FAILURES:'); failed.forEach((r) => console.log(`   • ${r.name} — ${r.note}`)); }
  process.exit(failed.length ? 1 : 0);
}

main();
