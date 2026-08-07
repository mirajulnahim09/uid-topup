/**
 * ═══════════════════════════════════════════════════════════
 * ★ একটিই দৃশ্যমান (headed) ব্রাউজার — পুরো সেশনজুড়ে পুনঃব্যবহার
 *
 *   `npx tsx scripts/pw-server.ts`   ← ব্যাকগ্রাউন্ডে চালু রাখুন
 *
 *   ws endpoint `ws.txt`-এ লেখা হয়; অন্য স্ক্রিপ্ট
 *   `chromium.connect(readFileSync('ws.txt','utf8'))` দিয়ে যুক্ত হয়।
 *   প্রতিটি যাচাইয়ের জন্য নতুন ব্রাউজার না খুলে একটিই জানালা থাকে।
 * ═══════════════════════════════════════════════════════════
 */
import { chromium } from 'playwright-core';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

(async () => {
  const server = await chromium.launchServer({
    headless: false,
    ...(exe ? { executablePath: exe } : {}),
    args: ['--window-size=1440,900'],
  });
  const ws = server.wsEndpoint();
  writeFileSync(path.join(process.cwd(), 'ws.txt'), ws, 'utf8');
  console.log(`headed browser ready\n  ws.txt ← ${ws}`);
  // জানালা খোলা রাখে — সেশনের বাকি যাচাইগুলো এতেই চলবে
  setInterval(() => {}, 1 << 30);
})();
