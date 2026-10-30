/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ডেলিভারি প্যাকেজিং (C1) — সিক্রেট কখনো zip-এ যাবে না
 *
 *   node scripts/package-release.mjs --since=2026-08-07
 *   node scripts/package-release.mjs --manifest=changed.txt
 *   node scripts/package-release.mjs --files=src/lib/a.ts,src/lib/b.ts
 *   node scripts/package-release.mjs --full-only
 *
 *   §2.6 অনুযায়ী দুটি zip বানায়:
 *     · uidtopup-CHANGED-<date>.zip — কেবল বদলানো/নতুন ফাইল, পথ অক্ষত
 *     · uidtopup-FULL-<date>.zip    — পুরো প্রজেক্ট, বাদে
 *                                      node_modules/ · .next/ · .env* · *.tsbuildinfo
 *
 *   ── কেন এই স্ক্রিপ্ট ──
 *   একটি ডিস্ট্রিবিউশন zip-এ `.env` ও `.env.bak-20260805` সহ ১৬টি
 *   লাইভ সিক্রেট চলে গিয়েছিল। হাতে zip করলে এটি আবার ঘটবে — মানুষ
 *   ভুল করে, স্ক্রিপ্ট করে না। তাই বাদ-তালিকা কোডে, আর শেষে একটি
 *   **কঠিন যাচাই**: স্টেজিং গাছে একটিও `.env*` পাওয়া গেলে স্ক্রিপ্ট
 *   zip না বানিয়েই থেমে যায়।
 *
 *   ── "changed" কীভাবে ঠিক হয় ──
 *   এই প্রজেক্ট git রিপো নয়, তাই `git diff` নেই। তিনটি উপায়:
 *     --since=<ISO তারিখ>  → mtime ওই সময়ের পরে
 *     --manifest=<ফাইল>    → প্রতি লাইনে একটি পথ
 *     --files=a,b,c        → কমা-আলাদা তালিকা
 *   কোনোটি না দিলে শুধু FULL zip বানে (নীরবে ভুল CHANGED zip দেওয়ার
 *   চেয়ে কিছু না দেওয়া ভালো)।
 *
 *   ⚠️ কোনো নির্ভরতা যোগ করা হয়নি (§2.2 নিয়ম ৮) — Windows-এ
 *      `Compress-Archive`, অন্যত্র `zip` ব্যবহার হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'release');
const STAMP = new Date().toISOString().slice(0, 10);

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const has = (name) => process.argv.includes(`--${name}`);

/**
 * ★★★ বাদ-তালিকা। `.env*` এখানে **প্রথম** — এবং নিচে আবার যাচাই হয়।
 *   একটিমাত্র জায়গায় নিয়ম রাখলে ভুল করার সুযোগ কম।
 */
const DENY_DIRS = new Set([
  'node_modules',   // §2.6
  '.next',          // §2.6
  '.git',           // recursion/ইতিহাস — zip-এ অর্থহীন
  'release',        // নিজের আউটপুট, নাহলে পুনরাবৃত্তি
  '.vercel',
  '.turbo',
  '.certs',         // local TLS cert + private key (prod-https.mjs)
  '.sim',           // simulation scratch output
]);

/** একটি ফাইল/ফোল্ডার বাদ যাবে কিনা (রুট-সাপেক্ষ পথ, `/` বিভাজক) */
function isExcluded(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];

  for (const p of parts) if (DENY_DIRS.has(p)) return true;

  // ★★★ সিক্রেট — `.env`, `.env.local`, `.env.bak-20260805`, যেকোনো কিছু।
  //   `.env.example` কেবল প্লেসহোল্ডার, তাই সেটি ছাড় পায়।
  if (base === '.env.example') return false;
  if (base === '.env' || base.startsWith('.env.') || base.startsWith('.env')) return true;

  if (base.endsWith('.tsbuildinfo')) return true;   // §2.6
  if (base === 'ws.txt') return true;               // মেশিন-নির্দিষ্ট
  if (base === '.DS_Store') return true;
  // runtime uploads (customer deposit screenshots = PII), gitignored
  if (rel === 'public/uploads' || rel.startsWith('public/uploads/')) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true; // key material, wherever it sits
  if (base.endsWith('.log')) return true;           // dev/server logs

  return false;
}

/** পুনরাবৃত্ত ফাইল-তালিকা (রুট-সাপেক্ষ, `/` বিভাজক) */
async function walk(dir = ROOT, acc = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (isExcluded(rel)) continue;
    if (e.isDirectory()) await walk(abs, acc);
    else acc.push(rel);
  }
  return acc;
}

/** স্টেজিং ডিরেক্টরিতে পথ অক্ষত রেখে কপি */
async function stage(files, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `uidtopup-${label}-`));
  for (const rel of files) {
    const dest = path.join(dir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(ROOT, rel), dest);
  }
  return dir;
}

/**
 * ★ শেষ প্রতিরক্ষা — স্টেজিং গাছে কোনো `.env*` (example ছাড়া) থাকলে
 *   zip বানানোই হবে না। বাদ-তালিকায় ভুল হলেও সিক্রেট বেরোবে না।
 */
async function assertNoSecrets(dir) {
  const found = [];
  const scan = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { await scan(abs); continue; }
      if ((e.name.startsWith('.env') && e.name !== '.env.example') || /\.(pem|key|p12|pfx)$/i.test(e.name)) {
        found.push(path.relative(dir, abs));
      }
    }
  };
  await scan(dir);
  if (found.length) {
    console.error('\n✗ থামানো হলো — স্টেজিং গাছে সিক্রেট ফাইল পাওয়া গেছে:');
    for (const f of found) console.error(`    ${f}`);
    console.error('  zip বানানো হয়নি।');
    process.exit(1);
  }
}

function zipDir(srcDir, outFile) {
  if (existsSync(outFile)) return { ok: false, err: `${outFile} আগে থেকেই আছে` };
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${outFile}' -Force`],
        { encoding: 'utf8' })
    : spawnSync('zip', ['-rq', outFile, '.'], { cwd: srcDir, encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, err: (r.stderr || r.stdout || '').trim() || `exit ${r.status}` };
  return { ok: true };
}

const human = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

(async () => {
  console.log('═══ ডেলিভারি প্যাকেজিং ═══\n');
  await fs.mkdir(OUT_DIR, { recursive: true });

  const all = await walk();
  console.log(`  প্রজেক্ট ফাইল (বাদ-তালিকার পর) : ${all.length}`);

  // ── CHANGED ──
  let changed = null;
  const since = arg('since'), manifest = arg('manifest'), filesArg = arg('files');

  if (!has('full-only')) {
    if (filesArg) {
      changed = filesArg.split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
    } else if (manifest) {
      const txt = await fs.readFile(path.resolve(ROOT, manifest), 'utf8');
      changed = txt.split(/\r?\n/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
    } else if (since) {
      // ★ `YYYY-MM-DD` কে **স্থানীয়** মধ্যরাত ধরি, UTC নয়।
      //   `new Date('2026-08-07')` UTC মধ্যরাত দেয়; বাংলাদেশ UTC+6 বলে
      //   সেটি স্থানীয় সকাল ৬টা — অর্থাৎ ওই সকালের নিজের কাজই বাদ
      //   পড়ে যেত, আর ব্যবহারকারী টের পেতেন না।
      const dOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since);
      const cut = dOnly
        ? new Date(Number(dOnly[1]), Number(dOnly[2]) - 1, Number(dOnly[3])).getTime()
        : new Date(since).getTime();
      if (Number.isNaN(cut)) { console.error(`✗ --since তারিখ পার্স হয়নি: ${since}`); process.exit(1); }
      console.log(`  কাট-অফ (স্থানীয়) : ${new Date(cut).toLocaleString()}`);
      changed = [];
      for (const rel of all) {
        const st = await fs.stat(path.join(ROOT, rel));
        if (st.mtimeMs >= cut) changed.push(rel);
      }
      console.log(`  --since=${since} → ${changed.length} টি ফাইল`);
    }
  }

  if (changed) {
    // বাদ-তালিকা ও অস্তিত্ব — ব্যবহারকারীর দেওয়া তালিকাতেও প্রযোজ্য
    const bad = changed.filter((f) => isExcluded(f));
    if (bad.length) {
      console.error('\n✗ থামানো হলো — তালিকায় বাদ-তালিকাভুক্ত ফাইল আছে:');
      for (const f of bad) console.error(`    ${f}`);
      process.exit(1);
    }
    const missing = changed.filter((f) => !existsSync(path.join(ROOT, f)));
    if (missing.length) {
      console.error('\n✗ থামানো হলো — এই ফাইলগুলো নেই:');
      for (const f of missing) console.error(`    ${f}`);
      process.exit(1);
    }
  }

  const jobs = [];
  if (changed && changed.length) jobs.push({ label: 'CHANGED', files: changed });
  else if (changed) console.log('  ⚠️ CHANGED তালিকা ফাঁকা — ওই zip বানানো হবে না');
  else console.log('  ℹ️ --since/--manifest/--files দেওয়া হয়নি → কেবল FULL zip');
  jobs.push({ label: 'FULL', files: all });

  for (const { label, files } of jobs) {
    const dir = await stage(files, label);
    await assertNoSecrets(dir);
    const out = path.join(OUT_DIR, `uidtopup-${label}-${STAMP}.zip`);
    const r = zipDir(dir, out);
    await fs.rm(dir, { recursive: true, force: true });
    if (!r.ok) { console.error(`\n✗ ${label} zip ব্যর্থ — ${r.err}`); process.exit(1); }
    const size = (await fs.stat(out)).size;
    console.log(`  ✓ ${label.padEnd(7)} ${files.length} ফাইল · ${human(size)} → release/${path.basename(out)}`);
  }

  console.log('\n  ✓ কোনো .env* zip-এ যায়নি (স্টেজিং যাচাই পাস)।');
})();
