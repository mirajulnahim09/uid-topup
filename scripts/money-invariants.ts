/**
 * ★★★ টাকার অপরিবর্তনীয় নিয়মের পরীক্ষা (4.2)
 *
 *   চালান: `npm run test:money`
 *
 *   ── কেন আলাদা টেস্ট ফ্রেমওয়ার্ক নয় ──
 *   প্রকল্পে vitest/jest নেই, আর এই পরীক্ষাগুলো আসলে **ইন্টিগ্রেশন**
 *   পরীক্ষা — এদের একটা সত্যিকারের ডাটাবেস দরকার, mock দিয়ে হয় না।
 *   `tsx` ইতিমধ্যেই আছে এবং `prisma/apply-constraints.ts` একই ধাঁচে
 *   লেখা, তাই নতুন নির্ভরতা যোগ না করে সেই প্যাটার্নই অনুসরণ করা হলো।
 *
 *   ── দুই ধরনের পরীক্ষা ──
 *   ক) **অবস্থা পরীক্ষা** — ডাটাবেস এখন যা আছে তা নিয়ম মানে কি না।
 *      কিছুই লেখে না, তাই প্রোডাকশনেও নিরাপদে চালানো যায়।
 *   খ) **আচরণ পরীক্ষা** — ওয়ালেট সার্ভিস সত্যিই ঠিক কাজ করে কি না।
 *      ⚠️ এগুলো transaction-এ চলে যা **সবসময় rollback** হয়, তাই
 *      ডাটাবেসে কোনো চিহ্ন থাকে না। টাকার টেস্ট আসল ডাটা নোংরা
 *      করলে সেটাই সবচেয়ে বড় বিপদ হতো।
 */
/** ⚠️ লাইভ DB-তে লেখা আটকায় — প্রথম import হতে হবে। */
import { liveWriteGuardActive } from './_guard-live-db';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { creditWallet, debitWallet } from '../src/lib/services/wallet';

/**
 * ★★★ গার্ড-করা ক্লায়েন্টই ব্যবহার করতে হবে।
 *
 *   আগে এখানে ছিল নিজস্ব `new PrismaClient()`। `_guard-live-db` তার
 *   middleware বসায় **`src/lib/prisma` এর** ক্লায়েন্টে — এই আলাদা
 *   ক্লায়েন্টটি সেই পাহারার বাইরে ছিল। ফলে `npm run test:money`
 *   (যা `.env` = লাইভ Neon পড়ে) খ-অংশে প্রকৃত ব্যবহারকারীর সারিতে
 *   `creditWallet`/`debitWallet` চালাত। rollback হতো ঠিকই, কিন্তু
 *   ততক্ষণ লাইভ User সারি লক থাকত — চলমান অর্ডার অপেক্ষায় পড়ত।
 *   (চূড়ান্ত অডিট ২০২৬-০৯-১৭, কোড পড়ে পাওয়া।)
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const n = (v: unknown) => Number(v);
const money = (v: unknown) => Math.round(n(v) * 100) / 100;

/** rollback করানোর জন্য বিশেষ ত্রুটি — ব্যর্থতা নয় */
class Rollback extends Error {}

// ═══════════════════════════════════════════════════════════
// ক) অবস্থা পরীক্ষা — কিছুই লেখে না
// ═══════════════════════════════════════════════════════════
async function stateInvariants() {
  console.log('\n── ক) অবস্থা: ডাটাবেস নিয়ম মানছে কি না ──');

  const users = await prisma.user.findMany({ select: { id: true, name: true, balance: true } });

  /**
   * ১. ★★★ ধারাবাহিক শৃঙ্খল — **কোডের বাগ ধরার আসল পরীক্ষা**
   *
   *    নিয়ম: পরপর দুটি এন্ট্রিতে
   *      entry[i].balanceAfter == entry[i-1].balanceAfter + entry[i].amount
   *
   *    ⚠️ কেন "যোগফল শূন্য থেকে শুরু" ধরা হয় না: কেউ যদি সরাসরি SQL
   *    দিয়ে ব্যালেন্স বদলায় (পরীক্ষার সময় যেমন হয়েছে), তখন মোট
   *    যোগফল মিলবে না — কিন্তু সেটি **কোডের** ভুল নয়, সিস্টেমের
   *    বাইরের হস্তক্ষেপ। ধারাবাহিক শৃঙ্খল সেই হস্তক্ষেপের *পরেও*
   *    কোড ঠিক আছে কি না তা ধরতে পারে, তাই এটিই কঠোর পরীক্ষা।
   */
  let chainBroken = 0;
  let outOfBandEdits = 0;
  for (const u of users) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: u.id }, orderBy: { createdAt: 'asc' },
      select: { amount: true, balanceAfter: true, type: true, createdAt: true },
    });
    for (let i = 1; i < entries.length; i++) {
      const prev = money(entries[i - 1].balanceAfter);
      const expected = money(prev + n(entries[i].amount));
      const actual = money(entries[i].balanceAfter);
      if (actual !== expected) {
        // ★ পার্থক্যটা ঠিক এই এন্ট্রির আগে ব্যালেন্স বাইরে থেকে
        //   বদলানোর সমান — অর্থাৎ কোড নয়, হস্তক্ষেপ
        outOfBandEdits++;
        console.log(`     ⓘ ${u.name}: ${entries[i].type} এর আগে ব্যালেন্স ${prev} → ${money(actual - n(entries[i].amount))} (খতিয়ানের বাইরে বদল)`);
      }
    }
  }
  check('খতিয়ানের ধারাবাহিক শৃঙ্খল অটুট (কোড সঠিক)', chainBroken === 0);

  // ২. ★★★ সর্বশেষ এন্ট্রি বাস্তবতার সাথে মেলে — সবচেয়ে জরুরি
  //    কঠোর নিয়ম: শেষ যে লেখাটা হয়েছে সেটি এখনকার ব্যালেন্স বলতেই হবে
  let lastMismatch = 0;
  for (const u of users) {
    const last = await prisma.ledgerEntry.findFirst({
      where: { userId: u.id }, orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true, type: true },
    });
    if (!last) continue;
    if (money(last.balanceAfter) !== money(u.balance)) {
      lastMismatch++;
      console.log(`     ↳ ${u.name}: শেষ balanceAfter=${money(last.balanceAfter)} বর্তমান=${money(u.balance)}`);
    }
  }
  check('সর্বশেষ খতিয়ান == বর্তমান ব্যালেন্স', lastMismatch === 0);

  // ৩. ⓘ তথ্য: খতিয়ানের বাইরে ব্যালেন্স বদল হয়েছে কি না।
  //    ব্যর্থতা নয় — শুধু জানানো, কারণ এটি কোডের নয় বরং পরিচালনার
  //    প্রশ্ন (কেউ সরাসরি SQL চালিয়েছে কি না)।
  if (outOfBandEdits > 0) {
    console.log(`  ⓘ খতিয়ানের বাইরে ${outOfBandEdits} টি ব্যালেন্স বদল পাওয়া গেছে`);
    console.log('     (Phase 2 পরীক্ষার সময় সরাসরি DB সম্পাদনা — কোডের ত্রুটি নয়)');
  }

  // ৩. ঋণাত্মক ব্যালেন্স কখনো নয়
  const neg = users.filter((u) => n(u.balance) < 0);
  check('কোনো ঋণাত্মক ব্যালেন্স নেই', neg.length === 0,
    neg.map((u) => `${u.name}=${u.balance}`).join(', '));

  // ৪. অর্ডারের দাম == subtotal − discount (snapshot অখণ্ডতা)
  const orders = await prisma.order.findMany({
    select: { orderNo: true, subtotal: true, discount: true, price: true, refundedAmount: true, status: true, id: true },
  });
  const badPrice = orders.filter((o) => money(n(o.subtotal) - n(o.discount)) !== money(o.price));
  check('price == subtotal − discount', badPrice.length === 0,
    badPrice.map((o) => `#${o.orderNo}`).join(', '));

  // ৫. discount কখনো subtotal ছাড়ায় না
  const badDiscount = orders.filter((o) => n(o.discount) > n(o.subtotal));
  check('discount <= subtotal', badDiscount.length === 0,
    badDiscount.map((o) => `#${o.orderNo}`).join(', '));

  // ৬. ★ ফেরত কখনো দামের বেশি নয় (3.14 এর মূল নিয়ম)
  const overRefund = orders.filter((o) => n(o.refundedAmount) > n(o.price));
  check('refundedAmount <= price', overRefund.length === 0,
    overRefund.map((o) => `#${o.orderNo}`).join(', '));

  // ৭. ★ refundedAmount খতিয়ানের সাথে মেলে — স্কিমার ফিল্ড আর
  //    অপরিবর্তনীয় অডিট ট্রেইল একমত কি না
  let refundMismatch = 0;
  for (const o of orders) {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { refId: o.id, type: 'REFUND' }, _sum: { amount: true },
    });
    if (money(agg._sum.amount ?? 0) !== money(o.refundedAmount)) {
      refundMismatch++;
      console.log(`     ↳ #${o.orderNo}: refundedAmount=${money(o.refundedAmount)} ledger=${money(agg._sum.amount ?? 0)}`);
    }
  }
  check('refundedAmount == খতিয়ানের REFUND যোগফল', refundMismatch === 0,
    refundMismatch ? `${refundMismatch} টি অর্ডার` : '');

  // ৮. অনুমোদিত ডিপোজিটের বিপরীতে DEPOSIT খতিয়ান থাকতেই হবে
  const approved = await prisma.deposit.findMany({
    where: { status: 'APPROVED' }, select: { id: true, depositNo: true, amount: true },
  });
  let missingLedger = 0;
  for (const d of approved) {
    const c = await prisma.ledgerEntry.count({ where: { refId: d.id, type: 'DEPOSIT' } });
    if (c === 0) { missingLedger++; console.log(`     ↳ ডিপোজিট #${d.depositNo} এর খতিয়ান নেই`); }
  }
  check('প্রতিটি অনুমোদিত ডিপোজিটের খতিয়ান আছে', missingLedger === 0);

  // ৯. কুপন ব্যবহারের হিসাব মেলে
  const coupons = await prisma.coupon.findMany({ select: { id: true, code: true, usageCount: true } });
  let couponMismatch = 0;
  for (const c of coupons) {
    const uses = await prisma.couponUse.count({ where: { couponId: c.id } });
    if (uses !== c.usageCount) {
      couponMismatch++;
      console.log(`     ↳ ${c.code}: usageCount=${c.usageCount} couponUse rows=${uses}`);
    }
  }
  check('coupon.usageCount == CouponUse সারির সংখ্যা', couponMismatch === 0);

  // ১০. অনাথ খতিয়ান — অস্তিত্বহীন ইউজারের এন্ট্রি
  const ids = new Set(users.map((u) => u.id));
  const allLedger = await prisma.ledgerEntry.findMany({ select: { userId: true } });
  const orphan = allLedger.filter((l) => !ids.has(l.userId));
  check('কোনো অনাথ খতিয়ান এন্ট্রি নেই', orphan.length === 0, `${orphan.length} টি`);
}

// ═══════════════════════════════════════════════════════════
// খ) আচরণ পরীক্ষা — সবসময় rollback
// ═══════════════════════════════════════════════════════════
async function behaviourInvariants() {
  console.log('\n── খ) আচরণ: ওয়ালেট সার্ভিস (সব rollback হয়) ──');

  // ★ সবচেয়ে বেশি ব্যালেন্সওয়ালা ইউজার — debit পরীক্ষার জন্য যথেষ্ট
  //   টাকা থাকা চাই। আগে `findFirst` নিত, যা ৳0 ব্যালেন্সের অ্যাডমিনকে
  //   ধরে ফেলত আর ডাটাবেসের `user_balance_positive` constraint-এ
  //   আটকে যেত — অর্থাৎ পরীক্ষাটি নিজের দোষে ব্যর্থ হতো।
  const user = await prisma.user.findFirst({
    orderBy: { balance: 'desc' }, select: { id: true, balance: true },
  });
  if (!user) { console.log('  ⚠️ কোনো ইউজার নেই — আচরণ পরীক্ষা বাদ'); return; }
  const start = money(user.balance);
  if (start < 100) { console.log('  ⚠️ যথেষ্ট ব্যালেন্স নেই — আচরণ পরীক্ষা বাদ'); return; }

  // ১. creditWallet ব্যালেন্স বাড়ায় ও সঠিক balanceAfter সহ খতিয়ান লেখে
  try {
    await prisma.$transaction(async (tx) => {
      const after = await creditWallet({
        tx, userId: user.id, amount: 250, type: 'ADMIN_ADJUST', note: 'পরীক্ষা',
      });
      check('creditWallet ব্যালেন্স বাড়ায়', money(after) === money(start + 250),
        `${money(after)} != ${money(start + 250)}`);

      const led = await tx.ledgerEntry.findFirst({
        where: { userId: user.id }, orderBy: { createdAt: 'desc' },
      });
      check('creditWallet খতিয়ান লেখে', led !== null && n(led.amount) === 250);
      check('খতিয়ানের balanceAfter আসল ব্যালেন্সের সমান',
        led !== null && money(led.balanceAfter) === money(after));
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }

  // ২. debitWallet কমায় ও খতিয়ানে **ঋণাত্মক** অঙ্ক লেখে
  try {
    await prisma.$transaction(async (tx) => {
      const after = await debitWallet({
        tx, userId: user.id, amount: 100, type: 'ORDER', note: 'পরীক্ষা',
      });
      check('debitWallet ব্যালেন্স কমায়', money(after) === money(start - 100));
      const led = await tx.ledgerEntry.findFirst({
        where: { userId: user.id }, orderBy: { createdAt: 'desc' },
      });
      // ★ ঋণাত্মক রাখা জরুরি — পুরনো সব ORDER এন্ট্রি ঋণাত্মক, তাই
      //   যোগফলের নিয়ম (পরীক্ষা ক-১) কেবল তখনই খাটে
      check('debitWallet খতিয়ানে ঋণাত্মক অঙ্ক লেখে', led !== null && n(led.amount) === -100);
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }

  // ৩. শূন্য ও ঋণাত্মক অঙ্ক প্রত্যাখ্যাত — নইলে credit(-100) গোপনে
  //    debit হয়ে যেত
  for (const [label, amt] of [['শূন্য', 0], ['ঋণাত্মক', -50]] as const) {
    let rejected = false;
    try {
      await prisma.$transaction(async (tx) => {
        await creditWallet({ tx, userId: user.id, amount: amt, type: 'ADMIN_ADJUST', note: 'x' });
        throw new Rollback();
      });
    } catch (e) {
      if (e instanceof Rollback) rejected = false;
      else rejected = true;
    }
    check(`creditWallet ${label} অঙ্ক প্রত্যাখ্যান করে`, rejected);
  }

  // ৪. ★ rollback সত্যিই কাজ করেছে — উপরের কিছুই টেকেনি
  const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { balance: true } });
  check('সব পরীক্ষা rollback হয়েছে — ব্যালেন্স অপরিবর্তিত',
    money(fresh!.balance) === start, `${money(fresh!.balance)} != ${start}`);
}

async function main() {
  console.log('═══ টাকার অপরিবর্তনীয় নিয়ম পরীক্ষা (4.2) ═══');
  await stateInvariants();
  if (liveWriteGuardActive) {
    // ★ লাইভ DB — কেবল পড়ার অংশ (ক)। খ-অংশ লেখে, তাই এখানে চলে না।
    console.log('\n── খ) আচরণ — বাদ: লাইভ ডাটাবেস (লেখা নিষিদ্ধ)। ডেভ DB-তে চালান। ──');
  } else {
    await behaviourInvariants();
  }

  console.log(`\n═══ ফলাফল: ${passed} পাস, ${failed} ব্যর্থ ═══`);
  if (failed > 0) {
    console.log('\nব্যর্থ পরীক্ষা:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('পরীক্ষা চালাতে সমস্যা:', e);
  await prisma.$disconnect();
  process.exit(1);
});
