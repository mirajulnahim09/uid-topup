/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ k6 — টাকার ঝড় (লগইন · ব্যালেন্স · ডিপোজিট · অর্ডার · প্রত্যাহার)
 *
 *   ⚠️⚠️ কখনো প্রোডাকশন/লাইভ Neon-এ নয়। এটি হাজার হাজার অর্ডার ও
 *   ডিপোজিট-সারি লেখে। কেবল সিম-রিগ (`scripts/sim/sim-rig.mjs start`,
 *   DB `uidtopup_sim`) বা আলাদা স্টেজিং-এ। localhost ছাড়া অন্য BASE দিলে
 *   `K6_I_OWN_THIS_STAGING=yes` না দেওয়া পর্যন্ত স্ক্রিপ্ট চলবেই না।
 *
 *   ── চালানো ──
 *   k6 run -e BASE=https://localhost:3443 -e VARIANT_ID=12 -e VARIANT_PRICE=20 \
 *          -e PEAK_RPS=400 -e USERS=10000 scripts/load/k6-money-storm.js
 *   তারপর **অবশ্যই**: npx tsx scripts/sim/03-reconcile.ts  (খতিয়ান = ব্যালেন্স)
 *   k6 DB দেখতে পায় না — চূড়ান্ত রায় reconcile দেয়, k6 কেবল HTTP-স্তরের লঙ্ঘন ধরে।
 *
 *   ── "২০,০০০ একসাথে" নিয়ে সৎ কথা ──
 *   ২০k *সক্রিয়* গ্রাহক ≠ ২০k *একসাথে-চলমান* অনুরোধ। think-time (৩–১০s) সহ
 *   ২০k সক্রিয় ≈ ২–৪k rps শিখর। তাই মূল মডেল `ramping-arrival-rate` (rps),
 *   VU-সংখ্যা নয়। একটি ল্যাপটপ থেকে ২০k VU চালানো যায় না (~২০GB RAM) —
 *   পূর্ণ মাপের জন্য k6 Cloud / একাধিক লোড-মেশিন লাগবে।
 *
 *   ── যা ধরে (প্রতিটি একটি Counter, threshold = ০) ──
 *   double_spend      — ৫টি সমান্তরাল অর্ডারের পর ব্যালেন্স-পতন ≠ সফল × দাম
 *   negative_balance  — /api/me কখনো ঋণাত্মক দেখালে
 *   idem_violation    — একই clientRef-এ দুটি ভিন্ন orderId
 *   withdraw_multi    — ৫টি সমান্তরাল প্রত্যাহারে ১টির বেশি সফল
 *   server_5xx        — টাকার রুটে যেকোনো ৫০০ (৫০৩ লক-টাইমআউট আলাদা গোনা)
 *   trx_dup_accepted  — একই TrxID-তে একাধিক ডিপোজিট গৃহীত
 * ═══════════════════════════════════════════════════════════
 */
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = (__ENV.BASE || 'https://localhost:3443').replace(/\/$/, '');
const PASSWORD = __ENV.SIM_PASSWORD || 'SimCustomer#2026';
const USERS = Number(__ENV.USERS || 10000);
const VARIANT_ID = Number(__ENV.VARIANT_ID || 0);
const PRICE = Number(__ENV.VARIANT_PRICE || 0);
const PEAK_RPS = Number(__ENV.PEAK_RPS || 400);

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && __ENV.K6_I_OWN_THIS_STAGING !== 'yes') {
  fail(`BASE=${BASE} localhost নয় — প্রোডাকশনে লোড-টেস্ট নিষিদ্ধ। স্টেজিং হলে K6_I_OWN_THIS_STAGING=yes দিন।`);
}
if (!VARIANT_ID || !PRICE) fail('VARIANT_ID ও VARIANT_PRICE দিন (stock=-1 এমন একটি সস্তা ভ্যারিয়েন্ট)');

// ★ প্রতিটি VU-র নিজস্ব গ্রাহক চাই — দুই VU একই গ্রাহক পেলে একজনের কেনা অন্যজনের
//   "ব্যালেন্স-পতন" হিসাবে মিশে ভুয়া double_spend দেখাত। আক্রমণকারী দৃশ্যগুলোর
//   সর্বোচ্চ VU (১০০০+৫০০+৫০০+২০০) বাদ দিয়ে বাকিটাই শপারদের।
const ATTACKER_VUS = 2200;
const SHOPPER_MAX_VUS = Math.min(8000, USERS - ATTACKER_VUS);
if (SHOPPER_MAX_VUS < 100) fail(`USERS=${USERS} খুব কম — অন্তত ${ATTACKER_VUS + 100} সিম-গ্রাহক লাগবে`);

const doubleSpend = new Counter('double_spend');
const negativeBalance = new Counter('negative_balance');
const idemViolation = new Counter('idem_violation');
const withdrawMulti = new Counter('withdraw_multi');
const server5xx = new Counter('server_5xx');
const lockTimeout503 = new Counter('lock_timeout_503');
const trxDupAccepted = new Counter('trx_dup_accepted');
const orderLatency = new Trend('order_latency', true);

// ★ ৪xx এখানে প্রত্যাশিত (৪০০ ব্যালেন্স নেই, ৪০৯ ডুপ্লিকেট, ৪২৯ রেট-লিমিট)
http.setResponseCallback(http.expectedStatuses(200, 400, 401, 403, 409, 429));

const stages = [
  { target: Math.round(PEAK_RPS * 0.1), duration: '1m' },
  { target: PEAK_RPS, duration: '3m' },
  { target: PEAK_RPS, duration: '5m' },
  { target: 0, duration: '1m' },
];

export const options = {
  insecureSkipTLSVerify: true, // সিম-রিগের স্ব-স্বাক্ষরিত সার্টিফিকেট
  scenarios: {
    // ক. বাস্তব মিশ্রণ — লগইন, ব্যালেন্স দেখা, মাঝে মাঝে কেনা
    shoppers: {
      executor: 'ramping-arrival-rate', exec: 'shopper',
      startRate: 1, timeUnit: '1s', stages,
      preAllocatedVUs: Math.min(SHOPPER_MAX_VUS, 2000), maxVUs: SHOPPER_MAX_VUS,
    },
    // খ. আক্রমণকারী — একই ব্যালেন্সে ৫টি সমান্তরাল অর্ডার
    double_spenders: {
      executor: 'constant-arrival-rate', exec: 'doubleSpender',
      rate: Math.max(1, Math.round(PEAK_RPS / 20)), timeUnit: '1s', duration: '8m', startTime: '1m',
      preAllocatedVUs: 200, maxVUs: 1000,
    },
    // গ. retry-ঝড় — একই clientRef ৫ বার একসাথে
    retriers: {
      executor: 'constant-arrival-rate', exec: 'retrier',
      rate: Math.max(1, Math.round(PEAK_RPS / 40)), timeUnit: '1s', duration: '8m', startTime: '1m',
      preAllocatedVUs: 100, maxVUs: 500,
    },
    // ঘ. ডিপোজিট — একই TrxID বহু গ্রাহক একসাথে
    depositors: {
      executor: 'constant-arrival-rate', exec: 'depositor',
      rate: Math.max(1, Math.round(PEAK_RPS / 40)), timeUnit: '1s', duration: '8m', startTime: '1m',
      preAllocatedVUs: 100, maxVUs: 500,
    },
    // ঙ. প্রত্যাহার — ১ মিলিসেকেন্ডে ৫টি
    withdrawers: {
      executor: 'constant-arrival-rate', exec: 'withdrawer',
      rate: 2, timeUnit: '1s', duration: '8m', startTime: '1m',
      preAllocatedVUs: 50, maxVUs: 200,
    },
  },
  thresholds: {
    double_spend: ['count<1'],
    negative_balance: ['count<1'],
    idem_violation: ['count<1'],
    withdraw_multi: ['count<1'],
    trx_dup_accepted: ['count<1'],
    server_5xx: ['count<1'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:money}': ['p(95)<3000'],
    'http_req_duration{kind:read}': ['p(95)<800'],
  },
};

const JSON_H = { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'money' } };
let loggedIn = false;

/** ★ প্রতি VU একজন আলাদা সিম-গ্রাহক — নাহলে ডাবল-স্পেন্ড হিসাব অন্য VU-র কেনায় গুলিয়ে যেত */
function userEmail() {
  const n = (exec.vu.idInTest - 1) % USERS;
  return `sim-${String(n).padStart(6, '0')}@sim.invalid`;
}

/** ★ NextAuth credentials — আসল পথ: csrf কুকি + টোকেন, তারপর callback */
function login() {
  if (loggedIn) return true;
  const csrf = http.get(`${BASE}/api/auth/csrf`, { tags: { kind: 'auth' } });
  const token = csrf.json('csrfToken');
  const res = http.post(`${BASE}/api/auth/callback/credentials`,
    { csrfToken: token, email: userEmail(), password: PASSWORD, json: 'true', callbackUrl: BASE },
    { redirects: 0, tags: { kind: 'auth' } });
  const s = http.get(`${BASE}/api/auth/session`, { tags: { kind: 'auth' } });
  loggedIn = check(s, { 'login ok': (r) => !!r.json('user.email') });
  if (res.status >= 500) server5xx.add(1, { route: 'login' });
  return loggedIn;
}

function balance() {
  const r = http.get(`${BASE}/api/me`, { tags: { kind: 'read' } });
  if (r.status >= 500) server5xx.add(1, { route: 'me' });
  if (r.status !== 200) return null;
  const b = Number(r.json('balance'));
  if (b < 0) negativeBalance.add(1);
  return b;
}

function track5xx(res, route) {
  for (const r of res) {
    if (r.status === 503) lockTimeout503.add(1, { route });
    else if (r.status >= 500) server5xx.add(1, { route });
  }
}

const ref = (p) => `${p}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Date.now()}`;
const orderReq = (clientRef) => ['POST', `${BASE}/api/order`,
  JSON.stringify({ variantId: VARIANT_ID, playerUid: '1234567890', clientRef }), JSON_H];

export function shopper() {
  if (!login()) return;
  balance();
  if (Math.random() < 0.08) {
    const r = http.post(`${BASE}/api/order`,
      JSON.stringify({ variantId: VARIANT_ID, playerUid: '1234567890', clientRef: ref('shop') }), JSON_H);
    orderLatency.add(r.timings.duration);
    track5xx([r], 'order');
  }
  sleep(3 + Math.random() * 7); // think-time
}

export function doubleSpender() {
  if (!login()) return;
  const before = balance();
  if (before === null) return;
  const res = http.batch(Array.from({ length: 5 }, () => orderReq(ref('ds'))));
  track5xx(res, 'order');
  const ok = res.filter((r) => r.status === 200).length;
  const after = balance();
  if (after === null) return;
  // ★ এই VU-র গ্রাহক অন্য কোথাও কেনে না, তাই পতন = ঠিক সফল × দাম
  const drop = Math.round((before - after) * 100);
  if (drop !== Math.round(ok * PRICE * 100)) {
    doubleSpend.add(1);
    console.error(`DOUBLE-SPEND? ${userEmail()} before=${before} after=${after} ok=${ok} price=${PRICE}`);
  }
  if (before < PRICE * 5 && ok * PRICE > before + 0.001) doubleSpend.add(1);
}

export function retrier() {
  if (!login()) return;
  const same = ref('idem');
  const res = http.batch(Array.from({ length: 5 }, () => orderReq(same)));
  track5xx(res, 'order-idem');
  const ids = new Set(res.filter((r) => r.status === 200).map((r) => r.json('orderId')));
  if (ids.size > 1) idemViolation.add(1);
}

export function depositor() {
  if (!login()) return;
  // ★ প্রতি সেকেন্ডে একটি ভাগ-করা TrxID — বহু VU একসাথে দাবি করে
  const shared = `K6S${Math.floor(Date.now() / 1000)}`;
  const variants = [shared, ` ${shared} `, shared.toLowerCase(), `${shared}\u0000`];
  const res = http.batch(variants.map((t) => ['POST', `${BASE}/api/deposit`,
    JSON.stringify({ method: 'BKASH', amount: 100, trxId: t, senderNo: '01712345678' }), JSON_H]));
  track5xx(res, 'deposit');
  // ★ এক ব্যাচের ভেতরে একই আসল TrxID-র একাধিক **নতুন** গ্রহণ = নিশ্চিত লঙ্ঘন।
  //   একই গ্রাহকের হুবহু পুনরাবৃত্তি ২০০ + `duplicate: true` (replay) পায় — সেটি নতুন সারি
  //   নয়, তাই গোনা হয় না। (ব্যাচ-পেরোনো ডুপ্লিকেট reconcile ধরবে: `Deposit.trxId` UNIQUE)
  const fresh = res.filter((r) => r.status === 200 && r.json('duplicate') !== true).length;
  if (fresh > 1) trxDupAccepted.add(1);
}

export function withdrawer() {
  if (!login()) return;
  const body = JSON.stringify({ amount: 100, method: 'BKASH', accountNumber: '01712345678', code: '000000' });
  const res = http.batch(Array.from({ length: 5 }, () => ['POST', `${BASE}/api/account/withdraw`, body, JSON_H]));
  track5xx(res, 'withdraw');
  // ★ OTP-গেট থাকায় সাধারণত সবই ৪xx — দাবিটি হলো "১টির বেশি কখনো নয়"।
  //   আসল লক-প্রমাণ (OTP পেরিয়ে) `tests/chaos-cross-action.test.ts`-এ।
  if (res.filter((r) => r.status === 200).length > 1) withdrawMulti.add(1);
  balance();
}

export function handleSummary(data) {
  const m = (k) => (data.metrics[k] ? data.metrics[k].values.count || 0 : 0);
  const verdict = ['double_spend', 'negative_balance', 'idem_violation', 'withdraw_multi', 'trx_dup_accepted', 'server_5xx']
    .map((k) => `${m(k) === 0 ? 'PASS' : 'FAIL'}  ${k} = ${m(k)}`).join('\n');
  return {
    stdout: `\n═══ টাকার ঝড় — রায় ═══\n${verdict}\nlock_timeout_503 = ${m('lock_timeout_503')} (লোড-শেডিং, ত্রুটি নয়)\n` +
      '\n⚠️ এখন চালান: npx tsx scripts/sim/03-reconcile.ts — খতিয়ান=ব্যালেন্স চূড়ান্ত প্রমাণ\n',
    'audit/sim/k6-money-storm.json': JSON.stringify(data, null, 2),
  };
}
