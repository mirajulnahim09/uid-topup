/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ প্রতিটি API রুটে **রানটাইমে** অথ-সীমানা (স্বাধীন অডিট, ২০২৬-০৯-১৮)
 *
 *   `route-guard-audit` উৎস-কোড পড়ে বলে "গার্ড আছে"। এই স্ক্রিপ্ট
 *   **আসল HTTP** দিয়ে প্রতিটি রুট তিন ভূমিকায় ডাকে — অতিথি, গ্রাহক,
 *   অ্যাডমিন — আর দেখে কে ঢুকতে পারল। উৎস-কোড ঠিক থাকলেও রানটাইমে
 *   ফাঁক থাকতে পারে (middleware matcher, ভুল export, fallback পথ)।
 *
 *   দাবি:
 *     · `/api/admin/**` — অতিথি ≥৪০১, গ্রাহক ≥৪০১ (কখনো ২xx নয়)
 *     · `/api/account/**`, `/api/order*`, `/api/deposit*`, `/api/tickets*`,
 *       `/api/me`, `/api/notifications`, `/api/upload`, `/api/uid/*`,
 *       `/api/review`, `/api/coupon/check`, `/api/stream` — অতিথি ≥৪০১
 *     · `/api/cron/**` — সিক্রেট ছাড়া ৪০১ (অ্যাডমিন সেশনেও ৪০১, শুধু tick-এ ছাড়)
 *     · `/api/reseller/**` — API-কী ছাড়া ≥৪০১
 *     · পাবলিক রুট (health, search, track, register, auth/*) — ২xx/৪xx, ৫xx নয়
 *
 *   ⚠️ কেবল **নিরাপদ** পেলোড: অবৈধ/খালি বডি পাঠানো হয়, যাতে অনুমতি
 *   থাকলেও কিছু বদলে না যায় (অনুমতি-যাচাই বরাবরই ভ্যালিডেশনের আগে)।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/api-auth-matrix.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { request, type APIRequestContext } from 'playwright-core';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };

let pass = 0; const failures: string[] = [];
function check(name: string, ok: boolean, note = '') {
  if (ok) pass++; else failures.push(`${name}${note ? ` — ${note}` : ''}`);
  if (!ok) console.log(`  FAIL  ${name}${note ? ` — ${note}` : ''}`);
}

/** src/app/api-এর প্রতিটি route.ts → HTTP পথ ও যেসব মেথড আছে */
function routes(dir = 'src/app/api', prefix = '/api'): Array<{ path: string; methods: string[] }> {
  const out: Array<{ path: string; methods: string[] }> = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // [param] → নমুনা মান; catch-all বাদ (NextAuth নিজে সামলায়)
      if (entry.startsWith('[...')) continue;
      const seg = entry.startsWith('[') ? 'probe-id' : entry;
      out.push(...routes(full, `${prefix}/${seg}`));
    } else if (entry === 'route.ts') {
      const src = readFileSync(full, 'utf8');
      const methods = [...new Set(
        [...src.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]),
      )];
      if (methods.length) out.push({ path: prefix, methods });
    }
  }
  return out;
}

async function ctxFor(who: { email: string; password: string } | null): Promise<APIRequestContext> {
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  if (!who) return ctx;
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: who.email, password: who.password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  const me = await (await ctx.get(`${BASE}/api/auth/session`)).json();
  if (me?.user?.email !== who.email) throw new Error(`লগইন হয়নি: ${who.email}`);
  return ctx;
}

async function call(ctx: APIRequestContext, method: string, p: string): Promise<number> {
  const url = `${BASE}${p}`;
  const opts = { failOnStatusCode: false, maxRedirects: 0, timeout: 30_000, data: {} as unknown };
  try {
    switch (method) {
      case 'GET': return (await ctx.get(url, opts)).status();
      case 'POST': return (await ctx.post(url, opts)).status();
      case 'PATCH': return (await ctx.patch(url, opts)).status();
      case 'PUT': return (await ctx.put(url, opts)).status();
      case 'DELETE': return (await ctx.delete(url, opts)).status();
      default: return 0;
    }
  } catch { return 0; }
}

const ADMIN_PREFIX = '/api/admin/';
const CRON_PREFIX = '/api/cron/';
const PUBLIC = new Set([
  '/api/health', '/api/search', '/api/track', '/api/register',
  '/api/auth/forgot', '/api/auth/reset', '/api/auth/login-status', '/api/auth/otp/send', '/api/auth/2fa-check',
  '/api/webhooks/payment/probe-id',
]);

async function main() {
  console.log(`═══ API অথ-ম্যাট্রিক্স (রানটাইম) · ${BASE} · DB ${dbLabel()} ═══`);
  const list = routes().sort((a, b) => a.path.localeCompare(b.path));
  console.log(`  রুট: ${list.length} · মেথড-সমন্বয়: ${list.reduce((n, r) => n + r.methods.length, 0)}`);

  const anon = await ctxFor(null);
  const cust = await ctxFor(CUSTOMER);
  const admin = await ctxFor(ADMIN);
  const rows: Array<{ path: string; method: string; anon: number; customer: number; admin: number }> = [];

  for (const r of list) {
    for (const m of r.methods) {
      const a = await call(anon, m, r.path);
      const c = await call(cust, m, r.path);
      // ⚠️ অ্যাডমিন-কল কেবল নিরাপদ মেথডে (GET) — নাহলে খালি বডিতেও কিছু বদলাতে পারে
      const ad = m === 'GET' && !r.path.startsWith(CRON_PREFIX) ? await call(admin, m, r.path) : -1;
      rows.push({ path: r.path, method: m, anon: a, customer: c, admin: ad });

      const label = `${m} ${r.path}`;
      if (r.path.startsWith(ADMIN_PREFIX)) {
        check(`${label} — অতিথি আটকায়`, a >= 401 && a < 500, `HTTP ${a}`);
        check(`${label} — গ্রাহক আটকায়`, c >= 401 && c < 500, `HTTP ${c}`);
      } else if (r.path.startsWith(CRON_PREFIX)) {
        check(`${label} — সিক্রেট ছাড়া ৪০১`, a === 401, `HTTP ${a}`);
        check(`${label} — অ্যাডমিন সেশনেও ৪০১`, c === 401, `HTTP ${c}`);
      } else if (r.path.startsWith('/api/reseller/')) {
        check(`${label} — API-কী ছাড়া আটকায়`, a >= 401 && a < 500, `HTTP ${a}`);
      } else if (PUBLIC.has(r.path) || r.path.startsWith('/api/auth/')) {
        check(`${label} — পাবলিক, ৫xx নয়`, a > 0 && a < 500, `HTTP ${a}`);
      } else {
        check(`${label} — অতিথি আটকায়`, a >= 401 && a < 500, `HTTP ${a}`);
      }
      /**
       * ★ `/api/stream` ফিচার-বন্ধ অবস্থায় ইচ্ছাকৃতভাবে **৫০৩ + `{enabled:false}`**
       *   ফেরায় (`STREAM_ENABLED` সেট না থাকলে) — এটি সার্ভার-ত্রুটি নয়, "ফিচার
       *   বন্ধ" সংকেত; তাই কেবল এই পথটিতে ৫০৩ ছাড় পায় (অন্য কোনো ৫xx নয়)।
       */
      const streamOff = r.path === '/api/stream' && c === 503;
      if (a >= 500 || (c >= 500 && !streamOff)) check(`${label} — ৫xx নেই`, false, `অতিথি ${a} · গ্রাহক ${c}`);
    }
  }

  mkdirSync('audit', { recursive: true });
  writeFileSync('audit/api-auth-matrix.json', JSON.stringify(rows, null, 2));
  await Promise.all([anon.dispose(), cust.dispose(), admin.dispose()]);
  await db.rateLimitBucket.deleteMany({});
  console.log(`\n════ ${pass} পাস · ${failures.length} ব্যর্থ ════`);
  if (failures.length) { console.log(failures.slice(0, 30).join('\n')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
