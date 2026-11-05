/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ধাপ ১ — ১০,০০০ সিন্থেটিক গ্রাহকের পৃথিবী
 *
 *   ⚠️ সব তথ্য **স্পষ্টতই নকল**: ইমেইল `.invalid` TLD-তে (RFC 2606 —
 *   কখনো কোনো আসল ঠিকানা হতে পারে না), নাম "Sim Customer N", ফোন
 *   `019` + ক্রমিক। কোনো আসল মানুষের তথ্য নেই।
 *
 *   ব্যালেন্স সবার **০** — টাকা ঢুকবে কেবল আসল ডিপোজিট-পথ দিয়ে
 *   (গ্রাহক দাবি → অ্যাডমিন অনুমোদন, HTTP), যাতে প্রতিটি টাকার উৎস
 *   খতিয়ানে প্রমাণযোগ্য থাকে। সরাসরি DB-তে ব্যালেন্স বসানো হয় না।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 \
 *     VERIFY_DATABASE_URL=postgresql://dev:dev@localhost:5434/uidtopup_sim \
 *     npx tsx scripts/sim/01-world.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, rng, saveJson, dbLabel, BASE, mintCookie, call } from './_lib';
import bcrypt from 'bcryptjs';

export const N_CUSTOMERS = Number(process.env.SIM_CUSTOMERS || 10_000);
export const SIM_PASSWORD = 'SimCustomer#2026';

// ── পারসোনা বণ্টন (নির্দেশনার উদাহরণ অনুযায়ী) ──
export const PERSONAS = [
  ['new', 0.20], ['occasional', 0.20], ['regular', 0.20], ['heavy', 0.15],
  ['price_sensitive', 0.10], ['impatient', 0.05], ['error_prone', 0.05], ['adversarial', 0.05],
] as const;
export type Persona = (typeof PERSONAS)[number][0];

const DEVICES = [['android', 0.55], ['iphone', 0.12], ['windows_pc', 0.13], ['laptop', 0.12], ['tablet', 0.08]] as const;
const NETWORKS = [['fast', 0.25], ['normal', 0.40], ['slow', 0.15], ['intermittent', 0.10], ['timeout_prone', 0.05], ['offline_reconnect', 0.05]] as const;

function weighted<T extends string>(r: ReturnType<typeof rng>, table: readonly (readonly [T, number])[]): T {
  const x = r.next();
  let acc = 0;
  for (const [k, w] of table) { acc += w; if (x < acc) return k; }
  return table[table.length - 1][0];
}

async function main() {
  console.log(`ডাটাবেস ${dbLabel()} · সার্ভার ${BASE} · গ্রাহক ${N_CUSTOMERS}`);
  const r = rng(20260925);

  const existing = await db.user.count({ where: { email: { startsWith: 'sim-', endsWith: '@sim.invalid' } } });
  if (existing > 0 && existing !== N_CUSTOMERS) {
    console.error(`✗ ${existing} সিম-গ্রাহক আছে (প্রত্যাশিত ০ বা ${N_CUSTOMERS}) — sim DB নতুন করে বানান`);
    process.exit(1);
  }
  if (existing === N_CUSTOMERS) {
    // ★ পৃথিবী আগেই তৈরি — কেবল অ্যাডমিন-সেটআপ আবার (idempotent)
    console.log('  পৃথিবী আগেই আছে — কেবল সেটআপ ধাপ');
    await setup();
    return;
  }

  const hash = await bcrypt.hash(SIM_PASSWORD, 12);
  const rows: Array<{ id?: string; name: string; email: string; phone: string; password: string; referralCode: string; emailVerified: boolean }> = [];
  const meta: Array<{ i: number; email: string; persona: Persona; device: string; network: string; referredBy: number | null }> = [];

  for (let i = 0; i < N_CUSTOMERS; i++) {
    const persona = weighted(r, PERSONAS);
    const n = String(i).padStart(6, '0');
    rows.push({
      name: `Sim Customer ${n}`,
      email: `sim-${n}@sim.invalid`,
      // ★ বৈধ BD ফরম্যাট (০১৯ + ৮ অঙ্ক) কিন্তু সিম-ক্রমিক
      phone: `019${String(10_000_000 + i).slice(-8)}`,
      password: hash,
      referralCode: `SIM${n}`,
      emailVerified: true,
    });
    // ★ ~১০% গ্রাহক অন্য কারও রেফারেলে এসেছেন (রেফারেল-বোনাসের পথও চলে)
    const referredBy = i > 100 && r.chance(0.10) ? r.int(0, i - 1) : null;
    meta.push({ i, email: rows[i].email, persona, device: weighted(r, DEVICES), network: weighted(r, NETWORKS), referredBy });
  }

  const t = Date.now();
  for (let k = 0; k < rows.length; k += 1000) {
    await db.user.createMany({ data: rows.slice(k, k + 1000) });
  }
  // রেফারেল সংযোগ (একই টেবিলে দ্বিতীয় পাস — id এখন জানা)
  const ids = await db.user.findMany({ where: { email: { endsWith: '@sim.invalid' } }, select: { id: true, email: true } });
  const idOf = new Map(ids.map((u) => [u.email, u.id]));
  for (const m of meta) {
    if (m.referredBy === null) continue;
    await db.user.update({ where: { email: m.email }, data: { referredById: idOf.get(meta[m.referredBy].email)! } });
  }
  console.log(`  ✓ ${ids.length} গ্রাহক (${((Date.now() - t) / 1000).toFixed(1)}s) · রেফারেল ${meta.filter((m) => m.referredBy !== null).length}`);

  saveJson('world.json', {
    createdAt: new Date().toISOString(),
    customers: N_CUSTOMERS,
    personaCounts: Object.fromEntries(PERSONAS.map(([p]) => [p, meta.filter((m) => m.persona === p).length])),
    deviceCounts: Object.fromEntries(DEVICES.map(([d]) => [d, meta.filter((m) => m.device === d).length])),
    networkCounts: Object.fromEntries(NETWORKS.map(([d]) => [d, meta.filter((m) => m.network === d).length])),
    referred: meta.filter((m) => m.referredBy !== null).length,
    meta,
  });
  console.log('  ✓ audit/sim/world.json');
  await setup();
}

async function setup() {
  // ── দ্বিতীয় অ্যাডমিন — বহু-অ্যাডমিন সংঘর্ষ পরীক্ষার জন্য ──
  await db.user.upsert({
    where: { email: 'admin2@sim.invalid' },
    update: {},
    create: {
      name: 'Sim Admin B', email: 'admin2@sim.invalid', phone: '01899999902',
      password: await bcrypt.hash('SimAdminB#2026', 12), role: 'ADMIN', referralCode: 'SIMADMINB', emailVerified: true,
    },
  });

  // ── সেটিংস — **অ্যাডমিন API দিয়েই** (আসল পথ, অডিট-লগসহ) ──
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } });
  const ac = await mintCookie(admin);
  const s = await call('setup settings', ac, 'POST', '/api/admin/settings', {
    withdrawal_enabled: '1',
    withdrawal_min: '100',
    withdrawal_daily_cap: '25000',
    // ★ সিমুলেশনের "দিন" কয়েক মিনিটে সংকুচিত — ৭২ ঘণ্টার hold এখানে সবাইকে
    //   আটকে দিত। hold-এর আচরণ আলাদা করে races ধাপে ৭২ ঘণ্টায় পরীক্ষিত।
    withdrawal_hold_hours: '0',
  });
  console.log(`  ✓ প্রত্যাহার চালু (HTTP ${s.status})`);

  // ── কুপন — অ্যাডমিন API দিয়ে ──
  const coupons = [
    { code: 'SIMSAVE10', type: 'PERCENT', value: 10, minOrder: 100, maxDiscount: 150, usageLimit: null, perUserLimit: 3 },
    { code: 'SIMFLAT20', type: 'FIXED', value: 20, minOrder: 200, usageLimit: 3000, perUserLimit: 2 },
  ];
  for (const c of coupons) {
    const res = await call('setup coupon', ac, 'POST', '/api/admin/coupon', c);
    console.log(`  কুপন ${c.code}: HTTP ${res.status} ${res.json?.error ?? ''}`);
  }
  if (s.status !== 200) process.exitCode = 1;
}

if (process.argv[1]?.includes('01-world')) {
  main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
}
