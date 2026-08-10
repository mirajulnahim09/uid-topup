import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group H — Upstash Redis (REST), **ক্যাশ ও কাউন্টার মাত্র**
 *
 *   ── কেন কোনো নতুন dependency নেই ──
 *   Upstash-এর REST API সাধারণ HTTPS POST: বডিতে কমান্ডটি একটি
 *   JSON অ্যারে, হেডারে Bearer টোকেন। `@upstash/redis` প্যাকেজটি
 *   এর উপর একটি পাতলা মোড়ক মাত্র। এই প্রকল্পে ইতিমধ্যেই
 *   `errorReporter.ts` একই কারণে vendor SDK ছাড়া চলে —
 *   একই রীতি রাখা হলো (CLAUDE.md §2.2(৮): অযাচিত নির্ভরতা নয়)।
 *
 *   ── অলঙ্ঘনীয় নিয়ম (RUN.md §GROUP H) ──
 *   **Postgres-ই সত্যের উৎস। Redis কখনো খতিয়ান নয়** — কেবল ক্যাশ
 *   ও কাউন্টার। এখানকার প্রতিটি ফাংশন ব্যর্থ হলে `null` ফেরে,
 *   কখনো throw করে না; কল-সাইট তখন Postgres-এর পথেই চলে যায়।
 *
 *   ⚠️ কনফিগার করা না থাকলে (আজকের অবস্থা) প্রতিটি কল সাথে সাথে
 *   `null` ফেরে — একটিও নেটওয়ার্ক কল হয় না, আচরণ হুবহু আগের মতো।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ Redis ধীর হলে সেটি যেন অনুরোধকেই ধীর না করে */
const TIMEOUT_MS = 1_000;

function config(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

export function isRedisConfigured(): boolean {
  return config() !== null;
}

/**
 * ★ একাধিক কমান্ড এক রাউন্ড-ট্রিপে (Upstash `/pipeline`)।
 *
 *   @returns প্রতিটি কমান্ডের ফল, অথবা **যেকোনো** সমস্যায় `null`।
 *   ⚠️ আংশিক ফল কখনো ফেরে না: একটি কমান্ড ব্যর্থ হলে পুরোটাই
 *   অবিশ্বস্ত ধরা হয়, কারণ কল-সাইট সেগুলোকে একসাথে ব্যাখ্যা করে।
 */
export async function redisPipeline(
  commands: Array<Array<string | number>>,
): Promise<unknown[] | null> {
  const cfg = config();
  if (!cfg || commands.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn('redis', 'pipeline http error', { status: res.status });
      return null;
    }

    const body = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(body) || body.length !== commands.length) return null;
    if (body.some((r) => r?.error)) {
      logger.warn('redis', 'pipeline command error', {
        first: body.find((r) => r?.error)?.error,
      });
      return null;
    }

    return body.map((r) => r?.result ?? null);
  } catch (e) {
    // ★ টাইমআউট বা সংযোগ ব্যর্থতা — নীরব অবনতি, কিন্তু লগ থাকে
    logger.warn('redis', 'unreachable', { err: e instanceof Error ? e.name : String(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** ★ একটিমাত্র কমান্ড */
export async function redisCmd(cmd: Array<string | number>): Promise<unknown | null> {
  const out = await redisPipeline([cmd]);
  return out ? out[0] : null;
}

export async function redisGet(key: string): Promise<string | null> {
  const v = await redisCmd(['GET', key]);
  return typeof v === 'string' ? v : null;
}

/** @returns সফল হলে `true`; Redis না থাকলে/ব্যর্থ হলে `false` */
export async function redisSetEx(key: string, value: string, ttlSec: number): Promise<boolean> {
  return (await redisCmd(['SET', key, value, 'EX', ttlSec])) !== null;
}

export async function redisDel(key: string): Promise<boolean> {
  return (await redisCmd(['DEL', key])) !== null;
}

/**
 * ★★★ রেট-লিমিট কাউন্টার — INCR + মেয়াদ।
 *
 *   ⚠️ কেন `EXPIRE` কেবল প্রথমবার: প্রতিবার মেয়াদ নতুন করে বসালে
 *   উইন্ডোটি "sliding" হয়ে যেত — অর্থাৎ কেউ ক্রমাগত চেষ্টা করলে
 *   কাউন্টার কখনো রিসেটই হতো না এবং সে চিরতরে আটকে থাকত।
 *   Postgres-এর বিদ্যমান আচরণ (স্থির উইন্ডো) হুবহু ধরে রাখা হলো।
 *
 *   @returns `{ count, ttl }` — অথবা Redis অনুপলব্ধ হলে `null`,
 *            তখন কল-সাইট Postgres-এর পথে যায়।
 */
export async function redisIncrWindow(
  key: string,
  windowSec: number,
): Promise<{ count: number; ttl: number } | null> {
  const first = await redisPipeline([
    ['INCR', key],
    ['TTL', key],
  ]);
  if (!first) return null;

  const count = Number(first[0]);
  let ttl = Number(first[1]);
  if (!Number.isFinite(count)) return null;

  // ★ TTL < 0 মানে মেয়াদ বসানো নেই (নতুন কী, বা আগেরবার EXPIRE ব্যর্থ)।
  //   বসাতে ব্যর্থ হলেও গণনা ঠিকই হয়েছে — তখন উইন্ডো ধরে নিই,
  //   কারণ কাউন্টার থাকা মেয়াদ থাকার চেয়ে বেশি জরুরি।
  if (!Number.isFinite(ttl) || ttl < 0) {
    await redisCmd(['EXPIRE', key, windowSec]);
    ttl = windowSec;
  }

  return { count, ttl };
}
