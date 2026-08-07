/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Vercel Blob — আপলোড / ডাউনলোড / মুছে ফেলা যাচাই
 *
 *   `npx tsx scripts/blob-verify.ts`
 *
 *   এটি "কোড ঠিক দেখাচ্ছে" বলে না। প্রতিটি ধাপ **প্রমাণ** করে:
 *     ১. আপলোড  — অ্যাপের নিজস্ব `uploadImage()` দিয়ে (রুটগুলো যা ব্যবহার করে)
 *     ২. ড্রাইভার — ফেরত URL সত্যিই Blob-এর কিনা (লোকাল ডিস্ক নয়)
 *     ৩. ডাউনলোড — URL থেকে বাইট ফিরিয়ে এনে **byte-for-byte** মেলানো
 *     ৪. হেডার   — content-type ও cache-control ঠিক আছে কিনা
 *     ৫. মুছে ফেলা — `deleteImage()` এর পর URL সত্যিই আর নেই (404/410)
 *
 *   প্রতিটি আপলোড-পৃষ্ঠের ফোল্ডার আলাদাভাবে পরীক্ষা করা হয়, যাতে
 *   "ব্যানার কাজ করে কিন্তু স্ক্রিনশট করে না" ধরনের ফাঁক ধরা পড়ে।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { getStorage } from '../src/lib/storage';
import { uploadImage, deleteImage } from '../src/lib/upload';

type Res = { name: string; ok: boolean; note: string };
const results: Res[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
  return ok;
};

/** ছোট কিন্তু **বৈধ** PNG — upload.ts এর magic-byte যাচাই পাস করতে হবে */
function makePng(tag: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // tag বাইটটি বদলায় → প্রতিটি পরীক্ষার বাইট আলাদা, তাই ডাউনলোড-তুলনা অর্থবহ
  const raw = Buffer.from([0x00, tag & 0xff, (tag >> 8) & 0xff, 0x00]);
  const zlib = require('node:zlib') as typeof import('node:zlib');
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Buffer → File (uploadImage যা চায়) */
function asFile(buf: Buffer, name: string): File {
  return new File([new Uint8Array(buf)], name, { type: 'image/png' });
}

/** প্রতিটি আপলোড-পৃষ্ঠ ও তার ফোল্ডার */
const SURFACES: { label: string; folder: string }[] = [
  { label: 'ব্যানার আপলোড',            folder: 'banners' },
  { label: 'লোগো / ব্র্যান্ডিং',        folder: 'branding' },
  { label: 'প্রোডাক্ট ছবি',             folder: 'products' },
  { label: 'পেমেন্ট স্ক্রিনশট',         folder: 'deposits' },
  { label: 'মিডিয়া লাইব্রেরি',          folder: 'media' },
  { label: 'রিভিউ ছবি',                folder: 'reviews' },
  { label: 'ভবিষ্যৎ আপলোড (নতুন ফোল্ডার)', folder: 'misc' },
];

(async () => {
  console.log('═══ Vercel Blob যাচাই ═══\n');

  const store = getStorage();
  console.log(`  ড্রাইভার : ${store.name}`);
  console.log(`  কনফিগার্ড : ${store.configured}${store.reason ? ` (${store.reason})` : ''}\n`);

  if (!check('storage ড্রাইভার Vercel Blob', store.name === 'vercel-blob',
    store.name === 'vercel-blob' ? 'vercel-blob' : `পাওয়া গেছে "${store.name}" — BLOB_READ_WRITE_TOKEN দেখুন`)) {
    console.log('\n✗ Blob ড্রাইভার সক্রিয় নয় — বাকি যাচাই অর্থহীন, থামানো হলো।');
    process.exit(1);
  }
  check('ড্রাইভার configured', store.configured);

  let i = 0;
  for (const { label, folder } of SURFACES) {
    console.log(`\n── ${label}  (folder: ${folder}) ──`);
    const original = makePng(++i);

    // ১. আপলোড — অ্যাপের আসল পথ
    let url = '', key = '';
    try {
      const r = await uploadImage(asFile(original, `verify-${folder}.png`), folder);
      url = r.url; key = r.key;
      check(`${label}: আপলোড সফল`, true, `${r.size} bytes → ${url.slice(0, 78)}`);
    } catch (e) {
      check(`${label}: আপলোড সফল`, false, (e as Error).message);
      continue;
    }

    // ২. URL সত্যিই Blob-এর — লোকাল ডিস্ক নয়
    check(`${label}: Blob-এ সংরক্ষিত (লোকাল ডিস্ক নয়)`,
      url.includes('.public.blob.vercel-storage.com') && !url.startsWith('/uploads/'),
      url.startsWith('/uploads/') ? '⚠️ লোকাল ডিস্কে গেছে!' : 'blob.vercel-storage.com');

    check(`${label}: কী-তে সঠিক ফোল্ডার`, key.startsWith(folder + '/'), key);

    // ৩. ডাউনলোড — বাইট মিলিয়ে
    try {
      const res = await fetch(url);
      const got = Buffer.from(await res.arrayBuffer());
      check(`${label}: ডাউনলোড HTTP 200`, res.status === 200, `HTTP ${res.status}`);
      check(`${label}: বাইট হুবহু মেলে`, got.equals(original),
        `পাঠানো ${original.length} B · ফেরত ${got.length} B`);
      check(`${label}: content-type ঠিক`, (res.headers.get('content-type') || '').includes('image/png'),
        res.headers.get('content-type') || '(নেই)');
      const cc = res.headers.get('cache-control') || '';
      check(`${label}: cache-control বসানো`, /max-age=\d+/.test(cc), cc || '(নেই)');
    } catch (e) {
      check(`${label}: ডাউনলোড`, false, (e as Error).message);
    }

    // ৪. মুছে ফেলা — এবং সত্যিই মুছেছে কিনা
    try {
      await deleteImage(url);
      // Blob-এ delete তাৎক্ষণিক নয় হতে পারে — সামান্য অপেক্ষা
      await new Promise((r) => setTimeout(r, 1200));
      const after = await fetch(url);
      check(`${label}: মোছার পর URL আর নেই`, after.status === 404 || after.status === 410,
        `HTTP ${after.status}`);
    } catch (e) {
      check(`${label}: মুছে ফেলা`, false, (e as Error).message);
    }
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n════════════════════════════════════════`);
  console.log(`  ${pass} পাস · ${fail} ব্যর্থ`);
  process.exit(fail ? 1 : 0);
})();
