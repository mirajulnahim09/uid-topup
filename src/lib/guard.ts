import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
// ★ side-effect: zod-এর ডিফল্ট ইংরেজি বার্তা বাংলায় (প্রতিটি API রুট guard ব্যবহার করে)
import './zodBangla';
import { logger } from './logger';
import { authOptions } from './auth';
import { prisma } from './prisma';
import { isSessionRevoked } from './sessionRevocation';

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

/**
 * ★★★ multipart ফর্ম নিরাপদে পড়া — `readJson`-এর জোড়া।
 *
 *   ⚠️ কেন দরকার (স্বাধীন অডিটে মাপা, ২০২৬-০৯-১৮): `req.formData()` বডি
 *   multipart না হলে (যেমন কেউ JSON বা text/plain পাঠালে) throw করে, আর
 *   সেটি `apiError`-এ গিয়ে **৫০০** হতো — অর্থাৎ ক্লায়েন্টের ভুলে "সার্ভার
 *   ত্রুটি", error-লেভেল লগ এবং **টেলিগ্রামে ভুয়া ops-সতর্কতা**। তিনটি
 *   আপলোড-রুটেই (গ্রাহক ও অ্যাডমিন) মাপা হয়েছে।
 */
export async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw new ApiError('ফাইল আপলোডের ফরম্যাট সঠিক নয় — ফর্ম হিসেবে পাঠান', 400);
  }
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

  // ★ AUTH-05 — সেশন-বাতিল-তালিকা একই সাথে (সমান্তরালে) — বাড়তি অপেক্ষা নেই
  const [user, revoked] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, role: true, isBanned: true, sessionEpoch: true },
    }),
    isSessionRevoked(session.user.sid),
  ]);

  if (!user) throw new ApiError('ইউজার পাওয়া যায়নি', 401);
  // ★★★ AUTH-05 — এই ডিভাইস থেকে লগআউট করা হয়েছে (কপি করা কুকিও একই sid বহন করে)
  if (revoked) throw new ApiError('আপনি লগআউট করেছেন — আবার লগইন করুন', 401);
  if (user.isBanned) throw new ApiError('আপনার অ্যাকাউন্ট বন্ধ করা হয়েছে', 403);

  /**
   * ★★★ সেশন-যুগ (`sessionEpoch`) — "সব ডিভাইস থেকে সাইন-আউট", পাসওয়ার্ড
   *   রিসেট ও অ্যাডমিন-রিকভারি এটি বাড়ায়। আগে যাচাই হতো কেবল NextAuth-এর
   *   jwt callback-এ, **৫ মিনিটে একবার** — মাপা: revoke-all-এর পরেও পুরনো
   *   সেশন ৩০১ সেকেন্ড অর্ডার/প্রত্যাহার করতে পারত। এখন প্রতিটি API অনুরোধে,
   *   **একই কোয়েরিতেই** (বাড়তি DB কল নয়)।
   *   ⚠️ পুরনো টোকেনে দাবিটি নেই (`undefined`) — তখন পুরনো আচরণই থাকে (0 ধরা হয়)
   *   যাতে চলমান বৈধ সেশনগুলো অকারণে বেরিয়ে না যায়; epoch বাড়লে তারাও বাতিল হবে।
   */
  const claimed = typeof session.user.epoch === 'number' ? session.user.epoch : 0;
  if (claimed !== user.sessionEpoch) {
    throw new ApiError('আপনার সেশন বাতিল করা হয়েছে — আবার লগইন করুন', 401);
  }

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

/**
 * ★★★ ক্লায়েন্টের পাঠানো **বিকৃত মান** থেকে জন্মানো Prisma-ত্রুটি চেনা।
 *
 *   কেন দরকার (মাপা — `scripts/verify/malformed-requests.ts`, ৯৯০ অনুরোধ):
 *   ৩৭টি ভুল ইনপুট ৪০০-এর বদলে **৫০০** দিত — `{ id: {} }`, `id: 1.5`,
 *   `99999999999` (INT4-এ ধরে না), URL-এ `%00` (Postgres 22021), আর
 *   অস্তিত্বহীন সারি হালনাগাদ (P2025)। দোষ ক্লায়েন্টের, অথচ প্রতিটি
 *   "সার্ভারে সমস্যা" দেখাত, error-লগে জমত ও প্রতি ১০ মিনিটে টেলিগ্রামে
 *   ভুয়া সতর্কতা পাঠাত — যে কেউ `/api/uid/recent?productId=99999999999`
 *   বারবার ডেকে অপারেটরকে অ্যালার্টে ডুবিয়ে দিতে পারত।
 *
 *   প্রতিটি রুটে আলাদা পাহারা বসালে ১৩টি ফাইল ছুঁতে হতো, আর চৌদ্দতম
 *   রুটে কেউ ভুলে যেত। তাই শ্রেণি ধরে এখানে একবার।
 *
 *   ⚠️ কেবল এই শ্রেণিগুলো — সংযোগ-বিচ্ছেদ বা অন্য যেকোনো ডাটাবেস-ত্রুটি
 *   আগের মতোই ৫০০ ও সতর্কতা (timeout/deadlock/write-conflict এখন আলাদা —
 *   নিচের `transientDbContention`, SCL-01)। আর `warn` স্তরে লগ হয়, তাই
 *   সত্যিকারের প্রোগ্রামিং-ভুল হলেও লগে দেখা যায়, হারিয়ে যায় না।
 */
function clientCausedDbError(e: unknown): { status: number; message: string } | null {
  if (e instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, message: 'অনুরোধের ডেটা সঠিক নয়' };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
    return { status: 404, message: 'খুঁজে পাওয়া যায়নি' };
  }
  /**
   * ★ ক্লায়েন্টের পাঠানো মান DB-র ধরনে বসেই না — সার্ভারের দোষ নয়, তাই ৪০০।
   *
   *   ⚠️ আগে কেবল `PrismaClientUnknownRequestError` দেখা হতো। কিন্তু raw query
   *   (`$queryRaw … FOR UPDATE`) ব্যর্থ হলে Prisma **`KnownRequestError` (P2010)**
   *   ছোড়ে — মাপা (EXTREME অডিট, ২০২৬-০৯-১৮): `orderId`/`userId`-তে null-byte
   *   (`\0`) পাঠালে Postgres `22021` ("invalid byte sequence for encoding
   *   UTF8: 0x00") → ব্যবহারকারী পেতেন **৫০০** ও ops-এ ভুয়া "সার্ভার ত্রুটি"।
   *   এখন দুই শ্রেণির বার্তাই একই নিয়মে দেখা হয়।
   */
  const dbCodes = /ConversionError\(|code: "?22021"?|code: "?22P02"?|code: "?22003"?|22021|22P02|22003/;
  if (
    (e instanceof Prisma.PrismaClientUnknownRequestError ||
      (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2010' || e.code === 'P2023'))) &&
    dbCodes.test(e.message)
  ) {
    return { status: 400, message: 'অনুরোধের ডেটা সঠিক নয়' };
  }
  return null;
}

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SCL-01 — ভিড়জনিত ক্ষণস্থায়ী DB-ত্রুটি → ৫০৩ + Retry-After
 *
 *   ফ্ল্যাশ-সেলে একই প্যাকেজের সবাই একই variant-রো-র `FOR UPDATE`-এর জন্য
 *   লাইনে দাঁড়ায়। তখন আসে: P2028 (transaction-এর সময় শেষ/শুরু করা যায়নি),
 *   P2034 (write-conflict বা deadlock), আর raw query-তে Postgres 40P01
 *   (deadlock) / 40001 (serialization) / 55P03 (lock পাওয়া যায়নি)। আগে এগুলো
 *   সাধারণ ৫০০ "সার্ভারে সমস্যা" + ops-সতর্কতা দিত — গ্রাহক বুঝতেন না অর্ডার
 *   হলো কি না, আর বারবার চাপতেন।
 *
 *   এগুলোতে transaction **rollback** হয় (কিছুই commit হয়নি), তাই সৎ উত্তর:
 *   "অনুরোধটি সম্পন্ন হয়নি, একটু পরে আবার চেষ্টা করুন" — ৫০৩ ও Retry-After।
 *   ⚠️ বার্তায় "টাকা কাটা হয়নি" দাবি করা হয় না — এই হ্যান্ডলার সব রুটের, আর
 *   প্রতিটি রুটে সেটি প্রমাণ করা যায় না। ভিড় বাগ নয়, লোড — তাই `warn` লগ,
 *   টেলিগ্রাম-পেজ নয়।
 * ═══════════════════════════════════════════════════════════
 */
const CONTENTION_PG = /40P01|40001|55P03|deadlock detected|could not serialize access/;
export const BUSY_RETRY_AFTER_SEC = 5;

function transientDbContention(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2034' || e.code === 'P2028') return true;
    if (e.code === 'P2010' && CONTENTION_PG.test(e.message)) return true;
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError && CONTENTION_PG.test(e.message)) return true;
  return false;
}

/** সব API route এর error handler */
export function apiError(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json(
      e.code ? { error: e.message, code: e.code } : { error: e.message },
      { status: e.status }
    );
  }

  if (transientDbContention(e)) {
    logger.warn('api', 'db contention — 503', {
      code: (e as { code?: string }).code,
      err: e instanceof Error ? e.message.slice(-200) : String(e),
    });
    return Response.json(
      {
        error: 'এই মুহূর্তে অনেক ভিড় — অনুরোধটি সম্পন্ন হয়নি। কয়েক সেকেন্ড পর আবার চেষ্টা করুন।',
        code: 'BUSY',
      },
      { status: 503, headers: { 'Retry-After': String(BUSY_RETRY_AFTER_SEC) } },
    );
  }

  const clientCaused = clientCausedDbError(e);
  if (clientCaused) {
    logger.warn('api', 'client-caused db error', {
      status: clientCaused.status,
      err: e instanceof Error ? e.message.slice(-300) : String(e),
    });
    return Response.json({ error: clientCaused.message }, { status: clientCaused.status });
  }

  logger.error('api', 'unexpected error', { err: e });
  warnOpsAboutServerError(e);
  return Response.json(
    { error: 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।' },
    { status: 500 }
  );
}
