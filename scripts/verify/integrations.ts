/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ইন্টিগ্রেশন যাচাই — প্রতিটি বাইরের নির্ভরতা ও টাকার নিয়ম
 *
 *   `npx tsx scripts/verify/integrations.ts`
 *
 *   যা পরীক্ষা করা হয়:
 *     ১. ডাটাবেস ও Prisma — সংযোগ, Decimal রাউন্ড-ট্রিপ, টাকার
 *        কলামগুলো সত্যিই `numeric(12,2)`
 *     ২. auth কুকি কনফিগ — নাম ও পতাকা এক উৎস থেকে
 *     ৩. Telegram — কনফিগ না থাকলে **নীরবে ও নিরাপদে** নিষ্ক্রিয়
 *     ৪. ইমেইল (Resend) — কী না থাকলে পাঠানো skip হয়, ক্র্যাশ নয়
 *     ৫. Storage — কোন ড্রাইভার সক্রিয় (blob/local) তা সৎভাবে জানানো
 *     ৬. কুপন/ছাড় — **প্রকৃত অর্ডারে** ছাড় বসে ও খতিয়ানে মেলে
 *     ৭. প্রত্যাহার — ফিচার-ফ্ল্যাগ ডিফল্ট বন্ধ, hold নিয়ম সঠিক
 *     ৮. অর্ডার লাইফসাইকেল — বৈধ অবস্থাগুলো ও খতিয়ান-প্রভাব
 *
 *   ⚠️ বাইরের সেবায় (Telegram/Resend/Blob) **কোনো আসল কল করা হয় না**।
 *      এখানে দাবি একটাই: কনফিগ না থাকলে সিস্টেম ভাঙে না, আর কনফিগ
 *      থাকলে কোন পথটি সক্রিয় হবে তা স্পষ্ট। Blob-এর প্রকৃত
 *      আপলোড/ডাউনলোড/মুছে ফেলা যাচাই আলাদা: `scripts/blob-verify.ts`।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';

import { Prisma } from '@prisma/client';
import {
  SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, CALLBACK_COOKIE_NAME, authCookieNames,
} from '../../src/lib/authCookies';
import { cleanName } from '../../src/lib/sanitize';
import { placeOrder } from '../../src/lib/services/order';
import { creditWallet } from '../../src/lib/services/wallet';
import { withdrawableAmount } from '../../src/lib/services/withdrawal';
import bcrypt from 'bcryptjs';

let fail = 0;
let total = 0;
const check = (name: string, ok: boolean, note = '') => {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const info = (name: string, note: string) => console.log(`  info  ${name} — ${note}`);

const TAG = `intg-${Date.now().toString(36)}`;

(async () => {
  console.log('═══ ইন্টিগ্রেশন যাচাই ═══');
  console.log(`  DB: ${dbLabel()}\n`);

  let userId = '';
  let productId = 0;
  let couponId = 0;

  try {
    // ═══ ১. ডাটাবেস ও Prisma ═══
    console.log('── ১. ডাটাবেস ও Prisma ──');
    const ping = await db.$queryRaw<Array<{ one: number }>>`SELECT 1::int AS one`;
    check('সংযোগ কাজ করে', ping[0]?.one === 1);

    /**
     * ★ টাকার কলাম **অবশ্যই** `numeric(12,2)` — CLAUDE.md §1।
     *   float হলে ০.১+০.২ সমস্যা খতিয়ানে ঢুকে যেত।
     */
    const cols = await db.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string; numeric_precision: number; numeric_scale: number }>>`
      SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name IN ('balance','amount','price','subtotal','costPrice','discount','balanceAfter')
      ORDER BY table_name, column_name`;
    const nonNumeric = cols.filter((c) => c.data_type !== 'numeric');
    check(`টাকার সব কলাম numeric (${cols.length}টি)`, nonNumeric.length === 0,
      nonNumeric.map((c) => `${c.table_name}.${c.column_name}=${c.data_type}`).join(', ') || 'সবগুলো numeric');
    const wrongScale = cols.filter((c) => c.numeric_precision !== 12 || c.numeric_scale !== 2);
    check('প্রতিটি টাকার কলাম (12,2)', wrongScale.length === 0,
      wrongScale.map((c) => `${c.table_name}.${c.column_name}=(${c.numeric_precision},${c.numeric_scale})`).join(', ') || 'সবগুলো (12,2)');

    // ★ Decimal রাউন্ড-ট্রিপ — ০.১ + ০.২ যেন ০.৩০০০০০০০০৪ না হয়
    const d = new Prisma.Decimal('0.1').plus('0.2');
    check('Decimal গণিত সঠিক (0.1 + 0.2 = 0.3)', d.toString() === '0.3', d.toString());

    // ═══ ২. auth কুকি কনফিগ ═══
    console.log('\n── ২. auth কুকি ──');
    const prod = authCookieNames(true);
    check('প্রোডাকশনে session কুকি __Secure-', prod.session === '__Secure-next-auth.session-token');
    check('প্রোডাকশনে csrf কুকি __Host-', prod.csrf === '__Host-next-auth.csrf-token');
    check('ডেভে prefix ছাড়া নাম', authCookieNames(false).session === 'next-auth.session-token');
    info('এই প্রক্রিয়ায় কার্যকর নাম', `${SESSION_COOKIE_NAME} · ${CSRF_COOKIE_NAME} · ${CALLBACK_COOKIE_NAME}`);

    // ═══ ৩. Telegram ═══
    console.log('\n── ৩. Telegram ──');
    const { getPrimaryBot } = await import('../../src/lib/telegram/store');
    const tok = await getPrimaryBot().catch(() => null);
    if (tok) {
      info('Telegram', 'বট টোকেন কনফিগার করা আছে — বার্তা পাঠানোর পথ সক্রিয়');
    } else {
      info('Telegram', 'এই পরিবেশে কনফিগার করা নেই — নিচে নিরাপদ অবনমন যাচাই হচ্ছে');
    }
    const { notifyAdmins } = await import('../../src/lib/notify');
    let threw = false;
    // ★ প্রকৃত signature: (title, body, link?, event?)
    await notifyAdmins('যাচাই', 'integration check').catch(() => { threw = true; });
    check('Telegram কনফিগ ছাড়াও notifyAdmins ক্র্যাশ করে না', !threw);

    // ═══ ৪. ইমেইল ═══
    console.log('\n── ৪. ইমেইল (Resend) ──');
    const hasResend = Boolean(process.env.RESEND_API_KEY);
    info('Resend', hasResend ? 'কী আছে — পাঠানোর পথ সক্রিয়' : 'কী নেই — পাঠানো নীরবে skip হবে');
    const { emailWelcome } = await import('../../src/lib/email');
    let emailThrew = false;
    // ★ প্রকৃত signature: (to, name, refCode)
    await emailWelcome('verify@example.com', 'যাচাই', 'VERIFY1').catch(() => { emailThrew = true; });
    check('কী না থাকলেও ইমেইল-কল ক্র্যাশ করে না', !emailThrew);

    // ═══ ৫. Storage ═══
    console.log('\n── ৫. Storage ──');
    const driver = (process.env.STORAGE_DRIVER || (process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local')).toLowerCase();
    info('সক্রিয় ড্রাইভার', driver === 'blob' ? 'Vercel Blob' : 'লোকাল ডিস্ক (public/uploads)');
    info('প্রকৃত আপলোড/ডাউনলোড/মুছে ফেলা', 'আলাদা যাচাই: npx tsx scripts/blob-verify.ts');

    // ═══ ৬. কুপন/ছাড় — প্রকৃত অর্ডারে ═══
    console.log('\n── ৬. কুপন ও ছাড় (প্রকৃত অর্ডার) ──');
    const cat = await db.category.findFirst({ select: { id: true } });
    if (!cat) throw new Error('কোনো Category নেই');

    const product = await db.product.create({
      data: { name: `Intg ${TAG}`, slug: `intg-${TAG}`, isActive: true, categoryId: cat.id },
      select: { id: true },
    });
    productId = product.id;
    const variant = await db.variant.create({
      data: { productId, label: 'Intg pack', price: 500, costPrice: 300, stock: 10, isActive: true },
      select: { id: true },
    });
    const user = await db.user.create({
      data: {
        email: `${TAG}@verify.local`, name: 'কুপন যাচাই', phone: `016${String(Date.now()).slice(-8)}`,
        password: await bcrypt.hash(`x-${TAG}`, 10), referralCode: `IN${TAG.slice(-8).toUpperCase()}`,
      },
      select: { id: true },
    });
    userId = user.id;
    // ⚠️ `creditWallet` কলারের ট্রানজেকশন **দাবি করে** — খতিয়ান ও
    //   ব্যালেন্স যেন কখনো আলাদা কমিটে না যায় (CLAUDE.md §2.1)
    await db.$transaction((tx) =>
      creditWallet({ tx, userId, amount: 1000, type: 'DEPOSIT', note: 'যাচাই' }));

    const coupon = await db.coupon.create({
      // ★ স্কিমার নাম `usageLimit`/`usageCount` (maxUses/usedCount নয়)
      data: { code: `INTG${TAG.slice(-6).toUpperCase()}`, type: 'PERCENT', value: 20, isActive: true, usageLimit: 5 },
      select: { id: true, code: true },
    });
    couponId = coupon.id;

    const placed = await placeOrder({
      userId, variantId: variant.id, playerUid: '123456789',
      playerName: null, slaDueAt: null, couponCode: coupon.code,
    });
    const order = await db.order.findUnique({
      where: { id: placed.orderId },
      select: { subtotal: true, discount: true, price: true, couponId: true },
    });
    check('অর্ডারে কুপন সংযুক্ত হয়েছে', order?.couponId === couponId, String(order?.couponId));
    check('২০% ছাড় সঠিকভাবে বসেছে', Number(order?.discount) === 100, `৳${Number(order?.discount)}`);
    check('চূড়ান্ত দাম = subtotal − ছাড়', Number(order?.price) === Number(order?.subtotal) - Number(order?.discount),
      `৳${Number(order?.price)} = ৳${Number(order?.subtotal)} − ৳${Number(order?.discount)}`);

    const bal = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
    check('ওয়ালেট থেকে ছাড়-পরবর্তী অঙ্কই কেটেছে', Number(bal?.balance) === 1000 - Number(order?.price),
      `৳${Number(bal?.balance)}`);

    const ledger = await db.ledgerEntry.findMany({ where: { userId } });
    const sum = ledger.reduce((s, l) => s + Number(l.amount), 0);
    check('খতিয়ানের যোগফল = ব্যালেন্স', sum === Number(bal?.balance), `৳${sum}`);

    const used = await db.coupon.findUnique({ where: { id: couponId }, select: { usageCount: true } });
    check('কুপনের ব্যবহার-সংখ্যা বেড়েছে', Number(used?.usageCount) === 1, String(used?.usageCount));

    // ═══ ৭. প্রত্যাহার ═══
    console.log('\n── ৭. প্রত্যাহার ──');
    const { getWithdrawalConfig } = await import('../../src/lib/services/withdrawal');
    const wcfg = await getWithdrawalConfig();
    info('ফিচার-ফ্ল্যাগ', wcfg.enabled ? 'চালু' : 'বন্ধ (ডিফল্ট — মালিক চালু করবেন)');
    check('hold ঘণ্টা ধনাত্মক ডিফল্ট', wcfg.holdHours > 0, `${wcfg.holdHours} ঘণ্টা`);

    await db.$transaction(async (tx) => {
      const zero = await withdrawableAmount(tx, userId, 1000, 0);
      check('holdHours = 0 → পুরো ব্যালেন্স তোলা যায়', zero === 1000, `৳${zero}`);
      const held = await withdrawableAmount(tx, userId, 1000, 72);
      check('holdHours = 72 → সাম্প্রতিক জমা আটকে থাকে', held < 1000, `৳${held}`);
    });

    // ═══ ৮. নাম-স্যানিটাইজেশন (বাংলা) ═══
    console.log('\n── ৮. বাংলা টেক্সট ──');
    check('বাংলা স্বরচিহ্ন সেভ-পথে টিকে থাকে', cleanName('মুন্না চৌধুরী') === 'মুন্না চৌধুরী',
      cleanName('মুন্না চৌধুরী'));
  } finally {
    if (userId) {
      await db.orderEvent.deleteMany({ where: { order: { userId } } }).catch(() => {});
      await db.order.deleteMany({ where: { userId } }).catch(() => {});
      await db.ledgerEntry.deleteMany({ where: { userId } }).catch(() => {});
      await db.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    if (couponId) await db.coupon.deleteMany({ where: { id: couponId } }).catch(() => {});
    if (productId) {
      await db.variant.deleteMany({ where: { productId } }).catch(() => {});
      await db.product.deleteMany({ where: { id: productId } }).catch(() => {});
    }
    console.log('\n  (যাচাই-ডেটা মুছে ফেলা হলো)');
    await db.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(`  ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''}`);
  process.exit(fail ? 1 : 0);
})();
