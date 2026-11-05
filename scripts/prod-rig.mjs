/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ প্রোডাকশন যাচাই-রিগ এক কমান্ডে
 *
 *     node scripts/prod-rig.mjs        # https://localhost:3443
 *
 *   এতদিন এই রিগটি **হাতে** চালু করা হতো — `next start` এক টার্মিনালে,
 *   `prod-https.mjs` আরেকটিতে, আর ডেভ-DB এর env মনে করে বসাতে হতো।
 *   তিনটি ধাপের যেকোনো একটি ভুলে গেলে ফল হতো নীরব ও ব্যয়বহুল:
 *     • env ভুলে গেলে `next start` **`.env` (লাইভ Neon)** ধরত —
 *       যাচাই-স্ক্রিপ্ট লাইভ ডাটাবেসে সারি লিখত;
 *     • TLS স্তর ভুলে গেলে `__Secure-` কুকি সংরক্ষিতই হতো না, আর
 *       প্রতিটি সুরক্ষিত পাতা `/login` এ ফিরত — "অ্যাপ ভাঙা" মনে হতো।
 *
 *   তাই ধাপগুলো এখানে বাঁধা, আর সবচেয়ে গুরুত্বপূর্ণ অংশটি একটি
 *   **গার্ড**: DATABASE_URL লোকালহোস্ট না হলে রিগ চালুই হয় না।
 *
 *   ⚠️ আগে `npm run build`, আর `next dev` **বন্ধ** থাকতে হবে —
 *   দুটি প্রসেস একই `.next` ফোল্ডার ভাগ করে নিতে পারে না।
 * ═══════════════════════════════════════════════════════════
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const HTTP_PORT = Number(process.env.PROD_HTTP_PORT || 3100);
const HTTPS_PORT = Number(process.env.PROD_HTTPS_PORT || 3443);

/** `.env.development` পড়ে env-এ বসায় — মান কখনো ছাপা হয় না (§2.3) */
function loadDevEnv() {
  const f = path.join(process.cwd(), '.env.development');
  if (!existsSync(f)) return [];
  const keys = [];
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
    keys.push(m[1]);
  }
  return keys;
}

const keys = loadDevEnv();

/**
 * ★★★ গার্ড — যাচাই কখনো লাইভ ডাটাবেসে চলবে না।
 *   `scripts/verify/_guard-live-db.ts` এর সাথে একই নীতি: হোস্ট
 *   লোকালহোস্ট হতে **হবে**, নাহলে থেমে যাও।
 */
const url = process.env.DATABASE_URL || '';
let host = '';
try { host = new URL(url).hostname; } catch { /* খালি/অবৈধ */ }
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(
    `✗ DATABASE_URL লোকালহোস্ট নয় (হোস্ট: ${host || 'অজানা'}) — রিগ চালু করা হলো না।\n` +
    `  ডেভ DB চালু করুন: npm run dev:db:up  (তারপর .env.development এ DATABASE_URL)`,
  );
  process.exit(1);
}

/**
 * ★★★ preflight — পোর্ট দুটি খালি কি না।
 *
 *   ── কোন সমস্যাটি এটি ঠেকায় (মাপা, ২০২৬-০৮-৩০) ──
 *   উইন্ডোজে wrapper প্রসেস kill করলে `next start` ও প্রক্সি
 *   **child হিসেবে বেঁচে থাকে**। ফলে পরের রানে:
 *     ১. নতুন প্রক্সি `EADDRINUSE` পেয়ে মরে,
 *     ২. `proxy.on('exit')` পুরো নতুন রিগকে নামিয়ে দেয়,
 *     ৩. কিন্তু **পুরনো** রিগ তখনো সাড়া দেয়, তাই যাচাই-স্ক্রিপ্ট
 *        "সার্ভার প্রস্তুত" দেখে শুরু করে,
 *     ৪. পুরনোটি পরে মরলেই মাঝপথে `ERR_CONNECTION_REFUSED`।
 *
 *   এই ধাঁধাটিই PROGRESS.md-এ তিনবার "রিগ নীরবে মরল" হিসেবে লেখা
 *   আছে — কারণ ব্যর্থতাটি দেখা যেত ভুল জায়গায়। এখন রিগ **শুরুতেই**
 *   স্পষ্ট বার্তা দিয়ে থামে, আর কোন PID দখলে তা-ও বলে দেয়।
 */
async function assertPortFree(port) {
  const { createServer } = await import('node:net');
  await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(
          `✗ পোর্ট ${port} ইতিমধ্যেই দখলে — পুরনো একটি রিগ বেঁচে আছে।
` +
          `  দেখুন : netstat -ano | findstr :${port}
` +
          `  মারুন : powershell Stop-Process -Id <PID> -Force`,
        );
        process.exit(1);
      }
      reject(e);
    });
    srv.once('listening', () => srv.close(() => resolve()));
    // ⚠️ host **দেওয়া হয় না** — প্রক্সি `::` (dual-stack) তে bind করে।
    //   `0.0.0.0` দিলে Windows-এ দুটি স্ট্যাক আলাদা গণ্য হয়, তাই
    //   পোর্ট দখলে থাকলেও bind সফল হতো — গার্ডটি কাজই করত না।
    srv.listen(port);
  });
}
await assertPortFree(HTTP_PORT);
await assertPortFree(HTTPS_PORT);

process.env.NEXTAUTH_URL = `https://localhost:${HTTPS_PORT}`;
process.env.PORT = String(HTTP_PORT);

console.log(`▲ প্রোডাকশন রিগ`);
console.log(`  env      : .env.development থেকে ${keys.length}টি কী (${keys.join(', ')})`);
console.log(`  ডাটাবেস  : ${host} — লাইভ নয় ✓`);
console.log(`  next start: 127.0.0.1:${HTTP_PORT}`);
console.log(`  https     : https://localhost:${HTTPS_PORT}\n`);

const next = spawn(process.execPath, [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(HTTP_PORT), '-H', '127.0.0.1'], {
  stdio: 'inherit',
  env: process.env,
});
const proxy = spawn(process.execPath, [path.join('scripts', 'prod-https.mjs')], {
  stdio: 'inherit',
  env: process.env,
});

const stop = () => { next.kill(); proxy.kill(); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
next.on('exit', (c) => { proxy.kill(); process.exit(c ?? 0); });
proxy.on('exit', (c) => { next.kill(); process.exit(c ?? 0); });
