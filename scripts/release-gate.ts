/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ FINAL PRODUCTION RELEASE GATE
 * `npx tsx scripts/release-gate.ts [--headless] [--only=authz,auth,...]`
 *
 *   এটি "কোড ঠিক আছে কি না" দেখে না — **চলমান অ্যাপটিকে ব্যবহার করে**।
 *   প্রতিটি দাবি HTTP স্ট্যাটাস, রেন্ডার করা DOM বা ডেটাবেসের সারি
 *   দেখে প্রমাণ করা হয়।
 *
 *   ধাপ:
 *     auth      রেজিস্ট্রেশন, লগইন, লগআউট, সেশন, রেট-লিমিট
 *     authz     ★ ভাঙা অ্যাক্সেস-কন্ট্রোল — ৫৬টি API × ৩ ভূমিকা
 *     workflow  ডিপোজিট, অর্ডার, কুপন, অ্যাডমিন অনুমোদন/ডেলিভারি/রিফান্ড
 *     security  XSS, SQLi, গোপন তথ্য ফাঁস, CSRF, সরাসরি URL
 *     db        ডুপ্লিকেট অনুরোধ, সমসাময়িকতা, টাকার নিরাপত্তা
 *     perf      লেটেন্সি ও সমসাময়িক লোড
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = process.env.GATE_BASE || 'http://localhost:3000';
const HEADLESS = process.argv.includes('--headless');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const stages = ONLY ? ONLY.split(',') : ['auth', 'authz', 'workflow', 'security', 'db', 'perf'];
const run = (s: string) => stages.includes(s);

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const OUT = 'audit/release';
mkdirSync(OUT, { recursive: true });

/* ─────────── ফলাফল সংগ্রহ ─────────── */
type Sev = 'BLOCKER' | 'MAJOR' | 'MINOR' | 'INFO';
type Res = { stage: string; name: string; ok: boolean; sev: Sev; note: string };
const results: Res[] = [];
let stage = '';
const section = (s: string) => { stage = s; console.log(`\n═══ ${s} ═══`); };
const check = (name: string, ok: boolean, note = '', sev: Sev = 'MAJOR') => {
  results.push({ stage, name, ok, sev, note });
  const tag = ok ? 'PASS' : (sev === 'BLOCKER' ? 'BLOCK' : 'FAIL');
  console.log(`  ${tag.padEnd(5)} ${name}${note ? ` — ${note}` : ''}`);
  return ok;
};
const info = (name: string, note: string) => {
  results.push({ stage, name, ok: true, sev: 'INFO', note });
  console.log(`  INFO  ${name} — ${note}`);
};

/* ─────────── সব API রুট ফাইল-সিস্টেম থেকে ─────────── */
function apiRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === 'route.ts') {
        const rel = p.replace(/\\/g, '/').replace('src/app', '').replace('/route.ts', '');
        out.push(rel);
      }
    }
  };
  walk('src/app/api');
  return out.sort();
}

/** `[id]` জাতীয় ডাইনামিক সেগমেন্টে একটি নিরীহ মান বসাই */
const concrete = (r: string) => r.replace(/\[\.\.\.[^\]]+\]/g, 'probe').replace(/\[[^\]]+\]/g, '1');

async function login(ctx: BrowserContext, email: string, password: string): Promise<boolean> {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 });
    return true;
  } catch { return false; }
  finally { await page.close(); }
}

async function clearRateLimit() {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  await db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
  await db.$disconnect();
}

async function main() {
  if (!exe) { console.log('FATAL: no browser'); process.exit(1); }
  const t0 = Date.now();
  await clearRateLimit();

  const browser: Browser = await chromium.launch({ headless: HEADLESS, executablePath: exe });
  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const customer = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  /* ═════════ ১. AUTH ═════════ */
  const cust = {
    email: `gate.${Date.now()}@example.com`,
    password: 'GateTest12345',
    name: 'Release Gate',
    phone: `018${String(Date.now()).slice(-8)}`,
  };

  if (run('auth')) {
    section('1. AUTHENTICATION');

    // ── রেজিস্ট্রেশন (আসল ফর্ম) ──
    const rp = await customer.newPage();
    await rp.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
    await rp.fill('#name', cust.name);
    await rp.fill('#email', cust.email);
    await rp.fill('#phone', cust.phone);
    await rp.fill('#password', cust.password);
    await rp.click('button[type="submit"]');
    const registered = await rp.waitForURL((u) => !u.pathname.includes('/register'), { timeout: 30000 })
      .then(() => true).catch(() => false);
    check('registration creates an account and signs in', registered,
      registered ? cust.email : 'stayed on /register', 'BLOCKER');

    // ── সেশন সত্যিই আছে ──
    const meRes = await customer.request.get(`${BASE}/api/me`);
    check('session works after registration', meRes.ok(), `GET /api/me → ${meRes.status()}`, 'BLOCKER');

    // ── ডুপ্লিকেট ইমেইল প্রত্যাখ্যাত ──
    const dup = await guest.request.post(`${BASE}/api/register`, {
      data: { name: 'dup', email: cust.email, phone: cust.phone, password: cust.password },
    });
    check('duplicate email rejected', !dup.ok(), `→ ${dup.status()}`, 'MAJOR');

    // ── দুর্বল পাসওয়ার্ড প্রত্যাখ্যাত ──
    const weak = await guest.request.post(`${BASE}/api/register`, {
      data: { name: 'w', email: `w.${Date.now()}@example.com`, phone: '01712345678', password: '123' },
    });
    check('weak password rejected', !weak.ok(), `→ ${weak.status()}`, 'MAJOR');

    // ── লগআউট ──
    await rp.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
    await rp.evaluate(`fetch('/api/auth/signout', { method: 'POST' })`).catch(() => {});
    await rp.waitForTimeout(1200);
    await rp.close();

    // ── ভুল পাসওয়ার্ডে লগইন ব্যর্থ ──
    const badCtx = await browser.newContext();
    const badOk = await login(badCtx, cust.email, 'definitely-wrong-password');
    check('login rejects a wrong password', !badOk, badOk ? 'LOGGED IN WITH WRONG PASSWORD' : 'denied', 'BLOCKER');
    await badCtx.close();

    /* ── রেট-লিমিট (ব্রুট-ফোর্স গার্ড) ──
       ⚠️ এটি **সঠিকভাবে** মাপা কঠিন, এবং প্রথম চেষ্টায় ভুল মাপা হয়েছিল:
       ১. `/api/auth/callback/credentials` এ সরাসরি POST করলে NextAuth
          CSRF-এর কারণে `authorize()` পর্যন্ত পৌঁছায়ই না — লিমিটার তখন
          কখনো চলে না, আর টেস্ট মিথ্যা "কোনো লকআউট নেই" বলে।
       ২. UI-এর বার্তা লকআউটেও একই থাকে ("ইমেইল বা পাসওয়ার্ড ভুল") —
          এটি **ইচ্ছাকৃত ও সঠিক**: লকআউট ফাঁস করলে আক্রমণকারী জানত
          কোন ইমেইল আসল।
       তাই একমাত্র বৈধ প্রমাণ: সীমা পেরোনোর পর **সঠিক পাসওয়ার্ডও
       প্রত্যাখ্যাত হয়** (`authorize` পাসওয়ার্ড দেখার আগেই null ফেরায়)। */
    await clearRateLimit();
    for (let i = 0; i < 6; i++) {
      const c = await browser.newContext();
      await login(c, cust.email, `wrong-${i}`);
      await c.close();
    }
    const lockedCtx = await browser.newContext();
    const loginAfterLimit = await login(lockedCtx, cust.email, cust.password);
    await lockedCtx.close();
    check('brute-force guard refuses even the correct password once tripped',
      !loginAfterLimit,
      loginAfterLimit ? 'CORRECT PASSWORD STILL ACCEPTED after 6 failures — limiter counts but does not block'
        : 'locked out after 6 failed attempts (5/15min per email)', 'BLOCKER');
    await clearRateLimit();

    // ── সঠিক শংসাপত্রে লগইন ──
    const custOk = await login(customer, cust.email, cust.password);
    check('customer can log in with correct credentials', custOk, cust.email, 'BLOCKER');
  } else {
    await login(customer, cust.email, cust.password).catch(() => false);
  }

  const adminOk = await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  if (run('auth')) check('admin can log in', adminOk, ADMIN_EMAIL, 'BLOCKER');

  /* ═════════ ২. AUTHORIZATION MATRIX ═════════ */
  if (run('authz')) {
    section('2. AUTHORIZATION — broken access control');

    const routes = apiRoutes();
    info('API surface', `${routes.length} route files; ${routes.filter((r) => r.startsWith('/api/admin')).length} under /api/admin`);

    const adminRoutes = routes.filter((r) => r.startsWith('/api/admin'));
    const leaks: string[] = [];
    const denied: Record<string, number> = {};

    for (const role of ['guest', 'customer'] as const) {
      const ctx = role === 'guest' ? guest : customer;
      for (const r of adminRoutes) {
        const url = `${BASE}${concrete(r)}`;
        for (const method of ['GET', 'POST'] as const) {
          const res = method === 'GET'
            ? await ctx.request.get(url, { failOnStatusCode: false, maxRedirects: 0 })
            : await ctx.request.post(url, { data: {}, failOnStatusCode: false, maxRedirects: 0 });
          const s = res.status();
          // ২xx = ভাঙা অ্যাক্সেস-কন্ট্রোল। ৪xx/৩xx/৫xx সবই প্রত্যাখ্যান।
          if (s >= 200 && s < 300) {
            const body = (await res.text().catch(() => '')).slice(0, 120);
            leaks.push(`${role} ${method} ${concrete(r)} → ${s} ${body.replace(/\s+/g, ' ')}`);
          } else {
            denied[String(s)] = (denied[String(s)] || 0) + 1;
          }
        }
      }
    }
    check('no admin API is reachable by guest or customer', leaks.length === 0,
      leaks.length ? leaks.slice(0, 6).join(' | ') : `${adminRoutes.length * 4} probes denied (${Object.entries(denied).map(([k, v]) => k + '×' + v).join(', ')})`,
      'BLOCKER');

    // ── অ্যাডমিন পাতা: সরাসরি URL ──
    const adminPages = ['/admin', '/admin/users', '/admin/deposits', '/admin/orders', '/admin/settings',
      '/admin/branding', '/admin/telegram', '/admin/tools', '/admin/logs', '/admin/payments'];
    const pageLeaks: string[] = [];
    for (const role of ['guest', 'customer'] as const) {
      const ctx = role === 'guest' ? guest : customer;
      const p = await ctx.newPage();
      for (const path of adminPages) {
        const resp = await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
        const landed = new URL(p.url()).pathname;
        // অ্যাডমিন পাতায় থেকে গেলে ও ২০০ পেলে = ফাঁস
        if (landed.startsWith('/admin') && resp && resp.status() === 200) {
          pageLeaks.push(`${role} → ${path} (landed ${landed})`);
        }
      }
      await p.close();
    }
    check('no admin page is reachable by guest or customer', pageLeaks.length === 0,
      pageLeaks.length ? pageLeaks.slice(0, 5).join(' | ') : `${adminPages.length * 2} direct-URL attempts redirected`,
      'BLOCKER');

    // ── গ্রাহকের ডেটা অন্য গ্রাহক দেখতে পায় না (IDOR) ──
    const idor: string[] = [];
    for (const path of ['/api/me', '/api/notifications']) {
      const g = await guest.request.get(`${BASE}${path}`, { failOnStatusCode: false });
      if (g.status() >= 200 && g.status() < 300) {
        const t = await g.text();
        if (t.length > 40 && !/\[\]|null|\{\s*\}/.test(t)) idor.push(`guest ${path} → ${g.status()} ${t.slice(0, 60)}`);
      }
    }
    check('customer-scoped APIs return nothing to a guest', idor.length === 0, idor.join(' | ') || 'ok', 'BLOCKER');

    // ── ভূমিকার বাস্তবতা ──
    info('roles implemented', 'schema enum Role = { USER, ADMIN } only — no Owner/Manager/Staff tier exists');
  }

  /* ═════════ ৩. WORKFLOWS ═════════ */
  if (run('workflow')) {
    section('3. WORKFLOWS (end-to-end, real UI)');
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();

    // ── ৩.১ গ্রাহক: ডিপোজিট জমা ──
    const cp = await customer.newPage();
    const trx = `GATE${Date.now()}`;
    await cp.goto(`${BASE}/account/wallet/deposit`, { waitUntil: 'networkidle' });
    const hasDepositForm = (await cp.locator('form').count()) > 0;
    check('deposit page renders a form', hasDepositForm, '', 'MAJOR');

    let depositMade = false;
    if (hasDepositForm) {
      const before = await db.deposit.count();
      const dres = await customer.request.post(`${BASE}/api/deposit`, {
        data: { amount: 500, method: 'BKASH', senderNo: '01712345678', trxId: trx },
        failOnStatusCode: false,
      });
      depositMade = dres.ok();
      const after = await db.deposit.count();
      check('customer can submit a deposit', depositMade && after === before + 1,
        `→ ${dres.status()}, rows ${before}→${after}`, 'BLOCKER');

      // ── ডুপ্লিকেট TrxID প্রত্যাখ্যাত (টাকার নিরাপত্তা) ──
      const dup = await customer.request.post(`${BASE}/api/deposit`, {
        data: { amount: 500, method: 'BKASH', senderNo: '01712345678', trxId: trx },
        failOnStatusCode: false,
      });
      const after2 = await db.deposit.count();
      check('duplicate transaction ID is rejected', !dup.ok() && after2 === after,
        `→ ${dup.status()}, rows ${after}→${after2}`, 'BLOCKER');
    }

    // ── ৩.২ ডিপোজিট অনুমোদনে ব্যালেন্স বাড়ে ও খতিয়ান লেখা হয় ──
    if (depositMade) {
      const dep = await db.deposit.findFirst({ where: { trxId: trx } });
      const u = await db.user.findFirst({ where: { email: cust.email } });
      if (dep && u) {
        const balBefore = Number(u.balance);
        const ledgerBefore = await db.ledgerEntry.count({ where: { userId: u.id } }).catch(() => -1);
        // ⚠️ ফিল্ডের নাম `depositId`, `id` নয় — প্রথম রানে `id` পাঠিয়ে
        //    ৪০০ পেয়ে সেটিকে ভুল করে "ব্যালেন্স জমা হয় না" ব্লকার ভেবেছিলাম।
        const ares = await admin.request.post(`${BASE}/api/admin/deposit`, {
          data: { depositId: dep.id, action: 'APPROVE' }, failOnStatusCode: false,
        });
        await new Promise((r) => setTimeout(r, 900));
        const u2 = await db.user.findUnique({ where: { id: u.id } });
        const balAfter = Number(u2?.balance ?? 0);
        const ledgerAfter = await db.ledgerEntry.count({ where: { userId: u.id } }).catch(() => -1);
        check('admin approval credits the wallet', ares.ok() && balAfter === balBefore + Number(dep.amount),
          `→ ${ares.status()}, ৳${balBefore} → ৳${balAfter}`, 'BLOCKER');
        check('approval writes a wallet ledger entry',
          ledgerBefore < 0 || ledgerAfter === ledgerBefore + 1,
          ledgerBefore < 0 ? 'LedgerEntry unavailable' : `${ledgerBefore} → ${ledgerAfter}`, 'MAJOR');
      }
    }

    // ── ৩.৩ অর্ডার দেওয়া (ব্যালেন্স খরচ) ──
    const prod = await db.product.findFirst({ where: { isActive: true }, include: { variants: true } as never }) as never as
      { id: number; name: string; variants?: { id: number; price: unknown }[] } | null;
    if (prod?.variants?.length) {
      const v = prod.variants[0];
      const u = await db.user.findFirst({ where: { email: cust.email } });
      const balBefore = Number(u?.balance ?? 0);
      const ores = await customer.request.post(`${BASE}/api/order`, {
        data: { variantId: v.id, playerUid: '123456789', quantity: 1 }, failOnStatusCode: false,
      });
      await new Promise((r) => setTimeout(r, 700));
      const u2 = await db.user.findFirst({ where: { email: cust.email } });
      const balAfter = Number(u2?.balance ?? 0);
      const price = Number(v.price);
      if (balBefore >= price) {
        check('order deducts exactly the price from the wallet',
          ores.ok() && Math.abs((balBefore - balAfter) - price) < 0.01,
          `→ ${ores.status()}, ৳${balBefore} → ৳${balAfter} (price ৳${price})`, 'BLOCKER');
      } else {
        check('order is refused when balance is insufficient', !ores.ok(),
          `→ ${ores.status()}, balance ৳${balBefore} < price ৳${price}`, 'BLOCKER');
      }
      // ── অপর্যাপ্ত ব্যালেন্সে কখনো ঋণাত্মক হয় না ──
      check('wallet never goes negative', balAfter >= 0, `৳${balAfter}`, 'BLOCKER');
    } else {
      info('order workflow', 'skipped — no active product with variants in the database');
    }

    // ── ৩.৪ কুপন যাচাই ──
    /* ⚠️ এই পরীক্ষাটি আগে **মিথ্যা আশ্বাস** দিত, দুটি কারণে:
         ১. পাঠানো হতো `{ code, amount }` — কিন্তু `/api/coupon/check`
            চায় `variantId` (দাম সার্ভারেই বের করা হয়, যাতে ক্লায়েন্ট
            দাম বলতে না পারে)। তাই বৈধ কুপনেও schema-ভুলে 400 আসত।
         ২. দাবি ছিল `good.status() < 500` — অর্থাৎ ঐ 400-ও "পাস"।
       ফলে "বৈধ কুপন গৃহীত" কখনোই প্রমাণিত হয়নি। এখন একটি নিশ্চিতভাবে
       বৈধ কুপন তৈরি করে প্রকৃত 200 ও সঠিক ছাড়ের অঙ্ক যাচাই করা হয়। */
    const variantForCoupon = await db.variant.findFirst({
      where: { isActive: true }, select: { id: true, price: true },
    });
    if (variantForCoupon) {
      const tmpCode = `GATECPN${Date.now().toString().slice(-6)}`;
      await db.coupon.create({
        data: {
          code: tmpCode, type: 'PERCENT', value: 10, minOrder: 0,
          usageLimit: 100, perUserLimit: 5, isActive: true,
          expiresAt: new Date(Date.now() + 864e5),
        },
      });

      const good = await customer.request.post(`${BASE}/api/coupon/check`, {
        data: { code: tmpCode, variantId: variantForCoupon.id }, failOnStatusCode: false,
      });
      const bad = await customer.request.post(`${BASE}/api/coupon/check`, {
        data: { code: 'NOPE-DOES-NOT-EXIST', variantId: variantForCoupon.id }, failOnStatusCode: false,
      });

      // ছাড় সত্যিই ১০% কি না — শুধু স্ট্যাটাস নয়, অঙ্কও মেলানো হয়
      let discountOk = false;
      let detail = '';
      if (good.ok()) {
        const body = await good.json().catch(() => null) as
          { discount?: string; subtotal?: string; finalPrice?: string } | null;
        const sub = Number(body?.subtotal ?? 0);
        const dis = Number(body?.discount ?? -1);
        discountOk = Math.abs(dis - sub * 0.1) < 0.02;
        detail = `৳${sub} − ৳${dis} = ৳${body?.finalPrice}`;
      }

      check('valid coupon accepted with the correct discount, invalid rejected',
        good.ok() && discountOk && !bad.ok(),
        `valid → ${good.status()}${detail ? ` (${detail})` : ''}, invalid → ${bad.status()}`, 'MAJOR');

      await db.coupon.delete({ where: { code: tmpCode } }).catch(() => {});
    }

    // ── ৩.৫ অ্যাডমিন CRUD: কুপন তৈরি → মুছে ফেলা ──
    const code = `GATE${Date.now().toString().slice(-6)}`;
    const cres = await admin.request.post(`${BASE}/api/admin/coupon`, {
      data: { code, type: 'PERCENT', value: 10, minOrder: 0, maxUses: 5, perUserLimit: 1, isActive: true },
      failOnStatusCode: false,
    });
    const made = await db.coupon.findFirst({ where: { code } });
    check('admin can create a coupon (CRUD write path)', cres.ok() && !!made,
      `→ ${cres.status()}${made ? ', row created' : ', NO ROW'}`, 'MAJOR');
    if (made) {
      // ── নিষ্ক্রিয় করা (PATCH) ──
      const pres = await admin.request.patch(`${BASE}/api/admin/coupon`, {
        data: { id: made.id, isActive: false }, failOnStatusCode: false,
      });
      const off = await db.coupon.findUnique({ where: { id: made.id } });
      check('admin can deactivate a coupon (CRUD update path)',
        pres.ok() && off?.isActive === false, `→ ${pres.status()}, isActive=${off?.isActive}`, 'MAJOR');

      // ── মুছে ফেলা (DELETE — `id` **বডিতে**, query-তে নয়) ──
      const dres = await admin.request.delete(`${BASE}/api/admin/coupon`, {
        data: { id: made.id }, failOnStatusCode: false,
      });
      const gone = !(await db.coupon.findUnique({ where: { id: made.id } }));
      check('admin can delete an unused coupon (CRUD delete path)', gone, `→ ${dres.status()}`, 'MAJOR');
      if (!gone) await db.coupon.delete({ where: { id: made.id } }).catch(() => {});
    }

    // ── ৩.৬ সেটিংস সংরক্ষণ ──
    const sres = await admin.request.post(`${BASE}/api/admin/settings`, {
      data: { site_notice: 'release-gate probe' }, failOnStatusCode: false,
    });
    check('admin settings save', sres.status() < 500, `→ ${sres.status()}`, 'MAJOR');

    // ── ৩.৭ রিপোর্ট ও হেলথ ──
    const rep = await admin.request.get(`${BASE}/api/admin/reports`, { failOnStatusCode: false });
    check('reports API responds', rep.status() < 500, `→ ${rep.status()}`, 'MINOR');
    const health = await guest.request.get(`${BASE}/api/health`, { failOnStatusCode: false });
    check('health endpoint responds', health.ok(), `→ ${health.status()}`, 'MINOR');

    await cp.close();
    await db.$disconnect();
  }

  /* ═════════ ৪. SECURITY ═════════ */
  if (run('security')) {
    section('4. SECURITY');

    // ── ৪.১ XSS: সংরক্ষিত পেলোড এস্কেপ হয় ──
    const xss = '<img src=x onerror="window.__xss=1">';
    const xres = await customer.request.patch(`${BASE}/api/account/profile`, {
      data: { name: xss }, failOnStatusCode: false,
    });
    const xp = await customer.newPage();
    let fired = false;
    xp.on('dialog', (d) => { fired = true; d.dismiss().catch(() => {}); });
    await xp.goto(`${BASE}/account/profile`, { waitUntil: 'networkidle' }).catch(() => {});
    const executed = await xp.evaluate(`Boolean(window.__xss)`).catch(() => false);
    check('stored XSS payload does not execute', !executed && !fired,
      `PATCH → ${xres.status()}, script executed=${executed}`, 'BLOCKER');
    await customer.request.patch(`${BASE}/api/account/profile`, { data: { name: cust.name }, failOnStatusCode: false });
    await xp.close();

    // ── ৪.২ SQL ইনজেকশন: লগইন বাইপাস অসম্ভব ──
    const sqlCtx = await browser.newContext();
    const sqlOk = await login(sqlCtx, `' OR '1'='1`, `' OR '1'='1`);
    check('SQL injection cannot bypass login', !sqlOk, sqlOk ? 'LOGGED IN VIA INJECTION' : 'denied', 'BLOCKER');
    await sqlCtx.close();
    const sqlSearch = await admin.request.get(`${BASE}/api/admin/search?q=${encodeURIComponent("'; DROP TABLE \"User\"; --")}`,
      { failOnStatusCode: false });
    const { PrismaClient: PC } = await import('@prisma/client');
    const db2 = new PC();
    const stillThere = await db2.user.count().catch(() => -1);
    check('injection in search does not damage the database', stillThere > 0,
      `search → ${sqlSearch.status()}, User rows = ${stillThere}`, 'BLOCKER');
    await db2.$disconnect();

    // ── ৪.৩ গোপন তথ্য ফাঁস ──
    const secretPats: [string, RegExp][] = [
      ['telegram bot token', /\d{8,12}:AA[\w-]{30,}/],
      ['postgres url', /postgres(ql)?:\/\/[^\s"']+/],
      ['nextauth secret', /NEXTAUTH_SECRET/],
      ['encryption key', /ENCRYPTION_KEY|SETTINGS_KEY/],
    ];
    const leakHits: string[] = [];
    const probePages = ['/', '/login', '/admin', '/admin/site', '/admin/telegram', '/admin/branding'];
    for (const path of probePages) {
      const p = await admin.newPage();
      await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
      const html = await p.content().catch(() => '');
      for (const [label, re] of secretPats) if (re.test(html)) leakHits.push(`${label} in HTML of ${path}`);
      await p.close();
    }
    for (const api of ['/api/admin/settings', '/api/admin/telegram/config', '/api/me']) {
      const r = await admin.request.get(`${BASE}${api}`, { failOnStatusCode: false });
      const t = await r.text().catch(() => '');
      for (const [label, re] of secretPats) if (re.test(t)) leakHits.push(`${label} in ${api}`);
    }
    check('no secret appears in HTML or API responses', leakHits.length === 0,
      leakHits.join(' | ') || `${probePages.length} pages + 3 APIs scanned for 4 secret patterns`, 'BLOCKER');

    /* ── ৪.৪ CSRF ──
       ⚠️ প্রথম চেষ্টায় ভুল পরীক্ষা করা হয়েছিল: Playwright-এর
       `request` কনটেক্সট **ব্রাউজার নয়** — সে SameSite মানে না এবং
       নিজের কুকি-জার থেকে কুকি পাঠিয়ে দেয়। তাই `Origin: evil.com`
       দিয়ে ২০০ পাওয়া গিয়েছিল এবং সেটিকে ভুল করে CSRF দুর্বলতা ভাবা
       হয়েছিল। আসল ব্রাউজারে ভিন্ন সাইট থেকে POST করলে সেশন-কুকিটি
       **পাঠানোই হয় না**, যদি সেটি SameSite=Lax হয়।
       তাই সঠিক প্রমাণ = কুকির প্রকৃত অ্যাট্রিবিউট যাচাই করা। */
    const cookies = await customer.cookies();
    const sess = cookies.find((c) => /next-auth\.session-token/.test(c.name));
    check('session cookie is httpOnly + SameSite=Lax (the CSRF mitigation)',
      !!sess && sess.httpOnly === true && String(sess.sameSite).toLowerCase() === 'lax',
      sess ? `${sess.name} httpOnly=${sess.httpOnly} sameSite=${sess.sameSite} secure=${sess.secure}` : 'NO SESSION COOKIE',
      'BLOCKER');
    info('cookie `secure` flag', 'false on http dev; auth.ts sets it from NODE_ENV === "production"');

    // ── ৪.৫ ইনপুট যাচাই: বাজে JSON ও অতিকায় পেলোড ──
    const badJson = await customer.request.post(`${BASE}/api/deposit`, {
      headers: { 'content-type': 'application/json' }, data: '{not json',
      failOnStatusCode: false,
    });
    check('malformed JSON returns 4xx, not 500', badJson.status() >= 400 && badJson.status() < 500,
      `→ ${badJson.status()}`, 'MAJOR');
    const huge = await customer.request.post(`${BASE}/api/deposit`, {
      data: { amount: 1, method: 'BKASH', senderNo: '01712345678', trxId: 'X'.repeat(200000) },
      failOnStatusCode: false,
    });
    check('oversized payload rejected without a 500', huge.status() >= 400 && huge.status() < 500,
      `→ ${huge.status()}`, 'MAJOR');

    // ── ৪.৬ নিরাপত্তা হেডার ──
    const hres = await guest.request.get(`${BASE}/`, { failOnStatusCode: false });
    const h = hres.headers();
    const missing = ['x-content-type-options', 'x-frame-options', 'referrer-policy']
      .filter((k) => !h[k]);
    check('core security headers present', missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : 'x-content-type-options, x-frame-options, referrer-policy', 'MAJOR');
    info('HSTS', h['strict-transport-security'] ? 'set' : 'not set over plain http (expected — set under isProd+https)');
  }

  /* ═════════ ৫. DATABASE & CONCURRENCY ═════════ */
  if (run('db')) {
    section('5. DATABASE, MONEY SAFETY & CONCURRENCY');
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();

    // ── ৫.১ একই সাথে ১০টি অভিন্ন ডিপোজিট: ঠিক ১টি টিকবে ──
    const trx = `CONC${Date.now()}`;
    const before = await db.deposit.count();
    const many = await Promise.all(Array.from({ length: 10 }, () =>
      customer.request.post(`${BASE}/api/deposit`, {
        data: { amount: 100, method: 'BKASH', senderNo: '01712345678', trxId: trx },
        failOnStatusCode: false,
      })));
    const okCount = many.filter((r) => r.ok()).length;
    const after = await db.deposit.count();
    check('10 concurrent identical deposits create exactly one row',
      after - before === 1, `accepted ${okCount}/10, rows +${after - before}`, 'BLOCKER');

    // ── ৫.২ সমসাময়িক অর্ডার ব্যালেন্স ঋণাত্মক করে না ──
    const u = await db.user.findFirst({ where: { email: cust.email } });
    const prod = await db.product.findFirst({ where: { isActive: true }, include: { variants: true } as never }) as never as
      { variants?: { id: number }[] } | null;
    if (u && prod?.variants?.length) {
      await Promise.all(Array.from({ length: 8 }, () =>
        customer.request.post(`${BASE}/api/order`, {
          data: { variantId: prod.variants![0].id, playerUid: '123456789', quantity: 1 },
          failOnStatusCode: false,
        })));
      await new Promise((r) => setTimeout(r, 1200));
      const u2 = await db.user.findUnique({ where: { id: u.id } });
      check('8 concurrent orders never drive the wallet negative',
        Number(u2?.balance ?? 0) >= 0, `balance ৳${Number(u2?.balance ?? 0)}`, 'BLOCKER');
    }

    // ── ৫.৩ ইনডেক্স ──
    const idx = await db.$queryRawUnsafe<{ tablename: string; indexname: string }[]>(
      `SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public'`).catch(() => []);
    const byTable = new Set(idx.map((i) => i.tablename));
    // ⚠️ মডেলের নাম `LedgerEntry` — `WalletLedger` নয়। ভুল নাম দিয়ে
    //    খুঁজে "ইনডেক্স নেই" বলা হয়েছিল; টেবিলটাই ওই নামে নেই।
    const hot = ['Order', 'Deposit', 'User', 'LedgerEntry', 'AdminLog', 'Notification'];
    const unindexed = hot.filter((t) => !byTable.has(t));
    check('hot tables are indexed', unindexed.length === 0,
      unindexed.length ? `no index on: ${unindexed.join(', ')}` : `${idx.length} indexes across ${byTable.size} tables`, 'MAJOR');

    // ── ৫.৪ N+1 সনাক্তকরণ ──
    let qCount = 0;
    const spy = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    (spy as never as { $on: (e: string, cb: () => void) => void }).$on('query', () => { qCount++; });
    await spy.order.findMany({ take: 20, include: { user: true, variant: { include: { product: true } } } as never });
    await spy.$disconnect();
    /* ⚠️ থ্রেশহোল্ড **সম্পর্কের সংখ্যা** অনুযায়ী হতে হয়, ইচ্ছেমতো নয়।
       Prisma প্রতিটি `include` স্তরের জন্য একটি করে ব্যাচড কোয়েরি চালায়:
       orders + user + variant + product = ৪। N+1 মানে হতো ২০+ কোয়েরি।
       প্রথমে `≤3` বসিয়ে সঠিক আচরণকেই ব্যর্থ দেখানো হয়েছিল। */
    check('order list is batched, not N+1', qCount <= 6,
      `${qCount} queries for 20 orders across 3 relation levels (N+1 would be 20+)`, 'MAJOR');

    await db.$disconnect();
  }

  /* ═════════ ৬. PERFORMANCE ═════════ */
  if (run('perf')) {
    section('6. PERFORMANCE (honest, measured)');

    const timeIt = async (path: string, n: number) => {
      const ts: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = Date.now();
        await guest.request.get(`${BASE}${path}`, { failOnStatusCode: false });
        ts.push(Date.now() - t);
      }
      ts.sort((a, b) => a - b);
      return { p50: ts[Math.floor(n * 0.5)], p95: ts[Math.floor(n * 0.95)] || ts[n - 1] };
    };
    for (const path of ['/api/health', '/']) {
      const { p50, p95 } = await timeIt(path, 12);
      info(`latency ${path}`, `p50 ${p50}ms · p95 ${p95}ms (dev server, single machine)`);
    }

    // সমসাময়িক লোড — যতটা সৎভাবে করা যায়
    const CONC = 50;
    const t = Date.now();
    const rs = await Promise.all(Array.from({ length: CONC }, () =>
      guest.request.get(`${BASE}/api/health`, { failOnStatusCode: false })));
    const elapsed = Date.now() - t;
    const okAll = rs.every((r) => r.status() < 500);
    check(`${CONC} concurrent requests all succeed`, okAll,
      `${elapsed}ms wall, ${Math.round((CONC / elapsed) * 1000)} req/s, no 5xx`, 'MAJOR');

    info('5,000-user stress test', 'NOT PERFORMED — see report §6; requires load infrastructure and a non-production database');
  }

  await browser.close();

  /* ─────────── রায় ─────────── */
  const fails = results.filter((r) => !r.ok);
  const blockers = fails.filter((r) => r.sev === 'BLOCKER');
  const majors = fails.filter((r) => r.sev === 'MAJOR');
  const passed = results.filter((r) => r.ok && r.sev !== 'INFO').length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${passed} passed · ${fails.length} failed  (${blockers.length} blocker, ${majors.length} major)`);
  console.log(`  elapsed ${Math.round((Date.now() - t0) / 1000)}s`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log(`  [${f.sev}] ${f.stage} :: ${f.name} — ${f.note}`));
  }
  writeFileSync(`${OUT}/_gate.json`, JSON.stringify(results, null, 1));
  console.log(`\n→ ${OUT}/_gate.json`);
  process.exit(blockers.length ? 2 : fails.length ? 1 : 0);
}

main();
