/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ M6 যাচাই — ক্যাশে ব্যবহারকারী-নির্দিষ্ট কিছু ঢোকে না
 *
 *   `npx tsx scripts/verify/isr-no-user-leak.ts --port=3100`  (prod build)
 *
 *   RUN.md-এর শর্ত: ISR বসানোর **আগে প্রমাণ** করতে হবে যে
 *   ব্যবহারকারী-নির্দিষ্ট কোনো তথ্য ক্যাশে যায় না।
 *
 *   কোডে দাবি করা আছে (product পাতার মন্তব্য): "ইউজারের ব্যালেন্স
 *   OrderForm ক্লায়েন্ট-সাইডে আনে (/api/me), তাই ক্যাশ নিরাপদ।"
 *   দাবিটি কেউ কখনো **মেপে** দেখেনি — এখানে দেখা হয়।
 *
 *   পদ্ধতি: দুইজন ভিন্ন ব্যবহারকারী (ভিন্ন নাম/ইমেইল/ব্যালেন্স) ও
 *   একজন অতিথি — তিনজনের পাওয়া HTML **byte-for-byte** মেলানো হয়।
 *   এক বিন্দু আলাদা হলেই বুঝব ক্যাশে ব্যক্তিগত কিছু ঢুকছে।
 * ═══════════════════════════════════════════════════════════
 */
/** ⚠️ `./_db` সবার আগে — env লোড ও লাইভ-DB সুরক্ষা (ওই ফাইলে ব্যাখ্যা) */
import { db as prisma, dbLabel } from './_db';

import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { encode } from 'next-auth/jwt';
import { SESSION_COOKIE_NAME } from '../../src/lib/authCookies';

const PORT = process.argv.find((a) => a.startsWith('--port='))?.slice(7) || '3000';
const BASE = `http://localhost:${PORT}`;
const SECRET = process.env.NEXTAUTH_SECRET as string;
const tag = `m6-${Date.now()}`;

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * ★ তুলনার আগে **প্রতি-অনুরোধে বদলায়** এমন মান সরিয়ে নিই।
 *   H3-এর পর প্রতিটি রেসপন্সে আলাদা CSP nonce বসে, তাই কাঁচা
 *   byte-তুলনা কখনোই মিলত না — সেটি ব্যবহারকারী-লিক নয়, আমারই
 *   আগের পরিবর্তনের প্রভাব। একই কারণে Next-এর build/deployment id
 *   ও RSC পে-লোডের ভেতরের এলোমেলো কী-ও বাদ দেওয়া হয়।
 */
const normalize = (html: string) =>
  html
    .replace(/nonce="[^"]*"/g, 'nonce="X"')
    .replace(/\\"nonce\\":\\"[^"]*\\"/g, '\\"nonce\\":\\"X\\"')
    /**
     * ★ `next dev` প্রতিটি স্ট্যাটিক অ্যাসেটে টাইমস্ট্যাম্প-ভিত্তিক
     *   cache-buster বসায়: `…/layout.css?v=1786711698723`,
     *   `…/webpack.js?v=1786711732223`। মানটি **কম্পাইলের সময়**,
     *   ব্যবহারকারীর সাথে সম্পর্কহীন — অথচ দুই অনুরোধে ভিন্ন হওয়ায়
     *   "দুই ব্যবহারকারীর মার্কআপ আলাদা" বলে মিথ্যা FAIL দিত (মাপা:
     *   ২০২৬-০৮-১৪; পার্থক্য ছিল ৯৭ ও ৮৬ মিলিসেকেন্ড)। prod বিল্ডে
     *   এই প্যারামিটারটি থাকেই না, তাই এটি dev-only কোলাহল।
     */
    .replace(/(\/_next\/[^"'\s?]+)\?v=\d+/g, '$1?v=X');

/**
 * ★ রেন্ডার করা **মার্কআপ** — সব `<script>` বাদ।
 *
 *   কেন দরকার: App Router RSC পে-লোড স্ট্রিম করে, আর সেই
 *   `self.__next_f.push(...)` খণ্ডগুলোর **ক্রম** অনুরোধভেদে বদলায়।
 *   কাঁচা তুলনায় সেটিকেই "পার্থক্য" মনে হচ্ছিল, অথচ বিষয়বস্তু এক।
 *   তাই কাঠামোগত তুলনা মার্কআপে, আর ব্যক্তিগত-তথ্যের খোঁজ চলে
 *   **সম্পূর্ণ** HTML-এ (স্ক্রিপ্টসহ) — নিচের marker-পরীক্ষায়।
 */
const markupOnly = (html: string) =>
  normalize(html).replace(/<script[\s\S]*?<\/script>/g, '');

/** স্বাভাবিকীকরণের পর কোথায় প্রথম পার্থক্য — ডিবাগে সাহায্য করে */
function firstDiff(a: string, b: string): string {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      const from = Math.max(0, i - 60);
      return `@${i}: …${a.slice(from, i + 60).replace(/\s+/g, ' ')}…\n              vs …${b.slice(from, i + 60).replace(/\s+/g, ' ')}…`;
    }
  }
  return a.length === b.length ? '(অভিন্ন)' : `দৈর্ঘ্য আলাদা: ${a.length} vs ${b.length}`;
}

async function mkUser(n: number, balance: number) {
  const u = await prisma.user.create({
    data: {
      email: `${tag}-${n}@verify.local`,
      name: `M6_MARKER_USER_${n}`,
      phone: `m6${n}-${Date.now().toString().slice(-8)}`,
      password: await bcrypt.hash('x-' + tag, 10),
      referralCode: `M6${n}${Date.now().toString(36).toUpperCase().slice(-6)}`,
      balance,
    },
    select: { id: true, role: true, sessionEpoch: true, name: true, email: true },
  });
  const jwt = await encode({
    token: { id: u.id, role: u.role, epoch: u.sessionEpoch ?? 0, lastChecked: Date.now() },
    secret: SECRET,
  });
  return { ...u, jwt };
}

(async () => {
  console.log(`═══ M6 — ক্যাশে ব্যবহারকারী-লিক যাচাই (${BASE}) ═══`);
  console.log(`  DB: ${dbLabel()}\n`);

  const a = await mkUser(1, 1111.11);
  const b = await mkUser(2, 2222.22);
  console.log(`  ইউজার A: ${a.name} · ব্যালেন্স ৳1111.11`);
  console.log(`  ইউজার B: ${b.name} · ব্যালেন্স ৳2222.22\n`);

  try {
    // ক্যাশযোগ্য পাতা খুঁজি
    const p = await prisma.product.findFirst({
      where: { isActive: true }, select: { id: true, slug: true },
    });
    const paths = ['/', ...(p ? [`/product/${p.id}/${p.slug}`] : [])];

    for (const path of paths) {
      console.log(`── ${path} ──`);

      const get = async (cookie?: string) => {
        const r = await fetch(BASE + path, {
          headers: cookie ? { cookie } : {},
          redirect: 'manual',
        });
        return { status: r.status, html: await r.text(), cache: r.headers.get('x-nextjs-cache') || '(নেই)' };
      };

      const guest = await get();
      const ra = await get(`${SESSION_COOKIE_NAME}=${a.jwt}`);
      const rb = await get(`${SESSION_COOKIE_NAME}=${b.jwt}`);

      /**
       * ⚠️ **যে হ্যাশটি ছাপা হয়, দাবিটি ঠিক সেটির উপরেই হওয়া চাই।**
       *
       *   আগে ছাপা হতো পূর্ণ HTML-এর হ্যাশ, অথচ "মার্কআপ অভিন্ন"
       *   দাবিটি মিলিয়ে দেখত `markupOnly` (স্ক্রিপ্ট-ছাড়া) সংস্করণ।
       *   RSC পে-লোডের খণ্ডগুলোর ক্রম অনুরোধভেদে বদলায়, তাই লগে
       *   userA ও userB এর হ্যাশ **আলাদা** দেখাত আর পরের লাইনেই
       *   লেখা থাকত "অভিন্ন" — পাঠকের পক্ষে দুটো মেলানো অসম্ভব।
       *   দাবিটি সত্যি ছিল, প্রমাণটি বিভ্রান্তিকর। এখন দুটোই ছাপা
       *   হয়: `মার্কআপ` (যেটির উপর দাবি) ও `পূর্ণ` (স্ক্রিপ্টসহ)।
       */
      const shaOf = (html: string) => `${sha(markupOnly(html))} · পূর্ণ ${sha(normalize(html))}`;
      console.log(`  guest ${guest.status} · মার্কআপ ${shaOf(guest.html)} · x-nextjs-cache=${guest.cache}`);
      console.log(`  userA ${ra.status} · মার্কআপ ${shaOf(ra.html)}`);
      console.log(`  userB ${rb.status} · মার্কআপ ${shaOf(rb.html)}`);

      /**
       * ★★★ আসল নিরাপত্তা-দাবি: **দুই ভিন্ন ব্যবহারকারীর** HTML অভিন্ন।
       *   অর্থাৎ রেন্ডারে ব্যক্তি-পরিচয়ের কিছু নেই — ক্যাশ ভাগাভাগি নিরাপদ।
       *
       *   ⚠️ guest বনাম লগ-ইন HTML আলাদা হওয়া **প্রত্যাশিত ও নিরীহ**:
       *   navbar লগ-ইন অবস্থায় ভিন্ন UI (অ্যাকাউন্ট মেনু) দেখায়, ফলে
       *   ভিন্ন JS chunk লোড হয়। এটি auth-**অবস্থা**, পরিচয় নয়।
       *   প্রথমে তিনটিকেই সমান ধরে পরীক্ষা লিখেছিলাম — সেটি ভুল দাবি ছিল।
       */
      /**
       * ★★★ দাবিটি **পাতা ক্যাশ হচ্ছে কি না তার উপর নির্ভরশীল** —
       *   আর এটিই এই স্ক্রিপ্টের আগের সংস্করণের ভুল ছিল (২০২৬-০৮-১২
       *   এর রানে "ব্যর্থ" দেখাত, অথচ কোনো লিক ছিল না)।
       *
       *   · পাতা **ক্যাশড** হলে একজনের HTML আরেকজন পাবে — তখন
       *     ব্যক্তি-পরিচয়ের কণামাত্রও রেন্ডারে থাকা চলবে না, এবং
       *     দুই ব্যবহারকারীর মার্কআপ **অভিন্ন** হতেই হবে।
       *   · পাতা **প্রতি-অনুরোধে রেন্ডার** (`force-dynamic`, আজকের
       *     অবস্থা) হলে নিজের নাম নিজের পাতায় থাকা স্বাভাবিক —
       *     সেটি লিক নয়। তখন আসল দাবি একটাই: **একজনের তথ্য
       *     আরেকজনের HTML-এ যায় না।**
       *
       *   তাই আগে ঠিক করি পাতাটি ক্যাশড কি না, তারপর সেই অনুযায়ী দাবি।
       */
      /**
       * ★★★ **শূন্যগর্ভ-পাস প্রতিরোধী গার্ড** (EXTREME অডিট, ২০২৬-০৯-১৮)
       *
       *   ⚠️ যা ঘটেছিল: স্ক্রিপ্ট-প্রসেসের `NODE_ENV` production না হলে
       *   হাতে-বানানো কুকি লেখা হতো ভুল নামে (`authCookies.ts` দেখুন),
       *   ফলে A ও B **দুজনেই অতিথি** হয়ে যেত। তখন "A এর তথ্য B এর
       *   HTML-এ নেই" দাবিটি নিখুঁত সবুজ দেখাত — কারণ কারো তথ্যই
       *   কোথাও ছিল না। মাপা প্রমাণ: দুজনের মার্কআপ-হ্যাশ হুবহু এক।
       *
       *   তাই দাবির **পূর্বশর্তটি** এখন নিজেই একটি দাবি: প্রতিটি
       *   ব্যবহারকারীর সেশন সত্যিই জীবিত কি না তা `/api/me` থেকে
       *   যাচাই করা হয় (পাতার HTML নয় — পাতা ক্যাশড হলে নিজের নামও
       *   থাকবে না, সেটি বৈধ)। জীবিত না হলে স্যুট **লাল** হবে।
       */
      if (path === paths[0]) {
        for (const [label, u] of [['A', a], ['B', b]] as const) {
          const me = await fetch(`${BASE}/api/me`, {
            headers: { cookie: `${SESSION_COOKIE_NAME}=${u.jwt}` },
            redirect: 'manual',
          });
          // `/api/me` ইমেইল ফেরায় না — নাম ও ব্যালেন্স ফেরায়, দুটোই এখানে অনন্য
          const body = me.ok ? await me.text() : '';
          const mine = body.includes(u.name);
          check(
            `পূর্বশর্ত: ইউজার ${label} এর সেশন সত্যিই জীবিত (নইলে পুরো স্যুট শূন্যগর্ভ)`,
            me.status === 200 && mine,
            `/api/me → ${me.status}${me.status === 200 && !mine ? ' · কিন্তু নাম মেলেনি' : ''}`,
          );
        }
      }

      const cached = guest.cache !== '(নেই)' && guest.cache.toUpperCase() !== 'MISS';
      console.log(`  মোড  : ${cached ? 'ক্যাশড (ISR/স্ট্যাটিক)' : 'প্রতি-অনুরোধে রেন্ডার (dynamic)'}`);

      const [ma, mb] = [ra.html, rb.html].map(markupOnly);

      if (cached) {
        check(`${path}: ★ (ক্যাশড) দুই ব্যবহারকারীর মার্কআপ অভিন্ন`,
          ma === mb, ma === mb ? 'অভিন্ন' : `⚠️ আলাদা\n              ${firstDiff(ma, mb)}`);

        for (const [label, u] of [['A', a], ['B', b]] as const) {
          const present =
            ra.html.includes(u.name) || rb.html.includes(u.name) ||
            ra.html.includes(u.email) || rb.html.includes(u.email);
          check(`${path}: (ক্যাশড) ইউজার ${label} এর নাম/ইমেইল রেন্ডারে নেই`, !present);
        }
        const balLeak = [ra.html, rb.html].some((h) => h.includes('1111.11') || h.includes('2222.22'));
        check(`${path}: (ক্যাশড) কোনো ব্যালেন্স রেন্ডারে নেই`, !balLeak);
      } else {
        // ★ ক্রস-দূষণই একমাত্র প্রকৃত দাবি
        const aInB = rb.html.includes(a.name) || rb.html.includes(a.email) || rb.html.includes('1111.11');
        const bInA = ra.html.includes(b.name) || ra.html.includes(b.email) || ra.html.includes('2222.22');
        check(`${path}: ★ A এর নাম/ইমেইল/ব্যালেন্স B এর HTML-এ নেই`, !aInB);
        check(`${path}: ★ B এর নাম/ইমেইল/ব্যালেন্স A এর HTML-এ নেই`, !bInA);
        check(`${path}: অতিথির HTML-এ কারো ব্যালেন্স নেই`,
          !guest.html.includes('1111.11') && !guest.html.includes('2222.22'));
        if (ma !== mb) console.log('  note  দুই ব্যবহারকারীর মার্কআপ আলাদা — dynamic পাতায় প্রত্যাশিত');
      }

      /** ★ তুলনাটি মার্কআপে — উপরে ছাপা হ্যাশটিও ঠিক এটিই */
      if (markupOnly(guest.html) !== ma) {
        console.log('  note  guest ≠ লগ-ইন — navbar এর auth-অবস্থা (প্রত্যাশিত)');
      }

      // ★ ISR সত্যিই কার্যকর কিনা — `x-nextjs-cache` না থাকলে পাতা
      //   প্রতি-অনুরোধে রেন্ডার হচ্ছে, অর্থাৎ `revalidate` কার্যত নিষ্ক্রিয়।
      console.log(`  note  x-nextjs-cache=${guest.cache} → ${guest.cache === '(নেই)' ? 'প্রতি-অনুরোধে রেন্ডার (ISR নিষ্ক্রিয়)' : 'ক্যাশ সক্রিয়'}`);
      console.log('');
    }

    // ── locale কুকি ক্যাশে মিশে যায় কিনা ──
    console.log('── locale কুকি ও ক্যাশ ──');
    const bn = await fetch(`${BASE}/`, { headers: { cookie: 'locale=bn' } }).then((r) => r.text());
    const en = await fetch(`${BASE}/`, { headers: { cookie: 'locale=en' } }).then((r) => r.text());
    console.log(`  locale=bn sha ${sha(bn)} · locale=en sha ${sha(en)}`);
    // ⚠️ এখানে "আলাদা" হওয়াই **সঠিক** — ভাষা আলাদা হলে HTML আলাদা হবে।
    //    সমস্যা হতো যদি এক ভাষার ক্যাশ অন্য ভাষাকে পরিবেশন করত।
    check('locale বদলালে HTML বদলায় (এক ভাষার ক্যাশ অন্যকে দেওয়া হচ্ছে না)',
      bn !== en, bn !== en ? 'আলাদা — ঠিক আছে' : '⚠️ একই HTML — locale ক্যাশে আটকে গেছে');
  } finally {
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    console.log('\n  (টেস্ট ইউজার মুছে ফেলা হলো)');
    await prisma.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
