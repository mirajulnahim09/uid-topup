/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ HTTP রুট হয়ে প্রকৃত আপলোড যাচাই — Blob, ডিস্ক নয়
 *
 *   `npx tsx scripts/blob-routes-verify.ts`
 *
 *   `blob-verify.ts` storage **লাইব্রেরি** পরীক্ষা করে। এটি করে আসল
 *   পথ: লগইন করা ব্রাউজার → `POST /api/admin/upload` ও
 *   `POST /api/upload` → রুটের guard, rate-limit, magic-byte যাচাই,
 *   Media রেকর্ড — সবকিছুসহ।
 *
 *   যা **প্রমাণ** করা হয়:
 *     ১. প্রতিটি রুট-ফোল্ডার আপলোড নেয় ও Blob URL ফেরত দেয়
 *     ২. ফেরত URL কখনো `/uploads/` নয় (লোকাল ডিস্ক নয়)
 *     ৩. URL থেকে বাইট ফিরিয়ে এনে byte-for-byte মেলে
 *     ৪. আপলোডের পর `public/uploads/` **অপরিবর্তিত** — এটাই
 *        "ডিস্কে কিছু লেখা হয়নি"-র একমাত্র সৎ প্রমাণ
 *     ৫. পরিষ্কার: পরীক্ষার blob ও Media সারি মুছে ফেলা হয়
 * ═══════════════════════════════════════════════════════════
 */
/** ⚠️ লাইভ DB-তে লেখা আটকায় — প্রথম import হতে হবে। */
import './_guard-live-db';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium, type Browser } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { deleteImage } from '../src/lib/upload';

const BASE = 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const UPLOADS = path.join(process.cwd(), 'public', 'uploads');
const db = new PrismaClient();

type Res = { name: string; ok: boolean; note: string };
const results: Res[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
  return ok;
};

/** বৈধ PNG — রুটের magic-byte যাচাই পাস করতে হবে; tag বদলে প্রতিটি আলাদা */
function makePng(tag: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let crc = 0xffffffff;
    for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0x00, tag & 0xff, (tag >> 8) & 0xff, 0x00]);
  const zlib = require('node:zlib') as typeof import('node:zlib');
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** public/uploads-এর পুনরাবৃত্ত স্ন্যাপশট — পথ + আকার + mtime */
async function snapshotUploads(): Promise<string> {
  if (!existsSync(UPLOADS)) return '(অনুপস্থিত)';
  const lines: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const s = await stat(full);
        lines.push(`${path.relative(UPLOADS, full)}|${s.size}|${s.mtimeMs}`);
      }
    }
  };
  await walk(UPLOADS);
  lines.sort();
  return lines.join('\n');
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** ব্রাউজারের ভেতর থেকে multipart POST — সেশন কুকিসহ */
async function uploadViaRoute(
  page: any, endpoint: string, b64: string, folder: string | null,
): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ({ base, endpoint, b64, folder }: any) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fd = new FormData();
      fd.append('file', new File([arr], 'probe.png', { type: 'image/png' }));
      if (folder) fd.append('folder', folder);
      const r = await fetch(base + endpoint, { method: 'POST', body: fd });
      let body: any = null;
      try { body = await r.json(); } catch { body = { error: '(non-json)' }; }
      return { status: r.status, body };
    },
    { base: BASE, endpoint, b64, folder },
  );
}

/** রুটের FOLDERS তালিকা (src/app/api/admin/upload/route.ts) */
const ADMIN_FOLDERS: { label: string; folder: string }[] = [
  { label: 'প্রোডাক্ট ছবি',      folder: 'products' },
  { label: 'ব্যানার',            folder: 'banners' },
  { label: 'পেমেন্ট মেথড ছবি',   folder: 'payments' },
  { label: 'সাইট / সাধারণ',      folder: 'site' },
  { label: 'ক্যাটাগরি আইকন',     folder: 'categories' },
  { label: 'ক্যাম্পেইন',         folder: 'campaigns' },
  { label: 'পপ-আপ',              folder: 'popups' },
  { label: 'মিডিয়া লাইব্রেরি',   folder: 'media' },
  { label: 'লোগো / ব্র্যান্ডিং', folder: 'brand' },
];

/** মিডিয়া-লাইব্রেরি রুটের নিজস্ব FOLDERS (src/app/api/admin/media/route.ts) */
const MEDIA_FOLDERS: { label: string; folder: string }[] = [
  { label: 'মিডিয়া: প্রোডাক্ট',   folder: 'products' },
  { label: 'মিডিয়া: ব্যানার',     folder: 'banners' },
  { label: 'মিডিয়া: পেমেন্ট',     folder: 'payments' },
  { label: 'মিডিয়া: সাইট',        folder: 'site' },
  { label: 'মিডিয়া: ক্যাটাগরি',   folder: 'categories' },
  { label: 'মিডিয়া: ক্যাম্পেইন',  folder: 'campaigns' },
  { label: 'মিডিয়া: পপ-আপ',       folder: 'popups' },
  { label: 'মিডিয়া: লাইব্রেরি',   folder: 'media' },
];

/**
 * ★ `--only=<sub>` — কেবল যে endpoint-এ `<sub>` আছে সেগুলো চালায়।
 *   কারণ: `/api/upload` ও `/api/admin/upload` **একই** rate-limit বাকেট
 *   (`upl:<id>`) ভাগ করে, আর ডিপোজিটের সীমা মাত্র ১০/১০মিনিট। পুরো
 *   স্ক্রিপ্ট পরপর দুবার চালালে দ্বিতীয়বার ৪২৯ খেত — সেটি রুটের ত্রুটি
 *   নয়, তাই আলাদা করে চালানোর সুযোগ রাখা হলো।
 *   `/api/admin/media` আলাদা বাকেট (`media:<id>`) ব্যবহার করে।
 */
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);

(async () => {
  console.log('═══ HTTP রুট হয়ে Blob আপলোড যাচাই ═══\n');

  if (!EMAIL || !PASSWORD) {
    console.error('✗ ADMIN_EMAIL / ADMIN_PASSWORD নেই — .env দেখুন');
    process.exit(1);
  }

  const before = await snapshotUploads();
  console.log(`  public/uploads আগে : ${before === '(অনুপস্থিত)' ? '(অনুপস্থিত)' : `${before.split('\n').filter(Boolean).length} ফাইল`} · sha ${digest(before)}\n`);

  let browser: Browser;
  const wsPath = path.join(process.cwd(), 'ws.txt');
  if (existsSync(wsPath)) {
    browser = await chromium.connect(readFileSync(wsPath, 'utf8').trim());
    console.log('  চলমান headed ব্রাউজারে যুক্ত হয়েছে (ws.txt)\n');
  } else {
    // playwright-core-এ বান্ডিল ব্রাউজার নেই — সিস্টেমের Chrome/Edge লাগে
    const exe = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find(existsSync);
    browser = await chromium.launch({ headless: false, ...(exe ? { executablePath: exe } : {}) });
    console.log('  ⚠️ ws.txt নেই — নতুন ব্রাউজার খোলা হলো\n');
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const createdUrls: string[] = [];

  try {
    // ── লগইন ──
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    let authed = 0;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000);
      authed = await page.evaluate(async (b) => (await fetch(`${b}/api/me`)).status, BASE);
      if (authed === 200) break;
    }
    if (!check('অ্যাডমিন লগইন', authed === 200, `/api/me HTTP ${authed}`)) {
      throw new Error('লগইন ব্যর্থ — বাকি যাচাই অর্থহীন');
    }

    let tag = 0;
    /** এক পৃষ্ঠের সম্পূর্ণ যাচাই */
    const verifySurface = async (label: string, endpoint: string, folder: string | null) => {
      if (ONLY && !endpoint.includes(ONLY)) return;
      console.log(`\n── ${label}  (${endpoint}${folder ? ` · folder=${folder}` : ''}) ──`);
      const original = makePng(++tag);
      const { status, body } = await uploadViaRoute(page, endpoint, original.toString('base64'), folder);

      if (!check(`${label}: রুট HTTP 200`, status === 200, `HTTP ${status}${body?.error ? ` — ${body.error}` : ''}`)) return;
      const url: string = body?.url || '';
      if (!check(`${label}: URL ফেরত এসেছে`, Boolean(url), url.slice(0, 80))) return;
      createdUrls.push(url);

      check(`${label}: Blob-এ (লোকাল ডিস্ক নয়)`,
        url.includes('.public.blob.vercel-storage.com') && !url.startsWith('/uploads/'),
        url.startsWith('/uploads/') ? '⚠️ লোকাল ডিস্কে গেছে!' : 'blob.vercel-storage.com');

      const res = await fetch(url);
      const got = Buffer.from(await res.arrayBuffer());
      check(`${label}: ডাউনলোড HTTP 200`, res.status === 200, `HTTP ${res.status}`);
      check(`${label}: বাইট হুবহু মেলে`, got.equals(original), `পাঠানো ${original.length} B · ফেরত ${got.length} B`);
      check(`${label}: content-type ঠিক`, (res.headers.get('content-type') || '').includes('image/png'),
        res.headers.get('content-type') || '(নেই)');
    };

    // ★ ডিপোজিট আগে: /api/upload ও /api/admin/upload একই বাকেট (`upl:<id>`)
    //   ব্যবহার করে কিন্তু ডিপোজিটের সীমা ১০ — তাই এটি প্রথমে চালানো হয়।
    await verifySurface('পেমেন্ট স্ক্রিনশট (ইউজার)', '/api/upload', null);
    for (const { label, folder } of ADMIN_FOLDERS) {
      await verifySurface(label, '/api/admin/upload', folder);
    }
    for (const { label, folder } of MEDIA_FOLDERS) {
      await verifySurface(label, '/api/admin/media', folder);
    }

    // ── ডিস্ক অপরিবর্তিত? ──
    console.log('\n── লোকাল ফাইল-সিস্টেম ──');
    const after = await snapshotUploads();
    check('public/uploads অপরিবর্তিত (কোনো আপলোড ডিস্কে যায়নি)', after === before,
      after === before ? `sha ${digest(after)} — অপরিবর্তিত`
        : `⚠️ বদলে গেছে: ${digest(before)} → ${digest(after)}`);

    const allBlob = createdUrls.length > 0 && createdUrls.every((u) => u.includes('.public.blob.vercel-storage.com'));
    check('প্রতিটি আপলোড Blob-এ সংরক্ষিত', allBlob, `${createdUrls.length} টি URL পরীক্ষিত`);

  } finally {
    // ── পরিষ্কার: পরীক্ষার blob ও Media সারি ──
    console.log('\n── পরিষ্কার ──');
    let delBlob = 0, delRow = 0;
    for (const url of createdUrls) {
      try { await deleteImage(url); delBlob++; } catch { /* নিচে গোনা হবে */ }
      try {
        const r = await db.media.deleteMany({ where: { url } });
        delRow += r.count;
      } catch { /* ignore */ }
    }
    console.log(`  blob মুছেছে: ${delBlob}/${createdUrls.length} · Media সারি মুছেছে: ${delRow}`);

    // মোছা সত্যিই হয়েছে কিনা — একটি নমুনা যাচাই
    if (createdUrls.length) {
      await new Promise((r) => setTimeout(r, 1200));
      const gone = await fetch(createdUrls[0]);
      check('পরিষ্কার যাচাই: মোছা URL আর নেই', gone.status === 404 || gone.status === 410, `HTTP ${gone.status}`);
    }

    await ctx.close();          // ব্রাউজার-জানালা খোলা থাকে (ws সার্ভার)
    await db.$disconnect();
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n════════════════════════════════════════');
  console.log(`  ${pass} পাস · ${fail} ব্যর্থ`);
  process.exit(fail ? 1 : 0);
})();
