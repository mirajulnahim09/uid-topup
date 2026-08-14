/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ C5 যাচাই — ব্যান ৫ মিনিটের মধ্যে কার্যকর হয়
 *
 *   `npx tsx scripts/verify/ban-revocation.ts`
 *
 *   ৫ মিনিট **অপেক্ষা করা হয় না** — বরং `next-auth/jwt` এর `encode`
 *   দিয়ে আসল স্বাক্ষরিত টোকেন বানানো হয় যার `lastChecked` ইচ্ছেমতো
 *   পুরনো। ফলে সময়ের উপর নির্ভর না করেই প্রকৃত আচরণ মাপা যায়।
 *
 *   দুই স্তরে পরীক্ষা:
 *     ক) jwt callback সরাসরি — থ্রটল ও বাতিলের যুক্তি
 *     খ) প্রকৃত HTTP — স্বাক্ষরিত কুকি নিয়ে `/api/me`
 *
 *   ⚠️ একটি সাময়িক টেস্ট-ইউজার তৈরি হয় এবং শেষে **মুছে ফেলা হয়**।
 *      কোনো প্রকৃত গ্রাহককে ban/unban করা হয় না।
 * ═══════════════════════════════════════════════════════════
 */
/** ⚠️ `./_db` সবার আগে — env লোড ও লাইভ-DB সুরক্ষা (ওই ফাইলে ব্যাখ্যা) */
import { db as prisma, BASE, dbLabel } from './_db';

import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { authOptions, SESSION_REVALIDATE_MS } from '../../src/lib/auth';
import { SESSION_COOKIE_NAME } from '../../src/lib/authCookies';

const SECRET = process.env.NEXTAUTH_SECRET as string;
/** ★ নাম আর হাতে লেখা হয় না — একমাত্র উৎস `authCookies.ts` */
const COOKIE = SESSION_COOKIE_NAME;

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const jwtCb = authOptions.callbacks!.jwt!;
const NOW = Date.now();
const FRESH = NOW - 1000;                          // ১ সেকেন্ড আগে দেখা
const STALE = NOW - (SESSION_REVALIDATE_MS + 60_000); // সীমার বাইরে

const tag = `c5-${Date.now()}`;

(async () => {
  console.log('═══ C5 — ব্যান কার্যকর হওয়া যাচাই ═══\n');
  console.log(`  পুনঃযাচাই সীমা : ${SESSION_REVALIDATE_MS / 60000} মিনিট`);
  console.log(`  DB: ${dbLabel()} · সার্ভার: ${BASE}\n`);

  // ── টেস্ট ইউজার ──
  const user = await prisma.user.create({
    data: {
      email: `${tag}@verify.local`,
      name: 'C5 Verify User',
      phone: `c5-${Date.now().toString().slice(-9)}`,
      password: await bcrypt.hash('irrelevant-' + tag, 10),
      referralCode: `C5${Date.now().toString(36).toUpperCase().slice(-7)}`,
    },
    select: { id: true, email: true, role: true, sessionEpoch: true },
  });
  console.log(`  টেস্ট ইউজার : ${user.email}\n`);

  try {
    const base = { id: user.id, role: user.role, epoch: user.sessionEpoch ?? 0 };

    // ═══ ক) jwt callback সরাসরি ═══
    console.log('── ক) jwt callback ──');

    // ১. সুস্থ ইউজার, টোকেন টাটকা → DB দেখা হবে না, টোকেন অক্ষত
    let out: any = await jwtCb({ token: { ...base, lastChecked: FRESH } } as any);
    check('টাটকা টোকেন টিকে থাকে', out?.id === user.id, `id=${out?.id ?? 'null'}`);
    check('টাটকা টোকেনের lastChecked বদলায় না (DB এড়ানো হয়েছে)',
      out?.lastChecked === FRESH, `${out?.lastChecked}`);

    // ২. সুস্থ ইউজার, টোকেন বাসি → DB দেখা হবে, টিকে থাকবে, lastChecked নতুন
    out = await jwtCb({ token: { ...base, lastChecked: STALE } } as any);
    check('বাসি টোকেন (ব্যান নয়) টিকে থাকে', out?.id === user.id);
    check('বাসি টোকেনের lastChecked হালনাগাদ হয়',
      typeof out?.lastChecked === 'number' && out.lastChecked > STALE,
      `${STALE} → ${out?.lastChecked}`);

    // ৩. ★ ব্যান করি
    await prisma.user.update({ where: { id: user.id }, data: { isBanned: true } });
    console.log('  (ইউজার ব্যান করা হলো)');

    // ৪. ব্যান + টাটকা টোকেন → এখনো ঢুকতে পারে (থ্রটল উইন্ডো)
    out = await jwtCb({ token: { ...base, lastChecked: FRESH } } as any);
    check('ব্যানের পরও টাটকা টোকেন উইন্ডোর ভেতরে টিকে থাকে (নকশা অনুযায়ী)',
      out?.id === user.id, 'সর্বোচ্চ ৫ মিনিট বিলম্ব — প্রত্যাশিত');

    // ৫. ব্যান + বাসি টোকেন → বাতিল
    out = await jwtCb({ token: { ...base, lastChecked: STALE } } as any);
    check('★ ব্যান + বাসি টোকেন → টোকেন বাতিল', !out?.id,
      `ফেরত: ${JSON.stringify(out)}`);

    // ৬. পুরনো টোকেন (lastChecked নেই) → সাথে সাথে যাচাই → বাতিল
    out = await jwtCb({ token: { ...base } } as any);
    check('lastChecked-বিহীন পুরনো টোকেনও ধরা পড়ে', !out?.id);

    // ৭. trigger=update → সীমা না পেরোলেও সাথে সাথে যাচাই
    out = await jwtCb({ token: { ...base, lastChecked: FRESH }, trigger: 'update' } as any);
    check('trigger=update সাথে সাথে যাচাই করে', !out?.id);

    // ── আনব্যান করে epoch পথ যাচাই ──
    await prisma.user.update({ where: { id: user.id }, data: { isBanned: false } });
    out = await jwtCb({ token: { ...base, epoch: 999, lastChecked: STALE } } as any);
    check('epoch অমিল (সব ডিভাইস সাইন-আউট) → বাতিল', !out?.id);

    // ═══ খ) প্রকৃত HTTP ═══
    console.log('\n── খ) প্রকৃত HTTP (/api/me) ──');
    const mint = async (lastChecked: number) =>
      encode({ token: { ...base, lastChecked }, secret: SECRET });

    const hit = async (jwtStr: string) => {
      const r = await fetch(`${BASE}/api/me`, { headers: { cookie: `${COOKIE}=${jwtStr}` } });
      return r.status;
    };

    // সুস্থ + টাটকা → ২০০
    check('সুস্থ ইউজার /api/me → 200', (await hit(await mint(FRESH))) === 200);

    // ব্যান করি, বাসি টোকেন → টোকেনই বাতিল → ৪০১
    await prisma.user.update({ where: { id: user.id }, data: { isBanned: true } });
    const stStale = await hit(await mint(STALE));
    check('★ ব্যান + বাসি টোকেন /api/me → 401 (টোকেন বাতিল)', stStale === 401, `HTTP ${stStale}`);

    /**
     * ★★★ এখানে প্রথমে ২০০ প্রত্যাশা করেছিলাম — **ভুল ছিল**।
     *   `requireUser()` (src/lib/guard.ts) নিজেই প্রতিটি কলে DB থেকে
     *   `isBanned` দেখে এবং ব্যান হলে ৪০৩ দেয়। অর্থাৎ API স্তরে ব্যান
     *   **সাথে সাথেই** কার্যকর — ৫ মিনিট অপেক্ষা করতে হয় না।
     *   পাঁচ-মিনিটের উইন্ডোটি কেবল **টোকেন/middleware** স্তরের, যেখানে
     *   কোনো DB কল নেই (edge)। অর্থাৎ দুই স্তরের প্রতিরক্ষা:
     *     · API রুট      → তাৎক্ষণিক ৪০৩ (requireUser)
     *     · টোকেন/পাতা   → সর্বোচ্চ ৫ মিনিটে বাতিল (এই C5 পরিবর্তন)
     */
    const stFresh = await hit(await mint(FRESH));
    check('★ ব্যান + টাটকা টোকেনেও API তাৎক্ষণিক ৪০৩ (requireUser — defence in depth)',
      stFresh === 403, `HTTP ${stFresh}`);

    // ── middleware স্তর: বাসি টোকেনে /account থেকে লগইনে পাঠায় ──
    const page = async (jwtStr: string) => {
      const r = await fetch(`${BASE}/account`, {
        headers: { cookie: `${COOKIE}=${jwtStr}` },
        redirect: 'manual',
      });
      return { status: r.status, loc: r.headers.get('location') || '' };
    };
    // ⚠️ middleware **DB দেখে না** (edge), তাই সে জানে না টোকেনটি
    //   বাতিল হয়েছে — রিডাইরেক্ট করে না। আসল প্রতিরক্ষা server
    //   component-এ: session এখন `null`, তাই পাতা ব্যবহারকারীর কোনো
    //   তথ্য রেন্ডার করে না।
    const pStale = await page(await mint(STALE));
    check('বাসি টোকেনে /account ব্যবহারকারীর তথ্য দেখায় না',
      pStale.status === 200 || (pStale.status >= 300 && pStale.status < 400),
      `HTTP ${pStale.status}${pStale.loc ? ' → ' + pStale.loc : ''}`);

    // ★ প্রকৃত দাবি: বাতিল টোকেনে সেশন `null` — তাই পাতা কিছু জানে না
    const sess = await fetch(`${BASE}/api/auth/session`, {
      headers: { cookie: `${COOKIE}=${await mint(STALE)}` },
    });
    const sessBody = await sess.json().catch(() => null);
    check('★ বাতিল টোকেনে /api/auth/session খালি',
      !sessBody || !sessBody.user, `${JSON.stringify(sessBody)}`);

    console.log(`\n  → API: তাৎক্ষণিক · টোকেন/পাতা: সর্বোচ্চ ${SESSION_REVALIDATE_MS / 60000} মিনিট`);
  } finally {
    await prisma.user.deleteMany({ where: { email: `${tag}@verify.local` } });
    console.log('  (টেস্ট ইউজার মুছে ফেলা হলো)');
    await prisma.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
