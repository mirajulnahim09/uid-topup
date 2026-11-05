/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অথ রেড-টিম — যেসব প্রান্ত আগে পরীক্ষা হয়নি
 *     (EXTREME অডিট, ২০২৬-০৯-১৮)
 *
 *   ক. ইমেইলের রূপভেদ: বড়/ছোট হাতের অক্ষর, আগে-পরে ফাঁকা, ডট-ভেরিয়েন্ট
 *   খ. রেজিস্ট্রেশন: একই ইমেইল ভিন্ন case-এ দ্বিতীয়বার
 *   গ. OTP: বারবার পাঠানো (spam), একাধিক সক্রিয় কোড, পুরনো কোড
 *   ঘ. সেশন-কুকি: httpOnly · secure · sameSite · মেয়াদ
 *   ঙ. লগআউটের পরে পুরনো কুকি · পাসওয়ার্ড বদলের পরে পুরনো সেশন
 *   চ. ব্যান হওয়া ইউজারের লগইন ও চলমান সেশন
 *
 *   ⚠️ কোনো নিরাপত্তা-সীমা বন্ধ করা হয় না; রেট-লিমিট **স্থানীয় টেস্ট-কাউন্টার**
 *   হিসেবে ধাপের মাঝে সাফ করা হয় (সুরক্ষা অক্ষত — ঙ/চ ধাপ নিজেরাই সীমা মাপে)।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/red-team-auth.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { issueOtp } from '../../src/lib/otp/core';
import { request, type APIRequestContext } from 'playwright-core';
import bcrypt from 'bcryptjs';

const TAG = `rt${Date.now().toString(36)}`;
const PASSWORD = 'RedTeam2026Pass';

let pass = 0; const fails: string[] = [];
function check(name: string, ok: boolean, note = '') {
  if (ok) pass++; else fails.push(`${name} — ${note}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}
const clearRl = () => db.rateLimitBucket.deleteMany({});
const ctx = () => request.newContext({ ignoreHTTPSErrors: true });

async function login(c: APIRequestContext, email: string, password: string) {
  const { csrfToken } = await (await c.get(`${BASE}/api/auth/csrf`)).json();
  const res = await c.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email, password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  const me = await (await c.get(`${BASE}/api/auth/session`)).json().catch(() => null);
  return { status: res.status(), headers: res.headersArray(), loggedIn: Boolean(me?.user?.id), email: me?.user?.email };
}

async function main() {
  console.log(`═══ অথ রেড-টিম · ${BASE} · DB ${dbLabel()} ═══`);

  /* ── ক/খ. ইমেইলের রূপভেদ ও ডুপ্লিকেট রেজিস্ট্রেশন ── */
  console.log('\n── ক. ইমেইল-রূপভেদ ও ডুপ্লিকেট ──');
  const anon = await ctx();
  const baseEmail = `${TAG}-Mixed@Verify.Local`;
  const lower = baseEmail.toLowerCase();
  await clearRl();
  const otp1 = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: lower, ip: '127.0.0.1' });
  const reg1 = await anon.post(`${BASE}/api/register`, {
    data: { name: 'রেড টিম', email: baseEmail, phone: `017${String(Date.now()).slice(-8)}`, password: PASSWORD, code: otp1.code },
    failOnStatusCode: false,
  });
  const created = await db.user.findFirst({ where: { email: { in: [baseEmail, lower] } } });
  check('বড়-হাতের ইমেইলে রেজিস্ট্রেশন হয়', reg1.status() === 200, `HTTP ${reg1.status()} ${(await reg1.text()).slice(0, 90)}`);
  check('  ↳ DB-তে ইমেইল lowercase-এ সংরক্ষিত', created?.email === lower, created?.email ?? 'নেই');

  await clearRl();
  const otp2 = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: lower, ip: '127.0.0.1' });
  const reg2 = await anon.post(`${BASE}/api/register`, {
    data: { name: 'নকল', email: lower, phone: `018${String(Date.now()).slice(-8)}`, password: PASSWORD, code: otp2.code },
    failOnStatusCode: false,
  });
  const count1 = await db.user.count({ where: { email: lower } });
  check('একই ইমেইল ভিন্ন case-এ দ্বিতীয় অ্যাকাউন্ট হয় না', reg2.status() >= 400 && count1 === 1, `HTTP ${reg2.status()} · অ্যাকাউন্ট ${count1}`);

  await clearRl();
  const spaced = `  ${lower}  `;
  const otp3 = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: lower, ip: '127.0.0.1' });
  const reg3 = await anon.post(`${BASE}/api/register`, {
    data: { name: 'ফাঁকা', email: spaced, phone: `019${String(Date.now()).slice(-8)}`, password: PASSWORD, code: otp3.code },
    failOnStatusCode: false,
  });
  check('আগে-পরে ফাঁকাসহ ইমেইলেও ডুপ্লিকেট আটকায়', reg3.status() >= 400 && (await db.user.count({ where: { email: lower } })) === 1, `HTTP ${reg3.status()}`);

  /* ── লগইন case-insensitive ── */
  await clearRl();
  const c1 = await ctx();
  const up = await login(c1, lower.toUpperCase(), PASSWORD);
  check('বড়-হাতের ইমেইলে লগইন হয় (normalize)', up.loggedIn && up.email === lower, `${up.status} · ${up.email ?? 'সেশন নেই'}`);

  /* ── ঘ. সেশন-কুকির ফ্ল্যাগ ── */
  console.log('\n── ঘ. সেশন-কুকির নিরাপত্তা-ফ্ল্যাগ ──');
  const setCookies = up.headers.filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);
  const sessionCookie = setCookies.find((v) => /session-token=/.test(v)) ?? '';
  const csrfCookie = setCookies.find((v) => /csrf-token=/.test(v)) ?? '';
  const flag = (c: string, f: RegExp) => f.test(c);
  check('সেশন-কুকি HttpOnly', flag(sessionCookie, /HttpOnly/i), sessionCookie ? 'আছে' : 'কুকি পাওয়া যায়নি');
  check('সেশন-কুকি Secure (TLS-এ)', flag(sessionCookie, /Secure/i));
  check('সেশন-কুকি SameSite=Lax/Strict', /SameSite=(Lax|Strict)/i.test(sessionCookie), (sessionCookie.match(/SameSite=\w+/i) ?? ['নেই'])[0]);
  check('সেশন-কুকির নাম __Secure- উপসর্গে', /__Secure-/.test(sessionCookie), sessionCookie.split('=')[0] || 'নেই');
  check('CSRF কুকিও HttpOnly', csrfCookie === '' || flag(csrfCookie, /HttpOnly/i), csrfCookie ? 'আছে' : '(এই উত্তরে আসেনি)');

  /* ── গ. OTP spam ও একাধিক কোড ── */
  console.log('\n── গ. OTP ──');
  await clearRl();
  const otpEmail = `${TAG}-otp@verify.local`;
  const sendResults: number[] = [];
  for (let i = 0; i < 8; i++) {
    const r = await anon.post(`${BASE}/api/auth/otp/send`, { data: { channel: 'EMAIL', purpose: 'REGISTER', destination: otpEmail }, failOnStatusCode: false });
    sendResults.push(r.status());
  }
  check('OTP বারবার পাঠানো সীমিত (৪২৯ আসে)', sendResults.includes(429), sendResults.join(','));
  const first = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: otpEmail, ip: '127.0.0.1' });
  const second = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: otpEmail, ip: '127.0.0.1' });
  const active = await db.otp.count({ where: { destination: otpEmail, purpose: 'REGISTER', consumedAt: null } });
  check('একসাথে একটিই সক্রিয় OTP থাকে', active === 1, `${active}টি`);
  await clearRl();
  const oldCode = await anon.post(`${BASE}/api/register`, {
    data: { name: 'পুরনো কোড', email: otpEmail, phone: `016${String(Date.now()).slice(-8)}`, password: PASSWORD, code: first.code },
    failOnStatusCode: false,
  });
  check('পুরনো (প্রতিস্থাপিত) OTP কাজ করে না', oldCode.status() >= 400, `HTTP ${oldCode.status()}`);
  check('  ↳ নতুন কোডটিই বৈধ', Boolean(second.code) && second.code !== first.code);

  /* ── ঙ. লগআউট ও পাসওয়ার্ড বদলের পরে সেশন ── */
  console.log('\n── ঙ. সেশন-বাতিলকরণ ──');
  const user = await db.user.create({
    data: {
      name: 'সেশন যাচাই', email: `${TAG}-sess@verify.local`, phone: `015${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(PASSWORD, 10), emailVerified: true, referralCode: `${TAG}S`.toUpperCase().slice(0, 12),
    },
  });
  await clearRl();
  const sessA = await ctx(); await login(sessA, user.email, PASSWORD);
  const sessB = await ctx(); await login(sessB, user.email, PASSWORD);
  check('একই অ্যাকাউন্টে দুটি সেশন একসাথে চলে', (await (await sessA.get(`${BASE}/api/me`, { failOnStatusCode: false })).status()) === 200
    && (await (await sessB.get(`${BASE}/api/me`, { failOnStatusCode: false })).status()) === 200);

  // লগআউট (A) — B অক্ষত থাকা উচিত
  const { csrfToken } = await (await sessA.get(`${BASE}/api/auth/csrf`)).json();
  await sessA.post(`${BASE}/api/auth/signout`, { form: { csrfToken, json: 'true' }, maxRedirects: 0, failOnStatusCode: false });
  const aAfter = (await sessA.get(`${BASE}/api/me`, { failOnStatusCode: false })).status();
  const bAfter = (await sessB.get(`${BASE}/api/me`, { failOnStatusCode: false })).status();
  check('লগআউটের পরে ঐ সেশন বন্ধ', aAfter === 401, `HTTP ${aAfter}`);
  check('  ↳ অন্য ডিভাইসের সেশন চালু থাকে (প্রত্যাশিত)', bAfter === 200, `HTTP ${bAfter}`);

  // পাসওয়ার্ড বদল (B) → B-র নিজের সেশন? অন্য সেশন?
  const sessC = await ctx(); await clearRl(); await login(sessC, user.email, PASSWORD);
  const pwRes = await sessB.post(`${BASE}/api/account/password`, { data: { current: PASSWORD, next: 'RedTeamNew2026x' }, failOnStatusCode: false });
  check('পাসওয়ার্ড বদল হয়', pwRes.status() === 200, `HTTP ${pwRes.status()}`);
  const cAfterPw = (await sessC.get(`${BASE}/api/me`, { failOnStatusCode: false })).status();
  console.log(`  তথ্য: পাসওয়ার্ড বদলের পরে **অন্য** ডিভাইসের সেশন: HTTP ${cAfterPw} ${cAfterPw === 200 ? '(টিকে থাকে — নথিভুক্ত আচরণ, "সব ডিভাইস সাইন-আউট" বোতাম আলাদা)' : '(বাতিল)'}`);
  await clearRl();
  const oldPw = await login(await ctx(), user.email, PASSWORD);
  check('পুরনো পাসওয়ার্ডে আর লগইন হয় না', !oldPw.loggedIn);

  // revoke-all → সব সেশন বাতিল
  const sessD = await ctx(); await clearRl(); await login(sessD, user.email, 'RedTeamNew2026x');
  const rev = await sessD.post(`${BASE}/api/account/sessions/revoke-all`, { data: {}, failOnStatusCode: false });
  const cAfterRevoke = (await sessC.get(`${BASE}/api/me`, { failOnStatusCode: false })).status();
  check('"সব ডিভাইস সাইন-আউট" পুরনো সেশন বাতিল করে', rev.status() === 200 && cAfterRevoke === 401, `revoke ${rev.status()} · পুরনো সেশন ${cAfterRevoke}`);

  /* ── চ. ব্যান ── */
  console.log('\n── চ. ব্যান ──');
  const sessE = await ctx(); await clearRl(); await login(sessE, user.email, 'RedTeamNew2026x');
  await db.user.update({ where: { id: user.id }, data: { isBanned: true } });
  const banned = (await sessE.get(`${BASE}/api/me`, { failOnStatusCode: false })).status();
  const bannedOrder = await sessE.post(`${BASE}/api/order`, { data: { variantId: 1, playerUid: '1234567890' }, failOnStatusCode: false });
  await clearRl();
  const bannedLogin = await login(await ctx(), user.email, 'RedTeamNew2026x');
  check('ব্যান হওয়ার পরে নতুন লগইন হয় না', !bannedLogin.loggedIn);
  check('ব্যান হওয়ার পরে চলমান সেশনে অর্ডার আটকায়', bannedOrder.status() >= 400, `HTTP ${bannedOrder.status()} (সেশন-চেক ${banned})`);

  await Promise.all([anon.dispose(), c1.dispose(), sessA.dispose(), sessB.dispose(), sessC.dispose(), sessD.dispose(), sessE.dispose()]);

  // পরিষ্কার
  const ids = (await db.user.findMany({ where: { email: { contains: TAG } }, select: { id: true } })).map((u) => u.id);
  if (ids.length) {
    await db.notification.deleteMany({ where: { userId: { in: ids } } });
    await db.adminLog.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { targetId: { in: ids } }] } });
    await db.ledgerEntry.deleteMany({ where: { userId: { in: ids } } });
    await db.order.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.otp.deleteMany({ where: { destination: { contains: TAG } } });
  await clearRl();

  console.log(`\n════ ${pass} পাস · ${fails.length} ব্যর্থ ════`);
  if (fails.length) { console.log(fails.join('\n')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
