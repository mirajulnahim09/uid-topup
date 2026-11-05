/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ M3 — theme-bridge ব্লকের কোন নির্বাচকটি আসলে ব্যবহৃত হয়?
 *
 *     node scripts/audit/m3-bridge-usage.mjs
 *
 *   CLAUDE.md §3.3 (M3) বলে ব্লকটি **ধীরে ধীরে** ছোট করতে হবে,
 *   একবারে মুছে নয়। কোনটি নিরাপদে যেতে পারে তা জানার একমাত্র উপায়
 *   গুনে দেখা — অনুমান করে নয়। যে ক্লাস `src/` এ একবারও নেই, তার
 *   নিয়মটি প্রতিটি ব্যবহারকারীর কাছে যায় অথচ কিছুই করে না।
 *
 *   ⚠️ গণনাটি স্ট্যাটিক। সেটি বৈধ **কেবল যদি** কোডে জোড়া-লাগানো
 *   ক্লাস-নাম না থাকে (`'text-gray-' + shade`)। স্ক্রিপ্টটি সেটিও
 *   পরীক্ষা করে, আর পেলে জোরে সতর্ক করে — নাহলে ফলটি মিথ্যা
 *   আত্মবিশ্বাস দিত।
 *
 *   ⚠️ নিয়ম **একাধিক লাইনে** ছড়াতে পারে (L772–774 এর মতো)। প্রথম
 *   সংস্করণটি লাইন-ভিত্তিক ছিল আর ঐ নিয়মের ১০টি ক্লাস গুনতেই ভুলে
 *   গিয়েছিল — তাই এখানে `{` পর্যন্ত পুরো নির্বাচক-তালিকা জোড়া হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const CSS = 'src/app/globals.css';
const css = readFileSync(CSS, 'utf8');

/**
 * ব্লকটি কেটে নিই — শিরোনাম-মন্তব্য **শেষ হওয়ার পর** থেকে, পরের
 * শিরোনাম-মন্তব্য **শুরুর আগে** পর্যন্ত।
 *
 * ⚠️ এই সীমানা দুটি ইচ্ছাকৃত, আর প্রথম সংস্করণে ভুল ছিল: শিরোনাম
 *   দুটিই মন্তব্যের **ভিতরে** বসে, তাই `indexOf('THEME BRIDGE')`
 *   থেকে কাটলে টুকরোটি শুরু হতো একটি মন্তব্যের মাঝখানে — খোলার
 *   `/*` বাইরে থেকে যেত, ফলে মন্তব্য-মোছার regex ঐ অংশটি ধরত না।
 *   পরিণামে মন্তব্যের ভিতরের `CLAUDE.md` থেকে `.md` একটি **ভুয়া
 *   ক্লাস** হিসেবে গোনা হতো (৯২ বার "ব্যবহৃত")। সংখ্যাটি এক বেশি
 *   দেখাত — ১১৫, আসলে ১১৪।
 */
const marker = css.indexOf('THEME BRIDGE');
const nextMarker = css.indexOf('TYPOGRAPHY & ALIGNMENT', marker);
if (marker < 0 || nextMarker < 0) {
  console.error('✗ theme-bridge ব্লক খুঁজে পাওয়া যায়নি — globals.css এর শিরোনাম বদলেছে?');
  process.exit(1);
}
const commentEnd = css.indexOf('*/', marker);
const start = commentEnd >= 0 ? commentEnd + 2 : marker;
const end = css.lastIndexOf('/*', nextMarker);
const block = css.slice(start, end);
const lineOf = (idx) => css.slice(0, start + idx).split('\n').length;

/** মন্তব্য বাদ দিয়ে প্রতিটি `নির্বাচক { ঘোষণা }` — নির্বাচক বহু-লাইন হতে পারে */
const rules = [];
for (const m of block.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length)).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const classes = [...m[1].matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((x) => x[1]);
  if (classes.length) rules.push({ line: lineOf(m.index), classes, decl: m[2].trim() });
}

/** src/ এর প্রতিটি উৎস ফাইল এক জায়গায় */
const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts|jsx|js)$/.test(e.name)) files.push(p);
  }
})('src');
const blob = files.map((f) => readFileSync(f, 'utf8')).join('\n');

/** ★ জোড়া-লাগানো ক্লাস থাকলে স্ট্যাটিক গণনা অর্থহীন — আগে সেটি দেখি */
const DYNAMIC = /['"`](?:text|bg|border|divide)-(?:slate|gray|zinc|rose|red|emerald|green|amber|yellow|orange|blue|sky|indigo|purple|violet|pink|teal)-['"`]|`(?:text|bg|border|divide)-\$\{/;
const dynamic = DYNAMIC.test(blob);

const count = (cls) => (blob.match(new RegExp(`(?<![\\w-])${cls}(?![\\w-])`, 'g')) || []).length;

let deadRules = 0, deadSel = 0, totalSel = 0;
const deadList = [];
for (const r of rules) {
  const used = r.classes.map((c) => [c, count(c)]);
  const live = used.filter(([, n]) => n > 0);
  const dead = used.filter(([, n]) => n === 0).map(([c]) => c);
  totalSel += r.classes.length;
  deadSel += dead.length;
  deadList.push(...dead);
  if (!live.length) {
    deadRules++;
    console.log(`L${r.line}  ☠ পুরো নিয়মটি মৃত  { ${r.decl} }`);
    console.log(`      ${r.classes.join(', ')}`);
  } else {
    console.log(`L${r.line}  ✔ ${live.length}/${r.classes.length}  { ${r.decl} }`);
    console.log(`      জীবিত: ${live.map(([c, n]) => `${c}(${n})`).join(', ')}`);
    if (dead.length) console.log(`      মৃত  : ${dead.join(', ')}`);
  }
}

console.log('\n─────────────────────────────────────');
console.log(`  নিয়ম      : ${rules.length} — সম্পূর্ণ মৃত ${deadRules}`);
console.log(`  নির্বাচক  : ${totalSel} — অব্যবহৃত ${deadSel} (${Math.round((deadSel / totalSel) * 100)}%)`);
/**
 * ⚠️ মন্তব্য বাদ দিয়ে গোনা — নাহলে সংখ্যাটি মিথ্যা।
 *   ধরা পড়েছিল হাতে-নাতে: ব্লকটি ছোট করার সময় যোগ করা মন্তব্যেই
 *   "একটিও নতুন `!important` যোগ হয়নি" লেখা ছিল, আর কাঁচা গণনা
 *   সেটিকেও একটি ঘোষণা হিসেবে গুনছিল — একটি পুরো নিয়ম সরানোর পরেও
 *   সংখ্যা ৬৯-এ আটকে ছিল। (`scripts/verify/theme-contrast.ts` এই
 *   শিক্ষাটি আগেই পেয়েছে — সেখানেও মন্তব্য বাদ দিয়ে গোনা হয়।)
 */
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
console.log(`  মোট !important (গোটা ফাইলে): ${(cssNoComments.match(/!important/g) || []).length}`);
if (dynamic) {
  console.log('\n  ⚠️⚠️ জোড়া-লাগানো ক্লাস-নাম পাওয়া গেছে — উপরের "মৃত" তালিকা');
  console.log('        বিশ্বাস করবেন না, স্ট্যাটিক গণনা সেগুলো দেখে না।');
} else {
  console.log('\n  ✓ কোনো জোড়া-লাগানো ক্লাস-নাম নেই — গণনা নির্ভরযোগ্য।');
}
