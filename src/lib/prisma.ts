import { PrismaClient, Prisma } from '@prisma/client';
import { assertEnv } from './env';

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

  client.$use((params, next) => withDbRetry(() => next(params)));

  return client;
}

export const prisma = g.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
