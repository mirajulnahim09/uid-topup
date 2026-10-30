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
 *   ── `next dev`, `next start` নয় ──
 *   ⚠️ প্রোডাকশন বিল্ডে কুকির নাম `__Secure-next-auth.session-token`
 *   এবং `secure: true` (auth.ts)। `__Secure-` উপসর্গ ও secure পতাকা
 *   দুটোই HTTPS বাধ্যতামূলক করে, তাই http://127.0.0.1-এ ব্রাউজার/fetch
 *   কুকিটি রাখেই না — প্রতিটি অথ-নির্ভর টেস্ট **মিথ্যা** ফেল করত।
 *   `next dev`-এ NODE_ENV=development, কুকি সাধারণ ও non-secure।
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
import net from 'node:net';
import path from 'node:path';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  TEST_DATABASE_URL, TEST_BACKUP_SIGNING_KEY, TEST_NEXTAUTH_SECRET, TEST_ISOLATED_ENV, assertSafeTestUrl,
  applyIsolatedEnv, assertNoLiveEnv,
} from './helpers/testEnv';

const ROOT = path.resolve(__dirname, '..');
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

let server: ChildProcess | null = null;

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
      (c) => c.startsWith('next-auth.session-token=') && !c.startsWith('next-auth.session-token=;'),
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
    TEST_DATABASE_URL,
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

  server = spawn(process.execPath, [NEXT_BIN, 'dev', '-p', String(port)], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // ★ সার্ভারের ত্রুটি গিলে ফেলা যাবে না — টেস্ট ফেল করলে কারণ
  //   সাধারণত এখানেই থাকে। শুধু error/warn ছাপি, নাহলে dev-এর
  //   compile লগে আসল বার্তা হারিয়ে যায়।
  server.stderr?.on('data', (b: Buffer) => {
    const s = b.toString();
    if (/error|Error|unhandled/.test(s)) process.stderr.write(`[next] ${s}`);
  });
  server.stdout?.on('data', (b: Buffer) => {
    const s = b.toString();
    if (/Error|error:/.test(s)) process.stdout.write(`[next] ${s}`);
  });

  console.log(`  Next dev চালু হচ্ছে → ${baseUrl} (টেস্ট DB)`);
  await waitForReady(baseUrl);
  await proveTestDatabase(baseUrl, PrismaClient);
  console.log('  ✓ প্রমাণিত: সার্ভার টেস্ট ডাটাবেস পড়ছে');

  provide('baseUrl', baseUrl);
  provide('sslczMockPort', sslczMockPort);
  provide('fulfillMockPort', fulfillMockPort);
}

export async function teardown() {
  if (!server || server.exitCode !== null) return;
  const pid = server.pid;
  if (!pid) return;

  // ★ `next dev` কর্মী-প্রসেস তৈরি করে। উইন্ডোজে শুধু parent kill করলে
  //   সেগুলো বেঁচে থাকে ও পোর্ট ধরে রাখে — তাই পুরো গাছ (/T) kill।
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
  server = null;
}
