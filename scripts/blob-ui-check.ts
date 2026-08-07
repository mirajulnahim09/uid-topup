/**
 * ═══════════════════════════════════════════════════════════
 * ★ ব্রাউজারে চোখে দেখা যাচাই — Blob ছবি সত্যিই রেন্ডার হয়
 *
 *   `npx tsx scripts/blob-ui-check.ts`
 *
 *   স্ক্রিপ্টে HTTP 200 পাওয়া আর ব্রাউজারে ছবি *দেখানো* এক নয় —
 *   `next.config.js` এর `images.remotePatterns` Blob হোস্ট না চিনলে
 *   `next/image` ৪০০ দেয় এবং পাতা ভাঙা থাম্বনেইল দেখায়। তাই এখানে
 *   `naturalWidth > 0` দিয়ে **প্রকৃত ডিকোড** যাচাই করা হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const SHOTS = path.join(process.cwd(), 'audit', 'screens');
mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

(async () => {
  console.log('═══ ব্রাউজারে Blob ছবি যাচাই ═══\n');
  const ws = path.join(process.cwd(), 'ws.txt');
  const browser = existsSync(ws)
    ? await chromium.connect(readFileSync(ws, 'utf8').trim())
    : await chromium.launch({ headless: false });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // নেটওয়ার্ক-স্তরে ব্যর্থ ছবি ধরা — কনসোলে চুপচাপ ৪০০ হলেও ধরা পড়বে
  const badImages: string[] = [];
  page.on('response', (r) => {
    const ct = r.headers()['content-type'] || '';
    if ((ct.startsWith('image/') || r.url().includes('/_next/image')) && r.status() >= 400) {
      badImages.push(`${r.status()} ${r.url().slice(0, 110)}`);
    }
  });

  try {
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
    check('অ্যাডমিন লগইন', authed === 200, `/api/me HTTP ${authed}`);

    await page.goto(`${BASE}/admin/media`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // পাতার সব <img> — Blob-এর কোনগুলো, আর সেগুলো ডিকোড হয়েছে কিনা
    const imgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img')).map((i) => ({
        src: (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src,
        w: (i as HTMLImageElement).naturalWidth,
        h: (i as HTMLImageElement).naturalHeight,
      })),
    );
    const blobImgs = imgs.filter((i) => i.src.includes('blob.vercel-storage') || i.src.includes('_next/image'));
    console.log(`\n  পাতায় <img>: ${imgs.length} · Blob-উৎস: ${blobImgs.length}`);
    for (const i of blobImgs) console.log(`    ${i.w}×${i.h}  ${i.src.slice(0, 100)}`);

    check('Blob-উৎস ছবি পাতায় আছে', blobImgs.length > 0, `${blobImgs.length} টি`);
    check('প্রতিটি Blob ছবি ডিকোড হয়েছে (naturalWidth>0)',
      blobImgs.length > 0 && blobImgs.every((i) => i.w > 0),
      blobImgs.filter((i) => i.w === 0).length ? `${blobImgs.filter((i) => i.w === 0).length} টি ভাঙা` : 'সব ঠিক');

    // পাতার লেখা "local"/"অচল" ধরনের সতর্কতা দেখাচ্ছে কিনা
    const bodyText = ((await page.textContent('body')) || '').replace(/\s+/g, ' ');
    check('পাতা "storage কনফিগার করুন" সতর্কতা দেখাচ্ছে না',
      !bodyText.includes('BLOB_READ_WRITE_TOKEN'),
      bodyText.includes('BLOB_READ_WRITE_TOKEN') ? '⚠️ সতর্কতা দৃশ্যমান' : 'কোনো সতর্কতা নেই');

    await page.screenshot({ path: path.join(SHOTS, 'admin_media_blob.png'), fullPage: true });
    console.log(`\n  স্ক্রিনশট → audit/screens/admin_media_blob.png`);

    check('কোনো ছবি-অনুরোধ ব্যর্থ হয়নি', badImages.length === 0,
      badImages.length ? badImages.join(' | ') : 'সব ২xx');
  } finally {
    await ctx.close();
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
