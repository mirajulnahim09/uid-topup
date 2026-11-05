/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রেস ও প্রান্ত-অবস্থা — আসল HTTP দিয়ে (EXTREME রেড-টিম, ২০২৬-০৯-২১)
 *
 *   আগের `state-machine` স্যুট যা **ঢাকেনি**, কেবল সেগুলো:
 *
 *     ক. ডেলিভারি-নিশ্চিতকরণ — "পেয়েছি" ও "পাইনি" **একসাথে** (আগে কেবল পরপর)
 *     খ. টিকিট — গ্রাহক বন্ধ করছেন ঠিক যখন অ্যাডমিন উত্তর দিচ্ছেন
 *     গ. অ্যাডমিন FAIL (রিফান্ড) ও একই গ্রাহকের নতুন অর্ডার একই প্যাকেজে
 *        **একসাথে** — লক-ক্রম উল্টো হলে deadlock (৫০০)
 *     ঘ. পুরো-ছাড়ের কুপন (ছাড় ≥ দাম) — প্রিভিউ ৳০ দেখায়, অর্ডার কী বলে
 *
 *   প্রতিটি ধাপের পরে খতিয়ান-অখণ্ডতা (যোগফল = ব্যালেন্স) মেলানো হয়।
 *   সব সারি শেষে মুছে ফেলা হয় — কেবল স্থানীয় ডেভ DB (`_db` নিশ্চিত করে)।
 *
 *   চালানো: npx tsx scripts/verify/race-redteam.ts   (next dev :3000 চালু থাকতে হবে)
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { creditWallet } from '../../src/lib/services/wallet';
import { request, type APIRequestContext } from 'playwright-core';
import bcrypt from 'bcryptjs';

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const TAG = `rr-${Date.now().toString(36)}`;
const PASSWORD = 'RaceRedTeam2026x';
const ROUNDS = Number(process.env.RACE_ROUNDS || 6);

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
const patch = (ctx: APIRequestContext, p: string, data: unknown) =>
  ctx.patch(`${BASE}${p}`, { data, failOnStatusCode: false, timeout: 60_000 });

async function ledgerOk(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
  const s = await db.ledgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
  return Math.abs(Number(u!.balance) - Number(s._sum.amount ?? 0)) < 0.001;
}

async function main() {
  console.log(`═══ রেস ও প্রান্ত-অবস্থা · ${BASE} · DB ${dbLabel()} · rounds=${ROUNDS} ═══`);

  // ── নিজস্ব প্যাকেজ — সীমিত স্টক (FAIL-পথ তখনই variant রো লক করে) ──
  const category = await db.category.findFirstOrThrow({ where: { isActive: true } });
  const product = await db.product.create({
    data: { categoryId: category.id, name: `রেস-যাচাই ${TAG}`, slug: TAG, needsUid: true, isActive: true },
  });
  const STOCK0 = 10_000;
  const variant = await db.variant.create({
    data: { productId: product.id, label: '১০ ডায়মন্ড', price: 10, costPrice: 8, stock: STOCK0, isActive: true },
  });

  const admin = await login(ADMIN);
  const user = await db.user.create({
    data: {
      name: 'রেস-যাচাই', email: `${TAG}@verify.local`, phone: `016${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(PASSWORD, 10), emailVerified: true, referralCode: TAG.toUpperCase().slice(0, 12),
    },
  });
  await db.$transaction((tx) => creditWallet({ tx, userId: user.id, amount: 5000, type: 'ADMIN_ADJUST', note: 'রেস-যাচাই' }));
  const cust = await login({ email: user.email, password: PASSWORD });

  let seq = 0;
  const placeOrder = async (): Promise<string> => {
    await db.rateLimitBucket.deleteMany({});
    const r = await post(cust, '/api/order', { variantId: variant.id, playerUid: `9${String(++seq).padStart(9, '0')}`, clientRef: `${TAG}-${seq}` });
    const j = await r.json();
    if (!j.orderId) throw new Error(`অর্ডার হয়নি: ${r.status()} ${JSON.stringify(j).slice(0, 160)}`);
    return j.orderId as string;
  };

  try {
    /* ── ক. ডেলিভারি-নিশ্চিতকরণ: "পেয়েছি" + "পাইনি" একসাথে ── */
    console.log('\n── ক. ডেলিভারি-নিশ্চিতকরণ — দুই উত্তর একসাথে ──');
    let bothSet = 0; let bothOk = 0; let dupEvents = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const o = await placeOrder();
      const done = await post(admin, '/api/admin/order', { orderId: o, action: 'COMPLETE' });
      if (done.status() !== 200) throw new Error(`COMPLETE হয়নি: ${done.status()}`);
      const [a, b] = await Promise.all([
        post(cust, '/api/order/confirm', { orderId: o, arrived: true }),
        post(cust, '/api/order/confirm', { orderId: o, arrived: false }),
      ]);
      if (a.status() === 200 && b.status() === 200) bothOk++;
      const row = await db.order.findUniqueOrThrow({ where: { id: o } });
      if (row.deliveryConfirmedAt && row.deliveryDisputedAt) bothSet++;
      const ev = await db.orderEvent.count({ where: { orderId: o, actorType: 'CUSTOMER', status: 'COMPLETED' } });
      if (ev > 1) dupEvents++;
    }
    check('দুই উত্তর একসাথে — একটিই গৃহীত', bothOk === 0, `${bothOk}/${ROUNDS} রাউন্ডে দুটোই ২০০`);
    check('  ↳ অর্ডার কখনো একসাথে "পেয়েছি" ও "পাইনি" নয়', bothSet === 0, `${bothSet}/${ROUNDS} অর্ডারে দুটোই বসেছে`);
    check('  ↳ গ্রাহকের উত্তর-ইভেন্ট একটিই', dupEvents === 0, `${dupEvents}/${ROUNDS} অর্ডারে ডুপ্লিকেট`);

    /* ── খ. টিকিট: বন্ধ করা ও উত্তর একসাথে ── */
    console.log('\n── খ. টিকিট — বন্ধ ও উত্তর একসাথে ──');
    let reopened = 0; let replyAfterClose = 0;
    for (let i = 0; i < ROUNDS; i++) {
      await db.rateLimitBucket.deleteMany({});
      const t = await post(cust, '/api/tickets', { subject: `রেস-টিকিট ${i}`, body: 'পরীক্ষামূলক বার্তা' });
      const tj = await t.json();
      const id = tj?.ticket?.id ?? tj?.id;
      if (!id) throw new Error(`টিকিট হয়নি: ${t.status()} ${JSON.stringify(tj).slice(0, 160)}`);
      await Promise.all([
        patch(cust, `/api/tickets/${id}`, {}),
        post(admin, '/api/admin/tickets', { id, body: 'অ্যাডমিনের উত্তর' }),
      ]);
      const row = await db.ticket.findUniqueOrThrow({ where: { id } });
      if (row.closedAt && row.status !== 'CLOSED') reopened++;
      // বন্ধ-বার্তার **পরে** লেখা উত্তর = বন্ধ টিকিটে উত্তর
      const msgs = await db.ticketMessage.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } });
      const closeIdx = msgs.findIndex((m) => m.body.startsWith('— টিকিটটি বন্ধ'));
      if (closeIdx >= 0 && msgs.slice(closeIdx + 1).some((m) => m.isStaff)) replyAfterClose++;
    }
    check('বন্ধ টিকিট নিজে থেকে আবার খোলে না (closedAt থাকলে status=CLOSED)', reopened === 0, `${reopened}/${ROUNDS} টিকিটে অসঙ্গত অবস্থা`);
    check('  ↳ বন্ধ-বার্তার পরে কোনো উত্তর জমা হয় না', replyAfterClose === 0, `${replyAfterClose}/${ROUNDS}`);

    /* ── গ. অ্যাডমিন FAIL ও নতুন অর্ডার একসাথে (একই গ্রাহক, একই প্যাকেজ) ── */
    console.log('\n── গ. রিফান্ড ও নতুন অর্ডার একসাথে — deadlock? ──');
    const N = 12;
    let serverErrors = 0; let totalFailOk = 0; let totalNewOk = 0;
    const statuses: Record<string, number> = {};
    for (let round = 0; round < Math.max(2, Math.ceil(ROUNDS / 2)); round++) {
      const pending: string[] = [];
      for (let i = 0; i < N; i++) pending.push(await placeOrder());
      await db.rateLimitBucket.deleteMany({});
      const jobs: Promise<{ kind: string; status: number }>[] = [];
      for (let i = 0; i < N; i++) {
        jobs.push(post(admin, '/api/admin/order', { orderId: pending[i], action: 'FAIL', failReason: 'OTHER', adminNote: 'রেস-পরীক্ষা' })
          .then((r) => ({ kind: 'fail', status: r.status() })));
        jobs.push(post(cust, '/api/order', { variantId: variant.id, playerUid: `8${String(++seq).padStart(9, '0')}`, clientRef: `${TAG}-n${seq}` })
          .then((r) => ({ kind: 'new', status: r.status() })));
      }
      const res = await Promise.all(jobs);
      for (const r of res) {
        statuses[`${r.kind}:${r.status}`] = (statuses[`${r.kind}:${r.status}`] ?? 0) + 1;
        if (r.status >= 500) serverErrors++;
        if (r.kind === 'fail' && r.status === 200) totalFailOk++;
        if (r.kind === 'new' && r.status === 200) totalNewOk++;
      }
    }
    check('সমান্তরাল রিফান্ড + নতুন অর্ডারে কোনো ৫০০ নেই', serverErrors === 0, `${serverErrors}টি ৫xx · ${JSON.stringify(statuses)}`);
    const refunds = await db.order.count({ where: { variantId: variant.id, status: 'REFUNDED' } });
    const live = await db.order.count({ where: { variantId: variant.id, status: { not: 'REFUNDED' } } });
    const v = await db.variant.findUniqueOrThrow({ where: { id: variant.id } });
    check('  ↳ স্টক = শুরু − চালু অর্ডার (রিফান্ডে ফেরত)', v.stock === STOCK0 - live, `stock=${v.stock}, শুরু=${STOCK0}, চালু=${live}, ফেরত=${refunds}`);
    check('  ↳ খতিয়ান অটুট', await ledgerOk(user.id));

    /* ── ঘ. পুরো-ছাড়ের কুপন ── */
    console.log('\n── ঘ. ছাড় ≥ দাম — কুপন ──');
    const code = `RR${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    await db.coupon.create({ data: { code, type: 'FIXED', value: 50, minOrder: 0, perUserLimit: 5, isActive: true } });
    await db.rateLimitBucket.deleteMany({});
    const prev = await post(cust, '/api/coupon/check', { code, variantId: variant.id });
    const pj = await prev.json();
    console.log(`     প্রিভিউ: HTTP ${prev.status()} · ${JSON.stringify(pj).slice(0, 200)}`);
    const balBefore = Number((await db.user.findUniqueOrThrow({ where: { id: user.id } })).balance);
    const ord = await post(cust, '/api/order', { variantId: variant.id, playerUid: '7000000001', couponCode: code, clientRef: `${TAG}-cpn` });
    const oj = await ord.json();
    console.log(`     অর্ডার:  HTTP ${ord.status()} · ${JSON.stringify(oj).slice(0, 200)}`);
    const previewSaysPayable = prev.status() === 200;
    const orderOk = ord.status() === 200;
    check('প্রিভিউ ও অর্ডার একই কথা বলে (প্রিভিউ গ্রহণ করলে অর্ডারও হয়)', previewSaysPayable === orderOk,
      `প্রিভিউ ${prev.status()}, অর্ডার ${ord.status()}`);
    check('  ↳ ব্যর্থ হলে বার্তাটি গ্রাহকের বোঝার মতো (ভেতরের "অঙ্ক" বার্তা নয়)',
      orderOk || !String(oj.error ?? '').includes('অঙ্ক শূন্যের বেশি'), String(oj.error ?? ''));
    const balAfter = Number((await db.user.findUniqueOrThrow({ where: { id: user.id } })).balance);
    check('  ↳ ব্যর্থ হলে টাকা কাটেনি', orderOk || balAfter === balBefore, `${balBefore} → ${balAfter}`);
    check('  ↳ খতিয়ান অটুট', await ledgerOk(user.id));
    await db.couponUse.deleteMany({ where: { coupon: { code } } });
    await db.coupon.deleteMany({ where: { code } });
  } finally {
    // ── পরিষ্কার — কেবল এই রানের সারি ──
    const orderIds = (await db.order.findMany({ where: { userId: user.id }, select: { id: true } })).map((o) => o.id);
    await db.review.deleteMany({ where: { userId: user.id } });
    await db.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.ticketMessage.deleteMany({ where: { ticket: { userId: user.id } } });
    await db.ticket.deleteMany({ where: { userId: user.id } });
    await db.couponUse.deleteMany({ where: { userId: user.id } });
    await db.order.deleteMany({ where: { userId: user.id } });
    await db.notification.deleteMany({ where: { userId: user.id } });
    await db.ledgerEntry.deleteMany({ where: { userId: user.id } });
    await db.adminLog.deleteMany({ where: { adminId: user.id } }).catch(() => {});
    await db.user.delete({ where: { id: user.id } });
    await db.variant.delete({ where: { id: variant.id } });
    await db.product.delete({ where: { id: product.id } });
    await db.rateLimitBucket.deleteMany({});
    await admin.dispose(); await cust.dispose();
  }

  console.log(`\n═══ ফল: ${pass} পাস · ${fails.length} ব্যর্থ ═══`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  await db.$disconnect();
  process.exit(fails.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(2);
});
