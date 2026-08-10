/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Error reporter — প্রোডাকশন exception ট্র্যাকিং
 *
 *   ── কেন vendor SDK নয় ──
 *   Sentry-এর পুরো `@sentry/nextjs` SDK bundle ভারী করে এবং
 *   একটি নির্দিষ্ট vendor-এ বেঁধে ফেলে। এই দোকানের যা দরকার তা
 *   সামান্য: একটি production exception হলে সেটা কোথাও পৌঁছে যাক
 *   যাতে অপারেটর টের পায়। তাই এখানে একটি **provider-agnostic**
 *   sink: `SENTRY_DSN` থাকলে Sentry-র store endpoint-এ পাঠায়;
 *   না থাকলে চুপচাপ কিছুই করে না (কোনো নতুন dependency নেই)।
 *
 *   ── কীভাবে চালু হয় ──
 *   env-এ `SENTRY_DSN` (Sentry project → Client Keys → DSN) বসালেই
 *   চালু। DSN না থাকলে `isConfigured()` false — health check তা দেখায়।
 *
 *   ⚠️ এটি logger-এর choke point (logger.ts) থেকে কেবল `error`
 *      লেভেলে ডাকা হয় — তাই কল-সাইট বদলাতে হয় না।
 *
 *   ⚠️ fire-and-forget: রিপোর্টিং কখনো মূল রেসপন্স ব্লক/ভাঙে না।
 *
 *   ★★★ Group H (১০ আগস্ট ২০২৬) — **scrubbing যোগ করা হলো।**
 *
 *   আগের মন্তব্যে দাবি ছিল "কোনো গোপন মান পাঠায় না — meta আগেই
 *   logger-এ redact হয়ে আসে"। `meta` সত্যিই পাঠানো হয় না, কিন্তু
 *   **বার্তা ও exception-এর নিজের টেক্সট** পাঠানো হয়, আর সেখানেই
 *   আসল ঝুঁকি: ডাটাবেস/লাইব্রেরির ত্রুটি-বার্তায় প্রায়ই আসল মান
 *   প্রতিধ্বনিত হয় — ইমেইল, ফোন, TrxID, টাকার অঙ্ক, এমনকি কী।
 *   একটি তৃতীয় পক্ষের সার্ভিসে সেসব পাঠানো মানে গ্রাহকের তথ্য
 *   দোকানের বাইরে চলে যাওয়া।
 *
 *   তাই যা কিছু বাইরে যায় তার সবই `scrubForReport()` দিয়ে যায়:
 *   বার্তা, exception-এর মান, এবং stack-এর প্রতিটি লাইন।
 *   RUN.md §GROUP H: "Scrub PII and money amounts from breadcrumbs."
 * ═══════════════════════════════════════════════════════════
 */

/**
 * ★★★ বাইরে পাঠানোর আগে সংবেদনশীল অংশ ঢেকে দেওয়া।
 *
 *   ⚠️ ইচ্ছাকৃতভাবে **আক্রমণাত্মক**: সন্দেহ হলে ঢেকে দেওয়াই নিয়ম।
 *   একটি ঢাকা পড়া অঙ্ক ডিবাগিং সামান্য কঠিন করে; একটি ফাঁস হওয়া
 *   ফোন নাম্বার ফেরানো যায় না।
 *
 *   ⚠️ যা **ঢাকা হয় না**: cuid/uuid আইডি ও ফাইল-পাথ। ওগুলো ছাড়া
 *   রিপোর্ট কার্যত অকেজো হয়ে যেত, আর সেগুলো নিজে থেকে কারও পরিচয়
 *   বা টাকার অঙ্ক বলে না।
 *
 *   export করা হয়েছে কেবল টেস্টের জন্য — এটি সরাসরি ডাকার দরকার নেই।
 */
export function scrubForReport(input: string): string {
  if (!input) return input;

  return (
    input
      // ── কী ও টোকেন (সবার আগে — এদের ভেতরে সংখ্যাও থাকে) ──
      .replace(/\buidk_[A-Za-z0-9_-]+/g, '<api-key>')
      .replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/gi, '<key>')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer <token>')
      .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization)\b\s*[=:]\s*\S+/gi,
        (_m, k) => `${k}=<redacted>`)
      // ── পরিচয় ──
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
      // BD মোবাইল: 01XXXXXXXXX, +8801…, 8801…
      .replace(/(?:\+?88)?01[3-9]\d{8}\b/g, '<phone>')
      // ── টাকার অঙ্ক ──
      // মুদ্রা-চিহ্নিত: ৳500, Tk 1,200.50, BDT 99
      .replace(/(৳|\bTk\.?|\bBDT)\s*[\d,]+(?:\.\d+)?/gi, '<amount>')
      // দুই দশমিকের খালি সংখ্যা — এই কোডবেসে কার্যত সবসময়ই টাকা
      // (`round2`/`toFixed(2)` এর ফল)
      //   ⚠️ `\d+` দিয়ে শুরু — `\d{1,3}` লিখলে `4999.50` ফসকে যেত
      //   (কমা ছাড়া চার অঙ্ক), অথচ কোডে অঙ্ক প্রায়ই কমা ছাড়াই থাকে।
      .replace(/\b\d+(?:,\d{3})*\.\d{2}\b/g, '<amount>')
      // ── লম্বা সংখ্যা: UID, TrxID, কার্ড-সদৃশ ──
      //   ⚠️ ফোন/অঙ্কের পরে চালানো হয় যাতে সেগুলো নিজ নামেই ঢাকা পড়ে
      .replace(/\b\d{6,}\b/g, '<digits>')
  );
}

type ParsedDsn = {
  endpoint: string;
  publicKey: string;
  projectId: string;
};

/** Sentry DSN → ingest endpoint. ফরম্যাট: https://<key>@<host>/<projectId> */
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/store/`,
      publicKey: u.username,
      projectId,
    };
  } catch {
    return null;
  }
}

const DSN = process.env.SENTRY_DSN?.trim();
const parsed = DSN ? parseDsn(DSN) : null;

export function isErrorReportingConfigured(): boolean {
  return Boolean(parsed);
}

/** throttle — একই বার্তার বন্যা ঠেকাতে প্রতি ইনস্ট্যান্সে হালকা সীমা */
let sent = 0;
let windowStart = Date.now();
const MAX_PER_WINDOW = 30;
const WINDOW_MS = 60 * 1000;

function underRateLimit(): boolean {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    sent = 0;
  }
  if (sent >= MAX_PER_WINDOW) return false;
  sent += 1;
  return true;
}

/**
 * ★ একটি exception রিপোর্ট করো। DSN না থাকলে বা rate-limit ছাড়ালে
 *   নীরবে return করে। কখনো throw করে না।
 */
export function reportError(
  scope: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (!parsed) return;
  if (!underRateLimit()) return;

  try {
    const errObj = meta?.err ?? meta?.error;
    const errMessage =
      errObj instanceof Error ? errObj.message : message;
    const errType =
      errObj instanceof Error ? errObj.name : 'Error';
    const stack = errObj instanceof Error ? errObj.stack : undefined;

    const payload = {
      event_id: crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      logger: scope,
      environment: process.env.NODE_ENV || 'production',
      server_name: process.env.VERCEL_REGION || undefined,
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      // ★★★ Group H — বাইরে যাওয়া প্রতিটি টেক্সট scrub হয়ে যায়।
      //   তিনটি জায়গাই ঢাকতে হয়: বার্তা, exception-এর মান, ও stack।
      //   stack-এর লাইনেও মান থাকতে পারে (যেমন Prisma কোয়েরির অংশ)।
      message: { formatted: scrubForReport(`[${scope}] ${message}`) },
      exception: {
        values: [
          {
            type: errType,
            value: scrubForReport(errMessage),
            ...(stack
              ? {
                  stacktrace: {
                    frames: stack
                      .split('\n')
                      .slice(1, 30)
                      .map((line) => ({ function: scrubForReport(line.trim()) })),
                  },
                }
              : {}),
          },
        ],
      },
    };

    const authHeader =
      `Sentry sentry_version=7, sentry_client=uidtopup/1, ` +
      `sentry_key=${parsed.publicKey}`;

    // fire-and-forget — await করি না, তাই মূল ফ্লো ব্লক হয় না
    void fetch(parsed.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': authHeader,
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      // রিপোর্টিং ব্যর্থ হলেও অ্যাপ চলবে — এটাই মূল উদ্দেশ্য
    });
  } catch {
    // কোনো অবস্থাতেই রিপোর্টার নিজে crash করবে না
  }
}
