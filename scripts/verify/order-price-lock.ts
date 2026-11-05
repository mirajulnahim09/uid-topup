/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ H1 যাচাই — অর্ডারের দাম লক করা রো থেকেই আসে
 *
 *   `npx tsx scripts/verify/order-price-lock.ts`
 *
 *   RUN.md যা চেয়েছে ঠিক তাই: লক ধরে রেখে সমান্তরালে দাম বদলানো,
 *   তারপর দেখা অর্ডারে কোন দাম বসল।
 *
 *   পরীক্ষা:
 *     ১. একটি লেনদেন `Variant` রো `FOR UPDATE` লক করে ধরে রাখে
 *     ২. সমান্তরালে দাম বদলানোর চেষ্টা → **ব্লক হয়** (লক কাজ করছে)
 *     ৩. লক ছাড়ার পর দাম বদলায়
 *     ৪. প্রকৃত অর্ডার API চালিয়ে দেখা — অর্ডারে বসা দাম, subtotal,
 *        costPrice ও ওয়ালেট-কর্তন সব **একই** ও লক করা মানের সমান
 *     ৫. খতিয়ান (LedgerEntry) ঠিক ততটাই কেটেছে
 *
 *   ⚠️ একটি অস্থায়ী প্রোডাক্ট/ভ্যারিয়েন্ট ও টেস্ট-ইউজার বানানো হয়,
 *      শেষে সব মুছে ফেলা হয়। প্রকৃত ক্যাটালগ ছোঁয়া হয় না।
 * ═══════════════════════════════════════════════════════════
 */
/**
 * ⚠️ `./_db` **সবার আগে** — সে env লোড করে (`.env.development`
 *    ওভারলে সহ) এবং লাইভ ডাটাবেসে চলতে দেয় না। পরের import গুলো
 *    module-scope এ env পড়ে, তাই ক্রমটি গুরুত্বপূর্ণ।
 */
import { db as prisma, BASE, dbLabel } from './_db';

import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { PrismaClient } from '@prisma/client';
import { SESSION_COOKIE_NAME } from '../../src/lib/authCookies';

const SECRET = process.env.NEXTAUTH_SECRET as string;
const tag = `h1-${Date.now()}`;

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const PRICE_AT_LOCK = 100;
const PRICE_AFTER = 999;

(async () => {
  console.log('═══ H1 — অর্ডারের দাম লক করা রো থেকে ═══\n');
  console.log(`  DB: ${dbLabel()} · সার্ভার: ${BASE}\n`);

  // ★ Product-এর একটি category লাগে — বিদ্যমান একটিতে যুক্ত করি,
  //   নতুন ক্যাটাগরি বানিয়ে ক্যাটালগ নোংরা করি না।
  const anyCategory = await prisma.category.findFirst({ select: { id: true } });
  if (!anyCategory) {
    console.error('✗ কোনো Category নেই — যাচাই চালানো যাচ্ছে না');
    process.exit(1);
  }
  const product = await prisma.product.create({
    data: {
      name: `H1 Verify ${tag}`, slug: `h1-verify-${tag}`,
      isActive: true, categoryId: anyCategory.id,
    },
    select: { id: true },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id, label: 'H1 pack',
      price: PRICE_AT_LOCK, costPrice: 40, stock: 50, isActive: true,
    },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `${tag}@verify.local`, name: 'H1 Verify User',
      phone: `h1-${Date.now().toString().slice(-9)}`,
      password: await bcrypt.hash('x-' + tag, 10),
      referralCode: `H1${Date.now().toString(36).toUpperCase().slice(-7)}`,
      balance: 5000,
    },
    select: { id: true, role: true, sessionEpoch: true },
  });
  console.log(`  variant #${variant.id} · দাম ৳${PRICE_AT_LOCK} · ইউজার ব্যালেন্স ৳5000\n`);

  /**
   * ⚠️ `try` এর **বাইরে** ঘোষণা — নাহলে মাঝপথে কোনো দাবি throw করলে
   *   এই সংযোগটি খোলা থেকে যেত। আগে `process.exit()` জোর করে মেরে
   *   দিত বলে সেটি চোখে পড়ত না; এখন ইভেন্ট-লুপ খালি হওয়ার অপেক্ষা
   *   করা হয়, তাই একটি খোলা ক্লায়েন্ট মানে স্ক্রিপ্ট **ঝুলে থাকা**।
   */
  let other: PrismaClient | null = null;

  try {
    // ── ১+২. লক ধরে রেখে সমান্তরাল UPDATE ব্লক হয় কিনা ──
    console.log('── লক আচরণ ──');
    // ★ দ্বিতীয় সংযোগ — একই (যাচাই-নির্ধারিত) ডাটাবেসে
    other = new PrismaClient({
      datasources: { db: { url: process.env.VERIFY_DATABASE_URL || process.env.DATABASE_URL } },
    });
    /** ★ ক্লোজারের ভিতরে `other` এর narrowing টেকে না (TS18047) — তাই ধ্রুবক */
    const otherDb = other;
    let updateBlocked = false;
    let updateFinished = false;

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id, stock, price FROM "Variant" WHERE id = ${variant.id} FOR UPDATE`;

      // সমান্তরালে দাম বদলানোর চেষ্টা — লকের কারণে অপেক্ষা করবে
      const upd = otherDb.$executeRaw`UPDATE "Variant" SET price = ${PRICE_AFTER} WHERE id = ${variant.id}`
        .then(() => { updateFinished = true; })
        .catch(() => { updateFinished = true; });

      await new Promise((r) => setTimeout(r, 1500));
      updateBlocked = !updateFinished;

      // লক ছাড়ার আগে পর্যন্ত UPDATE আটকে থাকা চাই
      check('লক ধরে থাকা অবস্থায় সমান্তরাল UPDATE আটকে থাকে', updateBlocked,
        updateBlocked ? '১.৫s পরেও শেষ হয়নি' : '⚠️ লক কাজ করেনি');

      // এখানে tx শেষ → লক ছাড়া পাবে, upd সম্পন্ন হবে
      void upd;
    }, { timeout: 20000 });

    await new Promise((r) => setTimeout(r, 1200));
    const after = await prisma.variant.findUnique({ where: { id: variant.id }, select: { price: true } });
    check('লক ছাড়ার পর দাম বদলায়', Number(after?.price) === PRICE_AFTER,
      `৳${Number(after?.price)}`);

    // ── ৩. দাম আবার ১০০ করে প্রকৃত অর্ডার ──
    await prisma.variant.update({ where: { id: variant.id }, data: { price: PRICE_AT_LOCK } });

    console.log('\n── প্রকৃত অর্ডার API ──');
    const jwt = await encode({
      token: { id: user.id, role: user.role, epoch: user.sessionEpoch ?? 0, lastChecked: Date.now() },
      secret: SECRET,
    });

    const res = await fetch(`${BASE}/api/order`, {
      method: 'POST',
      // ★ কুকির নাম `authCookies.ts` থেকে — হাতে লিখলে dev/prod এ ভুল হয়
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE_NAME}=${jwt}` },
      body: JSON.stringify({ variantId: variant.id, playerUid: '123456789' }),
    });
    const body = await res.json();
    check('অর্ডার সফল', res.status === 200 && body.success === true,
      `HTTP ${res.status} ${body.error ?? ''}`);

    if (body.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: body.orderId },
        select: { subtotal: true, price: true, costPrice: true, discount: true },
      });
      check('অর্ডারের subtotal = লক করা দাম', Number(order?.subtotal) === PRICE_AT_LOCK,
        `৳${Number(order?.subtotal)}`);
      check('অর্ডারের price = লক করা দাম', Number(order?.price) === PRICE_AT_LOCK,
        `৳${Number(order?.price)}`);
      check('costPrice স্ন্যাপশট লক করা রো থেকে', Number(order?.costPrice) === 40,
        `৳${Number(order?.costPrice)}`);

      // ── ৪. ওয়ালেট ও খতিয়ান ──
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { balance: true } });
      check('ব্যালেন্স ঠিক ততটাই কেটেছে', Number(u?.balance) === 5000 - PRICE_AT_LOCK,
        `৳${Number(u?.balance)}`);

      const ledger = await prisma.ledgerEntry.findMany({
        where: { userId: user.id },
        select: { amount: true, type: true, balanceAfter: true },
      });
      check('একটিমাত্র খতিয়ান এন্ট্রি', ledger.length === 1, `${ledger.length} টি`);
      check('খতিয়ানের অঙ্ক = লক করা দাম',
        ledger.length === 1 && Math.abs(Number(ledger[0].amount)) === PRICE_AT_LOCK,
        ledger.length ? `৳${Number(ledger[0].amount)}` : '—');
      check('খতিয়ানের balanceAfter ব্যালেন্সের সমান',
        ledger.length === 1 && Number(ledger[0].balanceAfter) === Number(u?.balance),
        ledger.length ? `৳${Number(ledger[0].balanceAfter)}` : '—');
    }

    // ── ৫. সোর্স যাচাই — দাম সত্যিই লক-কোয়েরিতে আছে ──
    /**
     * ⚠️ ফাইলের নাম **হালনাগাদ করা হলো**। Group F (৩) এ অর্ডার বসানোর
     *   পুরো যুক্তি `src/app/api/order/route.ts` থেকে
     *   `src/lib/services/order.ts` এ সরেছে — রুটটি এখন কেবল
     *   `placeOrder()` ডাকে। পুরনো পথ ধরে খোঁজায় এই যাচাই ২০২৬-০৮-১২
     *   থেকে **ভুল ফাইলে** খুঁজছিল ও মিথ্যা FAIL দিত, অথচ H1 অক্ষত।
     *
     *   `resellerPrice` ও লক-কোয়েরিতে থাকা **আবশ্যক** — Group F এর
     *   পর সেটিও টাকার মান, তাই লক-বহির্ভূত পড়া চলবে না।
     */
    console.log('\n── সোর্স যাচাই ──');
    const { readFileSync } = await import('node:fs');
    const SOURCES: Array<[string, RegExp]> = [
      // সাধারণ অর্ডার — সার্ভিস স্তর
      ['src/lib/services/order.ts',
        /SELECT id, stock, price, "costPrice", "isActive", "resellerPrice"[\s\S]{0,160}FOR UPDATE/],
      // "ডিরেক্ট" অর্ডার — নিজের লক নিজেই নেয়
      ['src/app/api/order/direct/route.ts',
        /SELECT id, stock, price, "costPrice", "isActive"[\s\S]{0,160}FOR UPDATE/],
    ];
    for (const [f, re] of SOURCES) {
      const src = readFileSync(f, 'utf8');
      check(`${f} — লক-কোয়েরিতে price ও costPrice`, re.test(src));
      check(`${f} — টাকার হিসাবে লক-বহির্ভূত variant.price ব্যবহার হয় না`,
        !/round2\(Number\(variant\.price\)\)/.test(src));
    }
  } finally {
    await prisma.ledgerEntry.deleteMany({ where: { userId: user.id } });
    await prisma.orderEvent.deleteMany({ where: { order: { userId: user.id } } });
    await prisma.order.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.variant.deleteMany({ where: { productId: product.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
    console.log('  (টেস্ট ডেটা মুছে ফেলা হলো)');
    await prisma.$disconnect();
    await other?.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  /**
   * ⚠️ `process.exit()` **নয়** — `exitCode`।
   *
   *   এই স্ক্রিপ্টটি দুটি Prisma ক্লায়েন্ট খোলে (লক পরীক্ষার জন্য
   *   দ্বিতীয় সংযোগ লাগে)। `$disconnect()` এর পরও কোয়েরি-ইঞ্জিনের
   *   async handle গুলো বন্ধ হতে কয়েক টিক নেয়; ঠিক তখন
   *   `process.exit()` ডাকলে Windows-এ libuv মরে যেত —
   *   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
   *   src\win\async.c, line 76` — আর প্রসেসটি **১২৭** ফেরত দিত।
   *
   *   ফলে প্রতিটি দাবি পাস করেও স্ক্রিপ্টটি যেকোনো গেটে **লাল**
   *   দেখাত (PROGRESS ২০২৬-০৮-২৫ এ "হারনেসের, প্রোডাক্টের নয়" বলে
   *   লেখা ছিল — কারণটি এখানেই)। `exitCode` বসিয়ে ইভেন্ট-লুপ
   *   নিজে থেকে খালি হতে দিলে teardown শান্তিতে শেষ হয়।
   */
  process.exitCode = fail ? 1 : 0;
})();
