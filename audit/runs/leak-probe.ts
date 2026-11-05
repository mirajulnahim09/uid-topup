/**
 * Next 15 dev-vs-prod leak probe. Not part of the repo.
 *   npx tsx leak-probe.ts serve <dev|start> <port>   → runs Next with the test env
 *   npx tsx leak-probe.ts probe <baseUrl>            → runs the checks
 * Uses only the docker test DB (localhost:5433).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { TEST_ISOLATED_ENV, TEST_DATABASE_URL, TEST_NEXTAUTH_SECRET } from '../../tests/helpers/testEnv';
import { Client } from '../../tests/helpers/http';
import * as f from '../../tests/helpers/factories';

const ROOT = process.cwd();

async function serve(mode: string, port: string) {
  const { DATABASE_URL: _drop, DIRECT_URL: _drop2, ...rest } = process.env;
  const env = {
    ...rest, ...TEST_ISOLATED_ENV,
    DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL,
    NEXTAUTH_URL: `http://localhost:${port}`, NEXTAUTH_SECRET: TEST_NEXTAUTH_SECRET,
    TRUSTED_PROXY: '',
  };
  const bin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const p = spawn(process.execPath, [bin, mode, '-p', port], { cwd: ROOT, env, stdio: 'inherit' });
  p.on('exit', (c) => process.exit(c ?? 0));
}

async function probe(base: string) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.status) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const u = new URL(TEST_DATABASE_URL);
  if (u.hostname !== 'localhost' || u.port !== '5433' || !u.pathname.endsWith('_test')) throw new Error('not the docker test DB');
  const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  // same reset vitest.setup.ts does before every test
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  const login = async (email: string, pw: string) => {
    const c = new Client(base);
    // Client.hasSession only knows the dev cookie name; prove the session via /api/me
    await c.login(email, pw);
    const me = await c.get('/api/me');
    if (me.status !== 200) throw new Error(`login failed for ${email}: /api/me ${me.status}`);
    return c;
  };
  const results: Array<[string, boolean, boolean]> = []; // name, expected, actual
  const check = (name: string, expected: boolean, actual: boolean) => results.push([name, expected, actual]);

  const variant = await f.createVariant(db, { price: 100 });
  const a = await f.createUser(db, {});
  const b = await f.createUser(db, {});
  const order = await f.createCompletedOrder(db, { userId: a.id, variantId: variant.id });
  const SECRET = `PROBESECRET${Date.now()}`;
  await db.order.update({ where: { id: order.id }, data: { playerUid: SECRET, internalNote: `NOTE-${SECRET}` } });

  const ca = await login(a.email, a.plainPassword ?? f.DEFAULT_PASSWORD);
  const cb = await login(b.email, b.plainPassword ?? f.DEFAULT_PASSWORD);

  const own = await (await ca.raw(`/account/orders/${order.id}`)).text();
  check('owner sees own order UID (positive control)', true, own.includes(SECRET));
  check('owner page carries internalNote (admin-only field)', false, own.includes(`NOTE-${SECRET}`));

  for (const p of [`/account/orders/${order.id}`, `/account/orders/${order.id}/invoice`]) {
    const r = await cb.raw(p);
    const html = await r.text();
    check(`B on A's ${p} → secret in body (status ${r.status})`, false, html.includes(SECRET));
  }

  const admin = await f.createAdmin(db);
  const cadm = await login(admin.email, admin.plainPassword ?? f.DEFAULT_PASSWORD);
  const TG = `TG-${Date.now()}:AAH-probe-token`;
  await db.setting.upsert({ where: { key: 'telegram_bot_token' }, create: { key: 'telegram_bot_token', value: TG }, update: { value: TG } });
  const flush = await cadm.post('/api/admin/settings', { site_name: 'Probe Store Name' });
  const site = await (await cadm.raw('/admin/site')).text();
  check(`admin /admin/site contains allowlisted site_name (positive control, flush ${flush.status})`, true, site.includes('Probe Store Name'));
  check('admin /admin/site contains telegram_bot_token', false, site.includes(TG));

  // revoked session (epoch bump) must be sent to /login with no PII in the body
  const victim = await f.createUser(db, {});
  const cv = await login(victim.email, victim.plainPassword ?? f.DEFAULT_PASSWORD);
  const tree = (from: string[]) => {
    let node: unknown[] = ['__PAGE__', {}];
    for (let i = from.length - 1; i >= 0; i--) node = [from[i], { children: node }];
    return encodeURIComponent(JSON.stringify(['', { children: node }, null, null, true]));
  };
  const before = await (await cv.raw('/account/profile')).text();
  check('live session /account/profile shows own email (positive control)', true, before.includes(victim.email));
  await db.user.update({ where: { id: victim.id }, data: { sessionEpoch: { increment: 1 } } });
  for (const p of ['/account', '/account/profile', '/account/orders', '/account/wallet']) {
    const h = await cv.raw(p);
    const hb = await h.text();
    const hLogin = ([303, 307, 308].includes(h.status) && (h.headers.get('location') || '').includes('/login'))
      || (hb.includes('NEXT_REDIRECT') && hb.includes('/login'));
    check(`revoked hard ${p} → sent to /login (status ${h.status})`, true, hLogin);
    check(`revoked hard ${p} → email/phone in body`, false, hb.includes(victim.email) || (!!victim.phone && hb.includes(victim.phone)));
    const n = await cv.raw(p, { headers: { RSC: '1', 'Next-Router-State-Tree': tree(['account', 'orders']) } });
    const nb = await n.text();
    check(`revoked nav ${p} → email/phone in body`, false, nb.includes(victim.email) || (!!victim.phone && nb.includes(victim.phone)));
  }

  let bad = 0;
  for (const [name, exp, act] of results) {
    const ok = exp === act;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: expected ${exp}, got ${act}`);
  }
  console.log(`\n${base}: ${results.length - bad}/${results.length} as expected`);
  await db.$disconnect();
  process.exit(bad ? 1 : 0);
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'serve') serve(a1, a2);
else if (cmd === 'probe') probe(a1);
else { console.error('usage: serve <dev|start> <port> | probe <base>'); process.exit(2); }
