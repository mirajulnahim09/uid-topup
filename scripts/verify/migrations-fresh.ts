/**
 * Migration test on an empty database (audit 2026-10-31, category 17).
 *
 * The Vitest harness builds its schema with `prisma db push`, so the CHECK
 * constraints and the AdminLog append-only triggers that live only in
 * `prisma/migrations/` are never present in the test DB. This script proves
 * them directly:
 *
 *   1. create a scratch database on the docker test server (localhost:5433),
 *   2. `prisma migrate deploy` every migration into it, in order,
 *   3. `prisma migrate status` must report it up to date,
 *   4. each money constraint must reject a bad row, and accept a good one,
 *   5. AdminLog UPDATE / DELETE / TRUNCATE must be refused, and the explicit
 *      purge switch must still work,
 *   6. drop the scratch database.
 *
 * Run: npx tsx scripts/verify/migrations-fresh.ts
 * Never touches DATABASE_URL from .env — the URL is built here and guarded.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from 'pg';

const require = createRequire(__filename);
const SERVER = process.env.MIGTEST_SERVER_URL || 'postgresql://test:test@localhost:5433';
const DB = 'uidtopup_migcheck_test';

const host = new URL(SERVER).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`refusing: migration test server must be local, got ${host}`);
  process.exit(1);
}
const DB_URL = `${SERVER}/${DB}`;

let pass = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, note = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${note ? ` — ${note}` : ''}`); }
}

function prisma(args: string[]) {
  const pj = require('prisma/package.json') as { bin: Record<string, string> };
  const entry = require.resolve(`prisma/${pj.bin.prisma.replace(/^\.\//, '')}`);
  const env = { ...process.env, DATABASE_URL: DB_URL, DIRECT_URL: DB_URL };
  return spawnSync(process.execPath, [entry, ...args], { env, encoding: 'utf8' });
}

/** Run `sql`; return the Postgres error code, or null when it succeeded. */
async function attempt(c: Client, sql: string, params: unknown[] = []): Promise<string | null> {
  await c.query('SAVEPOINT s');
  try {
    await c.query(sql, params);
    await c.query('RELEASE SAVEPOINT s');
    return null;
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT s');
    return (e as { code?: string }).code ?? 'ERR';
  }
}

async function main() {
  const admin = new Client({ connectionString: `${SERVER}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);

  try {
    const deploy = prisma(['migrate', 'deploy']);
    check('prisma migrate deploy on an empty DB', deploy.status === 0, (deploy.stderr || deploy.stdout).slice(-400));
    const applied = (deploy.stdout.match(/migrations? (?:have been )?applied|Applying migration/g) || []).length;
    console.log(`        (${applied} apply lines)`);

    const status = prisma(['migrate', 'status']);
    check('prisma migrate status is up to date', status.status === 0 && /up to date/i.test(status.stdout), status.stdout.slice(-300));

    // schema.prisma must describe exactly what the migrations built (exit 0 = no drift)
    const drift = prisma(['migrate', 'diff', '--from-url', DB_URL, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code']);
    check('no drift between migrations and schema.prisma', drift.status === 0, (drift.stdout || drift.stderr).slice(0, 600));

    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query('BEGIN');

    const count = await c.query(`SELECT COUNT(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`);
    check('every migration row finished', count.rows[0].n >= 18, `finished=${count.rows[0].n}`);

    // fixtures
    await c.query(`INSERT INTO "User" (id,name,email,phone,password,"referralCode","updatedAt") VALUES ('u1','U','u1@x','01900000001','x','R1',NOW())`);
    await c.query(`INSERT INTO "Category" (id,name,slug) VALUES (1,'C','c')`);
    await c.query(`INSERT INTO "Product" (id,"categoryId",name,slug) VALUES (1,1,'P','p')`);
    await c.query(`INSERT INTO "Variant" (id,"productId",label,price) VALUES (1,1,'V',100)`);
    await c.query(`INSERT INTO "Order" (id,"userId","variantId","playerUid",subtotal,price,"productName","variantName") VALUES ('o1','u1',1,'123',100,100,'P','V')`);

    const CHECK = '23514';
    check('user_balance_positive rejects balance < 0', (await attempt(c, `UPDATE "User" SET balance = -0.01 WHERE id='u1'`)) === CHECK);
    check('user_balance_positive accepts 0', (await attempt(c, `UPDATE "User" SET balance = 0 WHERE id='u1'`)) === null);
    check('variant_price_positive rejects price < 0', (await attempt(c, `UPDATE "Variant" SET price = -1 WHERE id=1`)) === CHECK);
    check('variant_stock_valid rejects stock -2', (await attempt(c, `UPDATE "Variant" SET stock = -2 WHERE id=1`)) === CHECK);
    check('variant_stock_valid accepts -1 (unlimited)', (await attempt(c, `UPDATE "Variant" SET stock = -1 WHERE id=1`)) === null);
    check('order_price_valid rejects discount > subtotal', (await attempt(c, `UPDATE "Order" SET discount = 101 WHERE id='o1'`)) === CHECK);
    check('order_refund_valid rejects refundedAmount > price', (await attempt(c, `UPDATE "Order" SET "refundedAmount" = 100.01 WHERE id='o1'`)) === CHECK);
    check('order_refund_valid rejects refundedAmount < 0', (await attempt(c, `UPDATE "Order" SET "refundedAmount" = -1 WHERE id='o1'`)) === CHECK);
    check('order_refund_valid accepts refundedAmount = price', (await attempt(c, `UPDATE "Order" SET "refundedAmount" = 100 WHERE id='o1'`)) === null);
    check('deposit_amount_positive rejects 0', (await attempt(c,
      `INSERT INTO "Deposit" (id,"userId",method,amount,"trxId","senderNo") VALUES ('d0','u1','BKASH',0,'TRX0','01900000001')`)) === CHECK);
    check('withdrawal_amount_positive rejects 0', (await attempt(c,
      `INSERT INTO "Withdrawal" (id,"userId",amount,method,"accountNumber","updatedAt") VALUES ('w0','u1',0,'BKASH','01900000001',NOW())`)) === CHECK);
    check('VoucherCode_assignment_check rejects ASSIGNED without order', (await attempt(c,
      `INSERT INTO "VoucherCode" (id,"variantId",code,status) VALUES ('v0',1,'C0','ASSIGNED')`)) === CHECK);
    check('VoucherCode_assignment_check rejects AVAILABLE with order', (await attempt(c,
      `INSERT INTO "VoucherCode" (id,"variantId",code,status,"orderId") VALUES ('v1',1,'C1','AVAILABLE','o1')`)) === CHECK);
    check('VoucherCode_assignment_check accepts ASSIGNED with order', (await attempt(c,
      `INSERT INTO "VoucherCode" (id,"variantId",code,status,"orderId") VALUES ('v2',1,'C2','ASSIGNED','o1')`)) === null);
    check('VoucherCode orderId unique — second code for same order refused', (await attempt(c,
      `INSERT INTO "VoucherCode" (id,"variantId",code,status,"orderId") VALUES ('v3',1,'C3','ASSIGNED','o1')`)) === '23505');

    await c.query(`INSERT INTO "AdminLog" (id,"adminId","adminName",action) VALUES ('a1','u1','U','TEST')`);
    const DENY = '42501';
    check('AdminLog UPDATE refused', (await attempt(c, `UPDATE "AdminLog" SET action='X' WHERE id='a1'`)) === DENY);
    check('AdminLog DELETE refused', (await attempt(c, `DELETE FROM "AdminLog" WHERE id='a1'`)) === DENY);
    check('AdminLog TRUNCATE refused', (await attempt(c, `TRUNCATE "AdminLog"`)) === DENY);
    await c.query(`SET LOCAL app.allow_adminlog_purge = 'on'`);
    check('AdminLog DELETE allowed with explicit purge switch', (await attempt(c, `DELETE FROM "AdminLog" WHERE id='a1'`)) === null);

    await c.query('ROLLBACK');
    await c.end();
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.end();
  }

  console.log(`\nmigrations-fresh: ${pass} pass, ${failures.length} fail`);
  if (failures.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
