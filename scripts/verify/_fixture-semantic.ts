/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ সেমান্টিক-রঙ যাচাইয়ের জন্য **অবস্থা** তৈরি
 *
 *   `semantic-tokens.ts` কেবল মাপে; যে অবস্থাগুলো ছাড়া মাপার কিছুই
 *   নেই, সেগুলো বানায় এই ফাইলটি।
 *
 *   ⚠️ কেন আলাদা ফিক্সচার দরকার: এই কাজে বদলানো রঙগুলোর প্রায় সবকটি
 *      **শর্তসাপেক্ষ শাখায়** — SLA ভাঙলে, ডিপোজিট বাতিল হলে, ঝুঁকি
 *      বেশি হলে, অর্ডার ফেরত গেলে। সাধারণ ক্রল বা `dev:db:seed` এ
 *      এগুলোর একটিও ফোটে না। ২০২৬-০৮-২৯ এর সেশনে ঠিক এই কারণেই
 *      ছয়টি call-site "চোখে দেখা হয়নি" বলে লিখে রাখতে হয়েছিল
 *      (UIUX_PROBLEM_MAP §১৩.৫)। এবার সেগুলো বানিয়ে নেওয়া হচ্ছে।
 *
 *   ⚠️⚠️ টাকা: ব্যালেন্স কেবল `creditWallet`/`debitWallet` দিয়ে নড়ে
 *      (CLAUDE.md §2.1)। ডেভ ডাটাবেস হলেও এখানে `user.update({balance})`
 *      লেখা হয়নি — ফিক্সচার খতিয়ান-অসংগত ডেটা বানালে তার উপর করা
 *      যাচাই মিথ্যা ভিত্তির উপর দাঁড়ায়, আর `money-invariants` পরে
 *      অকারণে লাল হয়। শেষে যোগফল মিলিয়ে দেখা হয়।
 *
 *   ⚠️ `./_db` **প্রথম import** — নাহলে Prisma লোড হওয়ার সময়ে `.env`
 *      (লাইভ Neon) থেকে DATABASE_URL বসে যেত।
 *
 *   চালানো:
 *     npx tsx scripts/verify/_fixture-semantic.ts          # বানাও
 *     npx tsx scripts/verify/_fixture-semantic.ts --clean  # মুছে দাও
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';
import { creditWallet, debitWallet } from '../../src/lib/services/wallet';
import { randomBytes } from 'node:crypto';

const TAG = 'SEMTOK';
const CUSTOMER_EMAIL = 'semtok.customer@dev.local';
const ELEVATED_EMAIL = 'semtok.elevated@dev.local';
const TRUSTED_EMAIL = 'semtok.trusted@dev.local';
const EMAILS = [CUSTOMER_EMAIL, ELEVATED_EMAIL, TRUSTED_EMAIL];

/** ★ `riskSignals.ts`: approvedCount >= ১০ এবং কোনো elevated সংকেত না থাকলে trusted */
const TRUSTED_MIN = 10;

async function wipe(): Promise<number> {
  const old = await db.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  const ids = old.map((u) => u.id);
  if (!ids.length) return 0;
  // ⚠️ ক্রম: সন্তান আগে, তারপর ইউজার — Order/Deposit/Ledger এ onDelete: Restrict
  await db.orderEvent.deleteMany({ where: { order: { userId: { in: ids } } } });
  await db.order.deleteMany({ where: { userId: { in: ids } } });
  await db.deposit.deleteMany({ where: { userId: { in: ids } } });
  await db.ledgerEntry.deleteMany({ where: { userId: { in: ids } } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

async function main() {
  console.log(`ডাটাবেস: ${dbLabel()}`);

  if (process.argv.includes('--clean')) {
    const n = await wipe();
    console.log(`✓ ${n} টি ফিক্সচার-ইউজার ও তাদের সব সারি মুছে ফেলা হলো`);
    return;
  }

  await wipe();

  // ★ পাসওয়ার্ড-হ্যাশ seed গ্রাহকের থেকে — একই পাসওয়ার্ডে লগইন করা যায়
  const seed = await db.user.findUnique({
    where: { email: 'customer@uidtopup.local' },
    select: { password: true },
  });
  if (!seed?.password) throw new Error('seed গ্রাহক পাওয়া যায়নি — আগে `npm run dev:db:seed` চালান');

  const mk = (email: string, name: string, phone: string, code: string) =>
    db.user.create({
      data: { email, name, phone, password: seed.password, referralCode: code },
      select: { id: true, phone: true },
    });

  const customer = await mk(CUSTOMER_EMAIL, 'সেমান্টিক গ্রাহক', '01900000001', `${TAG}CUST`);
  const elevated = await mk(ELEVATED_EMAIL, 'ঝুঁকিপূর্ণ দাবিদার', '01900000002', `${TAG}ELEV`);
  // ⚠️ নামটি ইচ্ছাকৃতভাবে "পরিচিত গ্রাহক" **নয়** — সেটি `TIER.trusted`
  //    এর নিজের লেবেল, আর যাচাই লেখা দেখে নোড খোঁজে; একই লেখা দুই
  //    জায়গায় থাকলে ভুল নোড মাপা হতো।
  const trusted = await mk(TRUSTED_EMAIL, 'নিয়মিত ক্রেতা', '01900000003', `${TAG}TRUST`);

  const variant = await db.variant.findFirst({
    select: { id: true, label: true, price: true, costPrice: true, product: { select: { name: true } } },
  });
  if (!variant) throw new Error('ক্যাটালগ খালি — আগে `npm run dev:db:seed` চালান');
  const price = Number(variant.price);

  const trx = (s: string) => `${TAG}${s}${randomBytes(4).toString('hex').toUpperCase()}`;

  // ══ ১. গ্রাহকের ওয়ালেটে টাকা (অনুমোদিত ডিপোজিট → খতিয়ান) ══
  const topup = await db.deposit.create({
    data: {
      userId: customer.id, method: 'BKASH', amount: price * 10, trxId: trx('TOPUP'),
      senderNo: customer.phone!, status: 'APPROVED',
      createdAt: new Date(Date.now() - 86_400_000), reviewedAt: new Date(Date.now() - 86_000_000),
    },
    select: { id: true },
  });
  await db.$transaction(async (tx) => {
    await creditWallet({
      tx, userId: customer.id, amount: price * 10, type: 'DEPOSIT', refId: topup.id,
      note: `${TAG} ফিক্সচার টপ-আপ`,
    });
  });

  // ══ ২. বাতিল ডিপোজিট **কারণসহ** ══
  //    `account/wallet/deposit` এর "কেন বাতিল হলো" বাক্সটি `adminNote`
  //    ছাড়া রেন্ডারই হয় না — তাই কারণটি বাধ্যতামূলক।
  await db.deposit.create({
    data: {
      userId: customer.id, method: 'NAGAD', amount: 500, trxId: trx('REJ'),
      senderNo: '01911111111', status: 'REJECTED',
      adminNote: 'TrxID টি bKash-এর রেকর্ডে পাওয়া যায়নি। সঠিক রেফারেন্স দিয়ে আবার চেষ্টা করুন।',
      createdAt: new Date(Date.now() - 7_200_000), reviewedAt: new Date(Date.now() - 7_000_000),
    },
  });

  /** এক অর্ডার — টাকা কাটা খতিয়ানসহ */
  async function order(status: 'PENDING' | 'REFUNDED', slaMinutesFromNow: number | null) {
    const o = await db.order.create({
      data: {
        userId: customer.id, variantId: variant!.id,
        playerUid: String(1_000_000_000 + Math.floor(Math.random() * 8_999_999)),
        productName: variant!.product.name, variantName: variant!.label,
        subtotal: price, price, costPrice: variant!.costPrice ?? 0,
        status,
        slaDueAt: slaMinutesFromNow === null ? null : new Date(Date.now() + slaMinutesFromNow * 60_000),
        createdAt: new Date(Date.now() - 3_600_000),
        trackToken: randomBytes(16).toString('hex'),
      },
      select: { id: true, orderNo: true },
    });
    await db.$transaction(async (tx) => {
      await debitWallet({ tx, userId: customer.id, amount: price, type: 'ORDER', refId: o.id, note: `${TAG} অর্ডার` });
      if (status === 'REFUNDED') {
        await creditWallet({ tx, userId: customer.id, amount: price, type: 'REFUND', refId: o.id, note: `${TAG} সম্পূর্ণ ফেরত` });
        // ⚠️ `refundedAmount` একই transaction-এ — money-invariants এর দাবি
        await tx.order.update({
          where: { id: o.id },
          data: {
            refundedAmount: price,
            adminNote: 'গেম সার্ভার থেকে টপ-আপ নিশ্চিত হয়নি, তাই পুরো টাকা ফেরত দেওয়া হয়েছে।',
          },
        });
      }
    });
    return o;
  }

  // ══ ৩. SLA — ভঙ্গ (৯৫ মিনিট পার) ও ঘনিয়ে আসা (১০ মিনিট বাকি) ══
  const breached = await order('PENDING', -95);
  const soon = await order('PENDING', 10);
  // ══ ৪. ফেরত দেওয়া অর্ডার — "বাতিল" ব্লক ══
  const refunded = await order('REFUNDED', null);

  // ══ ৫. উঁচু ঝুঁকির অপেক্ষমান ডিপোজিট ══
  //    প্রেরকের নাম্বার নিবন্ধিত নাম্বারের সাথে মেলে না → elevated + warn
  await db.deposit.create({
    data: {
      userId: elevated.id, method: 'BKASH', amount: 5000, trxId: trx('ELEV'),
      senderNo: '01955555555', status: 'PENDING', createdAt: new Date(Date.now() - 600_000),
    },
  });

  // ══ ৬. পরিচিত গ্রাহকের অপেক্ষমান ডিপোজিট ══
  //    ১০টি অনুমোদিত ইতিহাস → trusted + good সংকেত
  for (let i = 0; i < TRUSTED_MIN; i++) {
    const d = await db.deposit.create({
      data: {
        userId: trusted.id, method: 'BKASH', amount: 1000, trxId: trx(`TR${i}`),
        senderNo: trusted.phone!, status: 'APPROVED',
        createdAt: new Date(Date.now() - (i + 2) * 86_400_000),
        reviewedAt: new Date(Date.now() - (i + 2) * 86_000_000),
      },
      select: { id: true },
    });
    await db.$transaction(async (tx) => {
      await creditWallet({
        tx, userId: trusted.id, amount: 1000, type: 'DEPOSIT', refId: d.id,
        note: `${TAG} পুরনো অনুমোদন`,
      });
    });
  }
  await db.deposit.create({
    data: {
      userId: trusted.id, method: 'BKASH', amount: 1000, trxId: trx('TRPEND'),
      senderNo: trusted.phone!, status: 'PENDING', createdAt: new Date(Date.now() - 300_000),
    },
  });

  // ── খতিয়ান-invariant: ফিক্সচার নিজে ঠিক আছে কি না ──
  let bad = 0;
  for (const id of [customer.id, elevated.id, trusted.id]) {
    const u = await db.user.findUnique({ where: { id }, select: { balance: true } });
    const s = await db.ledgerEntry.aggregate({ where: { userId: id }, _sum: { amount: true } });
    const sum = s._sum.amount ?? 0;
    if (String(u!.balance) !== String(sum)) {
      bad++;
      console.error(`✗ ${id}: balance ${u!.balance} ≠ ledger ${sum}`);
    }
  }

  console.log(JSON.stringify({
    customerEmail: CUSTOMER_EMAIL,
    breachedOrderId: breached.id, breachedOrderNo: breached.orderNo,
    soonOrderId: soon.id, soonOrderNo: soon.orderNo,
    refundedOrderId: refunded.id, refundedOrderNo: refunded.orderNo,
    ledgerInvariantOk: bad === 0,
  }, null, 1));

  if (bad) throw new Error('✗ ফিক্সচার নিজেই খতিয়ান-অসংগত');
  console.log('\n✓ ফিক্সচার তৈরি, খতিয়ান-invariant ঠিক আছে');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
