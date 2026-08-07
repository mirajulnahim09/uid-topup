/**
 * প্রোডাকশন টেলিগ্রাম সিস্টেম টেস্ট।
 * `npx tsx scripts/telegram-production-test.ts`   (dev server চালু থাকতে হবে)
 *
 * ⚠️ কখনো টোকেন/পাসওয়ার্ড ছাপে না। শেষে কনফিগ আগের অবস্থায় ফেরানো হয়।
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import {
  encryptSecret, decryptSecret, isEncrypted, isSecretBoxReady, SecretBoxError,
} from '../src/lib/secretbox';
import { maskToken, maskChatId } from '../src/lib/telegram/store';
import { scrub } from '../src/lib/telegram/api';

const BASE = 'http://localhost:3000';
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const SECRET = TOKEN.split(':')[1] || '';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');

const jar = new Map<string, string>();
const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const section = (t: string) => console.log(`\n═══ ${t} ═══`);

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
  fetch(BASE + p, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie(), ...(init?.headers || {}) },
  });

async function main() {
  // ══════════ ১. এনক্রিপশন ══════════
  section('1. Encryption at rest');
  check('encryption key available', isSecretBoxReady());

  const sample = TOKEN || '123456789:AAHtest_token_value_for_roundtrip_x';
  const ct = encryptSecret(sample);
  check('ciphertext is tagged v1', ct.startsWith('v1.') && ct.split('.').length === 4);
  check('ciphertext does NOT contain plaintext', !ct.includes(sample));
  check('isEncrypted() recognises it', isEncrypted(ct));
  check('round-trip returns original', decryptSecret(ct) === sample);

  const ct2 = encryptSecret(sample);
  check('same plaintext → different ciphertext (random IV)', ct !== ct2);
  check('both decrypt to the same value', decryptSecret(ct2) === sample);

  // ★ GCM authentication — বিকৃত ciphertext চুপচাপ আবর্জনা দেবে না
  let tampered = false;
  try {
    const parts = ct.split('.');
    const data = Buffer.from(parts[3], 'base64url');
    data[0] ^= 0xff;
    parts[3] = data.toString('base64url');
    decryptSecret(parts.join('.'));
  } catch (e) { tampered = e instanceof SecretBoxError; }
  check('tampered ciphertext is REJECTED (GCM auth)', tampered);

  let badFormat = false;
  try { decryptSecret('not-a-ciphertext'); } catch (e) { badFormat = e instanceof SecretBoxError; }
  check('malformed input rejected cleanly', badFormat);

  // ══════════ ২. মাস্কিং ══════════
  section('2. Masking');
  const mt = maskToken(sample);
  check('masked token hides the secret half', !mt.includes(SECRET || 'AAHtest'), mt);
  check('masked token keeps bot id', mt.startsWith(sample.split(':')[0]));
  const mc = maskChatId('-1001234567890');
  check('masked chat id hides the middle', mc.includes('•') && mc.endsWith('7890'), mc);
  check('scrub removes token from URL text',
    !scrub(`https://api.telegram.org/bot${sample}/sendMessage`).includes(sample));

  // ══════════ ৩. লগইন ══════════
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

  // ══════════ ৪. অথ গার্ড ══════════
  section('4. Auth guards (all endpoints)');
  for (const [method, path] of [
    ['GET', '/api/admin/telegram'],
    ['POST', '/api/admin/telegram'],
    ['POST', '/api/admin/telegram/verify'],
    ['POST', '/api/admin/telegram/connect'],
    ['POST', '/api/admin/telegram/manage'],
    ['GET', '/api/admin/telegram/config'],
    ['POST', '/api/admin/telegram/config'],
  ] as const) {
    const r = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    check(`${method} ${path} requires admin`, r.status === 401, `HTTP ${r.status}`);
  }

  // ══════════ ৫. ড্যাশবোর্ড স্টেট ══════════
  section('5. Dashboard state API');
  const st = await (await api('/api/admin/telegram')).json();
  // ★ ১৫টি চাওয়া হয়েছিল + `user_registered` (আগের পর্বে যুক্ত ও চালু) = ১৬।
  //   আগেরটি বাদ দেওয়া মানে কর্মক্ষম একটি ফিচার মুছে ফেলা, তাই রাখা হয়েছে।
  const REQUESTED = [
    'deposit_new', 'deposit_approved', 'deposit_rejected', 'wallet_credit',
    'order_new', 'order_completed', 'refund', 'coupon', 'campaign',
    'maintenance', 'low_stock', 'server_warning', 'security_alert',
    'daily_summary', 'weekly_summary',
  ];
  const keys = (st.events as { key: string }[]).map((e) => e.key);
  check('all 15 requested events present', REQUESTED.every((k) => keys.includes(k)),
    REQUESTED.filter((k) => !keys.includes(k)).join(', ') || 'all present');
  check('user_registered retained from previous round', keys.includes('user_registered'));
  check('returns 16 events total', st.events?.length === 16, String(st.events?.length));
  check('encryption reported ready', st.storage?.encryptionReady === true);
  check('no token anywhere in response', !JSON.stringify(st).includes(TOKEN));
  check('token is masked in bots[]', String(st.bots?.[0]?.tokenMasked || '').includes('•'),
    st.bots?.[0]?.tokenMasked);
  check('chat id is masked in bots[]', String(st.bots?.[0]?.chatIdMasked || '').includes('•'),
    st.bots?.[0]?.chatIdMasked);
  check('stats object present', typeof st.stats?.totalSent === 'number');

  const originalEvents = Object.fromEntries(
    (st.events as { key: string; enabled: boolean }[]).map((e) => [e.key, e.enabled]),
  );
  const originalEnabled = st.enabled as boolean;

  // ══════════ ৬. উইজার্ড যাচাই ══════════
  section('6. Wizard verification');
  const badFmt = await (await api('/api/admin/telegram/verify', {
    method: 'POST', body: JSON.stringify({ kind: 'token', token: 'not a token' }),
  })).json();
  check('malformed token → format error', badFmt.ok === false && badFmt.stage === 'format', badFmt.error);

  const withNewline = await (await api('/api/admin/telegram/verify', {
    method: 'POST', body: JSON.stringify({ kind: 'token', token: `${TOKEN}\n` }),
  })).json();
  check('newline in token is caught', withNewline.ok === false, withNewline.error);

  const bogus = await (await api('/api/admin/telegram/verify', {
    method: 'POST', body: JSON.stringify({ kind: 'token', token: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
  })).json();
  check('bogus token → rejected by Telegram', bogus.ok === false && bogus.stage === 'rejected', bogus.error);

  const good = await (await api('/api/admin/telegram/verify', {
    method: 'POST', body: JSON.stringify({ kind: 'token', token: TOKEN }),
  })).json();
  check('valid token verified', good.ok === true, good.bot ? `@${good.bot.username}` : good.error);
  check('verify returns bot id + name', Boolean(good.bot?.id && good.bot?.name));
  check('verify response has NO token echo', !JSON.stringify(good).includes(TOKEN));
  check('profile photo is a data: URI or null',
    good.bot?.photoUrl === null || String(good.bot?.photoUrl || '').startsWith('data:'),
    good.bot?.photoUrl ? `${String(good.bot.photoUrl).slice(0, 24)}…` : 'null');

  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim().replace(/^["']|["']$/g, '');
  if (chatId) {
    const chatOk = await (await api('/api/admin/telegram/verify', {
      method: 'POST', body: JSON.stringify({ kind: 'chat', token: TOKEN, chatId }),
    })).json();
    check('valid chat verified', chatOk.ok === true, chatOk.chat ? `${chatOk.chat.title} (${chatOk.chat.typeLabel})` : chatOk.error);
    check('chat response includes type + title', Boolean(chatOk.chat?.type && chatOk.chat?.title));
  }

  const badChat = await (await api('/api/admin/telegram/verify', {
    method: 'POST', body: JSON.stringify({ kind: 'chat', token: TOKEN, chatId: '-100999999999999' }),
  })).json();
  check('unreachable chat → clear error', badChat.ok === false, badChat.error);

  // ══════════ ৭. DB-প্রথম অগ্রাধিকার ══════════
  section('7. DB-first config priority');
  const conn = await (await api('/api/admin/telegram/connect', {
    method: 'POST', body: JSON.stringify({ role: 'admin', token: TOKEN, chatId }),
  })).json();
  check('connect saves config', conn.success === true, conn.error || '');
  check('connect response has no token', !JSON.stringify(conn).includes(TOKEN));

  const st2 = await (await api('/api/admin/telegram')).json();
  check('source is now DB (not .env)', st2.connection?.source === 'db', String(st2.connection?.source));
  check('dbConfigured true', st2.storage?.dbConfigured === true);
  check('still no token in response', !JSON.stringify(st2).includes(TOKEN));

  // ★ DB-তে সত্যিই ciphertext আছে কি না — প্লেইনটেক্সট নয়
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'telegram_bots' } });
    const raw = row?.value || '';
    check('DB row exists', Boolean(raw));
    check('DB row does NOT contain plaintext token', !raw.includes(TOKEN));
    check('DB row contains v1. ciphertext', raw.includes('v1.'));
  } finally { await prisma.$disconnect(); }

  // ══════════ ৮. ব্যবস্থাপনা কাজ ══════════
  section('8. Management actions');
  const test = await (await api('/api/admin/telegram/manage', {
    method: 'POST', body: JSON.stringify({ action: 'test' }),
  })).json();
  check('test message delivered', test.success === true, test.message || test.error);
  check('test reports response time', typeof test.responseMs === 'number', `${test.responseMs}ms`);
  check('test reports delivery time', Boolean(test.deliveredAt));
  check('test reports API status', test.apiStatus === 'OK');

  const recon = await (await api('/api/admin/telegram/manage', {
    method: 'POST', body: JSON.stringify({ action: 'reconnect' }),
  })).json();
  check('reconnect works', recon.success === true, recon.message || recon.error);

  const junkAction = await api('/api/admin/telegram/manage', {
    method: 'POST', body: JSON.stringify({ action: 'destroy-everything' }),
  });
  check('unknown action rejected', junkAction.status === 400, `HTTP ${junkAction.status}`);

  // ══════════ ৯. এক্সপোর্ট / ইমপোর্ট ══════════
  section('9. Export / import');
  const expRes = await api('/api/admin/telegram/config');
  const expText = await expRes.text();
  check('export returns 200', expRes.status === 200);
  check('export is a file download', (expRes.headers.get('content-disposition') || '').includes('attachment'));
  check('EXPORT CONTAINS NO TOKEN', !expText.includes(TOKEN));
  check('export omits secret half too', SECRET.length > 10 && !expText.includes(SECRET));
  const exp = JSON.parse(expText);
  check('export has format marker', exp.format === 'uidtopup.telegram.config');
  check('export carries event prefs', typeof exp.events === 'object');

  const impBad = await api('/api/admin/telegram/config', {
    method: 'POST', body: JSON.stringify({ format: 'something.else', version: 1 }),
  });
  check('import rejects foreign file', impBad.status === 400, `HTTP ${impBad.status}`);

  const impInj = await (await api('/api/admin/telegram/config', {
    method: 'POST',
    body: JSON.stringify({ format: exp.format, version: 1, events: { evil_key: true, deposit_new: true } }),
  })).json();
  check('import ignores unknown event keys', impInj.imported?.settings === 1, JSON.stringify(impInj.imported));

  // ══════════ ১০. পাতা রেন্ডার + ফাঁস ══════════
  section('10. Page render & leak check');
  const page = await fetch(`${BASE}/admin/telegram`, { headers: { Cookie: cookie() } });
  const html = await page.text();
  check('/admin/telegram renders', page.status === 200, `${html.length} bytes`);
  check('FULL TOKEN not in page HTML', !html.includes(TOKEN));
  check('token secret half not in page HTML', SECRET.length > 10 && !html.includes(SECRET));
  check('shows encrypted badge', html.includes('এনক্রিপ্টেড'));
  check('shows management actions', html.includes('Connection Wizard'));

  for (const p of ['/', '/login', '/admin', '/admin/site', '/admin/integrations']) {
    const r = await fetch(BASE + p, { headers: { Cookie: cookie() } });
    const h = await r.text();
    check(`no token secret in ${p}`, SECRET.length > 10 && !h.includes(SECRET), `HTTP ${r.status}`);
  }

  // ══════════ ১১. পুনরুদ্ধার ══════════
  section('11. Restore original preferences');
  const restore = await api('/api/admin/telegram', {
    method: 'POST', body: JSON.stringify({ enabled: originalEnabled, events: originalEvents }),
  });
  check('preferences restored', restore.status === 200);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  if (passed !== results.length) {
    results.filter((r) => !r.ok).forEach((r) => console.log(`  FAILED: ${r.name} — ${r.note}`));
  }
  process.exit(passed === results.length ? 0 : 1);
}

main();
