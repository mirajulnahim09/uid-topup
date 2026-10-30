/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ k6 — ৫০০ RPS টানা চাপে রুট-ভিত্তিক p95/p99 ও TTFB
 *
 *   `k6-money-storm.js` **সঠিকতা** মাপে (ডাবল-স্পেন্ড ইত্যাদি)। এটি কেবল
 *   **গতি**: প্রতিটি গুরুত্বপূর্ণ রুট আলাদা `route` ট্যাগে, যাতে threshold ও
 *   রিপোর্ট রুট-প্রতি আসে — "গড়ে দ্রুত" দিয়ে একটি ধীর রুট ঢাকা পড়ে না।
 *
 *   TTFB = `http_req_waiting` (সার্ভারের প্রথম বাইট পর্যন্ত; নেটওয়ার্ক-সংযোগ বাদ)।
 *   ঠান্ডা শুরু আলাদা ধরা হয়: প্রতিটি VU-র **প্রথম** অনুরোধ `phase:cold` ট্যাগে।
 *
 *   ⚠️ localhost/নিজের স্টেজিং ছাড়া নয় (`K6_I_OWN_THIS_STAGING=yes`)। অর্ডার ও
 *   ডিপোজিট সত্যিই লেখে। চালানো:
 *     k6 run -e BASE=https://localhost:3443 -e VARIANT_ID=12 -e RPS=500 \
 *            scripts/load/k6-latency-500rps.js
 *
 *   মিশ্রণ (বাস্তব অনুপাত, মোট ১০০%): /api/me ৩৫ · হোম ২০ · প্রোডাক্ট ২০ ·
 *   /api/notifications ১০ · /api/order ১০ · /api/deposit ৫
 * ═══════════════════════════════════════════════════════════
 */
import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';

const BASE = (__ENV.BASE || 'https://localhost:3443').replace(/\/$/, '');
const RPS = Number(__ENV.RPS || 500);
const USERS = Number(__ENV.USERS || 10000);
const VARIANT_ID = Number(__ENV.VARIANT_ID || 0);
const PRODUCT_PATH = __ENV.PRODUCT_PATH || '/';
const PASSWORD = __ENV.SIM_PASSWORD || 'SimCustomer#2026';

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && __ENV.K6_I_OWN_THIS_STAGING !== 'yes') {
  fail(`BASE=${BASE} localhost নয় — প্রোডাকশনে লোড-টেস্ট নিষিদ্ধ।`);
}
if (!VARIANT_ID) fail('VARIANT_ID দিন (stock=-1, সস্তা ভ্যারিয়েন্ট)');

const ttfb = new Trend('ttfb', true);

const ROUTES = ['me', 'home', 'product', 'notifications', 'order', 'deposit'];
const thresholds = {
  http_req_failed: ['rate<0.01'],
  // ★ ঠান্ডা শুরু আলাদা সীমায় — গরম পথের সংখ্যাকে দূষিত করে না
  'ttfb{phase:cold}': ['p(95)<3000'],
};
// ★ মিউটেশন বেশি সময় পায় (লক + খতিয়ান + অটো-ডেলিভারি seam)
const BUDGET = {
  me: [300, 800], home: [400, 1000], product: [400, 1000],
  notifications: [300, 800], order: [1200, 2500], deposit: [800, 2000],
};
for (const r of ROUTES) {
  thresholds[`http_req_duration{route:${r},phase:warm}`] = [`p(95)<${BUDGET[r][0]}`, `p(99)<${BUDGET[r][1]}`];
  thresholds[`ttfb{route:${r},phase:warm}`] = [`p(95)<${BUDGET[r][0]}`];
}

export const options = {
  insecureSkipTLSVerify: true,
  // ★ ৪xx প্রত্যাশিত (ব্যালেন্স শেষ = ৪০০, রেট-লিমিট = ৪২৯, TrxID ডুপ্লিকেট = ৪০৯)
  scenarios: {
    sustained: {
      executor: 'ramping-arrival-rate',
      startRate: Math.round(RPS / 10), timeUnit: '1s',
      stages: [
        { target: RPS, duration: '2m' },  // ধীরে ওঠা — Neon জাগে, pool ভরে
        { target: RPS, duration: '10m' }, // টানা ৫০০ RPS
        { target: 0, duration: '1m' },
      ],
      preAllocatedVUs: Math.min(USERS, 1500), maxVUs: Math.min(USERS, 4000),
    },
  },
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 400, 409, 429));

let loggedIn = false;
let first = true;

function login() {
  if (loggedIn) return;
  const n = (exec.vu.idInTest - 1) % USERS;
  const email = `sim-${String(n).padStart(6, '0')}@sim.invalid`;
  const token = http.get(`${BASE}/api/auth/csrf`, { tags: { route: 'auth' } }).json('csrfToken');
  http.post(`${BASE}/api/auth/callback/credentials`,
    { csrfToken: token, email, password: PASSWORD, json: 'true', callbackUrl: BASE },
    { redirects: 0, tags: { route: 'auth' } });
  loggedIn = true;
}

function hit(route, method, path, body) {
  const phase = first ? 'cold' : 'warm';
  first = false;
  const params = { tags: { route, phase }, headers: body ? { 'Content-Type': 'application/json' } : {} };
  const res = method === 'GET' ? http.get(`${BASE}${path}`, params) : http.post(`${BASE}${path}`, JSON.stringify(body), params);
  ttfb.add(res.timings.waiting, { route, phase });
  check(res, { [`${route} not 5xx`]: (r) => r.status < 500 });
}

export default function () {
  login();
  const x = Math.random();
  if (x < 0.35) return hit('me', 'GET', '/api/me');
  if (x < 0.55) return hit('home', 'GET', '/');
  if (x < 0.75) return hit('product', 'GET', PRODUCT_PATH);
  if (x < 0.85) return hit('notifications', 'GET', '/api/notifications');
  if (x < 0.95) {
    return hit('order', 'POST', '/api/order', {
      variantId: VARIANT_ID, playerUid: '1234567890',
      clientRef: `lat-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`,
    });
  }
  return hit('deposit', 'POST', '/api/deposit', {
    method: 'BKASH', amount: 100, senderNo: '01712345678',
    trxId: `LAT${exec.vu.idInTest}X${exec.scenario.iterationInTest}`.slice(0, 30),
  });
}

export function handleSummary(data) {
  const lines = ROUTES.map((r) => {
    const m = data.metrics[`http_req_duration{route:${r},phase:warm}`];
    const t = data.metrics[`ttfb{route:${r},phase:warm}`];
    if (!m) return `  ${r.padEnd(14)} (নমুনা নেই)`;
    const v = m.values;
    return `  ${r.padEnd(14)} p95=${v['p(95)'].toFixed(0)}ms p99=${v['p(99)'].toFixed(0)}ms ttfb95=${t ? t.values['p(95)'].toFixed(0) : '-'}ms`;
  });
  const cold = data.metrics['ttfb{phase:cold}'];
  return {
    stdout: `\n═══ ৫০০ RPS — রুট-ভিত্তিক লেটেন্সি (গরম) ═══\n${lines.join('\n')}\n` +
      `  ঠান্ডা শুরু ttfb p95=${cold ? cold.values['p(95)'].toFixed(0) : '-'}ms\n`,
    'audit/sim/k6-latency-500rps.json': JSON.stringify(data, null, 2),
  };
}
