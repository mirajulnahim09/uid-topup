/**
 * অ্যাডমিন পৃষ্ঠায় টোকেন ফাঁস হচ্ছে কিনা — সত্যিকারের লগইন করে যাচাই।
 * `npx tsx scripts/telegram-admin-leak-test.ts`
 *
 * কেন দরকার: `/admin/site` একটি সার্ভার কম্পোনেন্ট যা ক্লায়েন্ট
 * কম্পোনেন্টে props পাঠায় — সেগুলো RSC payload-এ সিরিয়ালাইজ হয়ে
 * HTML-এর ভেতরেই ব্রাউজারে যায়। তাই শুধু কোড পড়ে নিশ্চিত হওয়া যায় না;
 * আসল রেসপন্স বডি দেখা দরকার।
 *
 * ⚠️ কখনো টোকেন/পাসওয়ার্ড ছাপে না।
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const BASE = 'http://localhost:3000';
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const SECRET_PART = TOKEN.split(':')[1] || '';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');

const jar = new Map<string, string>();

function storeCookies(res: Response) {
  // undici: getSetCookie() একাধিক Set-Cookie হেডার আলাদা করে দেয়
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function main() {
  const results: { name: string; ok: boolean; note: string }[] = [];
  const check = (name: string, ok: boolean, note = '') => {
    results.push({ name, ok, note });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
  };

  if (!EMAIL || !PASSWORD) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not in .env — cannot run authenticated check.');
    process.exit(1);
  }

  console.log('\n═══ Authenticated admin-page leak check ═══');

  // ১. CSRF
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  storeCookies(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  check('got CSRF token', Boolean(csrfToken));

  // ২. লগইন
  const form = new URLSearchParams({
    csrfToken,
    email: EMAIL,
    password: PASSWORD,
    callbackUrl: `${BASE}/admin`,
    json: 'true',
  });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(),
    },
    body: form.toString(),
    redirect: 'manual',
  });
  storeCookies(loginRes);
  const hasSession = [...jar.keys()].some((k) => k.includes('session-token'));
  check('admin login succeeded', hasSession, hasSession ? 'session cookie set' : `HTTP ${loginRes.status}`);

  if (!hasSession) {
    console.log('\n  Cannot continue without a session. Is the seed admin password current?');
    process.exit(1);
  }

  // ৩. অ্যাডমিন সেটিংস পৃষ্ঠা
  const pageRes = await fetch(`${BASE}/admin/site`, { headers: { Cookie: cookieHeader() } });
  const html = await pageRes.text();
  check('admin/site loads as admin', pageRes.status === 200, `HTTP ${pageRes.status}, ${html.length} bytes`);

  // ★ মূল দাবি
  check('FULL TOKEN not in admin page HTML', !html.includes(TOKEN));
  check('token SECRET half not in admin page HTML', SECRET_PART.length > 10 && !html.includes(SECRET_PART));
  check('page confirms it rendered the telegram panel', html.includes('টেলিগ্রাম'));

  // ৪. অন্যান্য অ্যাডমিন পৃষ্ঠা
  for (const p of ['/admin', '/admin/tools', '/admin/integrations']) {
    const r = await fetch(BASE + p, { headers: { Cookie: cookieHeader() } });
    const h = await r.text();
    check(`no token secret in ${p}`, !h.includes(SECRET_PART), `HTTP ${r.status}`);
  }

  // ৫. স্ট্যাটাস এন্ডপয়েন্ট — অ্যাডমিন হিসেবে
  const st = await fetch(`${BASE}/api/admin/telegram-test`, { headers: { Cookie: cookieHeader() } });
  const stBody = await st.text();
  check('GET telegram-test works for admin', st.status === 200, stBody.slice(0, 120));
  check('status response contains no token secret', !stBody.includes(SECRET_PART));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  if (passed !== results.length) {
    results.filter((r) => !r.ok).forEach((r) => console.log(`  FAILED: ${r.name} — ${r.note}`));
  }
  process.exit(passed === results.length ? 0 : 1);
}

main();
