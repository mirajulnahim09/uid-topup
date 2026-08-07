/**
 * ═══════════════════════════════════════════════════════════
 * ★ DB-level CHECK constraints প্রয়োগ করে — psql ছাড়াই।
 *
 *   কেন এই স্ক্রিপ্ট: `prisma/constraints.sql` চালাতে psql দরকার ছিল,
 *   যা অনেক মেশিনে/CI তে থাকে না। ফলে constraint গুলো বাস্তবে
 *   কোনো এনভায়রনমেন্টেই প্রয়োগ হতো না (AUDIT_REPORT.md H2)।
 *
 *   নিরাপত্তা: ALTER TABLE চালানোর আগে বিদ্যমান ডেটা যাচাই করা হয়।
 *   কোনো সারি নিয়ম ভাঙলে — স্ক্রিপ্ট থামবে এবং ঠিক কোথায় সমস্যা
 *   তা দেখাবে, ডাটাবেস অপরিবর্তিত রেখে।
 *
 *   চালানোর নিয়ম:  npm run db:constraints
 * ═══════════════════════════════════════════════════════════
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Guard = {
  name: string;
  table: string;
  /** ভাঙা সারি গোনার SQL — 0 না হলে constraint প্রয়োগ করা যাবে না */
  violationSql: string;
  /** constraint যোগ করার SQL */
  addSql: string;
  why: string;
};

const GUARDS: Guard[] = [
  {
    name: 'variant_price_positive',
    table: 'Variant',
    why: 'দাম কখনো negative হবে না',
    violationSql: `SELECT COUNT(*)::int AS n FROM "Variant" WHERE price < 0 OR "costPrice" < 0`,
    addSql: `ALTER TABLE "Variant" ADD CONSTRAINT variant_price_positive CHECK (price >= 0 AND "costPrice" >= 0)`,
  },
  {
    name: 'variant_stock_valid',
    table: 'Variant',
    why: 'স্টক −1 (আনলিমিটেড) এর কম হবে না',
    violationSql: `SELECT COUNT(*)::int AS n FROM "Variant" WHERE stock < -1`,
    addSql: `ALTER TABLE "Variant" ADD CONSTRAINT variant_stock_valid CHECK (stock >= -1)`,
  },
  {
    name: 'user_balance_positive',
    table: 'User',
    why: '★ ব্যালেন্স কখনো negative হবে না — সবচেয়ে জরুরি',
    violationSql: `SELECT COUNT(*)::int AS n FROM "User" WHERE balance < 0`,
    addSql: `ALTER TABLE "User" ADD CONSTRAINT user_balance_positive CHECK (balance >= 0)`,
  },
  {
    name: 'order_price_valid',
    table: 'Order',
    why: 'অর্ডারের দাম ও ছাড় — negative নয়, ছাড় subtotal ছাড়াবে না',
    violationSql: `SELECT COUNT(*)::int AS n FROM "Order" WHERE price < 0 OR discount < 0 OR subtotal < 0 OR discount > subtotal`,
    addSql: `ALTER TABLE "Order" ADD CONSTRAINT order_price_valid CHECK (price >= 0 AND discount >= 0 AND subtotal >= 0 AND discount <= subtotal)`,
  },
  {
    name: 'deposit_amount_positive',
    table: 'Deposit',
    why: 'ডিপোজিটের পরিমাণ ধনাত্মক',
    violationSql: `SELECT COUNT(*)::int AS n FROM "Deposit" WHERE amount <= 0`,
    addSql: `ALTER TABLE "Deposit" ADD CONSTRAINT deposit_amount_positive CHECK (amount > 0)`,
  },
  {
    name: 'coupon_value_valid',
    table: 'Coupon',
    why: 'কুপনের মান ধনাত্মক, শতকরা ১০০ এর বেশি নয়',
    violationSql: `SELECT COUNT(*)::int AS n FROM "Coupon" WHERE value <= 0 OR "minOrder" < 0 OR "usageCount" < 0 OR (type = 'PERCENT' AND value > 100)`,
    addSql: `ALTER TABLE "Coupon" ADD CONSTRAINT coupon_value_valid CHECK (value > 0 AND "minOrder" >= 0 AND "usageCount" >= 0 AND (type != 'PERCENT' OR value <= 100))`,
  },
];

async function countViolations(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(sql);
  return Number(rows?.[0]?.n ?? 0);
}

async function main() {
  console.log('🔒 DB constraint প্রয়োগ শুরু...\n');

  // ─── ধাপ ১: সব guard এর বিরুদ্ধে বিদ্যমান ডেটা যাচাই ───
  //   কোনো ALTER চালানোর আগেই — যাতে অর্ধেক প্রয়োগ হয়ে না থাকে
  const blocked: Array<{ guard: Guard; count: number }> = [];
  for (const g of GUARDS) {
    const n = await countViolations(g.violationSql);
    if (n > 0) blocked.push({ guard: g, count: n });
  }

  if (blocked.length > 0) {
    console.error('❌ বিদ্যমান ডেটা নিয়ম ভাঙছে — কোনো constraint প্রয়োগ করা হয়নি:\n');
    for (const b of blocked) {
      console.error(`   ✗ ${b.guard.name} (${b.guard.table}) — ${b.count} টি সারি`);
      console.error(`     ${b.guard.why}`);
    }
    console.error('\n   আগে ডেটা ঠিক করুন, তারপর আবার চালান।');
    process.exitCode = 1;
    return;
  }

  console.log('  ✓ বিদ্যমান সব ডেটা নিয়ম মানছে\n');

  // ─── ধাপ ২: প্রয়োগ (idempotent — DROP তারপর ADD) ───
  for (const g of GUARDS) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${g.table}" DROP CONSTRAINT IF EXISTS ${g.name}`
    );
    await prisma.$executeRawUnsafe(g.addSql);
    console.log(`  ✓ ${g.name} — ${g.why}`);
  }

  // ─── ধাপ ৩: সত্যিই বসেছে কিনা যাচাই ───
  const applied = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
    `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`,
    GUARDS.map((g) => g.name)
  );
  const appliedNames = new Set(applied.map((r) => r.conname));
  const missing = GUARDS.filter((g) => !appliedNames.has(g.name));

  if (missing.length > 0) {
    console.error(`\n❌ যাচাই ব্যর্থ — বসেনি: ${missing.map((m) => m.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n✅ ${GUARDS.length}/${GUARDS.length} constraint সক্রিয় ও যাচাইকৃত।`);
}

main()
  .catch((e) => {
    console.error('❌ constraint প্রয়োগ ব্যর্থ:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
