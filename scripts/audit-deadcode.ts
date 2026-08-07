/**
 * ★ মৃত-কোড স্ক্যান — কোন কম্পোনেন্ট/lib কোথাও import হয় না।
 *
 * ⚠️ এটি **রিপোর্ট** করে, নিজে কিছু মোছে না। Next.js-এ কিছু ফাইল
 *    নাম দিয়েই যুক্ত হয় (page/layout/route/manifest/sitemap...),
 *    সেগুলো import না হলেও মৃত নয় — তাই আলাদা করে বাদ দেওয়া হয়েছে।
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, basename } from 'path';

const ROOT = 'src';
const files: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
})(ROOT);

// Next-এর ফ্রেমওয়ার্ক-এন্ট্রি — নাম দিয়েই যুক্ত হয়
const FRAMEWORK = /(^|[\\/])(page|layout|route|loading|error|not-found|template|default|middleware|manifest|sitemap|robots|icon|opengraph-image)\.(ts|tsx)$/;

const corpus = new Map<string, string>();
for (const f of files) corpus.set(f, readFileSync(f, 'utf8'));

const unused: string[] = [];
for (const f of files) {
  if (FRAMEWORK.test(f)) continue;
  const name = basename(f).replace(/\.(ts|tsx)$/, '');
  const rel = relative(ROOT, f).replace(/\\/g, '/').replace(/\.(ts|tsx)$/, '');
  const alias = `@/${rel}`;
  let referenced = false;
  for (const [g, src] of corpus) {
    if (g === f) continue;
    if (src.includes(alias) || new RegExp(`from ['"][^'"]*/${name}['"]`).test(src)
      || new RegExp(`from ['"]\\./${name}['"]`).test(src)) { referenced = true; break; }
  }
  if (!referenced) unused.push(rel);
}

console.log(`\n═══ DEAD CODE SCAN ═══`);
console.log(`  files scanned: ${files.length}`);
console.log(`  never imported: ${unused.length}`);
unused.sort().forEach((u) => console.log(`   • src/${u}`));
