/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ধাপ ২ — ২৪ ঘণ্টার সিন্থেটিক ব্যবসার দিন, ১০,০০০ গ্রাহক, ≥৳১ কোটি
 *
 *   প্রতিটি টাকা **আসল HTTP পথে** নড়ে — গ্রাহকের ডিপোজিট-দাবি →
 *   অ্যাডমিনের অনুমোদন → ওয়ালেট থেকে অর্ডার → অ্যাডমিনের সম্পন্ন/বাতিল/
 *   আংশিক-ফেরত → প্রত্যাহার। DB সরাসরি কেবল **পড়া** হয় (অ্যাডমিনের
 *   কিউ-দেখার সমতুল্য) — কোনো টাকার সারি সরাসরি লেখা হয় না।
 *
 *   ⚠️ সময়-সংকোচন: ২৪ "ঘণ্টা" কয়েক মিনিটে চলে। প্রতি ঘণ্টার শুরুতে
 *   RateLimitBucket মোছা হয় — বাস্তবে এক ঘণ্টায় ৫/১০ মিনিটের জানালাগুলো
 *   নিজেই খালি হতো। মোছার আগে প্রতিটি 429 গোনা ও রিপোর্ট হয়। সীমা বন্ধ
 *   করা হয় না।
 *
 *   ফল: audit/sim/business-day.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, rng, call, pool, mintCookie, samples, summarize, byName, saveJson, dbConnections, money, tk } from './_lib';
import { readFileSync } from 'node:fs';
import type { Persona } from './01-world';

type Meta = { i: number; email: string; persona: Persona; device: string; network: string; referredBy: number | null };
const world: { meta: Meta[] } = JSON.parse(readFileSync('audit/sim/world.json', 'utf8'));
const R = rng(424242);

// ── দাবি-গণনা: প্রতিটি প্রত্যাশা PASS/FAIL, উদাহরণসহ ──
const checks: Record<string, { pass: number; fail: number; examples: string[] }> = {};
function check(name: string, ok: boolean, detail = '') {
  const c = (checks[name] ??= { pass: 0, fail: 0, examples: [] });
  if (ok) c.pass++; else { c.fail++; if (c.examples.length < 8) c.examples.push(detail); }
}
const counters: Record<string, number> = {};
const bump = (k: string, n = 1) => { counters[k] = (counters[k] ?? 0) + n; };

// ── দিনের ট্রাফিক-বক্ররেখা (ঢাকার সময়) — রাত নিস্তব্ধ, রাত ৯টায় শীর্ষ ──
const CURVE = [1.0, 0.5, 0.3, 0.2, 0.2, 0.4, 1.0, 1.5, 2.0, 3.0, 3.5, 4.0, 5.0, 4.5, 4.0, 4.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 5.0, 3.0];
const CURVE_SUM = CURVE.reduce((a, b) => a + b, 0);
function pickHour(r: ReturnType<typeof rng>, from = 0): number {
  const sub = CURVE.slice(from);
  const tot = sub.reduce((a, b) => a + b, 0);
  let x = r.next() * tot;
  for (let k = 0; k < sub.length; k++) { x -= sub[k]; if (x <= 0) return from + k; }
  return 23;
}

// ── পারসোনা অনুযায়ী খরচের বাজেট (৳) ও অর্ডার-রুচি ──
const BUDGET: Record<Persona, [number, number]> = {
  new: [60, 400], occasional: [200, 1200], regular: [600, 3000], heavy: [3000, 9000],
  price_sensitive: [100, 600], impatient: [300, 1500], error_prone: [150, 900], adversarial: [100, 700],
};

type Variant = { id: number; price: number; stock: number; label: string; product: string };
type Cust = {
  m: Meta; id: string; cookie: string; budget: number; depHour: number;
  approved: number; spent: number; refunded: number; withdrawn: number; seenPrice: Map<number, number>;
};

const orderLog: Array<{ ref: string; cust: number; variantId: number; status: number; orderId?: string; price?: number; hour: number; kind: string }> = [];
const depositLog: Array<{ cust: number; trxId: string; amount: number; status: number; hour: number; kind: string }> = [];
const adminLog: Array<{ act: string; id: string; status: number; admin: string; hour: number }> = [];
const hourStats: any[] = [];
let trxSeq = 0;
const newTrx = () => `SIM${Date.now().toString(36).toUpperCase()}${(trxSeq++).toString(36).toUpperCase().padStart(5, '0')}`;

async function main() {
  const t0 = Date.now();
  const users = await db.user.findMany({ where: { email: { startsWith: 'sim-', endsWith: '@sim.invalid' } }, select: { id: true, email: true, role: true, sessionEpoch: true } });
  const idOf = new Map(users.map((u) => [u.email, u]));
  const adminA = await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } });
  const adminB = await db.user.findUniqueOrThrow({ where: { email: 'admin2@sim.invalid' } });
  const A = await mintCookie(adminA);
  const B = await mintCookie(adminB);

  const vrows = await db.variant.findMany({ where: { isActive: true, product: { isActive: true } }, include: { product: true }, orderBy: { price: 'asc' } });
  let catalog: Variant[] = vrows.map((v) => ({ id: v.id, price: Number(v.price), stock: v.stock, label: v.label, product: v.product.name }));
  console.log(`ক্যাটালগ: ${catalog.length}টি সক্রিয় প্যাকেজ, দাম ${tk(catalog[0].price)}–${tk(catalog[catalog.length - 1].price)}`);
  const needsUid = new Set(vrows.filter((v) => v.product.needsUid).map((v) => v.id));

  const custs: Cust[] = [];
  for (const m of world.meta) {
    const u = idOf.get(m.email)!;
    const [lo, hi] = BUDGET[m.persona];
    custs.push({
      m, id: u.id, cookie: await mintCookie(u), budget: R.int(lo, hi), depHour: pickHour(R, 0),
      approved: 0, spent: 0, refunded: 0, withdrawn: 0, seenPrice: new Map(),
    });
  }
  console.log(`  ✓ ${custs.length} সেশন · মোট পরিকল্পিত বাজেট ${tk(custs.reduce((s, c) => s + c.budget, 0))}`);

  const settings = Object.fromEntries((await db.setting.findMany()).map((s) => [s.key, s.value]));
  const MAX_DEP = Number(settings.max_deposit || 25000);
  const MIN_DEP = Number(settings.min_deposit || 20);

  let priceChanged: { id: number; before: number; after: number } | null = null;

  for (let h = 0; h < 24; h++) {
    const hs: any = { hour: h, t: Date.now() };
    const before429 = samples.filter((s) => s.status === 429).length;
    await db.rateLimitBucket.deleteMany({}); // ★ সময়-সংকোচন (উপরে ব্যাখ্যা)
    const sStart = samples.length;
    const conn: number[] = [];
    const probe = setInterval(async () => { conn.push(await dbConnections().catch(() => -1)); }, 1000);

    // ═══ A. ডিপোজিট-দাবি ═══
    const depositors = custs.filter((c) => c.depHour === h);
    await pool(depositors, 64, async (c) => {
      const p = c.m.persona;
      // ভুল-প্রবণ: প্রথমে ভুল TrxID ফরম্যাট
      if (p === 'error_prone' && R.chance(0.3)) {
        const r = await call('POST /api/deposit (bad trx)', c.cookie, 'POST', '/api/deposit', { method: 'BKASH', amount: 100, trxId: 'ab', senderNo: '01911111111' });
        check('ভুল TrxID ফরম্যাট → 400', r.status === 400, `HTTP ${r.status}`);
      }
      // আক্রমণকারী: ঋণাত্মক/শূন্য/অতিরিক্ত অঙ্ক
      if (p === 'adversarial' && R.chance(0.3)) {
        const amt = R.pick([-500, 0, MAX_DEP + 1, 1e9, 0.001]);
        const r = await call('POST /api/deposit (bad amount)', c.cookie, 'POST', '/api/deposit', { method: 'BKASH', amount: amt, trxId: newTrx(), senderNo: '01911111111' });
        check('অবৈধ ডিপোজিট-অঙ্ক প্রত্যাখ্যাত (4xx)', r.status >= 400 && r.status < 500, `amt=${amt} HTTP ${r.status}`);
      }
      // বাজেট + ~১৫% ঝুলন্ত টাকা, সর্বোচ্চ সীমা মেনে কিস্তিতে
      let need = Math.max(MIN_DEP, Math.ceil(c.budget * 1.15));
      while (need > 0) {
        const amount = Math.min(need, MAX_DEP);
        const trxId = newTrx();
        const r = await call('POST /api/deposit', c.cookie, 'POST', '/api/deposit', {
          method: R.pick(['BKASH', 'NAGAD', 'ROCKET', 'UPAY']), amount, trxId, senderNo: `017${String(c.m.i).padStart(8, '0')}`,
        });
        depositLog.push({ cust: c.m.i, trxId, amount, status: r.status, hour: h, kind: 'normal' });
        check('বৈধ ডিপোজিট-দাবি গৃহীত', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`);
        // ভুল-প্রবণ/আক্রমণকারী: একই TrxID আবার (ডাবল-সাবমিট বা প্রতারণা)
        if ((p === 'error_prone' || p === 'adversarial' || p === 'impatient') && R.chance(0.25)) {
          const r2 = await call('POST /api/deposit (dup trx)', c.cookie, 'POST', '/api/deposit', { method: 'BKASH', amount, trxId: trxId.toLowerCase(), senderNo: '01911111111' });
          check('একই TrxID (ছোট হাতের) দ্বিতীয়বার → 409', r2.status === 409, `HTTP ${r2.status}`);
        }
        need -= amount;
      }
    });

    // ═══ B. অ্যাডমিন অনুমোদন — দুই অ্যাডমিন সমান্তরালে ═══
    const pend = await db.deposit.findMany({ where: { status: 'PENDING', user: { email: { endsWith: '@sim.invalid' } } }, select: { id: true, trxId: true, amount: true, riskHeldAt: true } });
    await pool(pend, 16, async (d, k) => {
      const who = k % 2 ? B : A;
      const whoName = k % 2 ? 'B' : 'A';
      // ~৩% "টাকা আসেনি" → প্রত্যাখ্যান
      const reject = R.chance(0.03);
      const body = reject ? { depositId: d.id, action: 'REJECT', rejectReason: 'TRX_NOT_FOUND' } : { depositId: d.id, action: 'APPROVE' };
      // ~২% দুই অ্যাডমিন একসাথে একই দাবিতে (স্টেল পাতা / ডাবল-ক্লিক)
      if (R.chance(0.02)) {
        const [r1, r2] = await Promise.all([
          call('POST /api/admin/deposit (race)', A, 'POST', '/api/admin/deposit', body),
          call('POST /api/admin/deposit (race)', B, 'POST', '/api/admin/deposit', body),
        ]);
        const oks = [r1, r2].filter((r) => r.status === 200).length;
        check('দুই অ্যাডমিন একই ডিপোজিট → ঠিক একজন সফল, অন্যজন 409', oks === 1 && [r1, r2].some((r) => r.status === 409), `${r1.status}/${r2.status}`);
        adminLog.push({ act: `deposit-${body.action}-race`, id: d.id, status: oks === 1 ? 200 : 0, admin: 'A+B', hour: h });
        return;
      }
      const r = await call('POST /api/admin/deposit', who, 'POST', '/api/admin/deposit', body);
      check('অ্যাডমিন ডিপোজিট-সিদ্ধান্ত সফল', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`);
      adminLog.push({ act: `deposit-${body.action}`, id: d.id, status: r.status, admin: whoName, hour: h });
    });
    // ক্লায়েন্ট-পক্ষের "আমার ব্যালেন্স" — কেবল পরিকল্পনার জন্য; সত্য DB-র
    const approvedNow = await db.deposit.groupBy({ by: ['userId'], where: { status: 'APPROVED', userId: { in: depositors.map((c) => c.id) } }, _sum: { amount: true } });
    const apMap = new Map(approvedNow.map((a) => [a.userId, Number(a._sum.amount ?? 0)]));
    for (const c of depositors) c.approved = apMap.get(c.id) ?? 0;

    // ═══ E1. ঘটনা: সকাল ১০টায় জনপ্রিয় প্যাকেজের দাম ২০% বাড়ানো (বাসি-পাতা পরীক্ষা) ═══
    if (h === 10) {
      const v = catalog[Math.floor(catalog.length * 0.4)];
      const after = money(v.price * 1.2);
      const r = await call('PATCH /api/admin/variant (price)', A, 'PATCH', '/api/admin/variant', { id: v.id, price: after });
      check('অ্যাডমিন দাম বদল সফল', r.status === 200, `HTTP ${r.status}`);
      priceChanged = { id: v.id, before: v.price, after };
      // যাঁরা আগে পাতা খুলেছিলেন তাঁদের চোখে পুরনো দাম
      for (const c of custs) if (c.seenPrice.size === 0 || R.chance(0.3)) c.seenPrice.set(v.id, v.price);
      v.price = after;
      console.log(`  [১০:০০] দাম বদল: #${v.id} ${tk(priceChanged.before)} → ${tk(after)}`);
    }

    // ═══ C. অর্ডার ═══
    const buyers = custs.filter((c) => c.depHour <= h && c.approved - c.spent - c.withdrawn + c.refunded >= catalog[0].price);
    await pool(buyers, 100, async (c) => {
      const p = c.m.persona;
      // এই ঘণ্টায় কতটি অর্ডার: বাকি ঘণ্টায় বাজেট ছড়ানো
      const hoursLeft = 24 - Math.max(h, c.depHour);
      let toSpend = (c.budget - c.spent) / Math.max(1, hoursLeft / (p === 'heavy' ? 2 : 4));
      if (h === 23) toSpend = c.budget - c.spent;
      let guard = 0;
      while (toSpend > 0 && guard++ < 25) {
        const avail = c.approved - c.spent - c.withdrawn + c.refunded;
        const affordable = catalog.filter((v) => v.price <= avail && v.stock !== 0);
        if (!affordable.length) break;
        const pool_ = p === 'heavy' ? affordable.slice(Math.floor(affordable.length * 0.5))
          : p === 'price_sensitive' ? affordable.slice(0, Math.max(1, Math.ceil(affordable.length * 0.3)))
          : affordable;
        // ★ দাম-সচেতন গ্রাহক কুপন দিতে চাইলে কুপনের ন্যূনতম অঙ্কের (৳১০০) উপরের প্যাকেজ বাছেন
        const wantsCoupon = p === 'price_sensitive' && R.chance(0.5) && affordable.some((x) => x.price >= 100);
        const v = wantsCoupon ? R.pick(affordable.filter((x) => x.price >= 100).slice(0, 8)) : R.pick(pool_);
        const ref = `sim-${c.m.i}-${h}-${guard}-${R.int(0, 1e6)}`;
        const uid = String(R.int(1_000_000_000, 9_999_999_999));
        const seen = c.seenPrice.get(v.id);
        const body: any = { variantId: v.id, playerUid: uid, clientRef: ref, expectedPrice: seen ?? v.price };
        if (wantsCoupon) body.couponCode = v.price >= 200 && R.chance(0.5) ? 'SIMFLAT20' : 'SIMSAVE10';

        // ── ভুল-প্রবণ: ভুল/খালি UID ──
        if (p === 'error_prone' && R.chance(0.2) && needsUid.has(v.id)) {
          const bad = R.pick(['', 'a', '12 34', '১২৩৪৫৬৭৮', '<script>', '9'.repeat(200)]);
          const r = await call('POST /api/order (bad uid)', c.cookie, 'POST', '/api/order', { ...body, playerUid: bad, clientRef: ref + 'x' });
          check('অবৈধ UID → 400, অর্ডার নয়', r.status === 400, `uid=${JSON.stringify(bad).slice(0, 20)} HTTP ${r.status}`);
          orderLog.push({ ref: ref + 'x', cust: c.m.i, variantId: v.id, status: r.status, hour: h, kind: 'bad-uid' });
        }
        // ── ভুল-প্রবণ: ব্যালেন্সের বেশি দামের প্যাকেজ ──
        if (p === 'error_prone' && R.chance(0.1)) {
          const exp = catalog.find((x) => x.price > avail + 1);
          if (exp) {
            const r = await call('POST /api/order (insufficient)', c.cookie, 'POST', '/api/order', { variantId: exp.id, playerUid: uid, clientRef: ref + 'i' });
            check('অপর্যাপ্ত ব্যালেন্স → 400, অর্ডার নয়', r.status === 400 && /ব্যালেন্স/.test(r.json?.error ?? ''), `HTTP ${r.status} ${r.json?.error ?? ''}`);
            orderLog.push({ ref: ref + 'i', cust: c.m.i, variantId: exp.id, status: r.status, hour: h, kind: 'insufficient' });
          }
        }
        // ── আক্রমণকারী: ক্লায়েন্ট থেকে দাম/ছাড় জাল করা ──
        if (p === 'adversarial' && R.chance(0.3)) {
          const r = await call('POST /api/order (tamper)', c.cookie, 'POST', '/api/order', { ...body, clientRef: ref + 't', price: 1, subtotal: 1, discount: 99999, expectedPrice: 0 });
          // expectedPrice 0 → দাম বেশি → 409; জাল price/discount উপেক্ষিত
          check('জাল দাম/ছাড় → অর্ডার নয় (409 PRICE_CHANGED)', r.status === 409, `HTTP ${r.status}`);
          orderLog.push({ ref: ref + 't', cust: c.m.i, variantId: v.id, status: r.status, hour: h, kind: 'tamper' });
        }

        let r;
        if (p === 'impatient' && R.chance(0.5)) {
          // ── ডাবল/ট্রিপল ক্লিক — একই clientRef সমান্তরালে ──
          const k = R.int(2, 3);
          const rs = await Promise.all(Array.from({ length: k }, () => call('POST /api/order (multi-click)', c.cookie, 'POST', '/api/order', body)));
          const ids = new Set(rs.filter((x) => x.status === 200).map((x) => x.json?.orderId));
          check('ডাবল-ক্লিক → সর্বোচ্চ একটি অর্ডার-আইডি', ids.size <= 1, `${rs.map((x) => x.status).join('/')} ids=${ids.size}`);
          bump('multiClickBursts'); bump('multiClickRequests', k);
          r = rs.find((x) => x.status === 200) ?? rs[0];
        } else if ((c.m.network === 'timeout_prone' || c.m.network === 'intermittent') && R.chance(0.3)) {
          // ── নেটওয়ার্ক কেটে যাওয়া: অনুরোধ পাঠিয়ে উত্তরের আগেই বাতিল, তারপর একই ref-এ retry ──
          await call('POST /api/order (aborted)', c.cookie, 'POST', '/api/order', body, { timeoutMs: R.int(3, 40) });
          bump('abortedThenRetried');
          r = await call('POST /api/order (retry)', c.cookie, 'POST', '/api/order', body);
        } else {
          r = await call('POST /api/order', c.cookie, 'POST', '/api/order', body);
        }

        if (r.status === 409 && r.json?.code === 'PRICE_CHANGED') {
          // ── বাসি দাম: গ্রাহক নতুন দাম দেখে আবার নিশ্চিত করেন ──
          bump('priceChanged409');
          check('বাসি দামে 409-এর বার্তায় নতুন দাম', /দাম বদলেছে/.test(r.json?.error ?? ''), r.json?.error ?? '');
          c.seenPrice.delete(v.id);
          orderLog.push({ ref, cust: c.m.i, variantId: v.id, status: 409, hour: h, kind: 'stale-409' });
          const ref2 = ref + 'c';
          r = await call('POST /api/order (reconfirm)', c.cookie, 'POST', '/api/order', { ...body, clientRef: ref2, expectedPrice: v.price });
          body.clientRef = ref2;
        }
        if (r.status === 400 && body.couponCode && /কুপন/.test(r.json?.error ?? '')) {
          // ── কুপন চলল না (সীমা শেষ/প্রতি-ইউজার সীমা) — গ্রাহক কুপন সরিয়ে আবার ──
          bump('couponRejected');
          orderLog.push({ ref: body.clientRef, cust: c.m.i, variantId: v.id, status: 400, hour: h, kind: 'coupon-400' });
          delete body.couponCode;
          body.clientRef = body.clientRef + 'n';
          r = await call('POST /api/order (no coupon)', c.cookie, 'POST', '/api/order', body);
        }
        orderLog.push({ ref: body.clientRef, cust: c.m.i, variantId: v.id, status: r.status, orderId: r.json?.orderId, price: undefined, hour: h, kind: 'normal' });
        if (r.status === 200) {
          const newBal = Number(r.json?.balance);
          // ক্লায়েন্টের হিসাব সার্ভারের উত্তরে মিলিয়ে নেওয়া
          const prevAvail = c.approved - c.spent - c.withdrawn + c.refunded;
          const charged = money(prevAvail - newBal);
          c.spent += charged;
          toSpend -= charged;
          bump('ordersOk');
        } else if (r.status === 429) {
          bump('order429'); break;
        } else {
          bump(`orderFail_${r.status}`);
          if (r.status >= 500 || r.status === 0) check('অর্ডারে 5xx/নেটওয়ার্ক-ত্রুটি নেই', false, `HTTP ${r.status} ${r.text.slice(0, 120)}`);
          break;
        }
      }
    });

    // ═══ D. অ্যাডমিন অর্ডার-প্রক্রিয়া — আগের ঘণ্টাগুলোর অর্ডার ═══
    const open = await db.order.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] }, user: { email: { endsWith: '@sim.invalid' } }, createdAt: { lt: new Date(hs.t) } },
      select: { id: true, status: true, price: true }, orderBy: { createdAt: 'asc' },
    });
    const toComplete: string[] = []; const toFail: string[] = []; const toProcess: string[] = [];
    for (const o of open) {
      const x = R.next();
      if (x < 0.07) toFail.push(o.id);
      else if (x < 0.85) toComplete.push(o.id);
      else if (o.status === 'PENDING') toProcess.push(o.id);
    }
    // বাল্ক সম্পন্ন (২০টি করে) — অর্ধেক; বাকি একটি একটি করে
    const bulk = toComplete.filter((_, k) => k % 2 === 0);
    const single = toComplete.filter((_, k) => k % 2 === 1);
    const chunks: string[][] = [];
    for (let k = 0; k < bulk.length; k += 20) chunks.push(bulk.slice(k, k + 20));
    await pool(chunks, 4, async (ids, k) => {
      const r = await call('POST /api/admin/order/bulk', k % 2 ? B : A, 'POST', '/api/admin/order/bulk', { orderIds: ids, action: 'COMPLETE' });
      check('বাল্ক-সম্পন্ন সফল', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`);
      adminLog.push({ act: 'bulk-complete', id: ids.join(','), status: r.status, admin: k % 2 ? 'B' : 'A', hour: h });
    });
    await pool(single, 12, async (id, k) => {
      if (k % 7 === 0) {
        // ★ takeover ছাড়া — অন্য অ্যাডমিন claim ধরে থাকলে 409 CLAIM_HELD-ই সঠিক আচরণ
        const r0 = await call('POST /api/admin/order (processing)', A, 'POST', '/api/admin/order', { orderId: id, action: 'PROCESSING' });
        if (r0.status === 409 && r0.json?.code === 'CLAIM_HELD') {
          check('claim-পাহারা: অন্য অ্যাডমিনের কাজে takeover ছাড়া ঢোকা যায় না (409 + নাম)', /কাজ করছেন/.test(r0.json?.error ?? ''), r0.json?.error ?? '');
        } else {
          check('PROCESSING সফল', r0.status === 200, `HTTP ${r0.status} ${r0.json?.error ?? ''}`);
        }
      }
      const r = await call('POST /api/admin/order (complete)', k % 7 === 0 ? A : (k % 2 ? B : A), 'POST', '/api/admin/order', { orderId: id, action: 'COMPLETE', takeover: true });
      check('একক সম্পন্ন সফল', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`);
      adminLog.push({ act: 'complete', id, status: r.status, admin: k % 2 ? 'B' : 'A', hour: h });
    });
    await pool(toFail, 8, async (id, k) => {
      // ~১০% ক্ষেত্রে দুই অ্যাডমিন একসাথে FAIL (দুবার রিফান্ড হওয়া চলবে না)
      if (k % 10 === 0) {
        const body = { orderId: id, action: 'FAIL', failReason: 'INVALID_UID', takeover: true };
        const [r1, r2] = await Promise.all([
          call('POST /api/admin/order (fail race)', A, 'POST', '/api/admin/order', body),
          call('POST /api/admin/order (fail race)', B, 'POST', '/api/admin/order', body),
        ]);
        const oks = [r1, r2].filter((r) => r.status === 200).length;
        check('দুই অ্যাডমিন একসাথে FAIL → ঠিক একটি রিফান্ড', oks === 1, `${r1.status}/${r2.status}`);
        adminLog.push({ act: 'fail-race', id, status: oks === 1 ? 200 : 0, admin: 'A+B', hour: h });
        return;
      }
      const r = await call('POST /api/admin/order (fail)', k % 2 ? B : A, 'POST', '/api/admin/order', { orderId: id, action: 'FAIL', failReason: R.pick(['INVALID_UID', 'OUT_OF_STOCK', 'GAME_SERVER_ISSUE']), takeover: true });
      check('FAIL (পূর্ণ রিফান্ড) সফল', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`);
      adminLog.push({ act: 'fail', id, status: r.status, admin: k % 2 ? 'B' : 'A', hour: h });
    });
    await pool(toProcess, 8, async (id) => {
      const r = await call('POST /api/admin/order (processing)', B, 'POST', '/api/admin/order', { orderId: id, action: 'PROCESSING', takeover: true });
      check('PROCESSING সফল', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`);
    });
    // FAIL হওয়া অর্ডারের টাকা গ্রাহকের পরিকল্পনায় ফেরত
    if (toFail.length) {
      const failed = await db.order.findMany({ where: { id: { in: toFail }, status: 'REFUNDED' }, select: { userId: true, price: true } });
      const byU = new Map<string, number>();
      for (const f of failed) byU.set(f.userId, (byU.get(f.userId) ?? 0) + Number(f.price));
      for (const c of custs) if (byU.has(c.id)) c.refunded += byU.get(c.id)!;
    }

    // ═══ E2. সন্ধ্যা ৬টা — আংশিক ফেরত (সম্পন্ন অর্ডারের ~২%), কিছু দুই ধাপে ═══
    if (h === 18) {
      const done = await db.order.findMany({ where: { status: 'COMPLETED', user: { email: { endsWith: '@sim.invalid' } } }, select: { id: true, price: true, userId: true } });
      const pick = done.filter(() => R.chance(0.02));
      await pool(pick, 8, async (o, k) => {
        const price = Number(o.price);
        const a1 = money(Math.max(0.01, price * 0.3));
        const r1 = await call('POST /api/admin/order/refund', A, 'POST', '/api/admin/order/refund', { orderId: o.id, amount: a1, reason: 'আংশিক ডেলিভারি', requestId: `day-pr1-${o.id}` });
        check('আংশিক ফেরত সফল', r1.status === 200, `HTTP ${r1.status} ${r1.json?.error ?? ''}`);
        // সীমার বেশি ফেরতের চেষ্টা → 400
        const r2 = await call('POST /api/admin/order/refund (over)', B, 'POST', '/api/admin/order/refund', { orderId: o.id, amount: money(price), reason: 'ভুল করে পুরো অঙ্ক', requestId: `day-pr2-${o.id}` });
        check('বাকি-অঙ্কের বেশি ফেরত → 400', r2.status === 400, `HTTP ${r2.status}`);
        if (k % 3 === 0) {
          // বাকিটা দুই অ্যাডমিন একসাথে — ঠিক একজন
          const rest = money(price - a1);
          const [x, y] = await Promise.all([
            call('POST /api/admin/order/refund (race)', A, 'POST', '/api/admin/order/refund', { orderId: o.id, amount: rest, reason: 'বাকি ফেরত', requestId: `day-pr3a-${o.id}` }),
            call('POST /api/admin/order/refund (race)', B, 'POST', '/api/admin/order/refund', { orderId: o.id, amount: rest, reason: 'বাকি ফেরত', requestId: `day-pr3b-${o.id}` }),
          ]);
          check('বাকি-ফেরত দুই অ্যাডমিন একসাথে → ঠিক একটি', [x, y].filter((q) => q.status === 200).length === 1, `${x.status}/${y.status}`);
        }
        const c = custs.find((cc) => cc.id === o.userId);
        if (c) c.refunded += a1;
      });
      bump('partialRefundOrders', pick.length);
    }

    // ═══ E3. বিকেল ৩টা–রাত ৮টা — প্রত্যাহার (OTP সহ) ═══
    if (h >= 15 && h <= 20) {
      const cands = custs.filter((c) => c.depHour < h && R.chance(0.012));
      await pool(cands, 16, async (c) => {
        const bal = Number((await db.user.findUnique({ where: { id: c.id }, select: { balance: true } }))!.balance);
        if (bal < 100) return;
        const amount = money(Math.min(bal, R.int(100, Math.max(100, Math.floor(bal)))));
        // ★ OTP: আসল `/api/account/withdraw` PUT কোড পাঠাতে চায় — সিমে ইমেইল বন্ধ,
        //   তাই "কোড পৌঁছেছে" অবস্থাটি সরাসরি Otp সারি হিসেবে বসানো (আসল `consumeOtp` পথই যাচাই করে)
        const code = String(R.int(100000, 999999));
        const bcrypt = (await import('bcryptjs')).default;
        await db.otp.updateMany({ where: { destination: c.m.email, purpose: 'WITHDRAW', consumedAt: null }, data: { consumedAt: new Date() } });
        await db.otp.create({ data: { channel: 'EMAIL', purpose: 'WITHDRAW', destination: c.m.email, codeHash: await bcrypt.hash(code, 8), expiresAt: new Date(Date.now() + 600_000) } });
        const body = { amount, method: 'BKASH', accountNumber: `018${String(c.m.i).padStart(8, '0')}`, code };
        // ভুল-প্রবণ: প্রথমে ভুল কোড
        if (c.m.persona === 'error_prone') {
          const w = await call('POST /api/account/withdraw (wrong otp)', c.cookie, 'POST', '/api/account/withdraw', { ...body, code: '000000' });
          check('ভুল OTP → 400, টাকা কাটা নয়', w.status === 400, `HTTP ${w.status}`);
        }
        // অধৈর্য/আক্রমণকারী: একই কোডে ৫টি সমান্তরাল অনুরোধ
        const k = c.m.persona === 'impatient' || c.m.persona === 'adversarial' ? 5 : 1;
        const rs = await Promise.all(Array.from({ length: k }, () => call('POST /api/account/withdraw', c.cookie, 'POST', '/api/account/withdraw', body)));
        const oks = rs.filter((x) => x.status === 200).length;
        check('প্রত্যাহার: একই OTP-তে সর্বোচ্চ একটি সফল', oks <= 1, rs.map((x) => x.status).join('/'));
        check('প্রত্যাহার সফল (বৈধ অনুরোধ)', oks === 1, rs.map((x) => `${x.status}:${x.json?.error ?? ''}`).join(' | '));
        if (oks === 1) { c.withdrawn += amount; bump('withdrawalsRequested'); }
      });
      // অ্যাডমিন: ৮০% অনুমোদন, ২০% প্রত্যাখ্যান; ~১০% দুই অ্যাডমিন একসাথে
      const wp = await db.withdrawal.findMany({ where: { status: { in: ['PENDING', 'HELD'] } }, select: { id: true, userId: true, amount: true } });
      await pool(wp, 8, async (w, k) => {
        const approve = R.chance(0.8);
        const body = approve ? { id: w.id, action: 'approve', payoutRef: `SIMPAY${k}${h}` } : { id: w.id, action: 'reject', reason: 'সিম: নাম্বার মেলেনি' };
        if (k % 10 === 0) {
          const [x, y] = await Promise.all([
            call('POST /api/admin/withdrawals (race)', A, 'POST', '/api/admin/withdrawals', body),
            call('POST /api/admin/withdrawals (race)', B, 'POST', '/api/admin/withdrawals', { ...body, action: approve ? 'reject' : 'approve', reason: 'বিপরীত সিদ্ধান্ত', payoutRef: 'SIMX' }),
          ]);
          check('প্রত্যাহারে দুই অ্যাডমিনের বিপরীত সিদ্ধান্ত → ঠিক একটি কার্যকর', [x, y].filter((q) => q.status === 200).length === 1, `${x.status}/${y.status}`);
        } else {
          const r = await call('POST /api/admin/withdrawals', k % 2 ? B : A, 'POST', '/api/admin/withdrawals', body);
          check('প্রত্যাহার-সিদ্ধান্ত সফল', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`);
        }
      });
      const rej = await db.withdrawal.findMany({ where: { status: 'REJECTED', id: { in: wp.map((w) => w.id) } }, select: { userId: true, amount: true } });
      for (const x of rej) { const c = custs.find((cc) => cc.id === x.userId); if (c) c.withdrawn -= Number(x.amount); }
    }

    // ═══ E4. রাত ৯টা — সীমিত-স্টক ফ্ল্যাশ সেল: ২০০ জন একসাথে, স্টক ৫০ ═══
    if (h === 21) {
      const v = catalog[1];
      const r0 = await call('PATCH /api/admin/variant (stock)', A, 'PATCH', '/api/admin/variant', { id: v.id, stock: 50 });
      check('স্টক বসানো সফল', r0.status === 200, `HTTP ${r0.status} ${r0.json?.error ?? ''}`);
      const rushers = custs.filter((c) => c.approved - c.spent - c.withdrawn + c.refunded > v.price * 2).slice(0, 200);
      const rs = await Promise.all(rushers.map((c, k) => call('POST /api/order (flash)', c.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: String(5_000_000_000 + k), clientRef: `sim-flash-${k}`, expectedPrice: v.price })));
      const ok = rs.filter((x) => x.status === 200).length;
      rs.forEach((x, k) => { if (x.status === 200) { rushers[k].spent += v.price; orderLog.push({ ref: `sim-flash-${k}`, cust: rushers[k].m.i, variantId: v.id, status: 200, orderId: x.json?.orderId, hour: h, kind: 'flash' }); } });
      const after = (await db.variant.findUnique({ where: { id: v.id } }))!.stock;
      check('ফ্ল্যাশ সেল: ঠিক ৫০টি সফল, স্টক ০, oversell নেই', ok === Math.min(50, rushers.length) && after === Math.max(0, 50 - rushers.length), `ok=${ok} rushers=${rushers.length} stockAfter=${after}`);
      check('ফ্ল্যাশ সেল: 5xx নেই', rs.every((x) => x.status > 0 && x.status < 500), rs.filter((x) => x.status >= 500 || x.status === 0).map((x) => x.status).join(','));
      counters.flashSale = ok;
      await call('PATCH /api/admin/variant (stock reset)', A, 'PATCH', '/api/admin/variant', { id: v.id, stock: -1 });
    }

    // ═══ F. সাপোর্ট: প্রতি ঘণ্টায় ২০ জন "সমস্যা" নিয়ে — অ্যাডমিন খোঁজে ═══
    const sup = depositLog.filter((d) => d.status === 200).slice(-400).filter(() => R.chance(0.05)).slice(0, 20);
    await pool(sup, 4, async (d) => {
      const r = await call('POST /api/admin/search (trx)', A, 'POST', '/api/admin/search', { q: d.trxId });
      const found = JSON.stringify(r.json ?? {}).includes(d.trxId);
      check('সাপোর্ট: TrxID দিয়ে ডিপোজিট খুঁজে পাওয়া যায়', r.status === 200 && found, `HTTP ${r.status}`);
    });

    // ═══ G. গ্রাহক: কিছু সম্পন্ন অর্ডারে "পেয়েছি" নিশ্চিতকরণ + অর্ডার-তালিকা দেখা ═══
    const doneNow = await db.order.findMany({ where: { status: 'COMPLETED', deliveryConfirmedAt: null, deliveryDisputedAt: null, user: { email: { endsWith: '@sim.invalid' } } }, select: { id: true, userId: true }, take: 300 });
    const byId = new Map(custs.map((c) => [c.id, c]));
    await pool(doneNow.filter(() => R.chance(0.3)), 16, async (o) => {
      const c = byId.get(o.userId)!;
      const r = await call('POST /api/order/confirm', c.cookie, 'POST', '/api/order/confirm', { orderId: o.id, arrived: R.chance(0.97) });
      check('গ্রাহকের ডেলিভারি-নিশ্চিতকরণ সফল', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`);
    });

    clearInterval(probe);
    const hSamples = samples.slice(sStart);
    hs.seconds = Math.round((Date.now() - hs.t) / 100) / 10;
    hs.requests = summarize(hSamples, hs.seconds);
    hs.limited429BeforeReset = samples.filter((s) => s.status === 429).length - before429;
    hs.peakDbConnections = Math.max(0, ...conn);
    hs.depositors = depositors.length; hs.buyers = buyers.length; hs.adminOpen = open.length;
    hourStats.push(hs);
    console.log(`  [${String(h).padStart(2, '0')}:00] ${hs.seconds}s · ${hSamples.length} অনুরোধ · p95 ${hs.requests.p95}ms · 5xx ${hs.requests.c5xx} · net0 ${hs.requests.net0} · জমা ${depositors.length} · ক্রেতা ${buyers.length} · খোলা অর্ডার ${open.length} · DB-সংযোগ শীর্ষ ${hs.peakDbConnections}`);
  }

  const failedChecks = Object.entries(checks).filter(([, v]) => v.fail > 0);
  const result = {
    startedAt: new Date(t0).toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    priceChanged, counters, checks, hourStats,
    endpoints: byName(samples), overall: summarize(samples),
    orderLog, depositLog, adminLog,
  };
  saveJson('business-day.json', result);
  console.log(`\nমোট ${samples.length} অনুরোধ · ${result.seconds}s · দাবি ${Object.values(checks).reduce((s, c) => s + c.pass + c.fail, 0)} · ব্যর্থ দাবি-ধরন ${failedChecks.length}`);
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v.fail ? '✗' : '✓'} ${k}: ${v.pass}/${v.pass + v.fail}${v.fail ? '  ← ' + v.examples.slice(0, 3).join(' ; ') : ''}`);
  console.log('  counters', JSON.stringify(counters));
  if (failedChecks.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
