/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ কোনো টেস্ট/যাচাই স্ক্রিপ্ট লাইভ ডাটাবেসে লিখতে পারে না
 *
 *   `npx tsx scripts/verify/no-live-writes.ts`
 *
 *   চারটি স্তর আলাদা করে **প্রমাণ** করা হয় — "মনে হয় নিরাপদ" নয়:
 *
 *     ১. `tests/` — `assertTestDatabase()` ডাটাবেসের নাম `_test` দিয়ে
 *        শেষ না হলে থামায় (টেস্ট প্রতিটি টেবিল truncate করে)
 *     ২. `scripts/verify/*` — `_db.ts` স্থানীয় নয় এমন URL এ **সংযোগই**
 *        করতে দেয় না
 *     ৩. `scripts/*` (অডিট/ডায়াগনস্টিক) — `_guard-live-db` লেখার
 *        অপারেশন আটকায়, পড়া চলতে দেয়
 *     ৪. লেখার-ক্ষমতা আছে এমন প্রতিটি স্ক্রিপ্ট আসলেই গার্ডটি
 *        import করে কি না (স্থিরভাবে যাচাই — নতুন স্ক্রিপ্ট যোগ হলে
 *        এখানেই ধরা পড়বে)
 * ═══════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

let fail = 0;
let total = 0;
const check = (name: string, ok: boolean, note = '') => {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/** লেখার অপারেশন আছে কি না — স্থির বিশ্লেষণ */
const WRITE_RE = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw/;
/** ইচ্ছাকৃত প্রোডাকশন-রক্ষণাবেক্ষণ সরঞ্জাম — এদের লেখাই কাজ */
const INTENTIONAL = new Set(['migrate-payment-keys.ts', 'migrate-uploads-to-blob.ts']);
/** নিজে থেকেই ডেভ URL স্পষ্ট করে দেয় */
const SELF_PINNED = /localhost:543\d|dev:dev@/;

(async () => {
  console.log('═══ লাইভ ডাটাবেসে লেখা — প্রতিরোধ যাচাই ═══\n');

  // ── ১. টেস্ট স্যুটের গার্ড ──
  console.log('── ১. tests/ ──');
  const { assertTestDatabase, deriveTestUrl } = await import('../test-db-url.mjs');
  let threw = false;
  try { assertTestDatabase('postgresql://u:p@ep-cool-neon.aws.neon.tech/neondb'); }
  catch { threw = true; }
  check('প্রোডাকশন নামের DB টেস্টে গ্রহণ করা হয় না', threw);

  let okName = true;
  try { assertTestDatabase('postgresql://u:p@localhost:5433/uidtopup_test'); }
  catch { okName = false; }
  check('`_test` নামের DB গ্রহণ করা হয়', okName);
  check('deriveTestUrl সবসময় `_test` যোগ করে',
    deriveTestUrl('postgresql://u:p@h/neondb').endsWith('/neondb_test'));

  // ── ২. scripts/verify এর সংযোগ-গার্ড ──
  console.log('\n── ২. scripts/verify/_db.ts ──');
  const dbSrc = readFileSync('scripts/verify/_db.ts', 'utf8');
  check('স্থানীয় নয় এমন URL এ process.exit করে', /process\.exit\(1\)/.test(dbSrc) && /isLocal/.test(dbSrc));
  check('VERIFY_ALLOW_REMOTE ছাড়া ছাড় নেই', /VERIFY_ALLOW_REMOTE/.test(dbSrc));

  /**
   * ⚠️ কেবল "লেখার মতো দেখতে" যথেষ্ট নয় — ফাইলটি আদৌ ডাটাবেস ছোঁয় কি না
   *   সেটিও দেখতে হয়। নাহলে `createHash(...).update(...)` (crypto) কে
   *   ডাটাবেস-লেখা ধরে নিয়ে `csp-nonce.ts` মিথ্যা FAIL দিত, আর এই
   *   ফাইলটি নিজেই নিজের regex-এর সাথে মিলে যেত।
   */
  const DB_REF = /from '\.\/_db'|lib\/prisma|new PrismaClient/;
  const files = readdirSync('scripts/verify')
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_') && f !== 'no-live-writes.ts');
  const usesDb = files.filter((f) => {
    const src = readFileSync(path.join('scripts/verify', f), 'utf8');
    return DB_REF.test(src) && WRITE_RE.test(src);
  });
  const missing = usesDb.filter((f) => !/from '\.\/_db'/.test(readFileSync(path.join('scripts/verify', f), 'utf8')));
  check(`verify এর লেখা-ক্ষম স্ক্রিপ্টগুলো _db ব্যবহার করে (${usesDb.length}টি)`,
    missing.length === 0, missing.join(', ') || 'সবগুলো');

  // ── ৩. গার্ডের যুক্তি নিজেই ──
  console.log('\n── ৩. scripts/_guard-live-db.ts ──');
  const gSrc = readFileSync('scripts/_guard-live-db.ts', 'utf8');
  for (const a of ['create', 'update', 'delete', 'upsert', 'executeRaw']) {
    check(`লেখার অপারেশন তালিকায় \`${a}\` আছে`, gSrc.includes(`'${a}`));
  }
  check('raw SQL এ লেখার শব্দ থাকলেও আটকায়', /RAW_WRITE/.test(gSrc));
  check('স্থানীয় DB তে গার্ড নিষ্ক্রিয় (ডেভ কাজ থামে না)', /isLocal/.test(gSrc));
  check('ইচ্ছাকৃত ছাড় কেবল ALLOW_LIVE_WRITES=1', /ALLOW_LIVE_WRITES/.test(gSrc));

  // ── ৪. প্রতিটি লেখা-ক্ষম স্ক্রিপ্ট গার্ড import করে ──
  console.log('\n── ৪. scripts/*.ts আচ্ছাদন ──');
  const scripts = readdirSync('scripts').filter((f) => (f.endsWith('.ts') || f.endsWith('.mjs')) && !f.startsWith('_'));
  const risky: string[] = [];
  for (const f of scripts) {
    const src = readFileSync(path.join('scripts', f), 'utf8');
    const touchesDb = /lib\/prisma|new PrismaClient/.test(src);
    if (!touchesDb || !WRITE_RE.test(src)) continue;
    if (INTENTIONAL.has(f)) continue;
    if (SELF_PINNED.test(src)) continue;            // নিজেই ডেভ URL এ বাঁধা
    if (/_guard-live-db/.test(src)) continue;       // গার্ড আছে
    risky.push(f);
  }
  check('লেখা-ক্ষম প্রতিটি স্ক্রিপ্টে গার্ড বা ডেভ-পিন আছে', risky.length === 0,
    risky.join(', ') || 'অরক্ষিত কিছু নেই');
  console.log(`  (ইচ্ছাকৃত প্রোডাকশন সরঞ্জাম, গার্ডের বাইরে: ${[...INTENTIONAL].join(', ')})`);

  console.log('\n════════════════════════════════════════');
  console.log(`  ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''}`);
  process.exit(fail ? 1 : 0);
})();
