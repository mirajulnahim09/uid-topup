/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টিকিট ও প্রত্যাহার — ব্রাউজারে, শেষ থেকে শেষ
 *
 *   `npx tsx scripts/verify/support-flow-e2e.ts`
 *
 *   ⚠️ **কেন এটি দরকার, যখন টেস্ট আগেই আছে।**
 *      `tests/tickets.test.ts` (২৩টি দাবি) ও `tests/withdrawal.test.ts`
 *      (১৩টি) নিয়মগুলো ভালোভাবেই ঢাকে — কিন্তু সবই **API/সার্ভিস
 *      স্তরে**। HANDOFF §৪ স্পষ্ট করে লিখে রেখেছে: এই পাতাগুলো
 *      "ব্রাউজারে কখনো দেখা হয়নি"। অর্থাৎ ফর্মটি আদৌ জমা হয় কি না,
 *      বোতামটি আদৌ আছে কি না, উত্তর পর্দায় দেখা যায় কি না — তার
 *      কোনো প্রমাণ ছিল না। এই স্ক্রিপ্টটি ঠিক সেই ফাঁকটুকু ভরে:
 *      প্রতিটি ধাপ **UI দিয়ে** চালায়, আর প্রতিটি ধাপের পর
 *      **ডাটাবেসের অবস্থা** মিলিয়ে দেখে।
 *
 *     গ্রাহক টিকিট খোলেন → অ্যাডমিন উত্তর দেন → গ্রাহক প্রত্যুত্তর দেন
 *     → গ্রাহক বন্ধ করেন → টাকা তোলার অনুরোধ → অ্যাডমিন প্রত্যাখ্যান
 *     (টাকা ফেরে) → আবার অনুরোধ → অ্যাডমিন অনুমোদন
 *
 *   ⚠️ টাকা: ব্যালেন্স কেবল `wallet.ts` দিয়ে বসানো হয়, আর শেষে
 *      খতিয়ানের যোগফল ব্যালেন্সের সমান কি না তা মিলিয়ে দেখা হয়।
 *
 *   ⚠️ সেটিংস সাময়িকভাবে বদলায় (`withdrawal_enabled` ইত্যাদি) এবং
 *      শেষে **আগের মানেই ফেরানো হয়** — ব্যর্থ হলেও (finally)।
 *
 *   ⚠️ `./_db` প্রথম import — নাহলে Prisma লাইভ Neon ধরত।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel, BASE } from './_db';

import { type Browser, type BrowserContext, type Page } from 'playwright-core';
import { openBrowser } from './_browser';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { creditWallet } from '../../src/lib/services/wallet';
import { issueOtp } from '../../src/lib/otp/core';

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const TAG = `sflow-${Date.now().toString(36)}`;
const EMAIL = `${TAG}@verify.local`;
const PASSWORD = 'Customer@2026Secure'; // ★ সিড গ্রাহকের হ্যাশ ধার করা হয়
const START_BALANCE = 3000;
const WD_AMOUNT = 1000;
const SHOT_DIR = process.env.SHOT_DIR || 'audit/shots';

let fail = 0;
let total = 0;
const check = (name: string, ok: boolean, note = '') => {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const info = (name: string, note = '') => console.log(`  info  ${name}${note ? ` — ${note}` : ''}`);

const settle = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(
    `!document.querySelector('.v-ovl') && !document.getElementById('v-boot')`, null, { timeout: 30_000 },
  ).catch(() => {});
  await page.waitForTimeout(350);
};

/** ⚠️ ব্রুট-ফোর্স গার্ড যেন হারনেসকে না আটকায় (prod-auth-e2e এ ব্যাখ্যা) */
const clearRateLimits = () => db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});

/**
 * ★ লগইনের আগে গন্তব্য-রুট **গরম করা** (কেবল `next dev` এ অর্থবহ)।
 *
 *   ⚠️ মাপা: ঠাণ্ডা dev সার্ভারে `/login` কম্পাইল হতে **১১.৫s** লাগে
 *   (২০২৬-০৮-২৭, dev লগে), তার উপর গন্তব্য পাতাটির কম্পাইল। একটি
 *   রানে ঠিক এখানেই দাবিটি ব্যর্থ হয়েছিল আর দেখে মনে হয়েছিল
 *   "লগইন ভাঙা"। কারণটি **প্রমাণিত নয়** (ঐ রানের টাইমিং ধরা পড়েনি),
 *   কিন্তু গরম করে নিলে সন্দেহটুকুই থাকে না — আর তখন দাবিটি
 *   webpack নয়, প্রকৃত auth মাপে। প্রোডাকশন বিল্ডে কম্পাইল নেই,
 *   তাই সেখানে এটি কেবল একটি বাড়তি GET।
 */
async function warm(page: Page, paths: string[]) {
  for (const p of paths) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
}

async function login(page: Page, email: string, password: string, want: string) {
  await warm(page, ['/login', want]);
  await clearRateLimits();
  await page.goto(`${BASE}/login?callbackUrl=${encodeURIComponent(want)}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
  await settle(page);
  return new URL(page.url()).pathname;
}

/** ★ সেটিং পড়া/লেখা — শেষে হুবহু আগের অবস্থায় ফেরানোর জন্য */
async function readSettings(keys: string[]) {
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  return new Map(rows.map((r) => [r.key, r.value]));
}
async function writeSettings(pairs: Record<string, string>) {
  for (const [key, value] of Object.entries(pairs)) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

const WD_KEYS = ['withdrawal_enabled', 'withdrawal_min', 'withdrawal_hold_hours', 'withdrawal_daily_cap'];

(async () => {
  console.log('═══ টিকিট ও প্রত্যাহার — ব্রাউজারে ═══');
  console.log(`  সার্ভার: ${BASE} · DB: ${dbLabel()}\n`);

  const before = await readSettings(WD_KEYS);
  let browser: Browser | null = null;
  let cust: BrowserContext | null = null;
  let adm: BrowserContext | null = null;
  let userId = '';

  try {
    /**
     * ⚠️ `withdrawal_hold_hours = 0` — নাহলে সাম্প্রতিক ক্রেডিট ৭২ ঘণ্টা
     *   আটকে থাকে আর "তোলার যোগ্য" শূন্য হয়ে ফর্মই দেখা যায় না।
     *   নিয়মটি ইচ্ছাকৃত (HANDOFF: টাকা বেরোনোর পথে রক্ষণশীল হিসাব);
     *   এখানে কেবল **সেটিং** সরানো হচ্ছে, নিয়ম নয় — আর শেষে ফেরত।
     */
    await writeSettings({
      withdrawal_enabled: '1', withdrawal_min: '500',
      withdrawal_hold_hours: '0', withdrawal_daily_cap: '25000',
    });

    // ── গ্রাহক তৈরি + ব্যালেন্স (কেবল wallet.ts দিয়ে) ──
    const seed = await db.user.findUnique({
      where: { email: 'customer@uidtopup.local' }, select: { password: true },
    });
    if (!seed?.password) throw new Error('সিড গ্রাহক নেই — আগে `node scripts/dev-make-customer.mjs` চালান (dev:db:seed কেবল অ্যাডমিন বানায়, গ্রাহক নয়)');
    const user = await db.user.create({
      data: { name: 'সাপোর্ট যাচাই', email: EMAIL, phone: `019${String(Date.now()).slice(-8)}`,
        // ★ এই স্কিমায় `emailVerified` একটি বুলিয়ান, তারিখ নয়
        password: seed.password, emailVerified: true,
        // ★ `referralCode` বাধ্যতামূলক ও অনন্য — TAG থেকেই বানানো
        referralCode: TAG.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) },
      select: { id: true },
    });
    userId = user.id;
    await db.$transaction(async (tx) => {
      await creditWallet({ tx, userId, amount: START_BALANCE, type: 'DEPOSIT', note: `${TAG} শুরুর ব্যালেন্স` });
    });

    browser = await openBrowser();
    const opts = { ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } };
    cust = await browser.newContext(opts);
    adm = await browser.newContext(opts);
    const cp = await cust.newPage();
    const ap = await adm.newPage();
    mkdirSync(SHOT_DIR, { recursive: true });

    check('গ্রাহক লগইন', (await login(cp, EMAIL, PASSWORD, '/account')).startsWith('/account'));
    check('অ্যাডমিন লগইন', (await login(ap, ADMIN.email, ADMIN.password, '/admin')).startsWith('/admin'));

    // ═══ ১. টিকিট খোলা (UI) ═══
    console.log('\n── ১. টিকিট খোলা ──');
    await cp.goto(`${BASE}/account/tickets`, { waitUntil: 'domcontentloaded' });
    await settle(cp);
    await cp.screenshot({ path: `${SHOT_DIR}/support-tickets-empty.png`, fullPage: true });

    const newBtn = cp.locator('button', { hasText: '+ নতুন টিকিট' }).first();
    check('"নতুন টিকিট" বোতাম আছে', (await newBtn.count()) > 0);
    await newBtn.click();
    await cp.waitForTimeout(300);
    const subject = `${TAG} ডায়মন্ড পাইনি`;
    await cp.fill('#subject', subject);
    await cp.fill('#body', 'অর্ডার সম্পন্ন দেখাচ্ছে কিন্তু গেমে ডায়মন্ড আসেনি। একটু দেখবেন?');
    await cp.click('button[type="submit"]');
    await cp.waitForURL(/\/account\/tickets\/[a-z0-9]+/, { timeout: 20_000 }).catch(() => {});
    await settle(cp);

    const t1 = await db.ticket.findFirst({
      where: { userId, subject }, select: { id: true, status: true, _count: { select: { messages: true } } },
    });
    check('টিকিট সারি তৈরি হয়েছে', Boolean(t1), t1 ? `${t1.id.slice(0, 8)} · ${t1.status}` : 'তৈরি হয়নি');
    check('অবস্থা OPEN', t1?.status === 'OPEN', String(t1?.status));
    check('প্রথম বার্তাটি লেখা হয়েছে', t1?._count.messages === 1, `${t1?._count.messages} টি`);
    check('থ্রেড পাতায় পৌঁছেছে', new URL(cp.url()).pathname === `/account/tickets/${t1?.id}`,
      new URL(cp.url()).pathname);
    await cp.screenshot({ path: `${SHOT_DIR}/support-thread-customer.png`, fullPage: true });

    // ═══ ২. অ্যাডমিন সারিতে দেখা ও উত্তর (UI) ═══
    console.log('\n── ২. অ্যাডমিনের উত্তর ──');
    await ap.goto(`${BASE}/admin/tickets`, { waitUntil: 'domcontentloaded' });
    await settle(ap);
    await ap.screenshot({ path: `${SHOT_DIR}/support-admin-queue.png`, fullPage: true });
    check('অ্যাডমিন সারিতে টিকিটটি দেখা যাচ্ছে',
      (await ap.locator(`text=${subject}`).count()) > 0);

    await ap.goto(`${BASE}/admin/tickets?id=${t1!.id}`, { waitUntil: 'domcontentloaded' });
    await settle(ap);
    const REPLY = 'দেখেছি — ম্যানুয়ালি ডেলিভারি করে দিয়েছি, একবার গেম রিস্টার্ট দিন।';
    await ap.fill('#areply', REPLY);
    await ap.locator('button', { hasText: 'পাঠান' }).first().click();
    await ap.waitForTimeout(2000);
    await settle(ap);

    const t2 = await db.ticket.findUnique({
      where: { id: t1!.id },
      select: { status: true, messages: { select: { isStaff: true, body: true }, orderBy: { createdAt: 'asc' } } },
    });
    check('বার্তা দুটি হয়েছে', t2?.messages.length === 2, `${t2?.messages.length} টি`);
    check('অ্যাডমিনের বার্তাটি isStaff', t2?.messages.at(-1)?.isStaff === true);
    check('অবস্থা ANSWERED', t2?.status === 'ANSWERED', String(t2?.status));
    await ap.screenshot({ path: `${SHOT_DIR}/support-thread-admin.png`, fullPage: true });

    // ═══ ৩. গ্রাহক উত্তর দেখেন ও প্রত্যুত্তর দেন (UI) ═══
    console.log('\n── ৩. গ্রাহকের প্রত্যুত্তর ──');
    await cp.reload({ waitUntil: 'domcontentloaded' });
    await settle(cp);
    check('গ্রাহক পর্দায় অ্যাডমিনের উত্তর দেখতে পান',
      (await cp.locator(`text=${REPLY.slice(0, 24)}`).count()) > 0);
    await cp.fill('#reply', 'পেয়েছি, ধন্যবাদ।');
    await cp.locator('button', { hasText: 'পাঠান' }).first().click();
    await cp.waitForTimeout(2000);
    await settle(cp);

    const t3 = await db.ticket.findUnique({
      where: { id: t1!.id }, select: { status: true, _count: { select: { messages: true } } },
    });
    check('বার্তা তিনটি হয়েছে', t3?._count.messages === 3, `${t3?._count.messages} টি`);
    check('গ্রাহক লিখলে আবার OPEN', t3?.status === 'OPEN', String(t3?.status));

    // ═══ ৪. গ্রাহক টিকিট বন্ধ করেন (UI) ═══
    console.log('\n── ৪. টিকিট বন্ধ ──');
    await cp.locator('button', { hasText: 'সমাধান হয়েছে' }).first().click();
    await cp.waitForTimeout(300);
    await cp.locator('button', { hasText: 'নিশ্চিত — বন্ধ করুন' }).first().click();
    await cp.waitForTimeout(2000);
    await settle(cp);

    const t4 = await db.ticket.findUnique({
      where: { id: t1!.id },
      select: { status: true, closedAt: true, messages: { select: { authorId: true, body: true }, orderBy: { createdAt: 'asc' } } },
    });
    check('অবস্থা CLOSED', t4?.status === 'CLOSED', String(t4?.status));
    check('closedAt বসেছে', Boolean(t4?.closedAt));
    check('থ্রেডে সিস্টেম-বার্তা যোগ হয়েছে', (t4?.messages.length ?? 0) === 4,
      `${t4?.messages.length} টি বার্তা`);
    check('বন্ধ থ্রেডে উত্তরের ফর্ম আর নেই', (await cp.locator('#reply').count()) === 0);

    // ═══ ৫. টাকা তোলার অনুরোধ (UI) ═══
    console.log('\n── ৫. টাকা তোলার অনুরোধ ──');
    /**
     * ⚠️ এই স্ক্রিপ্ট সেটিং **সরাসরি DB-তে** লেখে, অ্যাডমিন API দিয়ে নয়।
     *   পণ্যের প্রতিটি অ্যাডমিন-রুট লেখার পরেই `invalidateSettings()`
     *   ডাকে, কিন্তু API বাইপাস করায় সার্ভার-প্রসেসের ক্যাশ অক্ষত থাকে —
     *   আর `settings.ts` এর TTL ৩০s। `next dev`-এ এটি ঢাকা পড়ত (প্রতি
     *   অনুরোধে মডিউল রিলোড হয়ে মডিউল-স্তরের ক্যাশ মুছে যেত); প্রোডাকশন
     *   রিগে প্রসেস দীর্ঘজীবী, তাই ফর্মটি ৩০s পর্যন্ত "বন্ধ" দেখাত।
     *   তাই TTL পার হওয়া পর্যন্ত **বাউন্ডেড** ভাবে অপেক্ষা — নীরব
     *   sleep নয়, প্রতিবার সত্যিই পাতাটি দেখে।
     */
    let formSeen = false;
    for (let i = 0; i < 9 && !formSeen; i++) {
      await cp.goto(`${BASE}/account/wallet/withdraw`, { waitUntil: 'domcontentloaded' });
      await settle(cp);
      formSeen = (await cp.locator('#amt').count()) > 0;
      if (!formSeen) await cp.waitForTimeout(5_000);
    }
    check('ফিচার চালু — ফর্ম দেখা যাচ্ছে', formSeen);
    await cp.screenshot({ path: `${SHOT_DIR}/support-withdraw-form.png`, fullPage: true });

    /**
     * ⚠️ "কোড পাঠান" বোতামটি সত্যিই চাপা হয় — কিন্তু ডেভে কোনো ইমেইল
     *   প্রোভাইডার কনফিগার করা নেই, তাই রুটটি ৫০২ দেয় ("কোড পাঠানো
     *   যায়নি")। সেটি **প্রোডাক্টের ত্রুটি নয়, পরিবেশের** — HANDOFF §১
     *   এর ইমেইল-ব্লকারটিই এখানে দেখা যাচ্ছে। তাই ফলটি তথ্য হিসেবে
     *   ছাপা হয়, দাবি হিসেবে নয়; আর যে কোডটি জমা দেওয়া হয় সেটি
     *   রুটের মতোই `issueOtp()` দিয়ে তৈরি।
     */
    await cp.locator('button', { hasText: 'কোড পাঠান' }).first().click();
    await cp.waitForTimeout(1500);
    const sendErr = await cp.locator('[role="alert"]').first().textContent().catch(() => null);
    info('"কোড পাঠান" চাপার ফল', sendErr?.trim() || 'কোনো ত্রুটি দেখায়নি');

    const askAndSubmit = async () => {
      const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'WITHDRAW', destination: EMAIL, ip: '127.0.0.1' });
      await cp.fill('#amt', String(WD_AMOUNT));
      await cp.fill('#acc', '01711111111');
      await cp.fill('#wcode', code);
      await cp.locator('button', { hasText: 'অনুরোধ পাঠান' }).first().click();
      await cp.waitForTimeout(2500);
      await settle(cp);
    };
    await askAndSubmit();

    const w1 = await db.withdrawal.findFirst({
      where: { userId }, orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, amount: true, riskLevel: true, riskNote: true },
    });
    const bal1 = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
    const led1 = await db.ledgerEntry.findMany({ where: { userId }, select: { type: true, amount: true } });
    check('অনুরোধ তৈরি হয়েছে', Boolean(w1), w1 ? `${w1.status} · ৳${Number(w1.amount)}` : 'হয়নি');
    /**
     * ⚠️ **PENDING নয়, `HELD`ও বৈধ — এবং এখানে সেটিই প্রত্যাশিত।**
     *   Group H এর ঝুঁকি-মূল্যায়ন প্রত্যাহারে পুনঃব্যবহৃত: একদম নতুন
     *   অ্যাকাউন্টের প্রথম উত্তোলন ELEVATED হিসেবে চিহ্নিত হয় আর
     *   অনুরোধটি স্বাভাবিক সারিতে না ঢুকে **আটকে** থাকে। প্রথমে এই
     *   দাবিটি `PENDING` ধরে লিখেছিলাম আর সেটিই FAIL দিয়েছিল —
     *   ত্রুটিটি হারনেসের, প্রোডাক্টের নয় (২০২৬-০৮-২৭)। টাকা যে দুই
     *   ক্ষেত্রেই কাটা হয়, সেটিই আসল দাবি — নিচে আলাদা করে মাপা।
     */
    check('অবস্থা PENDING বা HELD', w1?.status === 'PENDING' || w1?.status === 'HELD',
      `${w1?.status}${w1?.riskLevel ? ` · ঝুঁকি ${w1.riskLevel}` : ''}${w1?.riskNote ? ` (${w1.riskNote})` : ''}`);
    check('অনুরোধেই ব্যালেন্স কমেছে', bal1 === START_BALANCE - WD_AMOUNT, `৳${bal1}`);
    check('খতিয়ানে WITHDRAWAL এন্ট্রি', led1.some((l) => l.type === 'WITHDRAWAL' && Number(l.amount) === -WD_AMOUNT));

    // ═══ ৬. অ্যাডমিন প্রত্যাখ্যান — টাকা ফেরে (UI) ═══
    console.log('\n── ৬. প্রত্যাখ্যান ──');
    /** ⚠️ ফিল্টার ছাড়া — `?status=PENDING` দিলে **আটকানো** অনুরোধ বাদ পড়ে */
    await ap.goto(`${BASE}/admin/withdrawals`, { waitUntil: 'domcontentloaded' });
    await settle(ap);
    await ap.screenshot({ path: `${SHOT_DIR}/support-admin-withdrawals.png`, fullPage: true });
    check('সারিতে অনুরোধটি দেখা যাচ্ছে', (await ap.locator('text=সাপোর্ট যাচাই').count()) > 0);
    if (w1?.riskLevel === 'ELEVATED') {
      check('আটকানোর কারণ অ্যাডমিনের পর্দাতেই লেখা',
        (await ap.locator('text=ঝুঁকি').count()) > 0);
    }

    await ap.fill('input[placeholder="প্রত্যাখ্যানের কারণ"]', `${TAG} যাচাই — নম্বর মেলেনি`);
    await ap.locator('button', { hasText: 'প্রত্যাখ্যান' }).first().click();
    await ap.waitForTimeout(2500);
    await settle(ap);

    const w1b = await db.withdrawal.findUnique({ where: { id: w1!.id }, select: { status: true } });
    const bal2 = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
    const led2 = await db.ledgerEntry.findMany({ where: { userId }, select: { type: true, amount: true } });
    check('অবস্থা REJECTED', w1b?.status === 'REJECTED', String(w1b?.status));
    check('টাকা ফেরত এসেছে', bal2 === START_BALANCE, `৳${bal2}`);
    check('ফেরত **নতুন** সারিতে (WITHDRAWAL_REVERSAL)',
      led2.some((l) => l.type === 'WITHDRAWAL_REVERSAL' && Number(l.amount) === WD_AMOUNT));
    check('মূল WITHDRAWAL সারিটি অক্ষত',
      led2.filter((l) => l.type === 'WITHDRAWAL').length === 1);

    // ═══ ৭. আবার অনুরোধ, এবার অনুমোদন (UI) ═══
    console.log('\n── ৭. অনুমোদন ──');
    await cp.goto(`${BASE}/account/wallet/withdraw`, { waitUntil: 'domcontentloaded' });
    await settle(cp);
    await askAndSubmit();
    const w2 = await db.withdrawal.findFirst({
      where: { userId, status: { in: ['PENDING', 'HELD'] } },
      orderBy: { createdAt: 'desc' }, select: { id: true, status: true },
    });
    check('দ্বিতীয় অনুরোধ তৈরি হয়েছে', Boolean(w2), String(w2?.status));

    await ap.goto(`${BASE}/admin/withdrawals`, { waitUntil: 'domcontentloaded' });
    await settle(ap);
    const TRX = `${TAG.toUpperCase()}PAY`;
    await ap.fill('input[placeholder="পরিশোধের TrxID"]', TRX);
    await ap.locator('button', { hasText: 'অনুমোদন' }).first().click();
    await ap.waitForTimeout(2500);
    await settle(ap);

    const w2b = await db.withdrawal.findUnique({
      where: { id: w2!.id }, select: { status: true, payoutRef: true, processedByName: true },
    });
    const bal3 = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
    const led3 = await db.ledgerEntry.findMany({ where: { userId }, select: { type: true, amount: true } });
    check('অবস্থা APPROVED', w2b?.status === 'APPROVED', String(w2b?.status));
    check('TrxID সংরক্ষিত', w2b?.payoutRef === TRX, String(w2b?.payoutRef));
    check('কে করলেন তা লেখা আছে', Boolean(w2b?.processedByName), String(w2b?.processedByName));
    check('অনুমোদনে ব্যালেন্স আর নড়েনি (আগেই কাটা)',
      bal3 === START_BALANCE - WD_AMOUNT, `৳${bal3}`);
    check('অনুমোদনে নতুন কোনো খতিয়ান-সারি হয়নি', led3.length === 4, `${led3.length} টি সারি`);

    // ═══ ৮. খতিয়ান invariant ═══
    console.log('\n── ৮. খতিয়ান invariant ──');
    const sum = led3.reduce((n, l) => n + Number(l.amount), 0);
    check('SUM(খতিয়ান) === ব্যালেন্স', sum === bal3, `যোগফল ৳${sum} · ব্যালেন্স ৳${bal3}`);

    // ── গ্রাহকের পাতায় ইতিহাস দেখা যায় কি না ──
    await cp.goto(`${BASE}/account/wallet/withdraw`, { waitUntil: 'domcontentloaded' });
    await settle(cp);
    check('গ্রাহকের পাতায় আগের অনুরোধ দেখা যাচ্ছে',
      (await cp.locator('text=আগের অনুরোধ').count()) > 0);
    check('প্রত্যাখ্যাত ও পাঠানো — দুটোই তালিকায়',
      (await cp.locator('text=প্রত্যাখ্যাত').count()) > 0 && (await cp.locator('text=পাঠানো হয়েছে').count()) > 0);
    await cp.screenshot({ path: `${SHOT_DIR}/support-withdraw-history.png`, fullPage: true });
  } finally {
    // ── পরিষ্কার: সারি, তারপর সেটিংস (ব্যর্থ হলেও) ──
    if (userId) {
      await db.ticketMessage.deleteMany({ where: { ticket: { userId } } }).catch(() => {});
      await db.ticket.deleteMany({ where: { userId } }).catch(() => {});
      await db.withdrawal.deleteMany({ where: { userId } }).catch(() => {});
      await db.ledgerEntry.deleteMany({ where: { userId } }).catch(() => {});
      await db.notification.deleteMany({ where: { userId } }).catch(() => {});
      await db.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await db.otp.deleteMany({ where: { destination: EMAIL } }).catch(() => {});
    /** ★ সেটিংস হুবহু আগের অবস্থায় — আগে না থাকলে মুছে ফেলা হয় */
    for (const key of WD_KEYS) {
      const prev = before.get(key);
      if (prev === undefined) await db.setting.deleteMany({ where: { key } }).catch(() => {});
      else await db.setting.update({ where: { key }, data: { value: prev } }).catch(() => {});
    }
    console.log('\n  (যাচাই-ডেটা মুছে ফেলা হলো · সেটিংস ফেরানো হলো)');

    await cust?.close().catch(() => {});
    await adm?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await db.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail === 0 ? `  ${total}/${total} পাস` : `  ${total - fail}/${total} পাস · ${fail} ব্যর্থ`);
  process.exit(fail === 0 ? 0 : 1);
})();
