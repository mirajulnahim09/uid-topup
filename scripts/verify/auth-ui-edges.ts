/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অথ — ব্রাউজারে ভুল-পথগুলো (চূড়ান্ত অডিট, ২০২৬-০৯-১৭)
 *
 *   API-স্তরে এগুলো Vitest-এ প্রমাণিত (otp · registration-flow ·
 *   auth-boundary)। এখানে প্রশ্নটা ভিন্ন: **গ্রাহক পর্দায় কী দেখেন**,
 *   আর সেই বার্তা কি সত্য বলে?
 *
 *     ১. ভুল পাসওয়ার্ড ও অস্তিত্বহীন অ্যাকাউন্ট — একই বার্তা (ইমেইল ফাঁস নয়)
 *     ২. রেজিস্ট্রেশন: দুর্বল পাসওয়ার্ড · ভুল কোড · ডুপ্লিকেট ইমেইল
 *     ৩. পাসওয়ার্ড ভুলে গেছি → আছে/নেই দুই ইমেইলে একই উত্তর
 *     ৪. রিসেট-লিংক → নতুন পাসওয়ার্ড → পুরনোটি আর চলে না, নতুনটি চলে →
 *        একই লিংক দ্বিতীয়বার ব্যর্থ · ভুয়া টোকেন ব্যর্থ
 *     ৫. ব্রুট-ফোর্স — ১০টি ভুলের পর লকআউট-বার্তা, "পাসওয়ার্ড ভুল" নয়
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/auth-ui-edges.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import { makeResetToken } from '../../src/lib/passwordReset';
import { issueOtp } from '../../src/lib/otp/core';
import bcrypt from 'bcryptjs';
import type { Browser, Page } from 'playwright-core';

const TAG = `authui${Date.now().toString(36)}`;
const PASS = 'AuthEdge2026x';
let total = 0;
let fail = 0;
function check(name: string, ok: boolean, note = '') {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function fresh(browser: Browser, path: string): Promise<Page> {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page;
}
async function tryLogin(browser: Browser, email: string, password: string) {
  const page = await fresh(browser, '/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  const text = await page.locator('body').innerText();
  const session = await page.evaluate(`fetch('/api/auth/session').then(r=>r.json()).catch(()=>null)`) as { user?: { id?: string } } | null;
  const url = page.url();
  await page.context().close();
  return { text, loggedIn: Boolean(session?.user?.id), url };
}

async function main() {
  console.log(`═══ অথ — ব্রাউজারে ভুল-পথ · ${BASE} · DB ${dbLabel()} ═══`);
  const email = `${TAG}@verify.local`;
  const user = await db.user.create({
    data: {
      name: 'অথ-প্রান্ত', email, phone: `015${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(PASS, 10), emailVerified: true, referralCode: TAG.toUpperCase().slice(0, 12),
    },
  });
  const browser = await openBrowser({ headless: process.env.HEADLESS === '1' });
  const regEmail = `${TAG}-reg@verify.local`;

  try {
    /* ── ১ ── */
    console.log('\n── ১. ভুল পাসওয়ার্ড বনাম অস্তিত্বহীন অ্যাকাউন্ট ──');
    await db.rateLimitBucket.deleteMany({});
    const wrong = await tryLogin(browser, email, 'WrongPass2026x');
    const ghost = await tryLogin(browser, `ghost-${TAG}@verify.local`, 'WrongPass2026x');
    check('ভুল পাসওয়ার্ডে লগইন হয় না', !wrong.loggedIn);
    check('ভুল পাসওয়ার্ডে "ইমেইল বা পাসওয়ার্ড ভুল" দেখায়', wrong.text.includes('ইমেইল বা পাসওয়ার্ড ভুল'));
    check('অস্তিত্বহীন অ্যাকাউন্টেও হুবহু একই বার্তা (ইমেইল ফাঁস নয়)',
      ghost.text.includes('ইমেইল বা পাসওয়ার্ড ভুল') && !ghost.loggedIn);

    /* ── ২ ── */
    console.log('\n── ২. রেজিস্ট্রেশনের ভুল ──');
    await db.rateLimitBucket.deleteMany({});
    let page = await fresh(browser, '/register');
    await page.fill('#name', 'রেজিস্ট্রেশন প্রান্ত');
    await page.fill('#email', regEmail);
    await page.fill('#phone', `014${String(Date.now()).slice(-8)}`);
    await page.fill('#password', 'password');
    const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: regEmail, ip: '127.0.0.1' });
    await page.fill('#otp', code);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    let t = await page.locator('body').innerText();
    check('দুর্বল পাসওয়ার্ড — বার্তা দেখায়, অ্যাকাউন্ট হয় না',
      /পাসওয়ার্ড/.test(t) && !(await db.user.findUnique({ where: { email: regEmail } })));
    await page.fill('#password', PASS);
    await page.fill('#otp', code === '000000' ? '111111' : '000000');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    t = await page.locator('body').innerText();
    // ★ AUTH-02 — OTP-ব্যর্থতার সব কারণে একটিই বার্তা (enumeration রোধ)
    check('ভুল কোড — "কোডটি সঠিক নয়…", অ্যাকাউন্ট হয় না',
      t.includes('কোডটি সঠিক নয়') && !(await db.user.findUnique({ where: { email: regEmail } })));
    await page.context().close();

    page = await fresh(browser, '/register');
    await page.fill('#name', 'ডুপ্লিকেট');
    await page.fill('#email', email);
    await page.fill('#phone', `013${String(Date.now()).slice(-8)}`);
    await page.fill('#password', PASS);
    await page.fill('#otp', '123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    t = await page.locator('body').innerText();
    // ★ AUTH-02 — নিবন্ধিত ইমেইলের অস্তিত্ব আর ফাঁস হয় না: উত্তর ভুল-কোডের মতোই
    check('ডুপ্লিকেট ইমেইল — অস্তিত্ব ফাঁস নয় ("কোডটি সঠিক নয়…"), "অ্যাকাউন্ট আছে" নয়',
      t.includes('কোডটি সঠিক নয়') && !t.includes('এই ইমেইল দিয়ে অ্যাকাউন্ট আছে'));
    await page.context().close();

    /* ── ৩ ── */
    console.log('\n── ৩. পাসওয়ার্ড ভুলে গেছি ──');
    await db.rateLimitBucket.deleteMany({});
    const answers: string[] = [];
    for (const e of [email, `nobody-${TAG}@verify.local`]) {
      const p = await fresh(browser, '/forgot-password');
      await p.fill('#email', e);
      const [res] = await Promise.all([
        p.waitForResponse((r) => r.url().endsWith('/api/auth/forgot'), { timeout: 20_000 }),
        p.click('button[type="submit"]'),
      ]);
      answers.push(`${res.status()} ${JSON.stringify(await res.json().catch(() => ({})))}`);
      await p.context().close();
    }
    check('আছে/নেই — দুই ইমেইলে হুবহু একই উত্তর', answers[0] === answers[1], answers[0].slice(0, 60));

    /* ── ৪ ── */
    console.log('\n── ৪. রিসেট-লিংক ──');
    const bad = await fresh(browser, '/reset-password?token=forged.token123');
    await bad.fill('#pw', 'Forged2026xyz');
    await bad.fill('#pw2', 'Forged2026xyz');
    await bad.click('button[type="submit"]');
    await bad.waitForTimeout(2000);
    check('ভুয়া টোকেনে রিসেট হয় না — বার্তা দেখায়', (await bad.locator('body').innerText()).includes('লিংকটি অবৈধ'));
    await bad.context().close();

    const token = makeResetToken(user.id, user.password);
    const NEWPASS = 'ResetNew2026x';
    page = await fresh(browser, `/reset-password?token=${encodeURIComponent(token)}`);
    await page.fill('#pw', NEWPASS);
    await page.fill('#pw2', 'Mismatch2026x');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(800);
    check('দুই ঘর না মিললে থামে', (await page.locator('body').innerText()).includes('দুইবার একই পাসওয়ার্ড দিন'));
    await page.fill('#pw2', NEWPASS);
    const [rs] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/auth/reset'), { timeout: 20_000 }),
      page.click('button[type="submit"]'),
    ]);
    check('রিসেট সফল', rs.status() === 200, String(rs.status()));
    await page.context().close();
    await db.rateLimitBucket.deleteMany({});
    check('পুরনো পাসওয়ার্ড আর চলে না', !(await tryLogin(browser, email, PASS)).loggedIn);
    check('নতুন পাসওয়ার্ডে লগইন হয়', (await tryLogin(browser, email, NEWPASS)).loggedIn);
    page = await fresh(browser, `/reset-password?token=${encodeURIComponent(token)}`);
    await page.fill('#pw', 'Again2026xyz');
    await page.fill('#pw2', 'Again2026xyz');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    check('একই লিংক দ্বিতীয়বার চলে না', (await page.locator('body').innerText()).includes('লিংকটি অবৈধ'));
    await page.context().close();

    /* ── ৫ ── */
    console.log('\n── ৫. ব্রুট-ফোর্স লকআউট ──');
    await db.rateLimitBucket.deleteMany({});
    const api = await browser.newContext({ ignoreHTTPSErrors: true });
    for (let i = 0; i < 10; i++) {
      const { csrfToken } = await (await api.request.get(`${BASE}/api/auth/csrf`)).json();
      await api.request.post(`${BASE}/api/auth/callback/credentials`, {
        form: { csrfToken, email, password: `Wrong${i}2026x`, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
      });
    }
    await api.close();
    const locked = await tryLogin(browser, email, NEWPASS);
    check('১০টি ভুলের পর সঠিক পাসওয়ার্ডেও ঢোকা যায় না', !locked.loggedIn);
    check('বার্তা "সাময়িকভাবে বন্ধ", "পাসওয়ার্ড ভুল" নয়',
      locked.text.includes('সাময়িকভাবে বন্ধ') && !locked.text.includes('ইমেইল বা পাসওয়ার্ড ভুল'), locked.text.match(/নিরাপত্তার[^\n]{0,60}/)?.[0] ?? '');
  } finally {
    await db.rateLimitBucket.deleteMany({});
    await db.otp.deleteMany({ where: { destination: { in: [regEmail, email] } } }).catch(() => {});
    await db.notification.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await db.adminLog.deleteMany({ where: { adminId: user.id } }).catch(() => {});
    await db.user.deleteMany({ where: { email: { in: [email, regEmail] } } }).catch(() => {});
    await browser.close().catch(() => {});
    await db.$disconnect();
  }
  console.log(`\n════ ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''} ════`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
