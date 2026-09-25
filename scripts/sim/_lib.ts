/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ সিমুলেশনের ভাগ করা যন্ত্রপাতি — HTTP, সেশন, পরিসংখ্যান, RNG
 *
 *   ⚠️ `../verify/_db` **সবার আগে** — env-লোডের ক্রম সেখানেই ঠিক করা
 *   (ESM-এ import আগে চলে; `_env.ts` দেখুন)। তারপর এখানে দ্বিতীয় গার্ড:
 *   ডাটাবেসের নাম `_sim` দিয়ে শেষ না হলে কিছুই চলে না। `_db` কেবল
 *   localhost যাচাই করে — সিমুলেশন লাখো সারি লেখে, তাই ডেভ DB-ও নিষেধ।
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from '../verify/_db';
import { encode } from 'next-auth/jwt';
import type { Role } from '@prisma/client';
import { SESSION_COOKIE_NAME } from '../../src/lib/authCookies';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';

export { db, BASE, dbLabel };

if (!/_sim$/.test(dbLabel())) {
  console.error(`✗ সিমুলেশন কেবল "_sim" ডাটাবেসে চলে — পাওয়া গেছে ${dbLabel()}`);
  console.error('  VERIFY_DATABASE_URL=postgresql://dev:dev@localhost:5434/uidtopup_sim দিন');
  process.exit(1);
}

// ★ সিম-রিগের নিজের ফেলনা সিক্রেট (`scripts/sim/sim-rig.mjs`) — env ফাইলের নয়
const SECRET = existsSync('.sim/nextauth-secret') ? readFileSync('.sim/nextauth-secret', 'utf8').trim() : '';
if (!SECRET) {
  console.error('✗ .sim/nextauth-secret নেই — আগে `node scripts/sim/sim-rig.mjs start` চালান');
  process.exit(1);
}

// ── বীজযুক্ত RNG — একই বীজে একই "পৃথিবী", ফল পুনরুৎপাদনযোগ্য ──
export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

// ── সেশন — আসল NextAuth JWT, সার্ভারের নিজের সিক্রেটে স্বাক্ষরিত ──
//   লগইন-ফর্ম দিয়ে ১০,০০০ সেশন বানালে bcrypt(১২)-এ ~৪০ মিনিট যেত; তাই
//   বেশিরভাগ সেশন সরাসরি মিন্ট করা হয়। সার্ভার এগুলো হুবহু আসল সেশনের
//   মতোই যাচাই করে (স্বাক্ষর + প্রতিটি API-তে DB-র ban/epoch)। লগইন-পথ
//   নিজে আলাদা ধাপে আসল ফর্ম দিয়ে মাপা হয়।
export async function mintCookie(u: { id: string; role: Role; sessionEpoch?: number | null }) {
  const jwt = await encode({
    token: { id: u.id, role: u.role, epoch: u.sessionEpoch ?? 0, lastChecked: Date.now() },
    secret: SECRET,
    maxAge: 30 * 24 * 60 * 60,
  });
  return `${SESSION_COOKIE_NAME}=${jwt}`;
}

// ── HTTP — প্রতিটি অনুরোধের সময় ও ফল রেকর্ড ──
export type Sample = { name: string; status: number; ms: number; at: number };
export const samples: Sample[] = [];

export type Res = { status: number; ms: number; json: any; text: string; headers: Headers | null };

export async function call(
  name: string,
  cookie: string | null,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; record?: boolean; signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<Res> {
  const t = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
  if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort());
  let status = 0; let text = ''; let headers: Headers | null = null;
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      redirect: 'manual',
      signal: ctrl.signal,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        // ★ মিউটেশনে Origin — ব্রাউজার যেভাবে পাঠায়
        origin: BASE,
        ...(opts.headers ?? {}),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    status = r.status; headers = r.headers;
    text = await r.text();
  } catch {
    status = 0;
  } finally {
    clearTimeout(timer);
  }
  const ms = Math.round(performance.now() - t);
  if (opts.record !== false) samples.push({ name, status, ms, at: Date.now() });
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* HTML/খালি */ }
  return { status, ms, json, text, headers };
}

/** সীমিত সমান্তরালতায় কাজ চালানো */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) {
      const i = k++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

export function summarize(xs: Sample[], seconds?: number) {
  const ms = xs.map((s) => s.ms);
  return {
    n: xs.length,
    ok: xs.filter((s) => s.status >= 200 && s.status < 400).length,
    c4xx: xs.filter((s) => s.status >= 400 && s.status < 500 && s.status !== 429).length,
    c429: xs.filter((s) => s.status === 429).length,
    c5xx: xs.filter((s) => s.status >= 500).length,
    net0: xs.filter((s) => s.status === 0).length,
    p50: pct(ms, 50), p75: pct(ms, 75), p90: pct(ms, 90), p95: pct(ms, 95), p99: pct(ms, 99),
    // ⚠️ `Math.max(...ms)` নয় — লাখো নমুনায় call stack ফেটে যায় (মাপা: ১.৫ লাখে)
    max: ms.reduce((a, b) => (b > a ? b : a), 0),
    rps: seconds ? Math.round((xs.length / seconds) * 10) / 10 : undefined,
  };
}

export function byName(xs: Sample[]) {
  const names = [...new Set(xs.map((s) => s.name))].sort();
  return Object.fromEntries(names.map((n) => [n, summarize(xs.filter((s) => s.name === n))]));
}

export async function dbConnections(): Promise<number> {
  const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()`;
  return Number(r[0].n);
}

export const OUT_DIR = 'audit/sim';
export function saveJson(name: string, data: unknown) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/${name}`, JSON.stringify(data, null, 2));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const money = (n: number) => Math.round(n * 100) / 100;
export const tk = (n: number) => `৳${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
