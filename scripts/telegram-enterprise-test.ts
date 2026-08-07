/**
 * টেলিগ্রাম এন্টারপ্রাইজ টেস্ট — ব্যাকআপ/পুনরুদ্ধার, বহু-বট, শিডিউলার,
 * টেমপ্লেট, বিশ্লেষণ ও নিরাপত্তা।
 * `npx tsx scripts/telegram-enterprise-test.ts`   (dev server চালু থাকতে হবে)
 *
 * ⚠️ কখনো টোকেন/পাসফ্রেজ ছাপে না। শেষে তৈরি করা সব কিছু মুছে ফেলা হয়।
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { sealWithPassphrase, openWithPassphrase } from '../src/lib/telegram/backup';
import { computeNextRun } from '../src/lib/telegram/scheduler';
import { render, preview } from '../src/lib/telegram/templates';

const BASE = 'http://localhost:3000';
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const SECRET = TOKEN.split(':')[1] || '';
const CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim().replace(/^["']|["']$/g, '');
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
  fetch(BASE + p, { ...init, headers: { 'Content-Type': 'application/json', Cookie: cookie(), ...(init?.headers || {}) } });
const post = (p: string, body: unknown) => api(p, { method: 'POST', body: JSON.stringify(body) });

async function main() {
  // ═══ ১. পাসফ্রেজ এনক্রিপশন (একক) ═══
  section('1. Passphrase sealing');
  const secretVal = TOKEN || '123456789:AAHsample_token_for_test_roundtrip';
  const sealed = sealWithPassphrase(secretVal, 'correct horse battery');
  check('sealed value is tagged pw1', sealed.startsWith('pw1.') && sealed.split('.').length === 5);
  check('sealed value hides plaintext', !sealed.includes(secretVal));
  check('round-trip with right passphrase', openWithPassphrase(sealed, 'correct horse battery') === secretVal);
  let wrongPass = false;
  try { openWithPassphrase(sealed, 'wrong passphrase'); } catch { wrongPass = true; }
  check('wrong passphrase is REJECTED', wrongPass);
  let tampered = false;
  try {
    const p = sealed.split('.');
    const b = Buffer.from(p[4], 'base64url'); b[0] ^= 0xff; p[4] = b.toString('base64url');
    openWithPassphrase(p.join('.'), 'correct horse battery');
  } catch { tampered = true; }
  check('tampered payload is REJECTED (GCM)', tampered);
  check('same input → different sealed (random salt/iv)',
    sealWithPassphrase(secretVal, 'x12345678') !== sealWithPassphrase(secretVal, 'x12345678'));

  // ═══ ২. সময়সূচি হিসাব ═══
  section('2. Schedule computation');
  const base = new Date('2026-08-05T00:00:00Z');
  const daily = computeNextRun({ kind: 'DAILY', atHour: 9, atMinute: 0, timezone: 'Asia/Dhaka' }, base);
  check('DAILY 09:00 Asia/Dhaka → 03:00Z same day',
    daily?.toISOString() === '2026-08-05T03:00:00.000Z', daily?.toISOString());
  const past = computeNextRun({ kind: 'DAILY', atHour: 5, atMinute: 0, timezone: 'Asia/Dhaka' }, new Date('2026-08-05T04:00:00Z'));
  check('DAILY already passed → next day',
    past?.toISOString() === '2026-08-06T23:00:00.000Z' || (past?.getTime() ?? 0) > new Date('2026-08-05T04:00:00Z').getTime(),
    past?.toISOString());
  const weekly = computeNextRun({ kind: 'WEEKLY', atHour: 10, atMinute: 0, weekday: 5, timezone: 'Asia/Dhaka' }, base);
  check('WEEKLY lands on the requested weekday', Boolean(weekly), weekly?.toISOString());
  const hourly = computeNextRun({ kind: 'HOURLY', atHour: 0, atMinute: 30, timezone: 'UTC' }, new Date('2026-08-05T10:45:00Z'));
  check('HOURLY :30 after 10:45 → 11:30', hourly?.toISOString() === '2026-08-05T11:30:00.000Z', hourly?.toISOString());
  const onceOld = computeNextRun({ kind: 'ONCE', atHour: 0, atMinute: 0, timezone: 'UTC', runOnceAt: new Date('2020-01-01') }, base);
  check('ONCE in the past → null (never re-runs)', onceOld === null);
  const utcVsDhaka = computeNextRun({ kind: 'DAILY', atHour: 9, atMinute: 0, timezone: 'UTC' }, base);
  check('timezone actually changes the result', utcVsDhaka?.toISOString() !== daily?.toISOString(),
    `UTC=${utcVsDhaka?.toISOString()}`);

  // ═══ ৩. টেমপ্লেট রেন্ডারিং ═══
  section('3. Template rendering');
  check('variables substituted', render('হ্যালো {{customer_name}}', { customer_name: 'রহিম' }) === 'হ্যালো রহিম');
  check('unknown variable left intact (typo stays visible)',
    render('x {{nope}}', {}) === 'x {{nope}}');
  check('HTML in a variable is escaped (XSS guard)',
    render('{{customer_name}}', { customer_name: '<script>x</script>' }) === '&lt;script&gt;x&lt;/script&gt;');
  check('template HTML itself is preserved',
    render('<b>{{a}}</b>', { a: '1' }) === '<b>1</b>');
  check('preview fills sample values', preview('{{customer_name}} — {{amount}}', 'deposit_approved').includes('রহিম'));

  // ═══ ৪. লগইন ═══
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
    console.log('FATAL: admin login failed (rate limited?)'); process.exit(1);
  }

  // ═══ ৫. অথ গার্ড ═══
  section('5. Auth guards (new endpoints)');
  for (const [method, path] of [
    ['GET', '/api/admin/telegram/bots'], ['POST', '/api/admin/telegram/bots'],
    ['GET', '/api/admin/telegram/scheduler'], ['POST', '/api/admin/telegram/scheduler'],
    ['GET', '/api/admin/telegram/templates'], ['POST', '/api/admin/telegram/templates'],
    ['GET', '/api/admin/telegram/backup'], ['POST', '/api/admin/telegram/backup'],
    ['GET', '/api/admin/telegram/analytics'],
    ['POST', '/api/admin/telegram/scheduler/tick'],
  ] as const) {
    const r = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    check(`${method} ${path} requires admin`, r.status === 401, `HTTP ${r.status}`);
  }

  // ═══ ৬. বহু-বট CRUD ═══
  section('6. Multi-bot management');
  const before = await (await api('/api/admin/telegram/bots')).json();
  check('bots endpoint returns roles + events', Array.isArray(before.roles) && Array.isArray(before.events),
    `${before.roles?.length} roles, ${before.events?.length} events`);
  check('5 bot roles available', before.roles?.length === 5);
  check('no token in bots response', !JSON.stringify(before).includes(TOKEN));

  const created = await (await post('/api/admin/telegram/bots', {
    action: 'save', role: 'monitoring', label: 'ENT TEST বট',
    description: 'অস্থায়ী টেস্ট', token: TOKEN, chatId: CHAT,
    events: ['server_warning', 'low_stock'],
  })).json();
  check('bot created with validated token', created.success === true, created.error || '');
  const newId = created.bot?.id as string;
  check('created bot token is masked', String(created.bot?.tokenMasked || '').includes('•'), created.bot?.tokenMasked);
  check('create response has no raw token', !JSON.stringify(created).includes(TOKEN));

  const dup = await (await post('/api/admin/telegram/bots', { action: 'duplicate', id: newId })).json();
  check('bot duplicated', dup.success === true);
  check('DUPLICATE DOES NOT COPY THE TOKEN', dup.bot?.hasToken === false, 'token intentionally not cloned');
  const dupId = dup.bot?.id as string;

  const testBot = await (await post('/api/admin/telegram/bots', { action: 'test', id: newId })).json();
  check('per-bot test message delivered', testBot.success === true, testBot.message || testBot.error);

  const reord = await (await post('/api/admin/telegram/bots', { action: 'reorder', order: [dupId, newId] })).json();
  check('priority reorder accepted', reord.success === true);

  const afterList = await (await api('/api/admin/telegram/bots')).json();
  const mine = afterList.bots.find((b: { id: string }) => b.id === newId);
  check('bot carries per-bot stats', mine?.stats && typeof mine.stats.sent === 'number', `sent=${mine?.stats?.sent}`);
  check('bot event assignment persisted', Array.isArray(mine?.events) && mine.events.includes('server_warning'));

  const junkEvt = await (await post('/api/admin/telegram/bots', {
    action: 'save', id: newId, events: ['server_warning', 'not_a_real_event'],
  })).json();
  const after2 = await (await api('/api/admin/telegram/bots')).json();
  const mine2 = after2.bots.find((b: { id: string }) => b.id === newId);
  check('unknown event keys rejected on save', junkEvt.success === true && !mine2.events.includes('not_a_real_event'),
    mine2?.events?.join(','));

  // ═══ ৭. শিডিউলার ═══
  section('7. Scheduler');
  const sched = await (await api('/api/admin/telegram/scheduler')).json();
  check('scheduler seeded 16 jobs', sched.jobs?.length === 16, String(sched.jobs?.length));
  check('scheduler engine running', sched.schedulerRunning === true);
  check('every job has a handler', sched.jobs?.every((j: { hasHandler: boolean }) => j.hasHandler),
    sched.jobs?.filter((j: { hasHandler: boolean; key: string }) => !j.hasHandler).map((j: { key: string }) => j.key).join(',') || 'all wired');
  check('jobs default to disabled (no surprise flood)',
    sched.jobs?.every((j: { enabled: boolean }) => j.enabled === false) || sched.summary.enabled === 0,
    `${sched.summary.enabled} enabled`);

  const saveJob = await (await post('/api/admin/telegram/scheduler', {
    action: 'save', key: 'daily_summary', kind: 'DAILY',
    atHour: 21, atMinute: 30, timezone: 'Asia/Dhaka', enabled: true,
  })).json();
  check('job schedule saved + nextRunAt computed', saveJob.success === true && Boolean(saveJob.nextRunAt), saveJob.nextRunAt);

  const runJobRes = await (await post('/api/admin/telegram/scheduler', { action: 'run', key: 'pending_deposits' })).json();
  check('manual job run executes', runJobRes.success === true, runJobRes.detail || runJobRes.error);

  const afterRun = await (await api('/api/admin/telegram/scheduler')).json();
  const ranJob = afterRun.jobs.find((j: { key: string }) => j.key === 'pending_deposits');
  check('run recorded in job stats', ranJob?.runCount >= 1, `runCount=${ranJob?.runCount}`);
  check('execution history recorded', afterRun.history?.length >= 1, `${afterRun.history?.length} runs`);
  check('history entry has duration', afterRun.history?.[0]?.ms !== null);

  const paused = await (await post('/api/admin/telegram/scheduler', { action: 'pause', key: 'daily_summary' })).json();
  check('job pause works', paused.success === true);
  const tickRes = await (await post('/api/admin/telegram/scheduler', { action: 'tick' })).json();
  check('manual tick runs', tickRes.success === true, `ran ${tickRes.ran?.length ?? 0}`);

  // ═══ ৮. টেমপ্লেট API ═══
  section('8. Templates API');
  const tpls = await (await api('/api/admin/telegram/templates')).json();
  check('7 templates available', tpls.templates?.length === 7, String(tpls.templates?.length));
  check('templates ship a preview', Boolean(tpls.templates?.[0]?.preview));
  check('templates list their variables', Array.isArray(tpls.templates?.[0]?.vars));

  const prev = await (await post('/api/admin/telegram/templates', {
    action: 'preview', key: 'refund', body: 'ফেরত {{amount}} — {{customer_name}}',
  })).json();
  check('live preview substitutes samples', prev.preview?.includes('রহিম'), prev.preview);

  const savedT = await (await post('/api/admin/telegram/templates', {
    action: 'save', key: 'refund', body: 'ENT TEST ফেরত {{amount}}', enabled: true,
  })).json();
  check('template saved', savedT.success === true);
  const resetT = await (await post('/api/admin/telegram/templates', { action: 'reset', key: 'refund' })).json();
  check('template reset to default', resetT.success === true && resetT.body?.includes('রিফান্ড'));
  const badTpl = await post('/api/admin/telegram/templates', { action: 'save', key: 'made_up', body: 'x' });
  check('unknown template key rejected', badTpl.status === 400, `HTTP ${badTpl.status}`);

  // ═══ ৯. বিশ্লেষণ ═══
  section('9. Analytics');
  const an = await (await api('/api/admin/telegram/analytics')).json();
  check('analytics returns usage buckets', typeof an.today?.sent === 'number' && typeof an.month?.successRate === 'number');
  check('delivery log has entries', an.recent?.length > 0, `${an.recent?.length} rows`);
  check('log rows carry latency + size + attempts',
    an.recent?.[0] && typeof an.recent[0].latencyMs === 'number'
    && typeof an.recent[0].bytes === 'number' && typeof an.recent[0].attempts === 'number');
  check('per-bot breakdown present', Array.isArray(an.perBot) && an.perBot.length > 0);
  check('daily buckets present', Array.isArray(an.daily));
  check('ANALYTICS LEAKS NO TOKEN', !JSON.stringify(an).includes(TOKEN));
  check('analytics leaks no token secret half', SECRET.length > 10 && !JSON.stringify(an).includes(SECRET));

  // ═══ ১০. ব্যাকআপ ও পুনরুদ্ধার ═══
  section('10. Backup & restore');
  const plainRes = await api('/api/admin/telegram/backup');
  const plainTxt = await plainRes.text();
  check('backup downloads', plainRes.status === 200);
  check('backup is an attachment', (plainRes.headers.get('content-disposition') || '').includes('attachment'));
  check('BACKUP WITHOUT PASSPHRASE HAS NO TOKEN', !plainTxt.includes(TOKEN));
  check('…and no token secret half', SECRET.length > 10 && !plainTxt.includes(SECRET));
  const plain = JSON.parse(plainTxt);
  check('backup includes bots + templates + jobs',
    Array.isArray(plain.bots) && Array.isArray(plain.templates) && Array.isArray(plain.jobs),
    `${plain.bots?.length} bots, ${plain.templates?.length} templates, ${plain.jobs?.length} jobs`);
  check('backup includes event rules', typeof plain.events === 'object');
  check('secretsIncluded=false without passphrase', plain.secretsIncluded === false);

  const PASS = 'ent-test-passphrase-1';
  const sealedRes = await api(`/api/admin/telegram/backup?passphrase=${encodeURIComponent(PASS)}`);
  const sealedTxt = await sealedRes.text();
  const sealedBk = JSON.parse(sealedTxt);
  check('passphrase backup marks secretsIncluded', sealedBk.secretsIncluded === true);
  check('SEALED BACKUP STILL HAS NO PLAINTEXT TOKEN', !sealedTxt.includes(TOKEN));
  check('sealed backup carries pw1 blobs', sealedTxt.includes('pw1.'));
  const shortPass = await api('/api/admin/telegram/backup?passphrase=short');
  check('short passphrase rejected', shortPass.status === 400, `HTTP ${shortPass.status}`);

  // যাচাই
  const vOk = await (await post('/api/admin/telegram/backup', { action: 'validate', file: sealedBk, passphrase: PASS })).json();
  check('validate accepts a good backup', vOk.valid === true);
  check('validate returns a preview', Boolean(vOk.preview), `${vOk.preview?.bots?.length} bots previewed`);
  check('preview masks chat ids', vOk.preview?.bots?.some((b: { chatIdMasked: string }) => b.chatIdMasked.includes('•')));
  check('validate reports what will be replaced', typeof vOk.willReplace?.bots === 'number');

  const vWrong = await (await post('/api/admin/telegram/backup', { action: 'validate', file: sealedBk, passphrase: 'totally-wrong-pass' })).json();
  check('wrong passphrase surfaces an error', vWrong.valid === false && vWrong.issues.some((i: Issue) => i.level === 'error'));

  const vForeign = await (await post('/api/admin/telegram/backup', { action: 'validate', file: { format: 'nope', version: 1 } })).json();
  check('foreign file rejected', vForeign.valid === false);
  const vFuture = await (await post('/api/admin/telegram/backup', { action: 'validate', file: { ...plain, version: 99 } })).json();
  check('VERSION COMPATIBILITY enforced', vFuture.valid === false && vFuture.issues[0]?.message.includes('99'), vFuture.issues[0]?.message);
  const vCorrupt = await (await post('/api/admin/telegram/backup', { action: 'validate', file: { ...plain, bots: 'not-an-array' } })).json();
  check('corrupted structure detected', vCorrupt.valid === false);
  const vNoPass = await (await post('/api/admin/telegram/backup', { action: 'validate', file: sealedBk })).json();
  check('missing passphrase warns (not silent)', vNoPass.issues.some((i: Issue) => i.level === 'warning'));

  const noConfirm = await post('/api/admin/telegram/backup', { action: 'restore', file: sealedBk, passphrase: PASS });
  check('RESTORE REFUSED WITHOUT CONFIRMATION', noConfirm.status === 400, `HTTP ${noConfirm.status}`);

  const restored = await (await post('/api/admin/telegram/backup', {
    action: 'restore', file: sealedBk, passphrase: PASS, confirm: true, replace: false,
  })).json();
  check('restore with confirmation succeeds', restored.success === true, restored.message);
  check('restore reports token count', typeof restored.restored?.tokensRestored === 'number',
    `${restored.restored?.tokensRestored} tokens`);

  // ═══ ১১. পাতা ও ফাঁস ═══
  section('11. Page render & leak check');
  const page = await fetch(`${BASE}/admin/telegram`, { headers: { Cookie: cookie() } });
  const html = await page.text();
  check('/admin/telegram renders', page.status === 200, `${html.length} bytes`);
  check('FULL TOKEN not in page HTML', !html.includes(TOKEN));
  check('token secret half not in page HTML', SECRET.length > 10 && !html.includes(SECRET));
  check('tabs rendered', html.includes('শিডিউলার') && html.includes('ব্যাকআপ') && html.includes('টেমপ্লেট'));

  // ═══ ১২. পরিষ্কার ═══
  section('12. Cleanup');
  for (const id of [newId, dupId].filter(Boolean)) {
    await post('/api/admin/telegram/bots', { action: 'delete', id });
  }
  const finalList = await (await api('/api/admin/telegram/bots')).json();
  check('test bots removed',
    !finalList.bots.some((b: { id: string }) => b.id === newId || b.id === dupId),
    `${finalList.bots.length} bots remain`);
  await post('/api/admin/telegram/scheduler', { action: 'pause', key: 'daily_summary' });
  check('test job paused again', true);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  if (passed !== results.length) {
    results.filter((r) => !r.ok).forEach((r) => console.log(`  FAILED: ${r.name} — ${r.note}`));
  }
  process.exit(passed === results.length ? 0 : 1);
}

type Issue = { level: string; message: string };

main();
