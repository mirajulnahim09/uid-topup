/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Cron জব — রানটাইম যাচাই (EXTREME অডিট, ২০২৬-০৯-১৯)
 *
 *   এতদিন cron-এর প্রমাণ ছিল কেবল "সিক্রেট ছাড়া 401" (api-auth-matrix)।
 *   সঠিক সিক্রেটে জবগুলো **আসলেই চলে কিনা**, দুবার চললে ক্ষতি করে কিনা,
 *   আর একসাথে একাধিক টিক এলে কী হয় — কোথাও মাপা হয়নি। কারণ স্থানীয়ভাবে
 *   `CRON_SECRET` থাকে না, আর লাইভের সিক্রেট ব্যবহার করা নিষেধ।
 *
 *   তাই: একটি **আলাদা** `next start` চালাতে হয় যাকে একটি **স্থানীয়,
 *   এককালীন, এলোমেলো** সিক্রেট দেওয়া — প্রোডাকশনের কোনো মান নয়:
 *
 *     S=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
 *     DATABASE_URL=postgresql://dev:dev@localhost:5434/uidtopup_dev \
 *     CRON_SECRET=$S TELEGRAM_BOT_TOKEN=disabled-for-audit TELEGRAM_CHAT_ID=0 \
 *       node node_modules/next/dist/bin/next start -p 3101 -H 127.0.0.1
 *     VERIFY_CRON_SECRET=$S npx tsx scripts/verify/cron-jobs.ts
 *
 *   ⚠️ টেলিগ্রাম টোকেন ইচ্ছাকৃতভাবে ভুয়া — SLA জব অ্যাডমিনকে বার্তা
 *      পাঠায়; যাচাই চলাকালে কারও আসল চ্যাটে বার্তা যাওয়া চলবে না।
 *   ⚠️ সব ফিক্সচার `cronprobe` ট্যাগ-করা, শেষে মুছে ফেলা হয় — কেবল
 *      স্থানীয় ডেভ DB (`./_db` নিজেই দূরের URL-এ থামে)।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';

const CRON_BASE = process.env.VERIFY_CRON_BASE || 'http://127.0.0.1:3101';
const SECRET = process.env.VERIFY_CRON_SECRET || '';

// ★ কখনো দূরের হোস্টে নয় — এই স্ক্রিপ্ট সারি লেখে ও মোছে
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(CRON_BASE)) {
  console.error(`✗ VERIFY_CRON_BASE স্থানীয় নয় (${CRON_BASE}) — থামছি`);
  process.exit(2);
}
if (SECRET.length < 16) {
  console.error('✗ VERIFY_CRON_SECRET নেই/ছোট — উপরের নির্দেশনা দেখুন (স্থানীয় এলোমেলো মান)');
  process.exit(2);
}

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const TAG = `cronprobe_${Date.now()}`;
const JOBS = ['ratelimit-cleanup', 'sla-breach', 'telegram-scheduler'] as const;

async function call(job: string, auth?: string, method = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== undefined) headers.Authorization = auth;
  const r = await fetch(`${CRON_BASE}/api/cron/${job}`, { method, headers });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* HTML/খালি */ }
  return { status: r.status, json, text };
}
const ok = (job: string) => call(job, `Bearer ${SECRET}`);

async function lastRun(job: string): Promise<{ at: string; ok: boolean } | null> {
  const row = await db.setting.findUnique({ where: { key: `job_lastrun_${job}` } });
  return row ? (JSON.parse(row.value) as { at: string; ok: boolean }) : null;
}

async function cleanup(orderId: string | null, userId: string | null, orderNo: number | null) {
  await db.telegramJob.deleteMany({ where: { key: { startsWith: TAG } } });
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: `${TAG}:` } } });
  if (orderNo !== null) {
    await db.notification.deleteMany({
      where: { title: { startsWith: '⏰ SLA ভঙ্গ' }, body: { contains: `#${orderNo} —` } },
    });
  }
  if (orderId) await db.order.deleteMany({ where: { id: orderId } });
  if (userId) await db.user.deleteMany({ where: { id: userId } });
}

(async () => {
  console.log(`═══ Cron জব — রানটাইম যাচাই (${CRON_BASE}) ═══`);
  console.log(`  DB: ${dbLabel()}\n`);

  let orderId: string | null = null;
  let userId: string | null = null;
  let orderNo: number | null = null;

  try {
    // ── ১. অথেন্টিকেশন ──
    console.log('── ১. অথেন্টিকেশন (প্রতিটি জব) ──');
    for (const job of JOBS) {
      const none = await call(job);
      const wrong = await call(job, 'Bearer not-the-secret-value-000000');
      const longer = await call(job, `Bearer ${SECRET}x`);
      const shorter = await call(job, `Bearer ${SECRET.slice(0, -1)}`);
      const raw = await call(job, SECRET); // "Bearer " ছাড়া
      const getNone = await call(job, undefined, 'GET');
      check(`${job}: হেডার ছাড়া / ভুল / এক-অক্ষর বেশি / কম / স্কিম ছাড়া / GET → সব 401`,
        [none, wrong, longer, shorter, raw, getNone].every((r) => r.status === 401),
        [none, wrong, longer, shorter, raw, getNone].map((r) => r.status).join(','));
      check(`${job}: 401-এর বার্তা কারণ ফাঁস করে না (সব এক)`,
        new Set([none.text, wrong.text, shorter.text]).size === 1);
    }

    // ── ২. রেট-লিমিট পরিষ্কার ──
    console.log('\n── ২. ratelimit-cleanup ──');
    const now = Date.now();
    await db.rateLimitBucket.createMany({
      data: [
        { key: `${TAG}:expired`, count: 3, resetAt: new Date(now - 60 * 60_000) },
        { key: `${TAG}:live`, count: 3, resetAt: new Date(now + 60 * 60_000) },
      ],
    });
    const rl1 = await ok('ratelimit-cleanup');
    const expGone = !(await db.rateLimitBucket.findUnique({ where: { key: `${TAG}:expired` } }));
    const liveKept = !!(await db.rateLimitBucket.findUnique({ where: { key: `${TAG}:live` } }));
    check('সঠিক সিক্রেটে 200 + success', rl1.status === 200 && rl1.json.success === true, `HTTP ${rl1.status}`);
    check('মেয়াদোত্তীর্ণ বাকেট মুছেছে', expGone, `deleted=${String(rl1.json.deleted)}`);
    check('চালু বাকেট **রাখা** হয়েছে (অতিরিক্ত মোছা নয়)', liveKept);
    const rl2 = await ok('ratelimit-cleanup');
    check('দ্বিতীয়বার চালালেও 200, চালু বাকেট অক্ষত (idempotent)',
      rl2.status === 200 && !!(await db.rateLimitBucket.findUnique({ where: { key: `${TAG}:live` } })));
    const rlRun = await lastRun('ratelimit-cleanup');
    check('readiness-এর শেষ-রান রেকর্ড হালনাগাদ (ok, ৬০s-এর মধ্যে)',
      !!rlRun && rlRun.ok && Date.now() - new Date(rlRun.at).getTime() < 60_000);

    // ── ৩. SLA ভঙ্গ — একবারই জানানো ──
    console.log('\n── ৩. sla-breach ──');
    const variant = await db.variant.findFirst({ where: { isActive: true }, select: { id: true, label: true, price: true } });
    const admins = await db.user.count({ where: { role: 'ADMIN' } });
    if (!variant || admins === 0) {
      check('ফিক্সচার: সক্রিয় ভ্যারিয়েন্ট ও অন্তত একজন অ্যাডমিন আছে', false,
        `variant=${!!variant} admins=${admins}`);
    } else {
      const u = await db.user.create({
        data: {
          id: `${TAG}_user`, name: 'ক্রন প্রোব', email: `${TAG}@probe.local`,
          phone: `019${String(Date.now()).slice(-8)}`, password: 'x', referralCode: TAG.toUpperCase(), emailVerified: true,
        },
      });
      userId = u.id;
      // শেষ সফল রান = ১০ মিনিট আগে → "নতুন ভঙ্গ" = এর পরে পেরোনো
      await db.setting.upsert({
        where: { key: 'job_lastrun_sla-breach' },
        create: { key: 'job_lastrun_sla-breach', value: JSON.stringify({ at: new Date(Date.now() - 10 * 60_000).toISOString(), ok: true, ms: 0 }) },
        update: { value: JSON.stringify({ at: new Date(Date.now() - 10 * 60_000).toISOString(), ok: true, ms: 0 }) },
      });
      const o = await db.order.create({
        data: {
          userId: u.id, variantId: variant.id, playerUid: '123456789',
          subtotal: variant.price, price: variant.price, costPrice: 0,
          productName: 'ক্রন প্রোব', variantName: variant.label,
          status: 'PENDING', slaDueAt: new Date(Date.now() - 2 * 60_000),
          trackToken: `${TAG}_tok`,
        },
        select: { id: true, orderNo: true },
      });
      orderId = o.id; orderNo = o.orderNo;

      const countProbe = () => db.notification.count({
        where: { title: { startsWith: '⏰ SLA ভঙ্গ' }, body: { contains: `#${o.orderNo} —` } },
      });

      const s1 = await ok('sla-breach');
      const n1 = await countProbe();
      check('প্রথম রান: 200, নতুন ভঙ্গ জানানো হয়েছে', s1.status === 200 && Number(s1.json.notified) >= 1,
        `notified=${String(s1.json.notified)}`);
      check('প্রতিটি অ্যাডমিন ঠিক একটি ইন-অ্যাপ বিজ্ঞপ্তি পেয়েছে', n1 === admins, `${n1}/${admins}`);

      const s2 = await ok('sla-breach');
      const n2 = await countProbe();
      check('দ্বিতীয় রান: একই ভঙ্গ **আবার** জানানো হয়নি', s2.status === 200 && n2 === n1,
        `notified=${String(s2.json.notified)} · বিজ্ঞপ্তি ${n1}→${n2}`);
      const slaRun = await lastRun('sla-breach');
      check('readiness-এর শেষ-রান রেকর্ড হালনাগাদ', !!slaRun && slaRun.ok
        && Date.now() - new Date(slaRun.at).getTime() < 60_000);

      // ★ আগের রান চলাকালীন ডেডলাইন পেরোনো অর্ডার — আগের রান তাকে "এখনো
      //   সময় আছে" দেখেছিল (তার ঘড়ি = শুরুর মুহূর্ত), তাই এই রানেই তাকে
      //   জানাতে হবে। আগের রান ৫s চলেছিল ধরে নিই: শুরু T−5s, শেষ T।
      const T = Date.now() - 60_000;
      await db.setting.update({
        where: { key: 'job_lastrun_sla-breach' },
        data: { value: JSON.stringify({ at: new Date(T).toISOString(), ok: true, ms: 5000 }) },
      });
      await db.order.update({ where: { id: o.id }, data: { slaDueAt: new Date(T - 2000) } });
      const before = await countProbe();
      const s3 = await ok('sla-breach');
      const after = await countProbe();
      check('আগের রান চলাকালীন পেরোনো ডেডলাইনও জানানো হয় (হারিয়ে যায় না)',
        s3.status === 200 && after === before + admins,
        `notified=${String(s3.json.notified)} · বিজ্ঞপ্তি ${before}→${after}`);
    }

    // ── ৪. টেলিগ্রাম শিডিউলার ──
    console.log('\n── ৪. telegram-scheduler ──');
    const past = new Date(Date.now() - 60_000);
    const mk = (suffix: string, status = 'IDLE') => db.telegramJob.create({
      data: {
        key: `${TAG}_${suffix}`, label: `প্রোব ${suffix}`, enabled: true, status,
        kind: 'ONCE', atHour: 0, atMinute: 0, nextRunAt: past,
      },
    });
    const runsOf = (suffix: string) => db.telegramJobRun.count({ where: { jobKey: `${TAG}_${suffix}` } });

    // ক. বকেয়া এককালীন জব — একবার চলে, দ্বিতীয় টিকে আর নয়
    await mk('once');
    const t1 = await ok('telegram-scheduler');
    const t2 = await ok('telegram-scheduler');
    const once = await db.telegramJob.findUnique({ where: { key: `${TAG}_once` } });
    check('বকেয়া জব চলেছে (200)', t1.status === 200 && (await runsOf('once')) === 1,
      `রান=${await runsOf('once')}`);
    check('দ্বিতীয় টিকে একই জব আবার চলেনি (idempotent)', t2.status === 200 && (await runsOf('once')) === 1
      && once?.nextRunAt === null && once?.status !== 'RUNNING',
      `nextRunAt=${once?.nextRunAt?.toISOString() ?? 'null'} status=${once?.status}`);

    // খ. তিনটি টিক একসাথে — জবটি ঠিক একবার
    await mk('race');
    const par = await Promise.all([0, 1, 2].map(() => ok('telegram-scheduler')));
    check('একসাথে ৩টি টিক: সব 200, জবটি ঠিক একবার চলেছে',
      par.every((r) => r.status === 200) && (await runsOf('race')) === 1,
      `রান=${await runsOf('race')}`);

    // গ. সক্রিয় RUNNING (এইমাত্র দাবি করা) — চুরি করা যাবে না
    await mk('busy', 'RUNNING');
    await ok('telegram-scheduler');
    const busy = await db.telegramJob.findUnique({ where: { key: `${TAG}_busy` } });
    check('সদ্য-চলমান জব অন্য টিক ছিনিয়ে নেয়নি', (await runsOf('busy')) === 0 && busy?.status === 'RUNNING');

    // ঘ. পরিত্যক্ত RUNNING — প্রসেস মাঝপথে মরে গেলে (টাইমআউট/DB বিচ্ছিন্ন)
    //    status চিরকাল RUNNING থেকে যেত; জবটি আর কখনো চলত না।
    await mk('stale', 'RUNNING');
    await db.$executeRaw`UPDATE "TelegramJob" SET "updatedAt" = NOW() - INTERVAL '45 minutes' WHERE key = ${`${TAG}_stale`}`;
    await db.telegramJobRun.create({
      data: { jobKey: `${TAG}_stale`, trigger: 'SCHEDULE', status: 'RUNNING', startedAt: new Date(Date.now() - 45 * 60_000) },
    });
    await ok('telegram-scheduler');
    const stale = await db.telegramJob.findUnique({ where: { key: `${TAG}_stale` } });
    const orphan = await db.telegramJobRun.count({ where: { jobKey: `${TAG}_stale`, status: 'RUNNING' } });
    check('৪৫ মিনিট পুরনো পরিত্যক্ত RUNNING জব পুনরুদ্ধার হয়ে আবার চলেছে',
      stale?.status !== 'RUNNING' && (stale?.runCount ?? 0) === 1,
      `status=${stale?.status} runCount=${stale?.runCount}`);
    check('পরিত্যক্ত রান-সারি আর "চলমান" দেখায় না', orphan === 0, `RUNNING সারি=${orphan}`);

    // ঙ. পরিত্যক্ত জবে একসাথে ৩টি টিক — পুনরুদ্ধারও ঠিক একবার (দ্বৈত রান নয়)
    await mk('stalerace', 'RUNNING');
    await db.$executeRaw`UPDATE "TelegramJob" SET "updatedAt" = NOW() - INTERVAL '45 minutes' WHERE key = ${`${TAG}_stalerace`}`;
    await Promise.all([0, 1, 2].map(() => ok('telegram-scheduler')));
    check('পরিত্যক্ত জবে একসাথে ৩টি টিক: পুনরুদ্ধার ঠিক একবার', (await runsOf('stalerace')) === 1,
      `রান=${await runsOf('stalerace')}`);

    const tgRun = await lastRun('telegram-scheduler');
    check('readiness-এর শেষ-রান রেকর্ড হালনাগাদ', !!tgRun && tgRun.ok
      && Date.now() - new Date(tgRun.at).getTime() < 60_000);
  } finally {
    await cleanup(orderId, userId, orderNo);
    const left = await db.telegramJob.count({ where: { key: { startsWith: TAG } } })
      + await db.rateLimitBucket.count({ where: { key: { startsWith: `${TAG}:` } } })
      + await db.user.count({ where: { id: { startsWith: TAG } } });
    console.log(`\n  (প্রোব সারি মুছে ফেলা হলো — অবশিষ্ট ${left})`);
    await db.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail === 0 ? '  সব পাস' : `  ${fail} টি ব্যর্থ`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
