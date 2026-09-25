/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ধাপ ৩ — ৳ মিলানো (কেবল পড়া, একটি সারিও লেখে না)
 *
 *   খতিয়ানকে তিন দিক থেকে যাচাই:
 *     ১. প্রতি ইউজার — balance = Σখতিয়ান = শেষ balanceAfter, আর
 *        balanceAfter-এর চলমান যোগফল-শিকল অবিচ্ছিন্ন।
 *     ২. প্রতি উৎস — প্রতিটি খতিয়ান-সারি ঠিক একটি বৈধ উৎস-সারিতে
 *        (Deposit/Order/Withdrawal) বাঁধা, অঙ্ক হুবহু মেলে, ডুপ্লিকেট নেই।
 *     ৩. সামগ্রিক — Σbalance = জমা + বোনাস + সমন্বয় + ফেরত + উল্টানো
 *        − অর্ডার − প্রত্যাহার।
 *   প্লাস HTTP-প্রমাণ (business-day.json) বনাম DB — ফ্যান্টম/হারানো অর্ডার।
 *
 *   সব অঙ্ক Postgres `numeric`-এ যোগ হয় (float নয়), তুলনা পয়সায় হুবহু।
 *   ফল: audit/sim/reconciliation.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, saveJson, tk } from './_lib';
import { existsSync, readFileSync } from 'node:fs';

type Row = Record<string, any>;
const q = async (sql: string): Promise<Row[]> => {
  const rows = await db.$queryRawUnsafe<Row[]>(sql);
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v && typeof v === 'object' && 'toFixed' in v ? String(v) : v])));
};
const one = async (sql: string) => (await q(sql))[0];

const results: Array<{ test: string; expected: string; actual: string; pass: boolean }> = [];
function assert(test: string, expected: string, actual: string | number, pass: boolean) {
  results.push({ test, expected, actual: String(actual), pass });
  console.log(`  ${pass ? '✓' : '✗'} ${test} — প্রত্যাশিত ${expected}, প্রকৃত ${actual}`);
}

async function main() {
  console.log('═══ ১. প্রতি-ইউজার অখণ্ডতা ═══');
  const perUser = await one(`
    WITH l AS (SELECT "userId", SUM(amount) s, COUNT(*) n FROM "LedgerEntry" GROUP BY "userId"),
    last AS (SELECT DISTINCT ON ("userId") "userId", "balanceAfter" FROM "LedgerEntry" ORDER BY "userId", "createdAt" DESC, id DESC)
    SELECT
      COUNT(*) users,
      COUNT(*) FILTER (WHERE u.balance <> COALESCE(l.s, 0)) bal_ne_sum,
      COUNT(*) FILTER (WHERE last."userId" IS NOT NULL AND u.balance <> last."balanceAfter") bal_ne_last,
      COUNT(*) FILTER (WHERE u.balance < 0) negative,
      SUM(u.balance) total_balance
    FROM "User" u LEFT JOIN l ON l."userId" = u.id LEFT JOIN last ON last."userId" = u.id`);
  assert('balance ≠ Σখতিয়ান এমন ইউজার', '0', perUser.bal_ne_sum, perUser.bal_ne_sum === 0);
  assert('balance ≠ শেষ balanceAfter এমন ইউজার', '0', perUser.bal_ne_last, perUser.bal_ne_last === 0);
  assert('ঋণাত্মক ব্যালেন্স', '0', perUser.negative, perUser.negative === 0);

  // চলমান-যোগফল শিকল: প্রতিটি সারির balanceAfter = আগের সব সারির যোগফল
  const chain = await one(`
    SELECT COUNT(*) breaks FROM (
      SELECT "balanceAfter", SUM(amount) OVER (PARTITION BY "userId" ORDER BY "createdAt", id) run FROM "LedgerEntry"
    ) x WHERE "balanceAfter" <> run`);
  assert('balanceAfter-শিকলে ভাঙন (createdAt,id ক্রমে)', '0', chain.breaks, chain.breaks === 0);
  const zero = await one(`SELECT COUNT(*) n FROM "LedgerEntry" WHERE amount = 0`);
  assert('শূন্য-অঙ্কের খতিয়ান-সারি', '0', zero.n, zero.n === 0);
  const frac = await one(`SELECT COUNT(*) n FROM "LedgerEntry" WHERE amount <> ROUND(amount, 2) OR "balanceAfter" <> ROUND("balanceAfter", 2)`);
  assert('২ দশমিকের বেশি (float-চিহ্ন)', '0', frac.n, frac.n === 0);

  console.log('\n═══ ২. উৎস-বন্ধন ═══');
  // DEPOSIT
  const dep = await one(`
    SELECT
      (SELECT COUNT(*) FROM "Deposit" WHERE status='APPROVED') approved,
      (SELECT COUNT(*) FROM "LedgerEntry" WHERE type='DEPOSIT') ledger_rows,
      (SELECT COUNT(*) FROM (SELECT "refId" FROM "LedgerEntry" WHERE type='DEPOSIT' GROUP BY "refId" HAVING COUNT(*)>1) d) dup,
      (SELECT COUNT(*) FROM "LedgerEntry" l LEFT JOIN "Deposit" d ON d.id=l."refId" WHERE l.type='DEPOSIT' AND (d.id IS NULL OR d.status<>'APPROVED' OR d.amount<>l.amount OR d."userId"<>l."userId")) bad,
      (SELECT COUNT(*) FROM "Deposit" d WHERE d.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" l WHERE l.type='DEPOSIT' AND l."refId"=d.id)) missing,
      (SELECT COALESCE(SUM(amount),0) FROM "Deposit" WHERE status='APPROVED') approved_sum,
      (SELECT COALESCE(SUM(amount),0) FROM "LedgerEntry" WHERE type='DEPOSIT') ledger_sum`);
  assert('অনুমোদিত ডিপোজিট = DEPOSIT খতিয়ান-সারি', String(dep.approved), dep.ledger_rows, dep.approved === dep.ledger_rows);
  assert('একই ডিপোজিটে একাধিক ক্রেডিট', '0', dep.dup, dep.dup === 0);
  assert('DEPOSIT সারি যার উৎস অবৈধ/অঙ্ক-অমিল/অননুমোদিত', '0', dep.bad, dep.bad === 0);
  assert('অনুমোদিত কিন্তু ক্রেডিট হয়নি', '0', dep.missing, dep.missing === 0);
  assert('Σঅনুমোদিত = ΣDEPOSIT খতিয়ান', tk(Number(dep.approved_sum)), tk(Number(dep.ledger_sum)), dep.approved_sum === dep.ledger_sum);

  // ORDER
  const ord = await one(`
    SELECT
      (SELECT COUNT(*) FROM "Order" WHERE status <> 'AWAITING_PAYMENT') paid_orders,
      (SELECT COUNT(*) FROM "LedgerEntry" WHERE type='ORDER') ledger_rows,
      (SELECT COUNT(*) FROM (SELECT "refId" FROM "LedgerEntry" WHERE type='ORDER' GROUP BY "refId" HAVING COUNT(*)>1) d) dup,
      (SELECT COUNT(*) FROM "LedgerEntry" l LEFT JOIN "Order" o ON o.id=l."refId" WHERE l.type='ORDER' AND (o.id IS NULL OR -l.amount<>o.price OR o."userId"<>l."userId")) bad,
      (SELECT COUNT(*) FROM "Order" o WHERE o.status<>'AWAITING_PAYMENT' AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" l WHERE l.type='ORDER' AND l."refId"=o.id)) orphan_orders,
      (SELECT COUNT(*) FROM "Order" WHERE price <> subtotal - discount OR price < 0 OR discount < 0) price_math,
      (SELECT COUNT(*) FROM (SELECT "userId","clientRef" FROM "Order" WHERE "clientRef" IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)>1) d) dup_ref`);
  assert('টাকা-কাটা অর্ডার = ORDER খতিয়ান-সারি', String(ord.paid_orders), ord.ledger_rows, ord.paid_orders === ord.ledger_rows);
  assert('একই অর্ডারে একাধিক কাটা (ডাবল চার্জ)', '0', ord.dup, ord.dup === 0);
  assert('ORDER সারি যার অঙ্ক ≠ অর্ডারের দাম', '0', ord.bad, ord.bad === 0);
  assert('খতিয়ান ছাড়া অর্ডার (অনাথ)', '0', ord.orphan_orders, ord.orphan_orders === 0);
  assert('price ≠ subtotal − discount', '0', ord.price_math, ord.price_math === 0);
  assert('একই clientRef-এ একাধিক অর্ডার', '0', ord.dup_ref, ord.dup_ref === 0);

  // REFUND
  const ref = await one(`
    WITH r AS (SELECT "refId", SUM(amount) s, COUNT(*) n FROM "LedgerEntry" WHERE type='REFUND' GROUP BY "refId")
    SELECT
      (SELECT COUNT(*) FROM r LEFT JOIN "Order" o ON o.id=r."refId" WHERE o.id IS NULL) orphan,
      (SELECT COUNT(*) FROM "Order" o LEFT JOIN r ON r."refId"=o.id WHERE o."refundedAmount" <> COALESCE(r.s,0)) mismatch,
      (SELECT COUNT(*) FROM "Order" WHERE "refundedAmount" > price) over_refund,
      (SELECT COUNT(*) FROM "Order" WHERE status='REFUNDED' AND "refundedAmount" <> price) refunded_not_full,
      (SELECT COUNT(*) FROM r JOIN "Order" o ON o.id=r."refId" WHERE o.status NOT IN ('REFUNDED','COMPLETED')) refund_on_open`);
  assert('REFUND সারি যার অর্ডার নেই', '0', ref.orphan, ref.orphan === 0);
  assert('Order.refundedAmount ≠ ΣREFUND খতিয়ান', '0', ref.mismatch, ref.mismatch === 0);
  assert('দামের বেশি ফেরত (ডাবল রিফান্ড)', '0', ref.over_refund, ref.over_refund === 0);
  assert('REFUNDED অবস্থা কিন্তু পুরো টাকা ফেরত নয়', '0', ref.refunded_not_full, ref.refunded_not_full === 0);
  assert('চলমান অর্ডারে ফেরত', '0', ref.refund_on_open, ref.refund_on_open === 0);

  // WITHDRAWAL
  const wd = await one(`
    SELECT
      (SELECT COUNT(*) FROM "Withdrawal") total,
      (SELECT COUNT(*) FROM "LedgerEntry" WHERE type='WITHDRAWAL') debit_rows,
      (SELECT COUNT(*) FROM "LedgerEntry" l LEFT JOIN "Withdrawal" w ON w.id=l."refId" WHERE l.type='WITHDRAWAL' AND (w.id IS NULL OR -l.amount<>w.amount)) bad_debit,
      (SELECT COUNT(*) FROM (SELECT "refId" FROM "LedgerEntry" WHERE type='WITHDRAWAL' GROUP BY 1 HAVING COUNT(*)>1) d) dup_debit,
      (SELECT COUNT(*) FROM "Withdrawal" WHERE status='REJECTED') rejected,
      (SELECT COUNT(*) FROM "LedgerEntry" WHERE type='WITHDRAWAL_REVERSAL') reversal_rows,
      (SELECT COUNT(*) FROM "LedgerEntry" l LEFT JOIN "Withdrawal" w ON w.id=l."refId" WHERE l.type='WITHDRAWAL_REVERSAL' AND (w.id IS NULL OR w.status<>'REJECTED' OR l.amount<>w.amount)) bad_reversal,
      (SELECT COUNT(*) FROM "Withdrawal" WHERE status='APPROVED' AND ("payoutRef" IS NULL OR "payoutRef"='')) approved_no_ref`);
  assert('প্রত্যাহার = WITHDRAWAL কাটা-সারি', String(wd.total), wd.debit_rows, wd.total === wd.debit_rows);
  assert('অবৈধ/অমিল WITHDRAWAL সারি', '0', wd.bad_debit, wd.bad_debit === 0);
  assert('একই প্রত্যাহারে দুবার কাটা', '0', wd.dup_debit, wd.dup_debit === 0);
  assert('প্রত্যাখ্যাত = উল্টানো-সারি', String(wd.rejected), wd.reversal_rows, wd.rejected === wd.reversal_rows);
  assert('অবৈধ উল্টানো (অপ্রত্যাখ্যাত/অঙ্ক-অমিল)', '0', wd.bad_reversal, wd.bad_reversal === 0);
  assert('পেআউট-রেফ ছাড়া অনুমোদিত প্রত্যাহার', '0', wd.approved_no_ref, wd.approved_no_ref === 0);

  // REFERRAL
  const refb = await one(`
    SELECT
      (SELECT COUNT(*) FROM "LedgerEntry" WHERE type='REFERRAL_BONUS') rows,
      (SELECT COALESCE(SUM(amount),0) FROM "LedgerEntry" WHERE type='REFERRAL_BONUS') sum,
      (SELECT COUNT(*) FROM "User" WHERE "referralBonusPaid") flagged,
      (SELECT COUNT(*) FROM (SELECT "refId" FROM "LedgerEntry" WHERE type='REFERRAL_BONUS' GROUP BY 1 HAVING COUNT(*)>1) d) dup`);
  assert('রেফারেল-বোনাস সারি = বোনাস-প্রাপ্ত চিহ্নিত রেফারি', String(refb.flagged), refb.rows, refb.rows === refb.flagged);
  assert('একই রেফারিতে একাধিক বোনাস', '0', refb.dup, refb.dup === 0);

  // কুপন ও স্টক
  const cp = await one(`
    SELECT
      (SELECT COUNT(*) FROM "Coupon" c WHERE c."usageCount" <> (SELECT COUNT(*) FROM "CouponUse" u WHERE u."couponId"=c.id)) count_mismatch,
      (SELECT COUNT(*) FROM "Coupon" WHERE "usageLimit" IS NOT NULL AND "usageCount" > "usageLimit") over_limit,
      (SELECT COUNT(*) FROM (SELECT u."couponId", u."userId", c."perUserLimit" lim, COUNT(*) n FROM "CouponUse" u JOIN "Coupon" c ON c.id=u."couponId" GROUP BY 1,2,3) x WHERE n > lim) per_user_over,
      (SELECT COUNT(*) FROM "Variant" WHERE stock < -1) bad_stock`);
  assert('কুপন usageCount ≠ ব্যবহার-সারি', '0', cp.count_mismatch, cp.count_mismatch === 0);
  assert('কুপন সীমা ছাড়িয়েছে', '0', cp.over_limit, cp.over_limit === 0);
  assert('প্রতি-ইউজার কুপন-সীমা ছাড়িয়েছে', '0', cp.per_user_over, cp.per_user_over === 0);
  assert('ঋণাত্মক স্টক (−1 = সীমাহীন ছাড়া)', '0', cp.bad_stock, cp.bad_stock === 0);

  // অবস্থা-যন্ত্র
  const sm = await one(`
    SELECT
      (SELECT COUNT(*) FROM "Order" WHERE status IN ('COMPLETED','REFUNDED','FAILED') AND "completedAt" IS NULL) final_no_time,
      (SELECT COUNT(*) FROM "Order" o WHERE NOT EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."orderId"=o.id)) no_events,
      (SELECT COUNT(*) FROM "Order" o WHERE o.status::text <> (SELECT e.status::text FROM "OrderEvent" e WHERE e."orderId"=o.id ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1)) last_event_mismatch,
      (SELECT COUNT(*) FROM "OrderEvent" a JOIN "OrderEvent" b ON a."orderId"=b."orderId" AND b."createdAt" > a."createdAt"
         WHERE a.status IN ('COMPLETED','REFUNDED','FAILED') AND b.status <> a.status) after_final`);
  assert('চূড়ান্ত অবস্থা কিন্তু completedAt নেই', '0', sm.final_no_time, sm.final_no_time === 0);
  assert('ঘটনাপঞ্জি ছাড়া অর্ডার', '0', sm.no_events, sm.no_events === 0);
  assert('অর্ডারের অবস্থা ≠ শেষ ঘটনার অবস্থা', '0', sm.last_event_mismatch, sm.last_event_mismatch === 0);
  assert('চূড়ান্ত অবস্থার পরে ভিন্ন অবস্থায় যাওয়া', '0', sm.after_final, sm.after_final === 0);

  console.log('\n═══ ৩. সামগ্রিক সংরক্ষণ-সূত্র ═══');
  const byType = await q(`SELECT type::text t, COUNT(*) n, SUM(amount) s FROM "LedgerEntry" GROUP BY 1 ORDER BY 1`);
  const T = (t: string) => Number(byType.find((r) => r.t === t)?.s ?? 0);
  const ledgerTotal = await one(`SELECT COALESCE(SUM(amount),0) s FROM "LedgerEntry"`);
  const exact = await one(`SELECT (SELECT COALESCE(SUM(balance),0) FROM "User") = (SELECT COALESCE(SUM(amount),0) FROM "LedgerEntry") eq`);
  assert('Σসব ব্যালেন্স = Σসব খতিয়ান (numeric-এ হুবহু)', tk(Number(ledgerTotal.s)), tk(Number(perUser.total_balance)), exact.eq === true);
  console.log('  খতিয়ান ধরন-অনুযায়ী:');
  for (const r of byType) console.log(`    ${r.t.padEnd(20)} ${String(r.n).padStart(7)} সারি  ${tk(Number(r.s)).padStart(20)}`);

  // ── ব্যবসার অঙ্ক ──
  const os = await q(`SELECT status::text s, COUNT(*) n, SUM(price) v, SUM("refundedAmount") r, SUM("costPrice") c, SUM(discount) d FROM "Order" GROUP BY 1 ORDER BY 1`);
  const O = (s: string) => os.find((r) => r.s === s) ?? { n: 0, v: 0, r: 0, c: 0, d: 0 };
  const ds = await q(`SELECT status::text s, COUNT(*) n, SUM(amount) v FROM "Deposit" GROUP BY 1 ORDER BY 1`);
  const ws = await q(`SELECT status::text s, COUNT(*) n, SUM(amount) v FROM "Withdrawal" GROUP BY 1 ORDER BY 1`);
  const D = (s: string) => ds.find((r) => r.s === s) ?? { n: 0, v: 0 };
  const W = (s: string) => ws.find((r) => r.s === s) ?? { n: 0, v: 0 };
  const completed = O('COMPLETED');
  const revenue = Number(completed.v) - Number(completed.r);
  const cost = Number(completed.c);
  const totalOrderValue = os.reduce((s, r) => s + Number(r.v), 0);
  const summary = {
    moneyIn_approvedDeposits: Number(D('APPROVED').v), depositsApproved: D('APPROVED').n,
    depositsRejected: D('REJECTED').n, depositsRejectedValue: Number(D('REJECTED').v ?? 0),
    depositsPending: D('PENDING').n, depositsPendingValue: Number(D('PENDING').v ?? 0),
    referralBonus: T('REFERRAL_BONUS'), adminAdjust: T('ADMIN_ADJUST'),
    orders: os.reduce((s, r) => s + r.n, 0), totalOrderValue,
    ordersByStatus: Object.fromEntries(os.map((r) => [r.s, { n: r.n, value: Number(r.v), refunded: Number(r.r), discount: Number(r.d) }])),
    totalRefunded: T('REFUND'), totalDiscount: os.reduce((s, r) => s + Number(r.d), 0),
    platformRevenue_completedNetOfPartialRefunds: revenue, costOfGoods_completed: cost, grossMargin: revenue - cost,
    openOrderLiability: Number(O('PENDING').v) + Number(O('PROCESSING').v),
    withdrawals: Object.fromEntries(ws.map((r) => [r.s, { n: r.n, value: Number(r.v) }])),
    withdrawnPaidOut: Number(W('APPROVED').v), withdrawalPendingLiability: Number(W('PENDING').v) + Number(W('HELD').v),
    customerWalletLiability: Number(perUser.total_balance),
    ledgerByType: Object.fromEntries(byType.map((r) => [r.t, { rows: r.n, sum: Number(r.s) }])),
  };
  // সূত্র: ঢোকা টাকা = ওয়ালেটে থাকা + ডেলিভারি-পাওনা + আয়-স্বীকৃত + প্রত্যাহার
  const inflow = summary.moneyIn_approvedDeposits + summary.referralBonus + summary.adminAdjust;
  const accounted = summary.customerWalletLiability + summary.openOrderLiability + revenue
    + summary.withdrawnPaidOut + summary.withdrawalPendingLiability;
  const unresolved = Math.round((inflow - accounted) * 100) / 100;
  assert('অমীমাংসিত টাকা = ঢোকা − (ওয়ালেট + চলমান অর্ডার + আয় + প্রত্যাহার)', '৳0.00', tk(unresolved), unresolved === 0);

  // ── HTTP-প্রমাণ বনাম DB ──
  if (existsSync('audit/sim/business-day.json')) {
    console.log('\n═══ ৪. HTTP উত্তর বনাম DB ═══');
    const day = JSON.parse(readFileSync('audit/sim/business-day.json', 'utf8'));
    const ok200 = new Set<string>(day.orderLog.filter((o: any) => o.status === 200 && o.orderId).map((o: any) => o.orderId));
    const dbSim = await q(`SELECT o.id FROM "Order" o JOIN "User" u ON u.id=o."userId" WHERE u.email LIKE 'sim-%@sim.invalid' AND o."clientRef" LIKE 'sim-%'`);
    const dbSet = new Set(dbSim.map((r) => r.id as string));
    const phantom = [...dbSet].filter((id) => !ok200.has(id));
    const lost = [...ok200].filter((id) => !dbSet.has(id));
    assert('DB-তে আছে কিন্তু কোনো 200 উত্তর দেয়নি (ফ্যান্টম অর্ডার)', '0', phantom.length, phantom.length === 0);
    assert('200 উত্তর দিয়েছে কিন্তু DB-তে নেই (হারানো অর্ডার)', '0', lost.length, lost.length === 0);
    const rejectedCodes = day.orderLog.filter((o: any) => o.status !== 200 && o.kind !== 'normal').length;
    const leaked = await one(`SELECT COUNT(*) n FROM "Order" WHERE "clientRef" ~ '(x|i|t)$' AND "clientRef" LIKE 'sim-%'`);
    assert('প্রত্যাখ্যাত ভুল-অনুরোধ (খারাপ UID/অপর্যাপ্ত/জাল দাম) থেকে অর্ডার', '0', `${leaked.n} (মোট ${rejectedCodes} প্রত্যাখ্যাত)`, leaked.n === 0);
    if (day.priceChanged) {
      const pc = day.priceChanged;
      const staleCharged = await one(`SELECT COUNT(*) n FROM "Order" WHERE "variantId"=${pc.id} AND subtotal=${pc.before} AND "createdAt" > (SELECT MIN("createdAt") FROM "AdminLog" WHERE action='PRICE_CHANGE')`);
      assert('দাম বদলের পরে পুরনো দামে অর্ডার', '0', staleCharged.n, staleCharged.n === 0);
    }
  }

  const failed = results.filter((r) => !r.pass);
  saveJson('reconciliation.json', { at: new Date().toISOString(), results, summary, unresolved });
  console.log('\n═══ সারাংশ ═══');
  for (const [k, v] of Object.entries(summary)) if (typeof v === 'number') console.log(`  ${k.padEnd(48)} ${k.match(/orders$|Approved$|Rejected$|Pending$/) ? v : tk(v)}`);
  console.log(`\n${failed.length ? '✗' : '✓'} ${results.length - failed.length}/${results.length} দাবি পাস`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
