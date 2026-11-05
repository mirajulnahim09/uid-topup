/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ডিটেইল-পাতার অডিটের জন্য ডেভ-ডেটা
 *
 *   `npx tsx scripts/audit/_fixture-detail.ts`
 *
 *   অডিট এতদিন **৪১টি স্ট্যাটিক রুট** মেপেছে। যে চারটি পাতা
 *   ডাইনামিক id-তে বসে, সেগুলো একবারও মাপা হয়নি:
 *
 *     · /account/orders/{id}           — অর্ডারের বিস্তারিত
 *     · /account/orders/{id}/invoice   — A4 চালান (কেউ কখনো দেখেনি)
 *     · /account/tickets/{id}          — বিরোধ-থ্রেড
 *     · /admin/users/{id}              — গ্রাহকের প্রোফাইল
 *
 *   অথচ বিরোধ ঠিক এই পাতাগুলোতেই নিষ্পত্তি হয় (HANDOFF §৪)।
 *
 *   ⚠️ কেন ফিক্সচার লাগল: `npm run dev:db:seed` অডিটের গ্রাহককে
 *      (`customer@uidtopup.local`) **একটিও অর্ডার দেয় না**, আর
 *      ডেভ DB-তে টিকিট **শূন্য**। id ছাড়া রুটটাই বানানো যায় না,
 *      আর নেই-রুট তালিকায় রাখলে প্রতি রানে মিথ্যা ৪০৪ গোনা হয়
 *      (২০২৬-০৮-১৮ এ `/account/wallet` ঠিক তাই করেছিল)।
 *
 *   ⚠️⚠️ টাকা: ব্যালেন্স কেবল `creditWallet`/`debitWallet` দিয়ে নড়ে
 *      (CLAUDE.md §2.1)। ডেভ ডাটাবেস বলে `user.update({ balance })`
 *      লেখার লোভ হয়, কিন্তু খতিয়ান-অসংগত ফিক্সচারের উপর করা যাচাই
 *      মিথ্যা ভিত্তির উপর দাঁড়ায় আর `money-invariants` পরে অকারণে
 *      লাল হয় — `_fixture-tbl-stack.ts` এ একই সিদ্ধান্ত।
 *
 *   ⚠️ `./_db` **প্রথম import** — নাহলে Prisma লোড হওয়ার সময়ে `.env`
 *      (লাইভ Neon) থেকে DATABASE_URL বসে যেত।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from '../verify/_db';
import { creditWallet, debitWallet } from '../../src/lib/services/wallet';

/** ★ ফিক্সচারের সব সারি এই চিহ্ন বহন করে — পুনরায় চালালে আগেরগুলো যায় */
const TAG = 'AUDITDETAIL';
const CUSTOMER_EMAIL = 'customer@uidtopup.local';

/**
 * ★ ইচ্ছাকৃতভাবে লম্বা বাংলা লেখা। ছোট "ঠিক আছে" বার্তা দিয়ে বিরোধ-থ্রেড
 *   মাপা মানে কিছুই না মাপা — আসল থ্রেডে গ্রাহক অনুচ্ছেদ লেখেন, আর
 *   ঠিক সেখানেই বুদবুদ ছাড়িয়ে যায় বা লেখা কাটা পড়ে।
 */
const LONG_MSG =
  'ভাই আমি গতকাল রাত ১১টা ৪৭ মিনিটে বিকাশ দিয়ে টাকা পাঠিয়েছি এবং ট্রানজেকশন আইডিও দিয়েছি, ' +
  'কিন্তু এখনো ডায়মন্ড অ্যাকাউন্টে আসেনি। আমার প্লেয়ার আইডি ঠিকই দিয়েছিলাম, দুইবার মিলিয়ে দেখেছি। ' +
  'অনুগ্রহ করে একটু দেখবেন, কালকে ইভেন্ট শেষ হয়ে যাবে।';
const LONG_REPLY =
  'আপনার অর্ডারটি আমরা দেখেছি। বিকাশের রেফারেন্স মিলে গেছে, তবে গেমের সার্ভার থেকে নিশ্চিতকরণ আসতে ' +
  'কখনো কখনো ১৫–২০ মিনিট সময় নেয়। আমরা ম্যানুয়ালি ডেলিভারি সম্পন্ন করে দিয়েছি — অ্যাপটি একবার বন্ধ করে ' +
  'আবার চালু করে দেখুন।';

async function main() {
  console.log(`ডাটাবেস: ${dbLabel()}`);

  const cust = await db.user.findUnique({
    where: { email: CUSTOMER_EMAIL },
    select: { id: true, balance: true },
  });
  if (!cust) throw new Error(`${CUSTOMER_EMAIL} পাওয়া যায়নি — আগে \`npm run dev:db:seed\` চালান`);

  /** ★ শুরুর অবস্থা — শেষে ব-দ্বীপ মেলানোর জন্য (নিচে ব্যাখ্যা) */
  const sumBefore = await db.ledgerEntry.aggregate({ where: { userId: cust.id }, _sum: { amount: true } });

  /**
   * ★★★ পুনরায় চালালে **আগেরটিই ফেরত দেওয়া হয়** — মোছা হয় না।
   *
   *   প্রথমে লিখেছিলাম "পুরনো ফিক্সচার মুছে নতুন বানাও", তারপর টের
   *   পেলাম সেটি করতে গেলে খতিয়ানের সারিতে হাত দিতে হয় (refId খালি
   *   করা বা এন্ট্রি মোছা) — §2.1(৫) সরাসরি নিষেধ করে, আর নিয়মটি
   *   ডেভ ডাটাবেসেও শিথিল করা উচিত নয়: যে অভ্যাস ফিক্সচারে চলে,
   *   সেটিই একদিন প্রোডাকশন কোডে ঢোকে।
   *
   *   তাই ফিক্সচারটি **idempotent**: সারি থাকলে তার id-ই ফেরত যায়,
   *   না থাকলে একবার তৈরি হয়। বারবার চালালে টাকা বারবার নড়ে না।
   */
  const existing = await db.order.findFirst({
    where: { userId: cust.id, productName: { startsWith: TAG } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, tickets: { select: { id: true }, take: 1 } },
  });
  if (existing?.tickets?.[0]) {
    const bal = await db.user.findUnique({ where: { id: cust.id }, select: { balance: true } });
    console.log(JSON.stringify({
      orderId: existing.id, ticketId: existing.tickets[0].id,
      balance: String(bal?.balance), reused: true,
    }, null, 1));
    return;
  }

  // ── একটি সম্পন্ন অর্ডার ──
  const v = await db.variant.findFirst({
    where: { isActive: true, product: { isActive: true } },
    select: { id: true, label: true, price: true, costPrice: true, product: { select: { name: true } } },
  });
  if (!v) throw new Error('ক্যাটালগ খালি — আগে `npm run dev:db:seed` চালান');
  const price = Number(v.price);

  // ★ আগে টাকা ঢোকাতে হবে, নাহলে debitWallet ব্যালেন্স-শূন্যে আটকাবে —
  //   ঠিক যেমনটি আসল অ্যাপে হতো। ডিপোজিট সারিও বানাই যাতে খতিয়ানের
  //   refId কোথাও নির্দেশ করে (নাহলে ডিটেইল পাতায় "উৎস" খালি দেখাত)।
  const dep = await db.deposit.create({
    data: {
      userId: cust.id, method: 'BKASH', amount: price * 3,
      trxId: `${TAG}${Date.now().toString(36).toUpperCase()}`,
      senderNo: '01711111111', status: 'APPROVED', reviewedAt: new Date(),
    },
    select: { id: true },
  });
  await db.$transaction(async (tx) => {
    await creditWallet({
      tx, userId: cust.id, amount: price * 3, type: 'DEPOSIT', refId: dep.id,
      note: `${TAG} ডিপোজিট অনুমোদন — bKash`,
    });
  });

  const order = await db.order.create({
    data: {
      userId: cust.id, variantId: v.id,
      playerUid: '2148573091',
      // ★ TAG শিরোনামে — পুনরায় চালালে এই সারিগুলোই খুঁজে পাওয়া যায়
      productName: `${TAG} ${v.product.name}`,
      variantName: v.label,
      subtotal: price, price, costPrice: v.costPrice ?? 0,
      status: 'COMPLETED',
      completedAt: new Date(),
    },
    select: { id: true },
  });
  await db.$transaction(async (tx) => {
    await debitWallet({
      tx, userId: cust.id, amount: price, type: 'ORDER', refId: order.id,
      note: `${TAG} অর্ডার — ${v.product.name}`,
    });
  });

  // ── একটি বিরোধ-থ্রেড, চারটি বার্তা ──
  const ticket = await db.ticket.create({
    data: {
      // ★ DISPUTE — টাকার সাথে জড়িত থ্রেড, স্কিমা এটিকেই আলাদা করে
      userId: cust.id, orderId: order.id, kind: 'DISPUTE', status: 'OPEN',
      subject: 'অর্ডার সম্পন্ন দেখাচ্ছে কিন্তু ডায়মন্ড পাইনি',
      lastMessageAt: new Date(),
    },
    select: { id: true },
  });
  // ★ স্টাফ-বার্তার লেখক আসল অ্যাডমিন — `authorId: null` মানে
  //   স্কিমা অনুযায়ী **সিস্টেম-বার্তা**, মানুষের উত্তর নয়
  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, name: true } });
  const msgs = [
    { authorId: cust.id, authorName: 'যাচাই গ্রাহক', isStaff: false, body: LONG_MSG },
    { authorId: admin?.id ?? null, authorName: admin?.name ?? 'সাপোর্ট', isStaff: true, body: LONG_REPLY },
    { authorId: cust.id, authorName: 'যাচাই গ্রাহক', isStaff: false, body: 'ধন্যবাদ, পেয়েছি।' },
    // ★ এক-শব্দের বার্তা ইচ্ছাকৃত — খুব ছোট বুদবুদেও বিন্যাস ধরে রাখতে হয়
    { authorId: admin?.id ?? null, authorName: admin?.name ?? 'সাপোর্ট', isStaff: true, body: 'স্বাগতম।' },
  ];
  for (let i = 0; i < msgs.length; i++) {
    await db.ticketMessage.create({
      data: { ticketId: ticket.id, ...msgs[i], createdAt: new Date(Date.now() - (msgs.length - i) * 60_000) },
    });
  }

  /**
   * ── খতিয়ান invariant — ফিক্সচার নিজেই যেন মিথ্যা না বানায় ──
   *
   * ⚠️ পরম মান নয়, **ব-দ্বীপ (delta)**। কারণটি মেপে জানা:
   *   `scripts/dev-make-customer.mjs:39` ডেভ গ্রাহককে সরাসরি
   *   `balance: 5000` দিয়ে বানায় — কোনো খতিয়ান-এন্ট্রি ছাড়াই।
   *   তাই ঐ ইউজারে `SUM(ledger) === balance` **কখনোই** মিলবে না,
   *   আর পরম তুলনা করলে ফিক্সচার নিজের নির্দোষ কাজেও লাল হতো।
   *   যা এখানে যাচাই্য: এই স্ক্রিপ্ট ব্যালেন্স যতটা নাড়িয়েছে,
   *   ঠিক ততটাই খতিয়ানে লিখেছে কি না।
   *   (ডেভ-বীজের ঐ ৫০০০ প্রোডাকশনের কিছু নয় — সেখানে ব্যালেন্স
   *   কেবল `wallet.ts` দিয়েই নড়ে। নিচে তথ্য হিসেবে ছাপা হয়।)
   */
  const after = await db.user.findUnique({ where: { id: cust.id }, select: { balance: true } });
  const sum = await db.ledgerEntry.aggregate({ where: { userId: cust.id }, _sum: { amount: true } });
  const balanceDelta = Number(after?.balance) - Number(cust.balance);
  const ledgerDelta = Number(sum._sum.amount ?? 0) - Number(sumBefore._sum.amount ?? 0);
  const ok = balanceDelta === ledgerDelta;

  console.log(JSON.stringify({
    orderId: order.id,
    ticketId: ticket.id,
    balance: String(after?.balance),
    balanceDelta,
    ledgerDelta,
    deltaMatches: ok,
    unledgeredOpeningBalance: Number(cust.balance) - Number(sumBefore._sum.amount ?? 0),
  }, null, 1));
  if (!ok) throw new Error('✗ ফিক্সচার খতিয়ান-অসংগত ডেটা বানিয়েছে — থামানো হলো');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
