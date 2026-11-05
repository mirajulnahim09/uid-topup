// ★ অস্থায়ী প্রোব (EXTREME অডিট ২০২৬-০৯-২১) — `/account` পাতা পুরো User সারি পড়ে (`include`);
//   HTML/RSC-তে পাসওয়ার্ড-হ্যাশ, 2FA-সিক্রেট বা recovery-হ্যাশ যাচ্ছে কি না মাপা। কেবল ডেভ DB।
import { db, BASE, dbLabel } from './_db';
import { request } from 'playwright-core';
import bcrypt from 'bcryptjs';

async function main() {
  const tag = `acct-${Date.now().toString(36)}`;
  const PASSWORD = 'AcctProbe2026x';
  const hash = await bcrypt.hash(PASSWORD, 10);
  const SECRET = 'ENCSECRETMARKER7Q2Z';
  const RECOVERY = 'RECOVERYHASHMARKER9K';
  const user = await db.user.create({
    data: {
      name: 'অ্যাকাউন্ট-প্রোব', email: `${tag}@verify.local`, phone: `018${String(Date.now()).slice(-8)}`,
      password: hash, emailVerified: true, referralCode: tag.toUpperCase().slice(0, 12),
      twoFactorEnabled: false, twoFactorSecret: SECRET, twoFactorRecovery: JSON.stringify([RECOVERY]),
    },
  });
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    await db.rateLimitBucket.deleteMany({});
    const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
    await ctx.post(`${BASE}/api/auth/callback/credentials`, {
      form: { csrfToken, email: user.email, password: PASSWORD, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
    });
    const me = await (await ctx.get(`${BASE}/api/me`)).json();
    if (!me?.name) throw new Error('লগইন হয়নি');
    let fails = 0;
    for (const p of ['/account', '/account/profile', '/account/orders', '/account/wallet/deposit']) {
      for (const rsc of [false, true]) {
        const r = await ctx.get(`${BASE}${p}`, { headers: rsc ? { RSC: '1' } : {}, failOnStatusCode: false });
        const body = await r.text();
        const leaks = [hash, hash.slice(0, 20), SECRET, RECOVERY].filter((s) => body.includes(s));
        const bcryptShape = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(body);
        const bad = leaks.length > 0 || bcryptShape;
        if (bad) fails++;
        console.log(`  ${bad ? 'FAIL' : 'PASS'}  ${p}${rsc ? ' (RSC)' : ''} — HTTP ${r.status()} · ${body.length}B · ফাঁস ${leaks.length} · bcrypt-আকৃতি ${bcryptShape}`);
      }
    }
    console.log(`DB ${dbLabel()} · ফল: ${fails === 0 ? 'ফাঁস নেই' : `${fails}টি ফাঁস`}`);
    process.exitCode = fails ? 1 : 0;
  } finally {
    await ctx.dispose();
    await db.adminLog.deleteMany({ where: { adminId: user.id } }).catch(() => {});
    await db.notification.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.rateLimitBucket.deleteMany({});
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
