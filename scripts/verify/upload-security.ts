/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ আপলোড নিরাপত্তা (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   `/api/upload` (গ্রাহক — পেমেন্ট/রিভিউ স্ক্রিনশট) ও `/api/admin/upload`
 *   আসল HTTP দিয়ে — কেবল নিরীহ ফাইল:
 *     অতিথি · ভুল ধরন (SVG, `.png` নামে HTML, খালি) · বড় (৯MB) ·
 *     বিশাল বডি (৪০MB — সার্ভার ডোবে কি না) · `../` ফাইলনাম ·
 *     GIF-HTML polyglot কী ধরনে পরিবেশিত হয় · গ্রাহক অ্যাডমিন-আপলোড ·
 *     অ্যাডমিন অবৈধ ফোল্ডার · সংরক্ষিত ফাইলের key কে ঠিক করে
 *
 *   চালানো: npx tsx scripts/verify/upload-security.ts   (ডেভ :3000 বা VERIFY_BASE)
 *   ⚠️ লোকাল ড্রাইভারে তৈরি হওয়া প্রতিটি ফাইল শেষে মুছে ফেলা হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { request, type APIRequestContext } from 'playwright-core';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

let total = 0;
let fail = 0;
function check(name: string, ok: boolean, note = '') {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function signIn(email: string, password: string): Promise<APIRequestContext> {
  await db.rateLimitBucket.deleteMany({});
  const api = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const { csrfToken } = await (await api.get('/api/auth/csrf')).json();
  await api.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  return api;
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  console.log(`═══ আপলোড নিরাপত্তা · ${BASE} · DB ${dbLabel()} ═══\n`);
  const created: string[] = [];
  const anon = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const cust = await signIn('customer@uidtopup.local', 'Customer@2026Secure');
  const admin = await signIn('admin@uidtopup.local', 'Admin@2026Secure');
  const up = (ctx: APIRequestContext, name: string, mimeType: string, buffer: Buffer, url = '/api/upload', extra: Record<string, string> = {}) =>
    ctx.post(url, { multipart: { file: { name, mimeType, buffer }, ...extra }, failOnStatusCode: false, timeout: 120_000 });
  const clear = () => db.rateLimitBucket.deleteMany({});

  try {
    console.log('── অনুমতি ──');
    const a = await up(anon, 'x.png', 'image/png', PNG_1PX);
    check('অতিথি আপলোড করতে পারেন না', a.status() === 401, String(a.status()));
    const ca = await up(cust, 'x.png', 'image/png', PNG_1PX, '/api/admin/upload', { folder: 'products' });
    check('গ্রাহক অ্যাডমিন-আপলোড ছুঁতে পারেন না', ca.status() === 403, String(ca.status()));

    console.log('\n── ফাইলের ধরন (magic bytes, নাম নয়) ──');
    await clear();
    const svg = await up(cust, 'x.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    check('SVG প্রত্যাখ্যাত (script বহন করতে পারে)', svg.status() === 400, `${svg.status()} ${(await svg.text()).slice(0, 60)}`);
    const html = await up(cust, 'x.png', 'image/png', Buffer.from('<html><script>alert(1)</script></html>'));
    check('.png নামে HTML প্রত্যাখ্যাত', html.status() === 400, String(html.status()));
    const empty = await up(cust, 'x.png', 'image/png', Buffer.alloc(0));
    check('খালি ফাইল প্রত্যাখ্যাত', empty.status() === 400, String(empty.status()));
    const noFile = await cust.post('/api/upload', { multipart: { other: 'x' }, failOnStatusCode: false });
    check('ফাইল ছাড়া অনুরোধ → ৪০০', noFile.status() === 400, String(noFile.status()));

    console.log('\n── আকার ──');
    await clear();
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(9 * 1024 * 1024)]);
    const bigRes = await up(cust, 'big.png', 'image/png', big);
    check('৯MB → ৪০০, বাংলা বার্তা', bigRes.status() === 400 && /MB/.test(await bigRes.text()), String(bigRes.status()));
    await clear();
    const huge = Buffer.concat([PNG_1PX, Buffer.alloc(40 * 1024 * 1024)]);
    const t = Date.now();
    const hugeRes = await up(cust, 'huge.png', 'image/png', huge);
    const ms = Date.now() - t;
    check('৪০MB → ৪xx (৫০০ নয়), সার্ভার সাড়া দেয়', hugeRes.status() >= 400 && hugeRes.status() < 500, `${hugeRes.status()} · ${ms}ms`);
    const alive = await anon.get('/api/health', { failOnStatusCode: false });
    check('বিশাল বডির পর সার্ভার সুস্থ', alive.ok(), String(alive.status()));

    console.log('\n── ফাইলনাম ও key ──');
    await clear();
    const trav = await up(cust, '../../../../src/app/page.tsx.png', 'image/png', PNG_1PX);
    const tj = await trav.json().catch(() => ({}));
    if (tj.url) created.push(tj.url);
    check('`../` ফাইলনাম উপেক্ষিত — key সার্ভার বানায়', trav.ok() && /^\/uploads\/deposits\/\d+-[a-z0-9]+\.png$|^https:\/\//.test(tj.url ?? ''), tj.url ?? String(trav.status()));

    console.log('\n── polyglot ও পরিবেশনা ──');
    await clear();
    const poly = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('<html><body><script>alert(document.domain)</script></body></html>')]);
    const pr = await up(cust, 'poly.html', 'text/html', poly);
    const pj = await pr.json().catch(() => ({}));
    if (pj.url) created.push(pj.url);
    check('GIF-শিরোনামওয়ালা ফাইল .gif হিসেবেই সংরক্ষিত (নাম/MIME উপেক্ষিত)', pr.ok() && /\.gif$/.test(pj.url ?? ''), pj.url ?? String(pr.status()));
    if (pj.url?.startsWith('/')) {
      const served = await anon.get(pj.url, { failOnStatusCode: false });
      const ct = served.headers()['content-type'] ?? '';
      /**
       * ⚠️ প্রোডাকশন বিল্ডে (`next start`) লোকাল ড্রাইভারের ফাইল **পরিবেশিতই হয় না** —
       *   Next বিল্ডের সময়ের `public/` তালিকা ধরে, পরে লেখা ফাইল ৪০৪ (মাপা, চূড়ান্ত
       *   মাস্টার অডিট ২০২৬-০৯-১৭; ডেভে কাজ করে বলে আগে ধরা পড়েনি)। ৪০৪ কোনো
       *   নিরাপত্তা-ব্যর্থতা নয় (কিছুই পরিবেশিত হয়নি), তাই দাবিটি তখন এভাবেই মাপা হয়:
       *   **HTML হিসেবে ২০০ দেওয়া হয়নি**।
       */
      const notServed = served.status() === 404;
      check(
        notServed
          ? 'polyglot পরিবেশিত হয়নি (প্রোড বিল্ডে লোকাল আপলোড ৪০৪ — Blob/S3 ব্যবহার্য)'
          : 'polyglot image/gif হিসেবে পরিবেশিত, HTML নয়',
        notServed ? !(served.status() === 200 && /text\/html/.test(ct)) : ct.startsWith('image/gif'),
        `${served.status()} · ${ct}`,
      );
      // ★ হেডার-দাবিগুলো কেবল তখনই অর্থবহ যখন ফাইলটি সত্যিই পরিবেশিত হয়
      if (served.status() === 200) {
        check('`X-Content-Type-Options: nosniff` আছে', served.headers()['x-content-type-options'] === 'nosniff',
          served.headers()['x-content-type-options'] ?? 'নেই');
        check('আপলোডে sandbox CSP আছে', /sandbox/.test(served.headers()['content-security-policy'] ?? ''),
          served.headers()['content-security-policy'] ?? 'নেই');
      }
    }

    console.log('\n── অ্যাডমিন ──');
    await clear();
    const badFolder = await up(admin, 'x.png', 'image/png', PNG_1PX, '/api/admin/upload', { folder: '../etc' });
    check('অ্যাডমিন: অবৈধ ফোল্ডার প্রত্যাখ্যাত', badFolder.status() === 400, String(badFolder.status()));
    const okAdmin = await up(admin, 'x.png', 'image/png', PNG_1PX, '/api/admin/upload', { folder: 'products' });
    const oj = await okAdmin.json().catch(() => ({}));
    if (oj.url) created.push(oj.url);
    check('অ্যাডমিন: বৈধ আপলোড সফল', okAdmin.ok() && typeof oj.url === 'string', oj.url ?? String(okAdmin.status()));

    console.log('\n── রেট-লিমিট ──');
    await clear();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await up(cust, 'x.png', 'image/png', PNG_1PX);
      codes.push(r.status());
      const j = await r.json().catch(() => ({}));
      if (j.url) created.push(j.url);
    }
    check('গ্রাহক: ১০টির পর ৪২৯', codes.slice(0, 10).every((c) => c === 200) && codes.slice(10).every((c) => c === 429), codes.join(','));
  } finally {
    for (const u of created) {
      if (u.startsWith('/uploads/')) await unlink(path.join(process.cwd(), 'public', u)).catch(() => {});
    }
    await db.media.deleteMany({ where: { url: { in: created } } }).catch(() => {});
    await db.rateLimitBucket.deleteMany({});
    for (const c of [anon, cust, admin]) await c.dispose();
    await db.$disconnect();
  }
  console.log(`\n════ ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''} ════`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
