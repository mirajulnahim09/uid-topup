/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অবস্থা-যন্ত্র ও সমান্তরালতা — HTTP স্তরে (স্বাধীন অডিট, ২০২৬-০৯-১৮)
 *
 *   ইউনিট-টেস্ট অর্ডার/কুপন/রিফান্ড/ডিপোজিটের রেস ঢাকে। এখানে **যা ঢাকা
 *   ছিল না** সেগুলো আসল HTTP দিয়ে:
 *
 *     ক. অর্ডার: PENDING-এ আংশিক ফেরত · দুবার COMPLETE (সমান্তরাল) ·
 *        REFUNDED-এর পরে COMPLETE · COMPLETE-এর পরে FAIL
 *     খ. ডিপোজিট: REJECT-এর পরে APPROVE · সমান্তরাল APPROVE+REJECT
 *     গ. প্রত্যাহার: **সমান্তরাল দুটি approve** · approve-এর পরে reject
 *     ঘ. ডেলিভারি-নিশ্চিতকরণ দুবার · একই অর্ডারে দুটি রিভিউ (সমান্তরাল)
 *     ঙ. OTP: একই কোড দুটি সমান্তরাল অনুরোধে
 *     চ. ব্যালেন্স-সমন্বয়: দুই অ্যাডমিন একসাথে · শূন্য/ঋণাত্মক/বিশাল অঙ্ক
 *
 *   প্রতিটি ধাপের পরে খতিয়ান-অখণ্ডতা (যোগফল = ব্যালেন্স) মিলিয়ে দেখা হয়।
 *   সব সারি শেষে মুছে ফেলা হয় (কেবল স্থানীয় ডেভ DB — `_db` নিশ্চিত করে)।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/state-machine.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { creditWallet } from '../../src/lib/services/wallet';
import { issueOtp } from '../../src/lib/otp/core';
import { request, type APIRequestContext } from 'playwright-core';
import bcrypt from 'bcryptjs';

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const TAG = `sm-${Date.now().toString(36)}`;
const PASSWORD = 'StateMachine2026x';

let pass = 0; const fails: string[] = [];
function check(name: string, ok: boolean, note = '') {
  if (ok) pass++; else fails.push(`${name} — ${note}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function login(who: { email: string; password: string }): Promise<APIRequestContext> {
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: who.email, password: who.password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  const me = await (await ctx.get(`${BASE}/api/auth/session`)).json();
  if (me?.user?.email !== who.email) throw new Error(`লগইন হয়নি: ${who.email}`);
  return ctx;
}

const post = (ctx: APIRequestContext, p: string, data: unknown) =>
  ctx.post(`${BASE}${p}`, { data, failOnStatusCode: false, timeout: 60_000 });

async function ledgerOk(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
  const s = await db.ledgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
  return Math.abs(Number(u!.balance) - Number(s._sum.amount ?? 0)) < 0.001;
}

async function main() {
  console.log(`═══ অবস্থা-যন্ত্র ও রেস · ${BASE} · DB ${dbLabel()} ═══`);
  const variant = await db.variant.findFirstOrThrow({
    where: { isActive: true, stock: -1, price: { lte: 100 }, product: { isActive: true, needsUid: true } },
    orderBy: { price: 'asc' }, include: { product: true },
  });
  const price = Number(variant.price);
  const admin = await login(ADMIN);
  const admin2 = await login(ADMIN); // দ্বিতীয় সেশন — "দুই অ্যাডমিন একসাথে"

  const user = await db.user.create({
    data: {
      name: 'অবস্থা-যাচাই', email: `${TAG}@verify.local`, phone: `015${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(PASSWORD, 10), emailVerified: true, referralCode: TAG.toUpperCase().slice(0, 12),
    },
  });
  // ★ DEPOSIT, ADMIN_ADJUST নয়: FIN-01 (২০২৬-০৯-২৭) থেকে অ্যাডমিনের ধনাত্মক সমন্বয় তোলার যোগ্য
  //   নয়, তাই প্রত্যাহারের অবস্থা-যাচাই গ্রাহকের নিজের জমা টাকায় চলে (support-flow-e2e-র মতো)
  await db.$transaction((tx) => creditWallet({ tx, userId: user.id, amount: 5000, type: 'DEPOSIT', note: 'অবস্থা-যাচাই' }));
  const cust = await login({ email: user.email, password: PASSWORD });

  const placeOrder = async (uid: string) => {
    await db.rateLimitBucket.deleteMany({});
    const r = await post(cust, '/api/order', { variantId: variant.id, playerUid: uid, clientRef: `${TAG}-${uid}` });
    const j = await r.json();
    if (!j.orderId) throw new Error(`অর্ডার হয়নি: ${r.status()} ${JSON.stringify(j).slice(0, 120)}`);
    return j.orderId as string;
  };

  try {
    /* ── ক. অর্ডার ── */
    console.log('\n── ক. অর্ডারের অবস্থা ──');
    const o1 = await placeOrder('1111111111');
    // ★ `requestId` বাধ্যতামূলক (অ্যাডমিন-টাকার idempotency, ২০২৬-০৯-২৫) — প্রতি অনুরোধে নতুন
    const rPending = await post(admin, '/api/admin/order/refund', { orderId: o1, amount: 5, reason: 'পরীক্ষা: চলমান অর্ডারে ফেরত', requestId: `sm-pend-${Date.now()}` });
    check('PENDING অর্ডারে আংশিক ফেরত প্রত্যাখ্যাত', rPending.status() >= 400 && rPending.status() < 500, `HTTP ${rPending.status()}`);
    check('  ↳ refundedAmount অপরিবর্তিত', Number((await db.order.findUniqueOrThrow({ where: { id: o1 } })).refundedAmount) === 0);

    const [c1, c2] = await Promise.all([
      post(admin, '/api/admin/order', { orderId: o1, action: 'COMPLETE' }),
      post(admin2, '/api/admin/order', { orderId: o1, action: 'COMPLETE' }),
    ]);
    const okCount = [c1, c2].filter((r) => r.status() === 200).length;
    const events = await db.orderEvent.count({ where: { orderId: o1, status: 'COMPLETED' } });
    check('সমান্তরাল দুটি COMPLETE — একটিই সফল', okCount === 1, `সফল ${okCount} (${c1.status()}/${c2.status()})`);
    check('  ↳ COMPLETED ইভেন্ট ঠিক একটি', events === 1, `${events}টি`);

    const rFull = await post(admin, '/api/admin/order/refund', { orderId: o1, amount: price, reason: 'পরীক্ষা: পূর্ণ ফেরত', requestId: `sm-full-${Date.now()}` });
    check('সম্পন্ন অর্ডারে পূর্ণ ফেরত চলে', rFull.status() === 200, `HTTP ${rFull.status()}`);
    const afterRefund = await db.order.findUniqueOrThrow({ where: { id: o1 } });
    const rAgain = await post(admin, '/api/admin/order/refund', { orderId: o1, amount: 1, reason: 'পরীক্ষা: দ্বিতীয় ফেরত', requestId: `sm-again-${Date.now()}` });
    check('পুরো ফেরতের পরে আর ফেরত নয়', rAgain.status() >= 400, `HTTP ${rAgain.status()}`);
    const rCompleteAfter = await post(admin, '/api/admin/order', { orderId: o1, action: 'COMPLETE' });
    check('ফেরত-দেওয়া অর্ডার আবার COMPLETE নয়', rCompleteAfter.status() >= 400, `HTTP ${rCompleteAfter.status()} · status=${afterRefund.status}`);
    const rFailAfter = await post(admin, '/api/admin/order', { orderId: o1, action: 'FAIL', failReason: 'OTHER', adminNote: 'পরীক্ষা' });
    check('ফেরত/সম্পন্ন অর্ডারে FAIL নয়', rFailAfter.status() >= 400, `HTTP ${rFailAfter.status()}`);
    check('  ↳ খতিয়ান অটুট', await ledgerOk(user.id));

    /* ── খ. ডিপোজিট ── */
    console.log('\n── খ. ডিপোজিটের অবস্থা ──');
    const dep = await db.deposit.create({
      data: { userId: user.id, method: 'BKASH', amount: 500, trxId: `${TAG}TRX1`, senderNo: '01712345678' },
    });
    const rej = await post(admin, '/api/admin/deposit', { depositId: dep.id, action: 'REJECT', rejectReason: 'TRX_NOT_FOUND' });
    check('ডিপোজিট বাতিল হয়', rej.status() === 200, `HTTP ${rej.status()}`);
    const appAfterRej = await post(admin, '/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' });
    check('বাতিলের পরে অনুমোদন নয়', appAfterRej.status() >= 400, `HTTP ${appAfterRej.status()}`);
    const balBefore = Number((await db.user.findUniqueOrThrow({ where: { id: user.id } })).balance);

    const dep2 = await db.deposit.create({
      data: { userId: user.id, method: 'BKASH', amount: 300, trxId: `${TAG}TRX2`, senderNo: '01712345678' },
    });
    const [a1, a2] = await Promise.all([
      post(admin, '/api/admin/deposit', { depositId: dep2.id, action: 'APPROVE' }),
      post(admin2, '/api/admin/deposit', { depositId: dep2.id, action: 'REJECT', rejectReason: 'TRX_NOT_FOUND' }),
    ]);
    const dep2After = await db.deposit.findUniqueOrThrow({ where: { id: dep2.id } });
    const credits = await db.ledgerEntry.count({ where: { userId: user.id, type: 'DEPOSIT', refId: dep2.id } });
    check('সমান্তরাল APPROVE+REJECT — একটিই কার্যকর', [a1, a2].filter((r) => r.status() === 200).length === 1, `${a1.status()}/${a2.status()} → ${dep2After.status}`);
    check('  ↳ টাকা সর্বোচ্চ একবার ঢুকেছে', credits <= 1 && (dep2After.status === 'APPROVED' ? credits === 1 : credits === 0), `খতিয়ান ${credits}`);
    check('  ↳ খতিয়ান অটুট', await ledgerOk(user.id));
    void balBefore;

    /* ── গ. প্রত্যাহার ── */
    console.log('\n── গ. প্রত্যাহারের অবস্থা ──');
    const KEYS = { enabled: 'withdrawal_enabled', min: 'withdrawal_min', cap: 'withdrawal_daily_cap', hold: 'withdrawal_hold_hours' };
    const prev: Record<string, string | null> = {};
    for (const [k, key] of Object.entries(KEYS)) {
      prev[k] = (await db.setting.findUnique({ where: { key } }))?.value ?? null;
    }
    /**
     * ⚠️ প্রত্যাহারের কী-গুলো `/api/admin/settings`-এর অনুমোদিত তালিকায় **নেই**
     *   (স্বাধীন অডিটে পাওয়া ops-ফাঁক, ২০২৬-০৯-১৮) — তাই বাস্তবে যেভাবে চালু
     *   করতে হয় সেভাবেই: DB-তে সারি, তারপর সার্ভারের ৩০s settings-ক্যাশ ফুরানোর
     *   অপেক্ষা (`lib/settings.ts` TTL_MS)। প্রথম রানে ক্যাশের কারণেই ভুল
     *   "ফিচার বন্ধ" এসেছিল — প্রোবের ত্রুটি, অ্যাপের নয়।
     */
    const setKey = async (key: string, value: string) =>
      db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await setKey(KEYS.enabled, '1'); await setKey(KEYS.min, '100');
    await setKey(KEYS.cap, '50000'); await setKey(KEYS.hold, '0');
    let live = false;
    for (let i = 0; i < 20 && !live; i++) {
      const s = await cust.get(`${BASE}/api/account/withdraw`, { failOnStatusCode: false });
      live = s.status() === 200 && Boolean((await s.json().catch(() => ({})))?.config?.enabled);
      if (!live) await new Promise((r) => setTimeout(r, 3000));
    }
    check('প্রত্যাহার-কনফিগ সার্ভারে পৌঁছেছে (≤৬০s ক্যাশ)', live);
    try {
      await db.rateLimitBucket.deleteMany({});
      const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'WITHDRAW', destination: user.email, ip: '127.0.0.1' });
      const wr = await post(cust, '/api/account/withdraw', {
        amount: 200, method: 'BKASH', accountNumber: '01712345678', code,
      });
      check('প্রত্যাহারের অনুরোধ হয়', wr.status() === 200, `HTTP ${wr.status()} ${(await wr.text()).slice(0, 80)}`);
      const w = await db.withdrawal.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      if (w) {
        const balBeforeApprove = Number((await db.user.findUniqueOrThrow({ where: { id: user.id } })).balance);
        const [w1, w2] = await Promise.all([
          post(admin, '/api/admin/withdrawals', { id: w.id, action: 'approve', payoutRef: `${TAG}-REF1` }),
          post(admin2, '/api/admin/withdrawals', { id: w.id, action: 'approve', payoutRef: `${TAG}-REF2` }),
        ]);
        const okW = [w1, w2].filter((r) => r.status() === 200).length;
        const wAfter = await db.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
        const balAfter = Number((await db.user.findUniqueOrThrow({ where: { id: user.id } })).balance);
        check('সমান্তরাল দুটি approve — একটিই সফল', okW === 1, `সফল ${okW} (${w1.status()}/${w2.status()}) · status=${wAfter.status}`);
        check('  ↳ অনুমোদনে ব্যালেন্স নড়েনি (আগেই কাটা)', balAfter === balBeforeApprove, `৳${balBeforeApprove} → ৳${balAfter}`);
        const rejAfter = await post(admin, '/api/admin/withdrawals', { id: w.id, action: 'reject', reason: 'পরীক্ষা' });
        check('অনুমোদনের পরে প্রত্যাখ্যান নয়', rejAfter.status() >= 400, `HTTP ${rejAfter.status()}`);
        check('  ↳ খতিয়ান অটুট', await ledgerOk(user.id));
      }
    } finally {
      // ★ আগের মান ফেরত — একই API দিয়ে (ক্যাশসহ), আর যেগুলো আগে ছিলই না সেগুলো মুছে
      const restore: Record<string, string> = {};
      for (const [k, key] of Object.entries(KEYS)) if (prev[k] !== null) restore[key] = prev[k]!;
      if (Object.keys(restore).length) await post(admin, '/api/admin/settings', restore);
      for (const [k, key] of Object.entries(KEYS)) if (prev[k] === null) await db.setting.deleteMany({ where: { key } });
      await post(admin, '/api/admin/settings', {}); // ক্যাশ পুনরায় লোড করাতে

    }

    /* ── ঘ. ডেলিভারি-নিশ্চিতকরণ ও রিভিউ ── */
    console.log('\n── ঘ. নিশ্চিতকরণ ও রিভিউ ──');
    const o2 = await placeOrder('2222222222');
    await post(admin, '/api/admin/order', { orderId: o2, action: 'COMPLETE' });
    const [cf1, cf2] = await Promise.all([
      post(cust, '/api/order/confirm', { orderId: o2, arrived: true }),
      post(cust, '/api/order/confirm', { orderId: o2, arrived: true }),
    ]);
    const o2row = await db.order.findUniqueOrThrow({ where: { id: o2 } });
    check('সমান্তরাল দুটি ডেলিভারি-নিশ্চিতকরণে ভাঙে না', [cf1, cf2].every((r) => r.status() < 500) && Boolean(o2row.deliveryConfirmedAt), `${cf1.status()}/${cf2.status()}`);
    const [rv1, rv2] = await Promise.all([
      post(cust, '/api/review', { orderId: o2, rating: 5, body: 'ভালো' }),
      post(cust, '/api/review', { orderId: o2, rating: 1, body: 'খারাপ' }),
    ]);
    const reviews = await db.review.count({ where: { orderId: o2 } });
    check('একই অর্ডারে রিভিউ ঠিক একটি', reviews === 1, `${reviews}টি (${rv1.status()}/${rv2.status()})`);

    /* ── ঙ. OTP সমান্তরাল ── */
    console.log('\n── ঙ. OTP ──');
    await db.rateLimitBucket.deleteMany({});
    const target = await db.user.create({
      data: {
        name: 'OTP রেস', email: `${TAG}-otp@verify.local`, phone: `019${String(Date.now()).slice(-8)}`,
        password: await bcrypt.hash(PASSWORD, 10), emailVerified: true, referralCode: `${TAG}O`.toUpperCase().slice(0, 12),
      },
    });
    const { code: regCode } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: `${TAG}-new@verify.local`, ip: '127.0.0.1' });
    const anon = await request.newContext({ ignoreHTTPSErrors: true });
    const form = {
      name: 'ওটিপি রেস', email: `${TAG}-new@verify.local`,
      phone: `018${String(Date.now()).slice(-8)}`, password: 'OtpRace2026Pass', code: regCode,
    };
    const [reg1, reg2] = await Promise.all([post(anon, '/api/register', form), post(anon, '/api/register', form)]);
    const made = await db.user.count({ where: { email: form.email } });
    check('একই OTP-তে সমান্তরাল দুটি রেজিস্ট্রেশন — একটিই অ্যাকাউন্ট', made === 1, `${made}টি (${reg1.status()}/${reg2.status()})`);
    await anon.dispose();

    /* ── চ. ব্যালেন্স-সমন্বয় ── */
    console.log('\n── চ. ব্যালেন্স-সমন্বয় ──');
    const before = Number((await db.user.findUniqueOrThrow({ where: { id: user.id } })).balance);
    const [j1, j2] = await Promise.all([
      post(admin, '/api/admin/user', { userId: user.id, amount: 100, note: 'রেস ১' }),
      post(admin2, '/api/admin/user', { userId: user.id, amount: 100, note: 'রেস ২' }),
    ]);
    const after = Number((await db.user.findUniqueOrThrow({ where: { id: user.id } })).balance);
    check('দুই অ্যাডমিনের সমান্তরাল সমন্বয় — দুটোই গোনা, হারায় না', after === before + 200, `৳${before} → ৳${after} (${j1.status()}/${j2.status()})`);
    check('  ↳ খতিয়ান অটুট', await ledgerOk(user.id));
    for (const [amt, label] of [[0, 'শূন্য'], [-999999, 'বিশাল ঋণাত্মক'], [99_999_999, 'বিশাল ধনাত্মক']] as const) {
      const r = await post(admin, '/api/admin/user', { userId: user.id, amount: amt, note: `সীমা: ${label}` });
      check(`${label} অঙ্কের সমন্বয় প্রত্যাখ্যাত`, r.status() >= 400, `HTTP ${r.status()}`);
    }
    check('সীমা-পরীক্ষার পরেও খতিয়ান অটুট', await ledgerOk(user.id));
    check('ব্যালেন্স ঋণাত্মক নয়', Number((await db.user.findUniqueOrThrow({ where: { id: user.id } })).balance) >= 0);
  } finally {
    await Promise.all([admin.dispose(), admin2.dispose(), cust.dispose()]);
    const ids = (await db.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    if (ids.length) {
      await db.review.deleteMany({ where: { userId: { in: ids } } });
      await db.orderEvent.deleteMany({ where: { order: { userId: { in: ids } } } });
      await db.notification.deleteMany({ where: { userId: { in: ids } } });
      await db.adminLog.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { targetId: { in: ids } }] } });
      await db.withdrawal.deleteMany({ where: { userId: { in: ids } } });
      await db.deposit.deleteMany({ where: { userId: { in: ids } } });
      await db.ledgerEntry.deleteMany({ where: { userId: { in: ids } } });
      await db.order.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
    await db.rateLimitBucket.deleteMany({});
  }

  console.log(`\n════ ${pass} পাস · ${fails.length} ব্যর্থ ════`);
  if (fails.length) { console.log(fails.join('\n')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
