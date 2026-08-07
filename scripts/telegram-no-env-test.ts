/**
 * ★★★ মূল দাবির প্রমাণ: `.env`-এ টেলিগ্রাম মান **না থাকলেও** সব কাজ করে।
 *
 * `npx tsx scripts/telegram-no-env-test.ts`
 *
 * চালানোর আগে `.env` থেকে TELEGRAM_BOT_TOKEN ও TELEGRAM_CHAT_ID সরিয়ে
 * dev server রিস্টার্ট করতে হবে — নাহলে এই টেস্ট অর্থহীন (নিজেই যাচাই করে)।
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const BASE = 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');

const jar = new Map<string, string>();
const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

function storeCookies(res: Response) {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
const api = (p: string, init?: RequestInit) =>
  fetch(BASE + p, { ...init, headers: { 'Content-Type': 'application/json', Cookie: cookie(), ...(init?.headers || {}) } });

async function main() {
  console.log('\n═══ .env independence proof ═══');

  // ★ প্রথমেই নিশ্চিত হই যে env সত্যিই খালি — নাহলে টেস্টটি প্রতারণা
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const envChat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  check('TELEGRAM_BOT_TOKEN absent from .env', envToken === '', envToken ? 'STILL SET — test is meaningless' : 'empty');
  check('TELEGRAM_CHAT_ID absent from .env', envChat === '', envChat ? 'STILL SET' : 'empty');
  if (envToken || envChat) {
    console.log('\nAborting: remove the Telegram vars from .env and restart the dev server first.');
    process.exit(1);
  }

  // লগইন
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  storeCookies(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: 'true' }).toString(),
    redirect: 'manual',
  });
  storeCookies(loginRes);
  if (![...jar.keys()].some((k) => k.includes('session-token'))) {
    console.log('FATAL: admin login failed (rate limited?)');
    process.exit(1);
  }

  // ── কনফিগ শুধু DB থেকে আসছে ──
  const st = await (await api('/api/admin/telegram')).json();
  check('config source is DB', st.connection?.source === 'db', String(st.connection?.source));
  check('bot token present (from encrypted DB)', st.bots?.[0]?.hasToken === true);
  check('chat id present (from encrypted DB)', st.bots?.[0]?.hasChatId === true);
  check('connection is live', st.connection?.connected === true);
  check('bot identity resolved', st.connection?.botUsername === 'uidtopup1bot', String(st.connection?.botUsername));
  check('token still masked', String(st.bots?.[0]?.tokenMasked || '').includes('•'));

  // ── সত্যিকারের বার্তা পাঠানো ──
  const test = await (await api('/api/admin/telegram/manage', {
    method: 'POST', body: JSON.stringify({ action: 'test' }),
  })).json();
  check('TEST MESSAGE SENT WITHOUT .env', test.success === true, test.message || test.error);
  check('delivery timing reported', typeof test.responseMs === 'number', `${test.responseMs}ms`);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  if (passed !== results.length) {
    results.filter((r) => !r.ok).forEach((r) => console.log(`  FAILED: ${r.name} — ${r.note}`));
  }
  process.exit(passed === results.length ? 0 : 1);
}

main();
