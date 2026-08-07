/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ লোকাল ডিস্ক → Vercel Blob স্থানান্তর
 *
 *   `npx tsx scripts/migrate-uploads-to-blob.ts`          ← শুকনো পরীক্ষা (ডিফল্ট)
 *   `npx tsx scripts/migrate-uploads-to-blob.ts --apply`  ← সত্যিই স্থানান্তর
 *
 *   `public/uploads/**` এ পড়ে থাকা প্রতিটি ফাইল Blob-এ তোলে, তারপর
 *   ডাটাবেসের **প্রতিটি** রেফারেন্স নতুন URL-এ বদলে দেয়।
 *
 *   ⚠️ নিরাপত্তা:
 *     · ডিফল্ট শুকনো — `--apply` ছাড়া কিছুই বদলায় না।
 *     · আগে Blob-এ তোলা হয়, **সফল হলে তবেই** DB বদলায়। উল্টো করলে
 *       আপলোড ব্যর্থ হলে DB ভাঙা URL নিয়ে বসে থাকত।
 *     · লোকাল ফাইল **মোছা হয় না** — স্থানান্তর যাচাই করার পর নিজে
 *       মুছবেন (`public/uploads/`)। অপরিবর্তনীয় কাজ স্ক্রিপ্ট করে না।
 *     · একই ফাইল দুবার চালালে দ্বিতীয়বার কিছুই করার থাকে না
 *       (DB-তে আর `/uploads/` থাকে না) — অর্থাৎ পুনঃচালনা নিরাপদ।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { put } from '@vercel/blob';

const APPLY = process.argv.includes('--apply');
const db = new PrismaClient();
const ROOT = path.join(process.cwd(), 'public', 'uploads');

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

let uploaded = 0, rewritten = 0, missing = 0, failed = 0, repaired = 0;
/** একই লোকাল পথ একাধিক সারিতে থাকলে একবারই তোলা হয় */
const urlMap = new Map<string, string>();

async function toBlob(localUrl: string): Promise<string | null> {
  if (urlMap.has(localUrl)) return urlMap.get(localUrl)!;

  const rel = localUrl.slice('/uploads/'.length);
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) {
    console.log(`  ⚠️  ফাইল ডিস্কে নেই: ${localUrl}`);
    missing++;
    return null;
  }

  const contentType = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  if (!APPLY) {
    console.log(`  [dry] তুলত: ${rel}  (${contentType})`);
    uploaded++;
    const fake = `https://<blob>/${rel}`;
    urlMap.set(localUrl, fake);
    return fake;
  }

  try {
    const bytes = await readFile(full);
    const blob = await put(rel, bytes, {
      access: 'public', contentType, addRandomSuffix: false, cacheControlMaxAge: 31536000,
    });
    console.log(`  ✓ তোলা হয়েছে: ${rel} → ${blob.url}`);
    uploaded++;
    urlMap.set(localUrl, blob.url);
    return blob.url;
  } catch (e) {
    console.log(`  ✗ ব্যর্থ: ${rel} — ${(e as Error).message}`);
    failed++;
    return null;
  }
}

/** একটি টেবিল-কলামের সব লোকাল URL স্থানান্তর করে */
async function migrateColumn(
  label: string,
  rows: { id: string | number; value: string | null }[],
  update: (id: any, url: string) => Promise<unknown>,
) {
  const local = rows.filter((r) => r.value?.startsWith('/uploads/'));
  if (!local.length) return;
  console.log(`\n── ${label} — ${local.length} টি ──`);
  for (const row of local) {
    const url = await toBlob(row.value!);
    if (!url) continue;
    if (APPLY) await update(row.id, url);
    rewritten++;
    console.log(`     ${label}#${row.id} → ${APPLY ? 'DB হালনাগাদ' : '[dry] DB হালনাগাদ হতো'}`);
  }
}

(async () => {
  console.log(APPLY
    ? '═══ স্থানান্তর (--apply) — সত্যিই বদলাচ্ছে ═══'
    : '═══ শুকনো পরীক্ষা — কিছুই বদলাবে না (--apply দিলে সত্যি হবে) ═══');

  if (APPLY && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('\n✗ BLOB_READ_WRITE_TOKEN সেট করা নেই — স্থানান্তর সম্ভব নয়।');
    process.exit(1);
  }

  await migrateColumn('Category.icon',
    (await db.category.findMany({ select: { id: true, icon: true } })).map((r) => ({ id: r.id, value: r.icon })),
    (id, url) => db.category.update({ where: { id }, data: { icon: url } }));

  await migrateColumn('Product.image',
    (await db.product.findMany({ select: { id: true, image: true } })).map((r) => ({ id: r.id, value: r.image })),
    (id, url) => db.product.update({ where: { id }, data: { image: url } }));

  await migrateColumn('ProductImage.url',
    (await db.productImage.findMany({ select: { id: true, url: true } })).map((r) => ({ id: r.id, value: r.url })),
    (id, url) => db.productImage.update({ where: { id }, data: { url } }));

  // ★ Media-র ক্ষেত্রে শুধু url বদলালে হয় না — `storage` ও `key` কলাম
  //   পুরনো ড্রাইভারের তথ্য ধরে রাখত, ফলে /admin/media-তে সারিটি
  //   "local" লেখা দেখাত অথচ ফাইল Blob-এ। (মুছতে সমস্যা হতো না —
  //   `driverForUrl()` URL দেখে ঠিক ড্রাইভার বাছে — কিন্তু তথ্যটি
  //   ভুল থাকত, আর ভুল মেটাডেটা পরের অডিটে ফাঁদ হয়ে ফেরে।)
  await migrateColumn('Media.url',
    (await db.media.findMany({ select: { id: true, url: true } })).map((r) => ({ id: r.id, value: r.url })),
    (id, url) => db.media.update({
      where: { id },
      data: { url, storage: 'blob', key: new URL(url).pathname.replace(/^\//, '') },
    }));

  await migrateColumn('Banner.image',
    (await db.banner.findMany({ select: { id: true, image: true } })).map((r) => ({ id: r.id, value: r.image })),
    (id, url) => db.banner.update({ where: { id }, data: { image: url } }));

  await migrateColumn('Campaign.imageUrl',
    (await db.campaign.findMany({ select: { id: true, imageUrl: true } })).map((r) => ({ id: r.id, value: r.imageUrl })),
    (id, url) => db.campaign.update({ where: { id }, data: { imageUrl: url } }));

  await migrateColumn('Deposit.screenshot',
    (await db.deposit.findMany({ select: { id: true, screenshot: true } })).map((r) => ({ id: r.id, value: r.screenshot })),
    (id, url) => db.deposit.update({ where: { id }, data: { screenshot: url } }));

  await migrateColumn('Review.photoUrl',
    (await db.review.findMany({ select: { id: true, photoUrl: true } })).map((r) => ({ id: r.id, value: r.photoUrl })),
    (id, url) => db.review.update({ where: { id }, data: { photoUrl: url } }));

  // ── Setting: ব্র্যান্ডিং লোগো/ফেভিকন ইত্যাদি value-র ভেতরে থাকে ──
  const settings = await db.setting.findMany({ where: { value: { contains: '/uploads/' } } });
  if (settings.length) {
    console.log(`\n── Setting (value-তে /uploads/) — ${settings.length} টি ──`);
    for (const s of settings) {
      let next = s.value;
      // একটি value-তে একাধিক URL থাকতে পারে (JSON) — সবগুলোই বদলাও
      const found = s.value.match(/\/uploads\/[A-Za-z0-9._/-]+/g) ?? [];
      for (const localUrl of found) {
        const url = await toBlob(localUrl);
        if (url) next = next.split(localUrl).join(url);
      }
      if (next !== s.value) {
        if (APPLY) await db.setting.update({ where: { key: s.key }, data: { value: next } });
        rewritten++;
        console.log(`     Setting[${s.key}] → ${APPLY ? 'DB হালনাগাদ' : '[dry] DB হালনাগাদ হতো'}`);
      }
    }
  }

  // ── মেরামত: URL Blob-এর কিন্তু মেটাডেটা পুরনো ──
  //   আগের সংস্করণ শুধু `url` বদলাত, তাই সেই সময়ের সারিগুলোতে
  //   `storage='local'` রয়ে গেছে। পুনঃচালনায় সেগুলো ঠিক হয়ে যায়।
  const stale = (await db.media.findMany({ select: { id: true, url: true, storage: true, key: true } }))
    .filter((m) => m.url.includes('.public.blob.vercel-storage.com') && m.storage !== 'blob');
  if (stale.length) {
    console.log(`\n── মেরামত: Blob URL কিন্তু storage≠blob — ${stale.length} টি ──`);
    for (const m of stale) {
      const key = new URL(m.url).pathname.replace(/^\//, '');
      if (APPLY) await db.media.update({ where: { id: m.id }, data: { storage: 'blob', key } });
      repaired++;
      console.log(`     Media#${m.id}  storage "${m.storage}" → "blob"${APPLY ? '' : '  [dry]'}`);
    }
  }

  console.log('\n═══ সারসংক্ষেপ ═══');
  console.log(`  Blob-এ তোলা ফাইল : ${uploaded}`);
  console.log(`  DB রেফারেন্স বদল : ${rewritten}`);
  console.log(`  মেটাডেটা মেরামত  : ${repaired}`);
  console.log(`  ডিস্কে অনুপস্থিত  : ${missing}`);
  console.log(`  ব্যর্থ            : ${failed}`);
  if (!APPLY) console.log('\n  → সত্যিই চালাতে: npx tsx scripts/migrate-uploads-to-blob.ts --apply');
  else console.log('\n  → যাচাইয়ের পর `public/uploads/` নিজে মুছে ফেলুন।');

  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
})();
