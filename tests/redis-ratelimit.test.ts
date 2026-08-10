/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group H — Redis কাউন্টার ও Postgres fallback
 *
 *   ── কী প্রমাণ করা দরকার ──
 *   ১. Redis থাকলে গণনা সেখানেই হয় এবং সীমা ঠিকঠাক কাজ করে
 *   ২. Redis **বন্ধ** হলে সিস্টেম চলে — Postgres পথেই সীমা বহাল
 *      (RUN.md: "If Redis is down the system still runs")
 *   ৩. সফল লগইনের `resetRateLimit()` Redis-এও পৌঁছায় — নাহলে
 *      ব্যবহারকারী নিজের সফল লগইন দিয়েই লক-আউট হতেন (এই বাগটি
 *      একবার প্রোডাকশনে ঘটেছিল)
 *   ৪. গ্রাহকের ইমেইল/IP কখনো Redis-এ যায় না — কী হ্যাশ করা
 *
 *   ⚠️ এই টেস্ট রেট-লিমিটারকে **সরাসরি** ডাকে (HTTP নয়), কারণ
 *   Next প্রসেসের env একবারই সেট হয়; Redis চালু/বন্ধ করে দেখা
 *   কেবল টেস্ট প্রসেসেই সম্ভব।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { rateLimit, peekRateLimit, resetRateLimit } from '../src/lib/rateLimit';
import { isRedisConfigured } from '../src/lib/redis';

/** ★ ন্যূনতম Upstash REST নকল — শুধু `/pipeline`, ইন-মেমরি স্টোর */
const store = new Map<string, { value: number; expiresAt: number }>();
let seenKeys: string[] = [];
let server: http.Server;
let url = '';

function run(cmd: string[]): unknown {
  const [name, key, ...rest] = cmd;
  if (key) seenKeys.push(key);
  const now = Date.now();
  const row = store.get(key);
  const live = row && row.expiresAt > now ? row : undefined;
  if (row && !live) store.delete(key);

  switch (name.toUpperCase()) {
    case 'INCR': {
      const next = (live?.value ?? 0) + 1;
      // ★★★ মেয়াদহীন = `Infinity`, আর TTL তখন **−১** (আসল Redis যা দেয়)।
      //   প্রথমে এখানে "এক ঘণ্টা" বসানো হয়েছিল, ফলে TTL ৩৬০০ ফিরত এবং
      //   `redisIncrWindow()` কখনো `EXPIRE` ডাকত না — অথচ টেস্ট পাস করত।
      //   অবিশ্বস্ত mock মানে অবিশ্বস্ত টেস্ট; তাই আচরণ হুবহু মেলানো হলো।
      store.set(key, { value: next, expiresAt: live?.expiresAt ?? Infinity });
      return next;
    }
    case 'TTL':
      if (!live) return -2;
      return live.expiresAt === Infinity ? -1 : Math.ceil((live.expiresAt - now) / 1000);
    case 'EXPIRE':
      if (!live) return 0;
      store.set(key, { value: live.value, expiresAt: now + Number(rest[0]) * 1000 });
      return 1;
    case 'GET':
      return live ? String(live.value) : null;
    case 'DEL':
      return store.delete(key) ? 1 : 0;
    default:
      return null;
  }
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-redis-token') {
        res.writeHead(401).end('{}');
        return;
      }
      let cmds: string[][] = [];
      try {
        cmds = JSON.parse(raw);
      } catch {
        res.writeHead(400).end('{}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cmds.map((c) => ({ result: run(c) }))));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  store.clear();
  seenKeys = [];
  process.env.UPSTASH_REDIS_REST_URL = url;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

const uniq = () => `test:${Math.random().toString(36).slice(2)}`;

describe('Redis কাউন্টার', () => {
  it('কনফিগার করা থাকলে গণনা Redis-এ হয়, Postgres-এ নয়', async () => {
    const key = uniq();
    const a = await rateLimit(key, 3, 60);
    const b = await rateLimit(key, 3, 60);

    expect(a.ok).toBe(true);
    expect(a.remaining).toBe(2);
    expect(b.remaining).toBe(1);

    // ★ Postgres স্পর্শই করা হয়নি
    const { db } = await import('../vitest.setup');
    expect(await db.rateLimitBucket.count({ where: { key } })).toBe(0);
  });

  it('সীমা ছাড়ালে আটকায় ও retryAfter দেয়', async () => {
    const key = uniq();
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60)).ok).toBe(true);

    const over = await rateLimit(key, 3, 60);
    expect(over.ok).toBe(false);
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(over.retryAfter).toBeLessThanOrEqual(60);
  });

  it('উইন্ডো sliding নয় — বারবার চেষ্টা করলেও মেয়াদ বাড়ে না', async () => {
    const key = uniq();
    await rateLimit(key, 10, 60);
    const firstTtl = (await peekRateLimit(key, 10)).retryAfter;

    await new Promise((r) => setTimeout(r, 1100));
    await rateLimit(key, 10, 60);
    const laterTtl = (await peekRateLimit(key, 10)).retryAfter;

    // ★ মেয়াদ কমেছে, রিসেট হয়নি — নাহলে কেউ ক্রমাগত চেষ্টা করে
    //   চিরতরে আটকে থাকত (বা কখনো আটকাত না)
    expect(laterTtl).toBeLessThan(firstTtl);
  });

  /** ★★★ এই স্যুটের সবচেয়ে গুরুত্বপূর্ণ টেস্ট */
  it('সফল লগইনের reset Redis-এও পৌঁছায়', async () => {
    const key = uniq();
    for (let i = 0; i < 5; i++) await rateLimit(key, 5, 900);
    expect((await rateLimit(key, 5, 900)).ok).toBe(false);

    await resetRateLimit(key);

    // ★ গণনা শূন্য থেকে শুরু — ব্যবহারকারী আর আটকে নেই
    const after = await rateLimit(key, 5, 900);
    expect(after.ok).toBe(true);
    expect(after.remaining).toBe(4);
  });

  it('peek গণনা বাড়ায় না ও একই উত্তর দেয়', async () => {
    const key = uniq();
    await rateLimit(key, 2, 60);
    await rateLimit(key, 2, 60);

    const p1 = await peekRateLimit(key, 2);
    const p2 = await peekRateLimit(key, 2);
    expect(p1.limited).toBe(false);
    expect(p2.limited).toBe(false);

    // ★ দুটি peek-এর পরেও সীমা ছাড়ায়নি — অর্থাৎ কিছু গোনা হয়নি
    expect((await rateLimit(key, 2, 60)).ok).toBe(false);
  });

  /** ★★★ গ্রাহকের তথ্য তৃতীয় পক্ষের ক্যাশে যায় না */
  it('ইমেইল/IP কখনো Redis-এ যায় না — কী হ্যাশ করা', async () => {
    await rateLimit('login:email:rakib.hasan@gmail.com', 5, 900);
    await rateLimit('forgot:ip:103.99.12.34', 5, 900);

    expect(seenKeys.length).toBeGreaterThan(0);
    for (const k of seenKeys) {
      expect(k).not.toContain('rakib.hasan@gmail.com');
      expect(k).not.toContain('103.99.12.34');
      expect(k).toMatch(/^rl:[0-9a-f]{32}$/);
    }
  });
});

describe('Redis বন্ধ — সিস্টেম চলে', () => {
  it('পৌঁছানো না গেলে Postgres পথেই সীমা বহাল', async () => {
    // ★ এমন একটি পোর্ট যেখানে কেউ নেই
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';
    const key = uniq();

    for (let i = 0; i < 2; i++) expect((await rateLimit(key, 2, 60)).ok).toBe(true);
    expect((await rateLimit(key, 2, 60)).ok).toBe(false);

    // ★ গণনা Postgres-এ হয়েছে — অর্থাৎ সত্যিই fallback নিয়েছে
    const { db } = await import('../vitest.setup');
    expect(await db.rateLimitBucket.count({ where: { key } })).toBe(1);
  }, 20_000);

  it('টোকেন ভুল হলেও (৪০১) সীমা কাজ করে', async () => {
    process.env.UPSTASH_REDIS_REST_TOKEN = 'wrong-token';
    const key = uniq();

    for (let i = 0; i < 2; i++) expect((await rateLimit(key, 2, 60)).ok).toBe(true);
    expect((await rateLimit(key, 2, 60)).ok).toBe(false);
  });

  it('কনফিগার না থাকলে একটিও Redis কল হয় না', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    expect(isRedisConfigured()).toBe(false);
    seenKeys = [];

    const key = uniq();
    expect((await rateLimit(key, 2, 60)).ok).toBe(true);
    expect(seenKeys).toHaveLength(0);
  });
});
