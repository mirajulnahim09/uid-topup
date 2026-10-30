import { PrismaClient, Prisma } from '@prisma/client';
import { assertEnv } from './env';
import { logger } from './logger';

// ★ DB ছোঁয়ার আগেই env যাচাই — ভুল কনফিগ নীরবে পাশ কাটাতে পারবে না
assertEnv();

const g = globalThis as unknown as { prisma?: PrismaClient };

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ক্ষণস্থায়ী সংযোগ-ত্রুটিতে স্বয়ংক্রিয় পুনঃচেষ্টা
 *
 *   কেন দরকার: Neon (serverless Postgres) ঘুমিয়ে গেলে বা
 *   connection pool ভরে গেলে প্রথম কোয়েরিটি ব্যর্থ হয় — যদিও
 *   এক মুহূর্ত পরেই সংযোগ ঠিক হয়ে যায়। QA তে এতে ওয়ালেট পেজ
 *   পুরোপুরি ভেঙে গিয়েছিল (BUG-07)।
 *
 *   ⚠️ শুধুমাত্র সেই ত্রুটিগুলোতেই retry করা হয় যেগুলোতে কোয়েরি
 *   সার্ভারে **পৌঁছায়ইনি** — তাই দুইবার চলার (double-spend) কোনো
 *   ঝুঁকি নেই:
 *
 *     P2024 — pool থেকে সংযোগ পেতে timeout (কোয়েরি চলেনি)
 *     P1001 — সার্ভারে পৌঁছানো যায়নি (কোয়েরি চলেনি)
 *
 *   P1017 ("server closed the connection") ইচ্ছাকৃতভাবে বাদ —
 *   ওখানে কোয়েরি চলেছে কিনা নিশ্চিত নয়, তাই টাকার হিসাবে
 *   পুনঃচেষ্টা করা বিপজ্জনক।
 * ═══════════════════════════════════════════════════════════
 */
const RETRYABLE = new Set(['P2024', 'P1001']);

/** ★ এর বেশি সময় নিলে কোয়েরিটি লগ হয় (`SLOW_QUERY_MS` env দিয়ে বদলানো যায়) */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) > 0 ? Number(process.env.SLOW_QUERY_MS) : 100;
export const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 150;

/** ত্রুটিটি কি "কোয়েরি চলেইনি" ধরনের? — শুধু তখনই retry নিরাপদ */
export function isRetryableDbError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE.has(e.code)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ★ পুনঃচেষ্টার মূল লজিক — আলাদা করে রাখা হয়েছে যাতে
 *   সরাসরি টেস্ট করা যায় (Prisma middleware এর ভেতরে
 *   attempt গোনা যায় না, কারণ retry তে next() সরাসরি
 *   query engine এ যায়)।
 */
export async function withDbRetry<T>(
  run: () => Promise<T>,
  onRetry?: (attempt: number, err: unknown) => void
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (e) {
      lastErr = e;
      if (!isRetryableDbError(e) || attempt === MAX_ATTEMPTS) throw e;
      onRetry?.(attempt, e);
      // exponential backoff — ঠান্ডা Neon endpoint জেগে ওঠার সময় দেয়
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

function createClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  client.$use(async (params, next) => {
    const t0 = performance.now();
    try {
      return await withDbRetry(() => next(params));
    } finally {
      const ms = performance.now() - t0;
      // ★ SRE — ধীর কোয়েরি রিয়েল-টাইমে Vercel লগে। শুধু model/action/সময় —
      //   `params.args` কখনো নয়: তাতে ইমেইল, TrxID, টাকার অঙ্ক থাকে (PII)।
      //   `warn`, `error` নয়: প্রতিটি ধীর কোয়েরি Sentry-তে গেলে কোটা শেষ হতো।
      //   খরচ: প্রতি কোয়েরিতে দুটি performance.now() — নগণ্য।
      if (ms >= SLOW_QUERY_MS) {
        logger.warn('db', 'slow query', {
          model: params.model ?? 'raw', action: params.action, ms: Math.round(ms),
          inTx: Boolean(params.runInTransaction),
        });
      }
    }
  });

  return client;
}

/**
 * ★★★ SCL-01 — রো-লকের অপেক্ষার সীমা (transaction-এর প্রথম কাজ হিসেবে ডাকুন)
 *
 *   মাপা হয়েছে (tests/tx-contention.test.ts): Prisma-র `timeout` চলমান
 *   কোয়েরি **থামায় না** — অন্য কেউ variant-রো ধরে রাখলে অর্ডার-অনুরোধ
 *   ১৫ সে.-এর timeout সত্ত্বেও ~৫৪ সে. ঝুলে ছিল, যতক্ষণ না লকটি ছাড়া হয়।
 *   `SET LOCAL lock_timeout` Postgres-কে নিজেই অপেক্ষা থামাতে বলে (55P03) —
 *   transaction rollback হয় আর `apiError` ৫০৩ + Retry-After দেয়।
 *   `LOCAL` = শুধু এই transaction-এ; pooler-এ অন্য সংযোগে ছড়ায় না।
 */
export const TX_LOCK_TIMEOUT = '8s';
export async function boundLockWait(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${TX_LOCK_TIMEOUT}'`);
}

export const prisma = g.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
