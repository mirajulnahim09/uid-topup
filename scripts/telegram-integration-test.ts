/**
 * টেলিগ্রাম ইন্টিগ্রেশন টেস্ট — `npx tsx scripts/telegram-integration-test.ts`
 *
 * লাইভ টেলিগ্রাম API + চলমান dev server (localhost:3000) দুটোই লাগে।
 * ⚠️ কখনো পূর্ণ টোকেন ছাপে না।
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { scrub, validateToken, sendTelegramRaw } from '../src/lib/telegram';
import { logger } from '../src/lib/logger';

const BASE = 'http://localhost:3000';
const results: { name: string; ok: boolean; note: string }[] = [];

function check(name: string, ok: boolean, note = '') {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');

async function main() {
  // ── ১. env লোডিং ──
  console.log('\n═══ 1. Environment loading ═══');
  check('TELEGRAM_BOT_TOKEN present', Boolean(process.env.TELEGRAM_BOT_TOKEN));
  check('no embedded newline in raw value', !/[\r\n]/.test(process.env.TELEGRAM_BOT_TOKEN || ''),
    `raw len ${(process.env.TELEGRAM_BOT_TOKEN || '').length}`);
  check('token format <id>:<secret>', /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(TOKEN));

  // ── ২. scrub() — গোপনীয়তা ──
  console.log('\n═══ 2. Secret scrubbing ═══');
  const leaky = `connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const scrubbed = scrub(leaky);
  check('scrub removes token from a URL-bearing message', !scrubbed.includes(TOKEN), scrubbed.slice(0, 60));
  check('scrub removes a bare token', !scrub(TOKEN).includes(TOKEN));
  check('scrub keeps non-secret text intact', scrub('HTTP 404 Not Found') === 'HTTP 404 Not Found');

  // ── ৩. লাইভ টোকেন যাচাই ──
  console.log('\n═══ 3. Live token validation (getMe) ═══');
  const who = await validateToken(TOKEN);
  check('getMe accepts the token', who.ok, who.ok ? `@${who.identity?.username}` : who.error || '');
  check('validate response carries no token', !JSON.stringify(who).includes(TOKEN));

  const bad = await validateToken('123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  check('getMe rejects a bogus token', !bad.ok, bad.error || '');

  // ── ৪. send পথ + ত্রুটি হ্যান্ডলিং ──
  console.log('\n═══ 4. Send path & error handling ═══');
  const noCfg = await sendTelegramRaw('', '', 'x');
  check('missing config returns ok:false (no throw)', !noCfg.ok, noCfg.error || '');

  const t0 = Date.now();
  const badChat = await sendTelegramRaw(TOKEN, '-100000000000000', 'test');
  const dt = Date.now() - t0;
  check('invalid chat_id returns ok:false', !badChat.ok, badChat.error || '');
  check('error message contains no token', !String(badChat.error).includes(TOKEN));
  check('4xx is NOT retried (fast fail)', dt < 4000, `${dt}ms`);

  // ── ৫. API রুট (অ্যাডমিন-অনলি) ──
  console.log('\n═══ 5. API route auth ═══');
  try {
    const res = await fetch(`${BASE}/api/admin/telegram-test`, { method: 'POST' });
    const body = await res.text();
    check('POST telegram-test requires admin', res.status === 401, `HTTP ${res.status}`);
    check('unauthenticated response leaks no token', !body.includes(TOKEN));

    const g = await fetch(`${BASE}/api/admin/telegram-test`);
    const gb = await g.text();
    check('GET telegram-test requires admin', g.status === 401, `HTTP ${g.status}`);
    check('GET response leaks no token', !gb.includes(TOKEN));
  } catch (e) {
    check('API route reachable', false, e instanceof Error ? e.message : 'unknown');
  }

  // ── ৬. পাবলিক পৃষ্ঠায় টোকেন ফাঁস? ──
  console.log('\n═══ 6. Public surface leak check ═══');
  for (const path of ['/', '/track', '/faq', '/login']) {
    try {
      const res = await fetch(BASE + path);
      const html = await res.text();
      check(`no token in ${path}`, !html.includes(TOKEN) && !html.includes(TOKEN.split(':')[1] || 'x'));
    } catch {
      check(`fetch ${path}`, false, 'request failed');
    }
  }

  // ── ৭. লগার ছাঁকনি (গোপন তথ্য লগে যায় না) ──
  console.log('\n═══ 7. Logger secret redaction ═══');
  const captured: string[] = [];
  const orig = { e: console.error, l: console.log, w: console.warn };
  const cap = (...a: unknown[]) => {
    captured.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  };
  console.error = cap; console.log = cap; console.warn = cap;
  // undici-সদৃশ ত্রুটি: টোকেন URL-এর ভেতরে
  logger.error('telegram', 'send failed', {
    err: new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`),
  });
  logger.warn('telegram', 'retry', { url: `https://api.telegram.org/bot${TOKEN}/getMe` });
  logger.info('telegram', 'cfg', { nested: { deep: { t: TOKEN } } });
  logger.error('db', 'fail', { err: new Error('postgres://user:supersecretpw@host:5432/db') });
  console.error = orig.e; console.log = orig.l; console.warn = orig.w;

  const logged = captured.join('\n');
  const secretHalf = TOKEN.split(':')[1] || '';
  check('logger emitted output', captured.length === 4);
  check('full token never reaches log output', !logged.includes(TOKEN));
  check('token secret half never reaches log output', secretHalf.length > 10 && !logged.includes(secretHalf));
  check('redaction marker present', logged.includes('<token:redacted>'));
  check('db password redacted too', !logged.includes('supersecretpw'));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  if (passed !== results.length) {
    console.log('FAILED:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  · ${r.name} — ${r.note}`));
  }
  process.exit(passed === results.length ? 0 : 1);
}

main();
