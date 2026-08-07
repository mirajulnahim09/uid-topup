/**
 * ═══════════════════════════════════════════════════════════
 * ★ কেন্দ্রীয় লগার (প্রোডাকশন observability)
 *
 *   কেন দরকার: আগে ২৪টি জায়গায় ছড়ানো console.* ছিল। প্রোডাকশনে
 *   সমস্যা হলে খুঁজে বের করা কঠিন। এই একটি চোকপয়েন্ট দিয়ে সব লগ
 *   গেলে — (ক) প্রোডাকশনে structured JSON (Vercel/Datadog/CloudWatch
 *   সহজে পার্স করে), (খ) dev-এ পড়ার মতো সুন্দর আউটপুট, (গ) পরে
 *   Sentry/Datadog যোগ করতে হলে শুধু এখানে একবার — ২৪ ফাইলে নয়।
 *
 *   ব্যবহার:
 *     import { logger } from '@/lib/logger';
 *     logger.error('order', 'ডেবিট ব্যর্থ', { orderId, err });
 *     logger.warn('auth', 'rate limited', { ip });
 *     logger.info('email', 'পাঠানো হয়েছে', { to });
 * ═══════════════════════════════════════════════════════════
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// প্রোডাকশনে debug চাপা; dev-এ সব
const MIN_LEVEL: Level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const isProd = process.env.NODE_ENV === 'production';

/**
 * ★★★ গোপন তথ্য ছাঁকনি — লগে যাওয়ার শেষ প্রতিরক্ষা।
 *
 *   কেন লগারেই: টেলিগ্রাম টোকেন থাকে **URL-এর ভেতরে**
 *   (`api.telegram.org/bot<TOKEN>/…`), আর কিছু fetch/undici ত্রুটি
 *   বার্তা ও স্ট্যাকে পুরো URL জুড়ে দেয়। কল-সাইটে ছাঁকলে একটিমাত্র
 *   ভুলে যাওয়া জায়গাই যথেষ্ট — তাই চোকপয়েন্টে ছাঁকা হয়, যাতে
 *   **যেকোনো** scope থেকে আসা লগ ঢাকা পড়ে।
 *
 *   এখানে যোগ করার নিয়ম: নতুন কোনো secret যদি কখনো URL/বার্তায়
 *   আসতে পারে, তার প্যাটার্ন এই তালিকায় দিন।
 */
const SECRET_PATTERNS: { re: RegExp; with: string }[] = [
  // টেলিগ্রাম বট টোকেন: <bot_id>:<35-char secret>
  //
  //   ⚠️ শুরুতে `\b` ব্যবহার করা যাবে **না**। টোকেন সবচেয়ে বেশি ফাঁস
  //   হয় URL-এর ভেতরে — `…/bot8801466881:AA…` — যেখানে সংখ্যার আগের
  //   অক্ষর `t`, অর্থাৎ দুটোই word-char, তাই সেখানে কোনো word boundary
  //   **নেই** এবং `\b` দিলে ঠিক সবচেয়ে জরুরি কেসটাই ফসকে যায়
  //   (একটি টেস্ট এটি ধরেছিল)। তাই lookbehind: আগে সংখ্যা না থাকলেই হলো।
  { re: /(?<!\d)\d{6,12}:[A-Za-z0-9_-]{20,}/g, with: '<token:redacted>' },
  // Bearer / api key হেডার-সদৃশ স্ট্রিং
  { re: /(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, with: '$1<redacted>' },
  // postgres/mysql সংযোগ স্ট্রিং-এর পাসওয়ার্ড অংশ
  { re: /(:\/\/[^:@\s]+:)[^@\s]+(@)/g, with: '$1<redacted>$2' },
];

function redactString(s: string): string {
  let out = s;
  for (const p of SECRET_PATTERNS) out = out.replace(p.re, p.with);
  return out;
}

/** স্ট্রিং, অ্যারে ও অবজেক্টের ভেতরে ঢুকে ছেঁকে আনে */
function deepRedact(v: unknown, depth = 0): unknown {
  if (depth > 4) return v;
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map((x) => deepRedact(x, depth + 1));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = deepRedact(val, depth + 1);
    }
    return out;
  }
  return v;
}

/** Error অবজেক্টকে নিরাপদ, সিরিয়ালাইজযোগ্য আকারে আনি */
function serializeErr(e: unknown): unknown {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: redactString(e.message),
      // স্ট্যাক শুধু নন-প্রোডে (প্রোডাকশন লগে সংক্ষিপ্ত রাখি)
      ...(isProd ? {} : { stack: e.stack ? redactString(e.stack) : undefined }),
    };
  }
  return deepRedact(e);
}

/** meta-অবজেক্টের ভেতরের err ফিল্ড সিরিয়ালাইজ করি */
function cleanMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = k === 'err' || k === 'error' || v instanceof Error ? serializeErr(v) : deepRedact(v);
  }
  return out;
}

function emit(level: Level, scope: string, msg: string, meta?: Record<string, unknown>) {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

  const cleaned = cleanMeta(meta);
  msg = redactString(msg);

  if (isProd) {
    // structured JSON — এক লাইন, log aggregator পার্স করতে পারে
    const line = JSON.stringify({
      t: new Date().toISOString(),
      level,
      scope,
      msg,
      ...(cleaned ? { meta: cleaned } : {}),
    });
    // stderr-এ warn/error, নাহলে stdout
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
    return;
  }

  // dev — পড়ার মতো
  const tag = `[${scope}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (cleaned) fn(tag, msg, cleaned);
  else fn(tag, msg);
}

/**
 * ★ Error reporter hook — একমাত্র চোকপয়েন্ট।
 *   `error` লেভেলের সব লগ এখান থেকেই exception-tracker-এ যায়
 *   (SENTRY_DSN থাকলে)। কল-সাইট কিছুই জানে না — logger.error()
 *   ডাকলেই স্বয়ংক্রিয়ভাবে রিপোর্ট হয়।
 *
 *   ⚠️ dynamic import — errorReporter খুব হালকা, কিন্তু logger প্রায়
 *      সব ফাইল লোড করে; static import দিলে অকারণে সবখানে টেনে আনত।
 *      fire-and-forget, তাই কখনো মূল ফ্লো ব্লক করে না।
 */
function forwardError(scope: string, msg: string, meta?: Record<string, unknown>) {
  import('./errorReporter')
    .then(({ reportError }) => reportError(scope, msg, meta))
    .catch(() => {});
}

export const logger = {
  debug: (scope: string, msg: string, meta?: Record<string, unknown>) => emit('debug', scope, msg, meta),
  info: (scope: string, msg: string, meta?: Record<string, unknown>) => emit('info', scope, msg, meta),
  warn: (scope: string, msg: string, meta?: Record<string, unknown>) => emit('warn', scope, msg, meta),
  error: (scope: string, msg: string, meta?: Record<string, unknown>) => {
    emit('error', scope, msg, meta);
    // ★ শুধু error লেভেল exception-tracker-এ যায় (নিচের hook দেখুন)
    forwardError(scope, msg, meta);
  },
};

/**
 * ভবিষ্যতে Sentry/Datadog যোগ করতে চাইলে এখানে একবার hook করুন:
 *   পরিবর্তন এই ফাইলেই — বাকি কোড অপরিবর্তিত থাকবে।
 *
 *   উদাহরণ:
 *     if (isProd && level === 'error') Sentry.captureException(...)
 */
