/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ HTTP টেস্ট হারনেস — আসল অ্যাপ চালু করে, টেস্ট ডাটাবেসে (Group D)
 *
 *   ── কেন রুট-হ্যান্ডলার সরাসরি না ডেকে HTTP ──
 *   double-spend ও coupon-race টেস্টের পুরো উদ্দেশ্যই হলো **সত্যিকারের
 *   সমান্তরাল অনুরোধ** — middleware, NextAuth সেশন, `requireUser()`,
 *   Prisma কানেকশন পুল, Postgres row-lock — সব স্তর একসাথে। হ্যান্ডলার
 *   সরাসরি ডাকলে ঠিক সেই স্তরগুলোই বাদ পড়ত যেগুলো পরীক্ষা করার জন্য
 *   টেস্টটি লেখা। ধীর হলেও এটিই সঠিক।
 *
 *   ── `next build` + `next start`, not `next dev` (Next 15 upgrade) ──
 *   The suite runs against a production build, i.e. what Vercel serves.
 *   Measured on Next 15.5 / React 19.2: `next dev` embeds RSC debug info
 *   (the resolved value of every awaited server promise) in page HTML, so
 *   a page that loads a row and then calls notFound()/redirect() ships that
 *   row to the client in dev only. The HTML-leak assertions (IDOR, invoice,
 *   settings-leak, revoked-session pages) then fail on dev-only output and
 *   cannot tell a real leak from a dev artefact. Production output is what
 *   they are meant to judge (audit/runs/leak-probe.ts: start 18/19, dev 2/6).
 *
 *   Cookies: the build writes `__Secure-next-auth.session-token` with the
 *   Secure flag (authCookies.ts). The test Client's jar ignores cookie
 *   attributes and sends it over http, which is what a browser does on the
 *   https production site; `SESSION_COOKIE` (helpers/http.ts) is that name.
 *
 *   Build output goes to `.next-test` (NEXT_DIST_DIR), never `.next`.
 *   Build reuse: the build is skipped when `.next-test` was produced by this
 *   harness from byte-identical inputs (`buildFingerprint()`); any source,
 *   config, lockfile, .env or build-env change rebuilds. TEST_FORCE_BUILD=1
 *   always rebuilds.
 *
 *   ── সবচেয়ে বড় ঝুঁকি ও তার প্রমাণ ──
 *   ⚠️⚠️ সার্ভার ভুল করে **লাইভ Neon**-এ চললে আসল গ্রাহকের অর্ডার ও
 *   ডিপোজিট তৈরি হয়ে যেত। `.env`-এ প্রোডাকশন `DATABASE_URL` আছেই।
 *   মাপা হয়েছে: `@next/env` বিদ্যমান env var **ওভাররাইড করে না**,
 *   তাই স্পষ্ট করে পাঠানো TEST URL-ই জেতে। কিন্তু টাকার সিস্টেমে
 *   "মেপে দেখেছি" যথেষ্ট নয় — তাই নিচে `proveTestDatabase()` একটি
 *   canary ইউজার **শুধু টেস্ট DB-তে** বানিয়ে HTTP দিয়ে লগইন করে।
 *   সফল হলে সার্ভার নিশ্চিতভাবে টেস্ট DB পড়ছে। ব্যর্থ হলে পুরো রান
 *   থেমে যায় — একটি টেস্টও চলে না।
 * ═══════════════════════════════════════════════════════════
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  TEST_DATABASE_URL, TEST_BACKUP_SIGNING_KEY, TEST_NEXTAUTH_SECRET, TEST_ISOLATED_ENV, assertSafeTestUrl,
  applyIsolatedEnv, assertNoLiveEnv,
} from './helpers/testEnv';
import { SESSION_COOKIE } from './helpers/http';

const ROOT = path.resolve(__dirname, '..');
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
/**
 * The harness builds into its own folder (`distDir` from NEXT_DIST_DIR in
 * next.config.js), never `.next`: a `npm run dev` started from this folder
 * rewrites `.next` (measured 2026-10-31: a dev server deleted BUILD_ID and the
 * stamp of a harness build), and a harness build there would break that dev
 * server in turn. ROOT is this repository, so no other project's folder is reachable.
 */
const DIST_NAME = '.next-test';
const DIST = path.join(ROOT, DIST_NAME);
const BUILD_STAMP = path.join(DIST, 'test-harness-build.json');
const NEXT_ENV_DTS = path.join(ROOT, 'next-env.d.ts');

let server: ChildProcess | null = null;

/** Build inputs: tracked + untracked (not ignored) files that reach the bundle. */
const BUILD_INPUT = /^(src\/|public\/|prisma\/schema\.prisma$|package(-lock)?\.json$|next\.config\.js$|tsconfig\.json$|(tailwind|postcss)\.config\.[cm]?[jt]s$|\.env$)/;
/** Env that is fixed per run but changes per port; read at runtime, not inlined. */
const PER_RUN_ENV = new Set(['NEXTAUTH_URL', 'SSLCZ_BASE_URL', 'GAME_API_URL']);

/**
 * Hash of everything that can change the build output: the content of every
 * build input file plus the build env (minus per-run ports and process noise).
 * A mismatch, a missing BUILD_ID or a missing stamp means rebuild.
 */
function buildFingerprint(env: NodeJS.ProcessEnv): string {
  const h = createHash('sha256');
  const ls = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  if (ls.status !== 0) throw new Error(`git ls-files failed: ${ls.stderr}`);
  const files = ls.stdout.split('\0').filter((f) => BUILD_INPUT.test(f)).sort();
  for (const f of files) {
    const abs = path.join(ROOT, f);
    if (!existsSync(abs)) continue; // deleted in the working tree
    h.update(f).update('\0').update(readFileSync(abs)).update('\0');
  }
  // `.env` is git-ignored, so `ls-files` never lists it; hash it explicitly
  for (const f of ['.env', '.env.production', '.env.local', '.env.production.local']) {
    const abs = path.join(ROOT, f);
    if (existsSync(abs)) h.update(f).update('\0').update(readFileSync(abs)).update('\0');
  }
  const keys = [...Object.keys(TEST_ISOLATED_ENV), 'DIRECT_URL', 'STORAGE_DRIVER', 'TRUSTED_PROXY', 'STREAM_ENABLED', 'NEXT_DIST_DIR']
    .concat(Object.keys(env).filter((k) => k.startsWith('NEXT_PUBLIC_')))
    .filter((k) => !PER_RUN_ENV.has(k))
    .sort();
  for (const k of keys) h.update(`${k}=${env[k] ?? ''}\0`);
  return h.digest('hex');
}

/** Spawn and wait; on failure print the tail of the output (no secrets: build logs only). */
function run(args: string[], env: NodeJS.ProcessEnv, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [NEXT_BIN, ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
    p.stderr?.on('data', (b: Buffer) => { out += b.toString(); });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) return resolve();
      process.stderr.write(`[${label}] last output:\n${out.split('\n').slice(-60).join('\n')}\n`);
      reject(new Error(`${label} failed (exit ${code})`));
    });
  });
}

/**
 * What the build folder holds right now. Anything that writes into it after
 * our build (a `next dev`/`next build` given the same NEXT_DIST_DIR) rewrites
 * these manifests without touching our stamp, so a fingerprint match alone
 * could reuse a clobbered tree.
 */
function distState(): string | null {
  const files = ['BUILD_ID', 'build-manifest.json', 'prerender-manifest.json', 'server/app-paths-manifest.json'];
  const parts: string[] = [];
  for (const f of files) {
    const abs = path.join(DIST, f);
    if (!existsSync(abs)) return null;
    parts.push(`${f}:${statSync(abs).mtimeMs}`);
  }
  return `${readFileSync(path.join(DIST, 'BUILD_ID'), 'utf8').trim()}|${parts.join('|')}`;
}

/** `next build` with the test env, unless the build folder already holds this exact build. */
async function buildForTests(env: NodeJS.ProcessEnv): Promise<void> {
  const fingerprint = buildFingerprint(env);
  if (!process.env.TEST_FORCE_BUILD && existsSync(BUILD_STAMP)) {
    try {
      const stamp = JSON.parse(readFileSync(BUILD_STAMP, 'utf8'));
      const state = distState();
      if (stamp.fingerprint === fingerprint && state !== null && stamp.dist === state) {
        console.log('  ✓ production build is current for these inputs — reusing .next-test');
        return;
      }
    } catch { /* unreadable stamp → rebuild */ }
  }
  console.log(`  next build → ${DIST_NAME} (test env, test DB) …`);
  const t0 = Date.now();
  // `next build` points the git-ignored next-env.d.ts at its distDir; put back
  // whatever the developer's `.next` setup had
  const nextEnvBefore = existsSync(NEXT_ENV_DTS) ? readFileSync(NEXT_ENV_DTS) : null;
  try {
    await run(['build'], env, 'next build');
  } finally {
    if (nextEnvBefore) writeFileSync(NEXT_ENV_DTS, nextEnvBefore);
  }
  const dist = distState();
  if (dist === null) throw new Error('next build finished but .next is incomplete');
  writeFileSync(BUILD_STAMP, JSON.stringify({ fingerprint, dist, builtAt: new Date().toISOString() }));
  console.log(`  ✓ next build done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

/** ★ ০ পোর্টে bind করে OS-কেই একটি ফাঁকা পোর্ট বেছে নিতে দিই —
 *  হার্ডকোড করলে ডেভের চলমান `npm run dev` এর সাথে সংঘাত হতো। */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** ★ সার্ভার সাড়া দেওয়া পর্যন্ত অপেক্ষা। `next dev` চাহিদামতো compile
 *  করে, তাই প্রথম হিট ধীর — উদার timeout। */
async function waitForReady(baseUrl: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`Next সার্ভার চালুর আগেই বন্ধ হয়ে গেছে (exit ${server.exitCode})`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/auth/csrf`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`সার্ভার ${timeoutMs}ms এ প্রস্তুত হয়নি — শেষ ত্রুটি: ${lastErr}`);
}

/**
 * ★★★ প্রমাণ (অনুমান নয়): সার্ভার টেস্ট ডাটাবেস পড়ছে।
 *
 *   canary ইউজারটি **কেবল** টেস্ট DB-তে তৈরি হয়। সার্ভার যদি অন্য
 *   কোনো ডাটাবেসে (যেমন প্রোডাকশন Neon) থাকত, সেখানে এই ইমেইল নেই —
 *   লগইন ব্যর্থ হতো এবং আমরা সাথে সাথেই থামতাম, একটি সারিও লেখার আগে।
 */
async function proveTestDatabase(
  baseUrl: string,
  PrismaClient: new (o: { datasources: { db: { url: string } } }) => PrismaClientType,
): Promise<void> {
  const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  const email = `canary-${Date.now()}@test.local`;
  const password = 'CanaryPass!234';

  try {
    // ★ আগের রানের শেষ টেস্টের rate-limit বাকেট টেস্ট DB-তে থেকে যায় (truncate হয়
    //   প্রতিটি টেস্টের **আগে**, রানের শেষে নয়)। মাপা: `login:ip:unknown` = ১৩ > ১০ —
    //   পরের রানের canary লগইন আটকে পুরো রান "no tests" হয়ে থামত। কেবল টেস্ট DB।
    await db.rateLimitBucket.deleteMany({});

    await db.user.create({
      data: {
        email,
        name: 'DB Canary',
        phone: `C${Date.now().toString().slice(-9)}`,
        password: await bcrypt.hash(password, 10),
        referralCode: `CNRY${Date.now().toString(36).toUpperCase().slice(-6)}`,
      },
    });

    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const csrfCookie = (csrfRes.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');

    const res = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        cookie: csrfCookie,
      },
      body: new URLSearchParams({
        csrfToken,
        email,
        password,
        callbackUrl: baseUrl,
        json: 'true',
      }),
    });

    const gotSession = (res.headers.getSetCookie?.() ?? []).some(
      (c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`),
    );

    if (!gotSession) {
      throw new Error(
        `\n✗✗ থামানো হলো — সার্ভার টেস্ট ডাটাবেস পড়ছে বলে প্রমাণ করা গেল না।\n\n` +
          `  canary ইউজার (${email}) কেবল টেস্ট DB-তে তৈরি হয়েছে, কিন্তু\n` +
          `  HTTP লগইন ব্যর্থ হয়েছে। সম্ভাব্য কারণ:\n` +
          `    · সার্ভার অন্য ডাটাবেসে (⚠️ প্রোডাকশন?) সংযুক্ত\n` +
          `    · NEXTAUTH_SECRET অমিল\n\n` +
          `  কোনো টেস্ট চালানো হয়নি — এটি ইচ্ছাকৃত (CLAUDE.md §2.1)।\n`,
      );
    }

    await db.user.deleteMany({ where: { email } });
  } finally {
    await db.$disconnect();
  }
}

export async function setup({ provide }: { provide: (k: string, v: unknown) => void }) {
  assertSafeTestUrl();

  // ★★★ গোপন-মান বিচ্ছিন্নতা (helpers/testEnv.ts): `@prisma/client` import-এর
  //   আগেই এই প্রসেসের গোপন কী টেস্ট-মানে — নাহলে Prisma `.env` থেকে লাইভ মান
  //   বসাত আর নিচের `...rest` সেগুলো টেস্ট-সার্ভারে পৌঁছে দিত। লিক হলে থামে।
  const envBeforePrisma = applyIsolatedEnv();
  const { PrismaClient } = await import('@prisma/client');
  assertNoLiveEnv(envBeforePrisma);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  /**
   * ★ SSLCommerz mock গেটওয়ের পোর্ট এখানেই ঠিক করি।
   *
   *   ⚠️ কেন globalSetup-এ: mock সার্ভারটি **টেস্ট প্রসেসে** চলে,
   *   কিন্তু webhook হ্যান্ডলার চলে **Next প্রসেসে**। Next-এর env
   *   একবারই সেট হয় (spawn-এর সময়), তাই পরে `process.env` বদলালে
   *   সার্ভার তা দেখত না — receiver টেস্ট আসল SSLCommerz-এ কল করার
   *   চেষ্টা করত। পোর্ট আগে থেকে ঠিক করে দুই প্রসেসকেই জানিয়ে দিলে
   *   সমস্যাটি থাকে না।
   */
  const sslczMockPort = await freePort();

  /**
   * ★ Group G — ফুলফিলমেন্ট mock প্রোভাইডারের পোর্ট, ঠিক একই কারণে
   *   এখানেই ঠিক করা: ডেলিভারি-কল যায় **Next প্রসেস** থেকে, আর
   *   mock সার্ভারটি চলে **টেস্ট প্রসেসে**।
   *
   *   ⚠️ `GAME_API_URL`/`GAME_API_KEY` env-এ থাকা মানেই অটো-ডেলিভারি
   *   চালু নয় — `hub` তখনই একে বাছে যখন সেটিংসেও active করা হয়েছে,
   *   আর `order_approval` automatic। ডিফল্ট টেস্টগুলো তাই অপ্রভাবিত।
   */
  const fulfillMockPort = await freePort();

  // ★ প্রোডাকশন DATABASE_URL সাব-প্রসেসে **পাঠানো হয় না**।
  //   বাইরের নেটওয়ার্ক-কল করা কী-গুলো ফাঁকা — টেস্ট কখনো আসল
  //   ইমেইল/টেলিগ্রাম/ব্লব-এ পৌঁছাবে না (email.ts ও telegram/store.ts
  //   কী না থাকলে নীরবে skip করে — যাচাই করা হয়েছে)।
  const { DATABASE_URL: _prod, ...rest } = process.env;
  const env: NodeJS.ProcessEnv = {
    ...rest,
    // ★ `...rest`-এ Prisma-র বসানো লাইভ `.env` কী থাকে (এই ফাইলের PrismaClient
    //   import-এ) — সব গোপন/ইন্টিগ্রেশন কী এখানে টেস্ট-মানে ঢেকে দিই
    //   (helpers/testEnv.ts)। নিচের নির্দিষ্ট মানগুলো (mock URL ইত্যাদি) পরে বসে।
    ...TEST_ISOLATED_ENV,
    DATABASE_URL: TEST_DATABASE_URL,
    // O-15 — schema `directUrl`; never inherited from the shell or `.env`
    DIRECT_URL: TEST_DATABASE_URL,
    TEST_DATABASE_URL,
    // `next start` loads `.env`, not `.env.development`; keep the local driver
    // the dev harness had (uploads never reach Blob from tests)
    STORAGE_DRIVER: 'local',
    // isolated build folder (see DIST above) — same value for build and start
    NEXT_DIST_DIR: DIST_NAME,
    NEXTAUTH_URL: baseUrl,
    NEXTAUTH_SECRET: TEST_NEXTAUTH_SECRET,
    RESEND_API_KEY: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    BLOB_READ_WRITE_TOKEN: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    // ★ TRUSTED_PROXY ফাঁকা — তাই `pickIp()` ক্লায়েন্টের
    //   x-forwarded-for উপেক্ষা করে (H2 এর আচরণ, যেমন প্রোডাকশনে)
    TRUSTED_PROXY: '',
    // ★ BKP-01 — ব্যাকআপ-স্বাক্ষর চাবি (টেস্ট-কেবল); টেস্ট-প্রসেসও একই মান জানে
    BACKUP_SIGNING_KEY: TEST_BACKUP_SIGNING_KEY,
    // ★ CFG-01 — প্রতিটি টেস্টের আগে টেবিল খালি হয়; থ্রটল ০ হলে IP-অনুপস্থিতির
    //   DB-চিহ্ন প্রতিবার লেখা হয় (প্রোডাকশনে ১০ মিনিটে একবার)
    CLIENT_IP_WARN_THROTTLE_MS: '0',
    // ★ SSLCommerz ড্রাইভার আসল গেটওয়ের বদলে mock-এ কল করবে।
    //   ⚠️ টেস্ট কখনো sandbox.sslcommerz.com-এ পৌঁছাবে না।
    SSLCZ_BASE_URL: `http://127.0.0.1:${sslczMockPort}`,
    // ★ Group G — mock ডেলিভারি প্রোভাইডার
    GAME_API_URL: `http://127.0.0.1:${fulfillMockPort}/deliver`,
    GAME_API_KEY: 'test-fulfill-key',
    // ★ ৩s — টাইমআউট-টেস্ট যেন ১৫ সেকেন্ড ধরে ঝুলে না থাকে
    GAME_API_TIMEOUT_MS: '3000',
    // ★ RT-01 — SSE-স্ট্রিমের প্রমাণীকরণ/সীমা পরীক্ষার জন্য কেবল টেস্ট-সার্ভারে চালু
    //   (প্রোডাকশনের ডিফল্ট বন্ধই — কোনো ক্লায়েন্ট এখনো স্ট্রিম ব্যবহার করে না)
    STREAM_ENABLED: '1',
  };

  // ★ টেস্ট-সার্ভারের চূড়ান্ত env-ও একই গার্ডে — কেবল mock ডেলিভারি কী ইচ্ছাকৃত
  assertNoLiveEnv(new Set(Object.keys(env)), env, ['GAME_API_URL', 'GAME_API_KEY']);
  // O-15 — both URLs Prisma can use, checked on the env the build and server get
  assertSafeTestUrl(env.DATABASE_URL);
  assertSafeTestUrl(env.DIRECT_URL);

  try {
    await buildForTests(env);

    server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // never leave a server holding the port if vitest exits without teardown
    process.once('exit', killServer);

    // ★ সার্ভারের ত্রুটি গিলে ফেলা যাবে না — টেস্ট ফেল করলে কারণ
    //   সাধারণত এখানেই থাকে। শুধু error/warn ছাপি।
    server.stderr?.on('data', (b: Buffer) => {
      const s = b.toString();
      if (/error|Error|unhandled/.test(s)) process.stderr.write(`[next] ${s}`);
    });
    server.stdout?.on('data', (b: Buffer) => {
      const s = b.toString();
      if (/Error|error:/.test(s)) process.stdout.write(`[next] ${s}`);
    });

    console.log(`  next start → ${baseUrl} (test DB)`);
    await waitForReady(baseUrl);
    await proveTestDatabase(baseUrl, PrismaClient);
    console.log('  ✓ প্রমাণিত: সার্ভার টেস্ট ডাটাবেস পড়ছে');
  } catch (e) {
    killServer();
    throw e;
  }

  provide('baseUrl', baseUrl);
  provide('sslczMockPort', sslczMockPort);
  provide('fulfillMockPort', fulfillMockPort);
}

/** Synchronous so it also works from `process.on('exit')`. Only our own child tree. */
function killServer(): void {
  if (!server || server.exitCode !== null) return;
  const pid = server.pid;
  server = null;
  if (!pid) return;

  // ★ Next কর্মী-প্রসেস তৈরি করে। উইন্ডোজে শুধু parent kill করলে
  //   সেগুলো বেঁচে থাকে ও পোর্ট ধরে রাখে — তাই পুরো গাছ (/T) kill।
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    process.kill(pid, 'SIGTERM');
  }
}

export async function teardown() {
  killServer();
}
