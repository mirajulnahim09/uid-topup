/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অস্থির (flaky) টেস্ট খোঁজা — `npm run test:flaky [রান-সংখ্যা]`
 *
 *   ── কেন ──
 *   ২০২৬-০৮-১১: ৪টি রানের একটিতে ১৭৭-এর মধ্যে ২টি ব্যর্থ হয়েছিল,
 *   নাম ধরা পড়েনি। "সম্ভবত ফ্লেক" বলে ছেড়ে দেওয়া যায় না —
 *   **টাকার পথে বিক্ষিপ্ত ব্যর্থতা প্রমাণ না হওয়া পর্যন্ত race
 *   condition**। একই স্যুট বহুবার চালিয়ে দেখা হয় কোন নামগুলো
 *   অস্থির, আর কত ভাগ রানে।
 *
 *   প্রতিটি রান পূর্ণ `npm test` — নতুন `next dev`, নতুন `db push`।
 *   ইচ্ছাকৃতভাবে `vitest --repeat` নয়: সেটি একই প্রসেসে টেস্ট
 *   পুনরাবৃত্তি করে, তাই প্রসেস-চালুর সময় ও রান-জুড়ে জমা হওয়া
 *   অবস্থার (সংযোগ পুল, বাকেট, compile ক্যাশ) কারণে হওয়া race
 *   গুলো ধরাই পড়ত না — অথচ আসল ব্যর্থতাটি ঠিক সেভাবেই এসেছিল।
 * ═══════════════════════════════════════════════════════════
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const RESULTS_FILE = '.vitest-results.json';
const RUNS = Number(process.argv[2] || 10);

if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 100) {
  console.error('\n✗ রান-সংখ্যা ১–১০০ এর মধ্যে হতে হবে।\n');
  process.exit(1);
}

/** ★ test-run.mjs এর লেখা JSON থেকে ব্যর্থ টেস্টের পূর্ণ নাম */
function failedFromResults() {
  if (!existsSync(RESULTS_FILE)) return null;
  let json;
  try {
    json = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
  } catch {
    return null;
  }
  const out = [];
  // ⚠️ উইন্ডোজ পাথ-স্ল্যাশ স্বাভাবিককরণ — নইলে absolute পাথ ছাপা হয়
  const cwd = process.cwd().replace(/\\/g, '/');
  for (const suite of json.testResults ?? []) {
    const rel = (suite.name || '').replace(/\\/g, '/').replace(cwd, '').replace(/^\//, '');
    for (const t of suite.assertionResults ?? []) {
      if (t.status === 'failed') {
        out.push({
          name: `${rel} › ${t.fullName || t.title}`,
          message: (t.failureMessages?.[0] || '').split('\n').slice(0, 3).join(' | ').slice(0, 300),
        });
      }
    }
  }
  return out;
}

/** নাম → { count, messages:Set, runs:[] } */
const tally = new Map();
const runSummary = [];

console.log(`\n═══ অস্থিরতা যাচাই — ${RUNS}টি পূর্ণ রান ═══\n`);

for (let i = 1; i <= RUNS; i++) {
  rmSync(RESULTS_FILE, { force: true });

  const started = Date.now();
  const r = spawnSync(process.execPath, ['scripts/test-run.mjs'], {
    stdio: ['ignore', 'ignore', 'ignore'], // ★ আউটপুট JSON থেকেই নিই
    env: process.env,
  });
  const secs = Math.round((Date.now() - started) / 1000);

  const failed = failedFromResults();

  if (failed === null) {
    // ⚠️ নীরবে গোনা যাবে না — হারনেস নিজেই ভেঙেছে
    runSummary.push({ run: i, secs, status: 'HARNESS', n: 0 });
    console.log(`  রান ${String(i).padStart(2)}/${RUNS}  ${String(secs).padStart(4)}s  ⚠️ ফলাফল ফাইল নেই (exit ${r.status})`);
    continue;
  }

  for (const f of failed) {
    const e = tally.get(f.name) ?? { count: 0, messages: new Set(), runs: [] };
    e.count++;
    e.runs.push(i);
    if (f.message) e.messages.add(f.message);
    tally.set(f.name, e);
  }

  runSummary.push({ run: i, secs, status: failed.length ? 'FAIL' : 'PASS', n: failed.length });
  console.log(
    `  রান ${String(i).padStart(2)}/${RUNS}  ${String(secs).padStart(4)}s  ` +
      (failed.length ? `✗ ${failed.length}টি ব্যর্থ` : '✓ সবুজ'),
  );
}

// ── ফল ──
const green = runSummary.filter((r) => r.status === 'PASS').length;
const red = runSummary.filter((r) => r.status === 'FAIL').length;
const broken = runSummary.filter((r) => r.status === 'HARNESS').length;

console.log(`\n═══ ফল ═══\n`);
console.log(`  সবুজ রান   : ${green}/${RUNS}`);
console.log(`  লাল রান    : ${red}/${RUNS}`);
if (broken) console.log(`  হারনেস ত্রুটি: ${broken}/${RUNS}`);

if (tally.size === 0) {
  console.log(`\n  ✓ ${RUNS}টি রানের একটিতেও কোনো টেস্ট ব্যর্থ হয়নি।\n`);
  process.exit(broken ? 1 : 0);
}

console.log(`\n  অস্থির টেস্ট — ${tally.size}টি:\n`);
const sorted = [...tally.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [name, e] of sorted) {
  console.log(`  ✗ ${e.count}/${RUNS} রানে ব্যর্থ  (রান: ${e.runs.join(', ')})`);
  console.log(`    ${name}`);
  for (const m of e.messages) console.log(`    ↳ ${m}`);
  console.log('');
}

console.log('  ⚠️ টাকার পথের কোনো টেস্ট এখানে থাকলে সেটি ফ্লেক নয় —\n' +
            '     প্রমাণ না হওয়া পর্যন্ত race condition ধরে তদন্ত করুন।\n');
process.exit(1);
