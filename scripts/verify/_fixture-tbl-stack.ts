/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ `.tbl--stack` যাচাইয়ের জন্য বাস্তবঘেঁষা ডেভ-ডেটা
 *
 *   `tbl-stack.ts` কেবল **মাপে**; সারি বানায় এই ফাইলটি।
 *
 *   ⚠️ কেন আলাদা ফিক্সচার দরকার হলো: `npm run dev:db:seed` ক্যাটালগ
 *      আর দুটি ইউজার বসায় — অর্ডার/ডিপোজিট/খতিয়ান/লগ **শূন্য**।
 *      শূন্য টেবিলে স্ট্যাকিং যাচাই করা মানে কিছুই যাচাই না করা:
 *      লম্বা TrxID, লম্বা নাম, ৪০ সারির খতিয়ান, ৩০০ সারির লগ —
 *      ঠিক এই জিনিসগুলোই বিন্যাস ভাঙে।
 *
 *   ⚠️⚠️ টাকা: ব্যালেন্স কেবল `creditWallet`/`debitWallet` দিয়ে নড়ে
 *      (CLAUDE.md §2.1)। এখানে `user.update({ balance })` লেখা হয়নি,
 *      যদিও এটি ডেভ ডাটাবেস — কারণ ফিক্সচার যদি খতিয়ান-অসংগত ডেটা
 *      বানায়, তবে সেই ডেটার উপর করা যেকোনো যাচাই মিথ্যা ভিত্তির উপর
 *      দাঁড়ায়, আর `money-invariants` পরে অকারণে লাল হয়।
 *
 *   ⚠️ `./_db` **প্রথম import** — নাহলে Prisma লোড হওয়ার সময়ে `.env`
 *      (লাইভ Neon) থেকে DATABASE_URL বসে যেত। ওই ফাইলে বিস্তারিত।
 *
 *   চালানো:  npx tsx scripts/verify/_fixture-tbl-stack.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';
import { creditWallet, debitWallet } from '../../src/lib/services/wallet';
import { createHash, randomBytes } from 'node:crypto';

/** ★ ফিক্সচারের সব সারি এই চিহ্ন বহন করে — পুনরায় চালালে আগেরগুলো যায় */
const TAG = 'TBLSTACK';
const HEAVY_EMAIL = 'tblstack.heavy@dev.local';
const EMPTY_EMAIL = 'tblstack.empty@dev.local';

/** ★ ইচ্ছাকৃতভাবে লম্বা বাংলা নাম — ৩২০px কার্ডে এটিই সবচেয়ে চাপ দেয় */
const LONG_BN_NAME = 'মোহাম্মদ আব্দুর রহমান চৌধুরী সিদ্দিকী আল-মামুন';
/** ★ লম্বা TrxID — ফাঁকা জায়গা নেই, তাই `break-all` ছাড়া কার্ড ছাড়িয়ে যায় */
const LONG_TRX = 'BKASH9F2ABX7QK1LM0Z8TRXPAYMENTREF20260817LONGESTVALUEONRECORD';

async function main() {
  console.log(`ডাটাবেস: ${dbLabel()}`);

  // ── পুরনো ফিক্সচার সরানো (পুনরায় চালানো নিরাপদ রাখতে) ──
  const old = await db.user.findMany({
    where: { email: { in: [HEAVY_EMAIL, EMPTY_EMAIL] } },
    select: { id: true },
  });
  const oldIds = old.map((u) => u.id);
  if (oldIds.length) {
    // ⚠️ ক্রম: সন্তান আগে, তারপর ইউজার — Order/Deposit/Ledger এ
    //    onDelete: Restrict, তাই উল্টো ক্রমে FK ত্রুটি হতো।
    await db.orderEvent.deleteMany({ where: { order: { userId: { in: oldIds } } } });
    await db.order.deleteMany({ where: { userId: { in: oldIds } } });
    await db.deposit.deleteMany({ where: { userId: { in: oldIds } } });
    await db.ledgerEntry.deleteMany({ where: { userId: { in: oldIds } } });
    await db.apiKey.deleteMany({ where: { userId: { in: oldIds } } });
    await db.notification.deleteMany({ where: { userId: { in: oldIds } } });
    await db.user.deleteMany({ where: { id: { in: oldIds } } });
  }
  await db.adminLog.deleteMany({ where: { detail: { startsWith: TAG } } });

  // ── ইউজার ──
  // ★ পাসওয়ার্ড-হ্যাশ বিদ্যমান গ্রাহকের থেকে নেওয়া, যাতে একই
  //   পাসওয়ার্ডে লগইন করা যায় (bcrypt এখানে আবার চালানোর দরকার নেই)।
  const seedCustomer = await db.user.findUnique({
    where: { email: 'customer@uidtopup.local' },
    select: { password: true },
  });
  if (!seedCustomer?.password) throw new Error('seed গ্রাহক পাওয়া যায়নি — আগে `npm run dev:db:seed` চালান');

  const heavy = await db.user.create({
    data: {
      email: HEAVY_EMAIL,
      name: LONG_BN_NAME,
      phone: '01712345678',
      password: seedCustomer.password,
      referralCode: 'TBLSTACKHEAVY',
      tier: 'RESELLER',
    },
    select: { id: true },
  });

  const empty = await db.user.create({
    data: {
      email: EMPTY_EMAIL,
      name: 'খালি অ্যাকাউন্ট',
      phone: '01887654321',
      password: seedCustomer.password,
      referralCode: 'TBLSTACKEMPTY',
    },
    select: { id: true },
  });

  // ── API কী (ResellerPanel টেবিল) ──
  for (const [i, spec] of [
    { label: 'নিজের প্যানেল', revoked: false, used: true },
    { label: 'পুরনো টেলিগ্রাম বট — আর ব্যবহার হয় না', revoked: true, used: false },
  ].entries()) {
    const raw = randomBytes(24).toString('hex');
    await db.apiKey.create({
      data: {
        userId: heavy.id,
        label: spec.label,
        prefix: `rk_live_${raw.slice(0, 8)}`,
        hash: createHash('sha256').update(raw).digest('hex'),
        lastUsedAt: spec.used ? new Date() : null,
        revokedAt: spec.revoked ? new Date() : null,
        createdByName: 'Admin',
        createdAt: new Date(Date.now() - (i + 1) * 86400000),
      },
    });
  }

  // ── ডিপোজিট ৩০টি + প্রতিটির জন্য খতিয়ান (অনুমোদিতগুলোয়) ──
  const METHODS = ['BKASH', 'NAGAD', 'ROCKET'] as const;
  const STATUSES = ['APPROVED', 'PENDING', 'REJECTED'] as const;
  for (let i = 0; i < 30; i++) {
    const status = STATUSES[i % 3];
    const amount = [500, 1000, 2500, 125000][i % 4];
    // ★ প্রথমটিতে সবচেয়ে লম্বা TrxID — এটিই `break-all` এর পরীক্ষা
    const trxId = i === 0 ? LONG_TRX : `${TAG}TRX${String(i).padStart(4, '0')}${randomBytes(4).toString('hex').toUpperCase()}`;
    const dep = await db.deposit.create({
      data: {
        userId: heavy.id,
        method: METHODS[i % 3],
        amount,
        trxId,
        senderNo: '017' + String(10000000 + i),
        status,
        createdAt: new Date(Date.now() - i * 3600_000),
        reviewedAt: status === 'PENDING' ? null : new Date(Date.now() - i * 3600_000 + 600_000),
      },
      select: { id: true },
    });
    if (status === 'APPROVED') {
      await db.$transaction(async (tx) => {
        await creditWallet({
          tx, userId: heavy.id, amount, type: 'DEPOSIT', refId: dep.id,
          note: `${TAG} ডিপোজিট অনুমোদন — ${METHODS[i % 3]}`,
        });
      });
    }
  }

  // ── অর্ডার ৩০টি + খরচের খতিয়ান ──
  const variants = await db.variant.findMany({
    take: 6,
    select: { id: true, label: true, price: true, costPrice: true, product: { select: { name: true } } },
  });
  if (!variants.length) throw new Error('ক্যাটালগ খালি — আগে `npm run dev:db:seed` চালান');

  const ORDER_STATUS = ['COMPLETED', 'PENDING', 'PROCESSING', 'REFUNDED'] as const;
  for (let i = 0; i < 30; i++) {
    const v = variants[i % variants.length];
    const status = ORDER_STATUS[i % 4];
    const price = Number(v.price);
    const order = await db.order.create({
      data: {
        userId: heavy.id,
        variantId: v.id,
        playerUid: String(1000000000 + i * 7919),
        // ★ লম্বা প্রোডাক্ট-নাম ইচ্ছাকৃত — কার্ডে দুই লাইনে গড়ায়
        productName: i % 3 === 0
          ? `${v.product.name} — বাংলাদেশ সার্ভার (তাৎক্ষণিক ডেলিভারি)`
          : v.product.name,
        variantName: v.label,
        subtotal: price,
        price,
        costPrice: v.costPrice ?? 0,
        status,
        createdAt: new Date(Date.now() - i * 5400_000),
        completedAt: status === 'COMPLETED' ? new Date(Date.now() - i * 5400_000 + 900_000) : null,
      },
      select: { id: true },
    });
    // ★ প্রতিটি অর্ডার টাকা কেটেছে; REFUNDED হলে সেই টাকা একটি
    //   **নতুন** REFUND এন্ট্রিতে ফেরত গেছে — মূল ORDER সারিটি
    //   অপরিবর্তিত (CLAUDE.md §2.1(৫))। ফলে খতিয়ানে দুই ধরনের
    //   চিহ্ন (ঋণাত্মক ও ধনাত্মক) দুটোই যাচাইয়ে আসে।
    await db.$transaction(async (tx) => {
      await debitWallet({
        tx, userId: heavy.id, amount: price, type: 'ORDER', refId: order.id,
        note: `${TAG} অর্ডার — ${v.product.name}`,
      });
      if (status === 'REFUNDED') {
        await creditWallet({
          tx, userId: heavy.id, amount: price, type: 'REFUND', refId: order.id,
          note: `${TAG} সম্পূর্ণ ফেরত — অর্ডার বাতিল`,
        });
        /**
         * ⚠️ `refundedAmount` **একই transaction-এ** বসাতেই হবে।
         *   `scripts/money-invariants.ts` এর একটি invariant হলো
         *   `order.refundedAmount == ওই অর্ডারের REFUND এন্ট্রিগুলোর
         *   যোগফল`। প্রথমবার এটি বাদ পড়েছিল আর invariant স্ক্রিপ্ট
         *   ৭টি অর্ডারে ধরে ফেলেছিল — ফিক্সচার ভুল ডেটা বানালে তার
         *   উপর করা যেকোনো যাচাইই অর্থহীন।
         */
        await tx.order.update({ where: { id: order.id }, data: { refundedAmount: price } });
      }
    });
  }

  // ── অ্যাডমিন লগ ৩২০টি (পাতার সীমা ৩০০ ছাড়িয়ে) ──
  const ACTIONS = [
    'LOGIN', 'LOGOUT', 'REGISTER', 'DEPOSIT_CREATE', 'DEPOSIT_APPROVE', 'DEPOSIT_REJECT',
    'ORDER_CREATE', 'ORDER_COMPLETE', 'ORDER_REFUND', 'ORDER_PARTIAL_REFUND',
    'BALANCE_ADJUST', 'USER_BAN', 'USER_UNBAN', 'PRICE_CHANGE', 'SETTINGS_CHANGE',
  ];
  const ACTORS = ['ADMIN', 'CUSTOMER', 'SYSTEM'];
  const UAS = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  ];
  const logs = Array.from({ length: 320 }, (_, i) => ({
    adminId: i % 3 === 1 ? heavy.id : 'system',
    // ★ একটিতে খুব লম্বা নাম — লগ টেবিলের "কে" কলামের চাপ
    adminName: i % 7 === 0 ? LONG_BN_NAME : i % 3 === 1 ? 'টেস্ট গ্রাহক' : 'Admin',
    actorType: ACTORS[i % 3],
    role: i % 3 === 1 ? 'USER' : 'ADMIN',
    action: ACTIONS[i % ACTIONS.length],
    targetId: i % 5 === 0 ? heavy.id : null,
    amount: i % 4 === 0 ? 125000 : null,
    detail: i % 6 === 0
      // ★ ইচ্ছাকৃতভাবে লম্বা — মোবাইল কার্ডে এটিই সবচেয়ে বেশি গড়ায়
      ? `${TAG} bKash ট্রানজেকশন যাচাই করে অনুমোদন দেওয়া হয়েছে; গ্রাহক এর আগে দুইবার ভুল TrxID দিয়ে চেষ্টা করেছিলেন এবং তৃতীয়বারে সঠিক রেফারেন্স জমা দেন`
      : `${TAG} ${ACTIONS[i % ACTIONS.length]} #${i}`,
    ip: i % 2 === 0 ? '103.230.104.220' : '2400:adc5:11f:d900:6c4b:2f3a:9e11:0042',
    userAgent: UAS[i % 3],
    createdAt: new Date(Date.now() - i * 900_000),
  }));
  await db.adminLog.createMany({ data: logs });

  // ── ফল ──
  const check = await db.user.findUnique({
    where: { id: heavy.id },
    select: { balance: true, _count: { select: { orders: true, deposits: true, ledger: true } } },
  });
  const sum = await db.ledgerEntry.aggregate({ where: { userId: heavy.id }, _sum: { amount: true } });
  const ok = String(check!.balance) === String(sum._sum.amount);

  console.log(JSON.stringify({
    heavyId: heavy.id,
    emptyId: empty.id,
    heavyEmail: HEAVY_EMAIL,
    emptyEmail: EMPTY_EMAIL,
    longTrx: LONG_TRX,
    longName: LONG_BN_NAME,
    counts: check!._count,
    adminLogs: await db.adminLog.count(),
    balance: String(check!.balance),
    ledgerSum: String(sum._sum.amount),
    ledgerInvariantOk: ok,
  }, null, 1));

  if (!ok) throw new Error('✗ খতিয়ানের যোগফল ব্যালেন্সের সাথে মেলেনি — ফিক্সচার নিজেই ভুল');
  console.log('\n✓ ফিক্সচার তৈরি, খতিয়ান-invariant ঠিক আছে');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
