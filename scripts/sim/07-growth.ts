/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ধাপ ৭ — ডাটা-বৃদ্ধি: ~৫০k → ১ লাখ → ৫ লাখ অর্ডার
 *
 *   ঐতিহাসিক অর্ডার SQL-এ তৈরি (HTTP দিয়ে ৫ লাখ বানাতে ঘণ্টা লাগত) —
 *   কিন্তু **খতিয়ান-সঙ্গত**: প্রতিটি অর্ডারের সাথে একটি অনুমোদিত
 *   ডিপোজিট, DEPOSIT(+দাম) ও ORDER(−দাম) সারি, দুটি ঘটনা। ফলে
 *   `03-reconcile.ts` বৃদ্ধির পরেও সবুজ থাকতে হবে — সেটিও একটি পরীক্ষা।
 *   সব সারি ১০০ জন `grow-*@sim.invalid` গ্রাহকের, শেষে ব্যালেন্স ০।
 *
 *   প্রতিটি আকারে অ্যাডমিন/গ্রাহকের ভারী পাতা ও API ৫ বার মাপা হয়।
 *   ফল: audit/sim/growth.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, call, mintCookie, saveJson } from './_lib';
import bcrypt from 'bcryptjs';

const TARGETS = (process.env.GROW_TARGETS || '100000,500000').split(',').map(Number);
const GROW_USERS = 100;

async function ensureGrowUsers() {
  const have = await db.user.count({ where: { email: { startsWith: 'grow-' } } });
  if (have >= GROW_USERS) return;
  const pw = await bcrypt.hash('Grow#2026', 4);
  await db.user.createMany({ data: Array.from({ length: GROW_USERS }, (_, i) => ({
    name: `Grow ${i}`, email: `grow-${i}@sim.invalid`, phone: `014${String(i).padStart(8, '0')}`,
    password: pw, referralCode: `GROW${i}`, emailVerified: true,
  })) });
}

/** n টি খতিয়ান-সঙ্গত ঐতিহাসিক অর্ডার যোগ (একটি SQL-এ) */
async function addOrders(n: number, offset: number) {
  const t = Date.now();
  await db.$executeRawUnsafe(`
    WITH gu AS (SELECT id, row_number() OVER (ORDER BY email) - 1 AS k FROM "User" WHERE email LIKE 'grow-%@sim.invalid'),
    vs AS (SELECT v.id, v.price, v."costPrice", v.label, p.name pname, row_number() OVER (ORDER BY v.id) - 1 AS k
           FROM "Variant" v JOIN "Product" p ON p.id = v."productId" WHERE v."isActive"),
    nv AS (SELECT COUNT(*) c FROM vs),
    g AS (
      SELECT s AS i,
        (SELECT id FROM gu WHERE gu.k = s % ${GROW_USERS}) uid,
        (SELECT vs.id FROM vs, nv WHERE vs.k = (s * 7) % nv.c) vid,
        now() - make_interval(secs => (${offset + n} - s) * 60) - interval '2 days' ts
      FROM generate_series(${offset}, ${offset + n - 1}) s
    ),
    ins_dep AS (
      INSERT INTO "Deposit" (id, "userId", method, amount, "trxId", "senderNo", status, "createdAt", "reviewedAt")
      SELECT 'gd' || g.i, g.uid, 'BKASH'::"PayMethod", v.price, 'GROW' || g.i, '01700000000', 'APPROVED'::"DepositStatus", g.ts, g.ts
      FROM g JOIN "Variant" v ON v.id = g.vid RETURNING 1
    ),
    ins_ord AS (
      INSERT INTO "Order" (id, "userId", "variantId", "playerUid", subtotal, discount, price, "costPrice", "productName", "variantName", status, "createdAt", "completedAt")
      SELECT 'go' || g.i, g.uid, g.vid, (1000000000 + g.i)::text, v.price, 0, v.price, v."costPrice", p.name, v.label, 'COMPLETED'::"OrderStatus", g.ts + interval '1 second', g.ts + interval '20 minutes'
      FROM g JOIN "Variant" v ON v.id = g.vid JOIN "Product" p ON p.id = v."productId" RETURNING 1
    ),
    ins_led AS (
      INSERT INTO "LedgerEntry" (id, "userId", type, amount, "balanceAfter", "refId", note, "createdAt")
      SELECT 'gl' || g.i || 'd', g.uid, 'DEPOSIT'::"LedgerType", v.price, v.price, 'gd' || g.i, 'বৃদ্ধি-জমা', g.ts FROM g JOIN "Variant" v ON v.id = g.vid
      UNION ALL
      SELECT 'gl' || g.i || 'o', g.uid, 'ORDER'::"LedgerType", -v.price, 0, 'go' || g.i, 'বৃদ্ধি-অর্ডার', g.ts + interval '1 second' FROM g JOIN "Variant" v ON v.id = g.vid
      RETURNING 1
    )
    INSERT INTO "OrderEvent" (id, "orderId", status, note, "actorType", "createdAt")
    SELECT 'ge' || g.i || 'a', 'go' || g.i, 'PENDING'::"OrderStatus", 'বৃদ্ধি', 'CUSTOMER'::"OrderActorType", g.ts + interval '1 second' FROM g
    UNION ALL
    SELECT 'ge' || g.i || 'b', 'go' || g.i, 'COMPLETED'::"OrderStatus", 'বৃদ্ধি', 'ADMIN'::"OrderActorType", g.ts + interval '20 minutes' FROM g`);
  await db.$executeRawUnsafe('ANALYZE');
  return Date.now() - t;
}

async function main() {
  await ensureGrowUsers();
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const heavy = await db.user.findUniqueOrThrow({ where: { email: 'grow-0@sim.invalid' } });
  const H = await mintCookie(heavy);
  const anyOrder = await db.order.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const anyTrx = (await db.deposit.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).trxId;

  const probes: Array<[string, string, 'GET' | 'POST', string, unknown?]> = [
    ['admin /admin (ড্যাশবোর্ড)', A, 'GET', '/admin'],
    ['admin /admin/orders', A, 'GET', '/admin/orders'],
    ['admin /admin/orders?status=PENDING', A, 'GET', '/admin/orders?status=PENDING'],
    ['admin /admin/orders?status=COMPLETED', A, 'GET', '/admin/orders?status=COMPLETED'],
    ['admin /admin/deposits', A, 'GET', '/admin/deposits'],
    ['admin /admin/users', A, 'GET', '/admin/users'],
    ['admin /admin/reports', A, 'GET', '/admin/reports'],
    ['admin /admin/logs', A, 'GET', '/admin/logs'],
    ['api admin/analytics', A, 'GET', '/api/admin/analytics'],
    ['api admin/reports', A, 'GET', '/api/admin/reports'],
    ['api admin/logs/export (CSV)', A, 'GET', '/api/admin/logs/export'],
    ['api search: orderNo', A, 'POST', '/api/admin/search', { q: String(anyOrder.orderNo) }],
    ['api search: UID', A, 'POST', '/api/admin/search', { q: anyOrder.playerUid }],
    ['api search: TrxID', A, 'POST', '/api/admin/search', { q: anyTrx }],
    ['api search: email', A, 'POST', '/api/admin/search', { q: 'sim-000123@sim.invalid' }],
    ['customer /account/orders (ভারী গ্রাহক)', H, 'GET', '/account/orders'],
    ['customer /account (ভারী গ্রাহক)', H, 'GET', '/account'],
    ['customer /api/me', H, 'GET', '/api/me'],
  ];

  const sizes: any[] = [];
  const measure = async (label: string) => {
    const total = await db.order.count();
    const row: any = { label, orders: total, ledger: await db.ledgerEntry.count(), probes: {} };
    console.log(`\n═══ ${label}: অর্ডার ${total.toLocaleString('en-IN')} ═══`);
    for (const [name, c, m, path, body] of probes) {
      const ms: number[] = []; let status = 0; let bytes = 0;
      for (let k = 0; k < 5; k++) {
        const r = await call(`growth ${name}`, c, m, path, body, { timeoutMs: 120_000 });
        ms.push(r.ms); status = r.status; bytes = r.text.length;
      }
      ms.sort((a, b) => a - b);
      row.probes[name] = { status, median: ms[2], max: ms[4], kb: Math.round(bytes / 1024) };
      console.log(`  ${name.padEnd(40)} HTTP ${status} · মধ্যক ${String(ms[2]).padStart(6)}ms · সর্বোচ্চ ${String(ms[4]).padStart(6)}ms · ${Math.round(bytes / 1024)}KB`);
    }
    sizes.push(row);
  };

  await measure('সিমুলেশনের পর (বেসলাইন)');
  let have = await db.order.count({ where: { id: { startsWith: 'go' } } });
  for (const target of TARGETS) {
    const cur = await db.order.count();
    const need = target - cur;
    if (need > 0) {
      // ৫০k করে — এক বিশাল ট্রানজেকশন এড়াতে
      for (let done = 0; done < need; done += 50_000) {
        const n = Math.min(50_000, need - done);
        const ms = await addOrders(n, have);
        have += n;
        console.log(`  + ${n.toLocaleString('en-IN')} অর্ডার (${Math.round(ms / 1000)}s)`);
      }
    }
    await measure(`${(target / 1000).toFixed(0)}k`);
  }

  // ধীর কোয়েরির কারণ — UID-খোঁজের পরিকল্পনা
  const plan = await db.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
    `EXPLAIN ANALYZE SELECT id FROM "Order" WHERE "playerUid" ILIKE '%${anyOrder.playerUid}%' OR "productName" ILIKE '%${anyOrder.playerUid}%' ORDER BY "createdAt" DESC LIMIT 10`);
  const planText = plan.map((p) => p['QUERY PLAN']).join('\n');
  console.log('\nUID-খোঁজের পরিকল্পনা:\n' + planText);
  saveJson('growth.json', { at: new Date().toISOString(), sizes, uidSearchPlan: planText });
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
