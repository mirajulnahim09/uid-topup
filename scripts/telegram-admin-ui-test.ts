/**
 * টেলিগ্রাম অ্যাডমিন UI + ইভেন্ট-সুইচ টেস্ট।
 * `npx tsx scripts/telegram-admin-ui-test.ts`  (dev server চালু থাকতে হবে)
 *
 * ⚠️ কখনো টোকেন/পাসওয়ার্ড ছাপে না। শেষে সব সুইচ আগের অবস্থায় ফেরানো হয়।
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

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

function storeCookies(res: Response) {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function main() {
  // ── লগইন ──
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
    console.log('FATAL: admin login failed');
    process.exit(1);
  }

  console.log('\n═══ 1. Page renders ═══');
  const page = await fetch(`${BASE}/admin/telegram`, { headers: { Cookie: cookie() } });
  const html = await page.text();
  check('/admin/telegram returns 200', page.status === 200, `${html.length} bytes`);
  check('shows connection status section', html.includes('সংযোগের অবস্থা'));
  check('shows activity section', html.includes('কার্যকলাপ'));
  check('shows bot username', html.includes('uidtopup1bot'));
  check('shows bot id', html.includes('8801466881'));
  check('has test-message button', html.includes('টেস্ট মেসেজ পাঠান'));
  check('nav link present', html.includes('/admin/telegram'));

  console.log('\n═══ 2. All 10 events rendered ═══');
  const LABELS = [
    'নতুন ডিপোজিট', 'ডিপোজিট অনুমোদিত', 'ডিপোজিট বাতিল', 'নতুন অর্ডার',
    'অর্ডার সম্পন্ন', 'রিফান্ড', 'নতুন রেজিস্ট্রেশন', 'স্টক শেষ',
    'মেইনটেন্যান্স মোড', 'ক্যাম্পেইন প্রকাশ',
  ];
  for (const l of LABELS) check(`event "${l}" on page`, html.includes(l));

  console.log('\n═══ 3. No secret exposure ═══');
  check('FULL TOKEN not in page HTML', !html.includes(TOKEN));
  check('token secret half not in page HTML', SECRET.length > 10 && !html.includes(SECRET));
  // chat_id সেট থাকলে মাস্কড হওয়া উচিত — এখন সেট নেই, তাই শুধু গঠন যাচাই
  check('token shown only as dots', html.includes('••••••••••') || html.includes('সেট করা নেই'));

  console.log('\n═══ 4. Status API ═══');
  const apiRes = await fetch(`${BASE}/api/admin/telegram`, { headers: { Cookie: cookie() } });
  const api = (await apiRes.json()) as {
    connection: Record<string, unknown>;
    enabled: boolean;
    events: { key: string; enabled: boolean }[];
    activity: Record<string, unknown>;
  };
  check('GET returns 200', apiRes.status === 200);
  check('reports bot username', api.connection.botUsername === 'uidtopup1bot');
  check('reports bot id', api.connection.botId === 8801466881);
  check('tokenValid true', api.connection.tokenValid === true);
  // ★ "connected" = টোকেন বৈধ **এবং** chat_id আছে। হার্ডকোড না করে
  //   সম্পর্কটাই যাচাই করি, যাতে chat_id যোগ হলে টেস্ট বাসি না হয়।
  check(
    'connected === (tokenValid && chatIdSet)',
    api.connection.connected === Boolean(api.connection.tokenValid && api.connection.chatIdSet),
    `connected=${api.connection.connected} chatIdSet=${api.connection.chatIdSet}`,
  );
  check('response has no token field', !JSON.stringify(api).includes(TOKEN));
  if (api.connection.chatIdSet) {
    const cid = String(api.connection.chatId ?? '');
    check('chat_id is masked by default', cid.includes('•'), cid);
  }
  check('returns exactly 15 events', api.events.length === 15, `${api.events.length}`);
  check('activity object present', typeof api.activity === 'object');

  console.log('\n═══ 5. Unauthenticated access blocked ═══');
  const anon = await fetch(`${BASE}/api/admin/telegram`);
  check('GET requires admin', anon.status === 401, `HTTP ${anon.status}`);
  const anonPost = await fetch(`${BASE}/api/admin/telegram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":false}',
  });
  check('POST requires admin', anonPost.status === 401, `HTTP ${anonPost.status}`);

  console.log('\n═══ 6. Toggles persist ═══');
  const before = { enabled: api.enabled, events: Object.fromEntries(api.events.map((e) => [e.key, e.enabled])) };

  const flip = await fetch(`${BASE}/api/admin/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie() },
    body: JSON.stringify({ enabled: false, events: { deposit_new: false, campaign: true } }),
  });
  check('POST accepted', flip.status === 200, `HTTP ${flip.status}`);

  const after = (await (await fetch(`${BASE}/api/admin/telegram`, { headers: { Cookie: cookie() } })).json()) as typeof api;
  const ev = Object.fromEntries(after.events.map((e) => [e.key, e.enabled]));
  check('master switch persisted (off)', after.enabled === false);
  check('deposit_new persisted (off)', ev.deposit_new === false);
  check('campaign persisted (on)', ev.campaign === true);
  check('untouched event unchanged', ev.low_stock === before.events.low_stock);

  console.log('\n═══ 7. Unknown event keys rejected ═══');
  const junk = await fetch(`${BASE}/api/admin/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie() },
    body: JSON.stringify({ events: { not_a_real_event: true, __proto__: 'x' } }),
  });
  check('junk-only payload is rejected', junk.status === 400, `HTTP ${junk.status}`);

  console.log('\n═══ 8. Gating actually suppresses sends ═══');
  // মাস্টার সুইচ এখনো বন্ধ — এই অবস্থায় shouldSend() false হওয়া উচিত
  const { shouldSend } = await import('../src/lib/telegram');
  const { invalidateSettings } = await import('../src/lib/settings');
  invalidateSettings();
  check('master OFF ⇒ shouldSend(order_new) false', (await shouldSend('order_new')) === false);

  await fetch(`${BASE}/api/admin/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie() },
    body: JSON.stringify({ enabled: true }),
  });
  invalidateSettings();
  check('master ON + event OFF ⇒ false', (await shouldSend('deposit_new')) === false);
  check('master ON + event ON ⇒ true', (await shouldSend('campaign')) === true);
  check('unclassified message ⇒ true', (await shouldSend()) === true);

  console.log('\n═══ 9. End-to-end test message ═══');
  if (!after.connection?.chatIdSet && !api.connection.chatIdSet) {
    console.log('  SKIP — no chat_id configured, cannot deliver');
  } else {
    const t0 = Date.now();
    const testRes = await fetch(`${BASE}/api/admin/telegram-test`, {
      method: 'POST', headers: { Cookie: cookie() },
    });
    const testBody = (await testRes.json()) as { success?: boolean; message?: string; error?: string };
    check('test message delivered', testRes.status === 200 && testBody.success === true,
      testBody.message || testBody.error || `HTTP ${testRes.status}`);
    check('test response leaks no token', !JSON.stringify(testBody).includes(TOKEN));

    // ★ সফল পাঠানোর পর স্ট্যাটাস DB-তে লেখা হয়েছে কি না
    const act = (await (await fetch(`${BASE}/api/admin/telegram`, { headers: { Cookie: cookie() } })).json()) as typeof api;
    const okAt = act.activity.lastOkAt as string | null;
    check('lastOkAt recorded', Boolean(okAt) && new Date(okAt!).getTime() >= t0 - 5000, String(okAt));
    check('lastError cleared after success', !act.activity.lastError);
  }

  console.log('\n═══ 10. Restore original settings ═══');
  const restore = await fetch(`${BASE}/api/admin/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie() },
    body: JSON.stringify({ enabled: before.enabled, events: before.events }),
  });
  check('settings restored', restore.status === 200);
  const final = (await (await fetch(`${BASE}/api/admin/telegram`, { headers: { Cookie: cookie() } })).json()) as typeof api;
  const finalEv = Object.fromEntries(final.events.map((e) => [e.key, e.enabled]));
  check('master back to original', final.enabled === before.enabled);
  check('every event back to original',
    Object.entries(before.events).every(([k, v]) => finalEv[k] === v));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  if (passed !== results.length) {
    results.filter((r) => !r.ok).forEach((r) => console.log(`  FAILED: ${r.name} — ${r.note}`));
  }
  process.exit(passed === results.length ? 0 : 1);
}

main();
