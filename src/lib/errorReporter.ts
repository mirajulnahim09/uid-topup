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
 *   ⚠️ কোনো গোপন মান পাঠায় না — meta আগেই logger-এ redact হয়ে আসে।
 * ═══════════════════════════════════════════════════════════
 */

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
      message: { formatted: `[${scope}] ${message}` },
      exception: {
        values: [
          {
            type: errType,
            value: errMessage,
            ...(stack
              ? {
                  stacktrace: {
                    frames: stack
                      .split('\n')
                      .slice(1, 30)
                      .map((line) => ({ function: line.trim() })),
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
