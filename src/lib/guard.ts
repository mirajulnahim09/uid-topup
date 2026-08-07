import { getServerSession } from 'next-auth';
import { logger } from './logger';
import { authOptions } from './auth';
import { prisma } from './prisma';

export class ApiError extends Error {
  /**
   * ★ ঐচ্ছিক মেশিন-পাঠযোগ্য কোড।
   *
   *   কেন দরকার: একই HTTP status একাধিক কারণে আসতে পারে। যেমন 409
   *   হয় "অর্ডার আর বদলানো যাবে না", আবার "অন্য অ্যাডমিন ধরে আছে"
   *   (3.7) — প্রথমটায় থামতে হবে, দ্বিতীয়টায় টেক-ওভার জিজ্ঞেস করতে
   *   হবে। বাংলা বার্তা মিলিয়ে পার্থক্য করা ভঙ্গুর — বার্তা বদলালেই
   *   ভেঙে যেত। তাই কোড।
   *
   *   পুরনো সব `throw new ApiError(msg, status)` অপরিবর্তিত কাজ করে।
   */
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * ★★★ নিরাপদ JSON বডি পাঠক — বিকৃত বডি ৪০০, ৫০০ নয়।
 *
 *   কেন দরকার: `await req.json()` বডি পার্স করতে না পারলে (ভাঙা JSON,
 *   খালি বডি, ভুল Content-Type) `SyntaxError` ছোড়ে। সেটা `ApiError`
 *   নয়, তাই `apiError()` তাকে "সার্ভারে সমস্যা হয়েছে" ৫০০ বানায় —
 *   অথচ দোষ ক্লায়েন্টের, সার্ভারের নয়। ফলে মনিটরিং-এ ভুয়া সার্ভার
 *   এরর জমে আর ক্লায়েন্ট ভুল বার্তা পায়।
 *
 *   `null`/প্রিমিটিভ টপ-লেভেল মানও আটকানো হয়: `JSON.parse('null')`
 *   সফল হয়, কিন্তু পরের `const { id } = null` আবার ৫০০ ছুড়ত।
 *
 *   জেনেরিক ডিফল্ট `any` — যাতে বিদ্যমান destructuring ও
 *   `schema.safeParse(...)` কল-সাইট হুবহু আগের মতোই টাইপ-চেক করে।
 */
export async function readJson<T = any>(req: Request): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError('অনুরোধের ডেটা পড়া যায়নি', 400);
  }
  if (body === null || typeof body !== 'object') {
    throw new ApiError('অনুরোধের ডেটা সঠিক নয়', 400);
  }
  return body as T;
}

export type Role = 'USER' | 'ADMIN';

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

/** লগইন বাধ্যতামূলক — ban check সহ */
export async function requireUser(): Promise<SafeUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new ApiError('লগইন করুন', 401);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isBanned: true },
  });

  if (!user) throw new ApiError('ইউজার পাওয়া যায়নি', 401);
  if (user.isBanned) throw new ApiError('আপনার অ্যাকাউন্ট বন্ধ করা হয়েছে', 403);

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * ★★★ অ্যাডমিন অনুমতি — DB থেকেও role verify হয়
 *
 *   ⚠️ এই প্ল্যাটফর্মে প্রশাসনিক ভূমিকা **একটিই**: `ADMIN` (মালিক)।
 *   ডিপোজিট অনুমোদন, অর্ডার প্রসেসিং, ব্যালেন্স সমন্বয়, গ্রাহক
 *   ব্যবস্থাপনা, সার্চ, রিফান্ড, সেটিংস — সবই মালিকের হাতে।
 *   স্তরভিত্তিক (STAFF) ভূমিকা ইচ্ছাকৃতভাবে **রাখা হয়নি**, যাতে
 *   অনুমতির নিয়ম একটাই থাকে এবং কোথায় কার কী ক্ষমতা তা নিয়ে
 *   কোনো অস্পষ্টতা না থাকে।
 */
export async function requireAdmin(): Promise<SafeUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new ApiError('অনুমতি নেই', 403);
  return user;
}

/**
 * ★ সার্ভার-সতর্কতা থ্রটল।
 *
 *   কেন দরকার: একটি ভাঙা endpoint সেকেন্ডে বহুবার ৫০০ দিতে পারে।
 *   প্রতিটির জন্য টেলিগ্রাম বার্তা পাঠালে অপারেটর-গ্রুপ বন্যায় ভেসে
 *   যেত এবং টেলিগ্রামের rate-limit-ও ধাক্কা খেত। প্রতি ১০ মিনিটে
 *   একটি বার্তাই যথেষ্ট — সমস্যা আছে সেটা জানানোই উদ্দেশ্য,
 *   প্রতিটি ঘটনার হিসাব দেওয়া নয় (সেটা `/admin/logs`-এর কাজ)।
 *
 *   ইন-মেমরি, অর্থাৎ প্রতি সার্ভার-ইনস্ট্যান্সে আলাদা — serverless-এ
 *   কয়েকটি বাড়তি বার্তা যেতে পারে। DB-ভিত্তিক থ্রটল করলে প্রতিটি
 *   ৫০০-তে একটি DB লেখা লাগত, অর্থাৎ ডাটাবেস বসে গেলে সেটিও ব্যর্থ হতো।
 */
let lastServerWarnAt = 0;
const SERVER_WARN_THROTTLE_MS = 10 * 60 * 1000;

function warnOpsAboutServerError(e: unknown): void {
  const now = Date.now();
  if (now - lastServerWarnAt < SERVER_WARN_THROTTLE_MS) return;
  lastServerWarnAt = now;

  // ★ ডাইনামিক import — `guard.ts` প্রায় সব রুট লোড করে; উপরে
  //   স্থির import দিলে টেলিগ্রাম স্তরটি সবখানে টেনে আনত।
  import('./telegram')
    .then(({ telegramEvent }) => {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return telegramEvent(
        'server_warning',
        '⚠️ সার্ভার ত্রুটি',
        `একটি অপ্রত্যাশিত ৫০০ ত্রুটি হয়েছে — ${msg.slice(0, 180)}`,
        '/admin/logs',
      );
    })
    .catch(() => {
      // সতর্কতা পাঠাতে ব্যর্থ হলেও মূল রেসপন্স অক্ষত থাকবে
    });
}

/** সব API route এর error handler */
export function apiError(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json(
      e.code ? { error: e.message, code: e.code } : { error: e.message },
      { status: e.status }
    );
  }

  logger.error('api', 'unexpected error', { err: e });
  warnOpsAboutServerError(e);
  return Response.json(
    { error: 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।' },
    { status: 500 }
  );
}
