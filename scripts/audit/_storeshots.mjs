/**
 * স্টোরফ্রন্টের কনট্রাস্ট-সংশোধনের **দৃশ্য**-যাচাই।
 *
 * `storefront-contrast.ts` প্রমাণ করে সংখ্যাগুলো ঠিক; এই স্ক্রিপ্টটি
 * দেখায় **চোখে কেমন**। দুটি জিনিস আলাদা, আর আগের সেশনগুলোতে ঠিক
 * এখানেই ফাঁক থেকে গিয়েছিল (PROGRESS §"অডিট রঙ/কনট্রাস্ট মাপে না")।
 *
 * যা তোলা হয়: হোমপেজ (হিরো + প্রোডাক্ট-গ্রিড + লাইভ ফিড + UID কার্ড)
 * এবং অ্যাডমিনের অর্ডার-পাতা (গোল্ড ফিল্টার-চিপ) —
 * **২ থিম × ২ প্রস্থ**, আর হিরোটি **৫টি accent প্রিসেটেই**।
 *
 *   node scripts/audit/_storeshots.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE || 'https://localhost:3443';
const DIR = 'audit/shots';
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!CHROME) throw new Error('Chrome পাওয়া যায়নি');

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--ignore-certificate-errors'] });

async function settle(page) {
  await page.waitForSelector('#v-boot', { state: 'detached', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
}

/** থিম ও প্রিসেট বসিয়ে reload — ThemeProvider localStorage থেকেই পড়ে */
async function prefs(page, theme, accent) {
  await page.evaluate(`(function(){
    try { localStorage.setItem('theme', '${theme}'); localStorage.setItem('accent', '${accent}'); } catch (e) {}
  })()`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
}

async function shoot(page, name, full = false) {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: full });
  console.log(`  ✓ ${name}`);
}

/* ═══ ১. হোমপেজ — ২ থিম × ২ প্রস্থ ═══ */
for (const [wName, width, height] of [['mobile', 390, 844], ['desktop', 1366, 900]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  for (const theme of ['light', 'dark']) {
    await prefs(page, theme, 'lime');
    await shoot(page, `store-home-${wName}-${theme}`, true);
  }
  await ctx.close();
}

/* ═══ ২. হিরো — ৫টি প্রিসেট, লাইট ও ডার্ক ═══
   ★ এখানেই আগের ত্রুটিটি সবচেয়ে স্পষ্ট ছিল: purple প্রিসেটে
     শিরোনামের রঙ = গ্রেডিয়েন্টের হালকা স্টপ (১.০০:১)। */
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  for (const theme of ['light', 'dark']) {
    for (const accent of ['lime', 'purple', 'blue', 'red', 'orange']) {
      await prefs(page, theme, accent);
      const hero = page.locator('h1').first();
      const box = await hero.boundingBox();
      if (!box) { console.log(`  · হিরো পাওয়া গেল না (${theme}/${accent})`); continue; }
      await page.screenshot({
        path: `${DIR}/store-hero-${accent}-${theme}.png`,
        clip: { x: 0, y: Math.max(0, box.y - 150), width: 1366, height: 420 },
      });
      console.log(`  ✓ store-hero-${accent}-${theme}`);
    }
  }
  await ctx.close();
}

/* ═══ ৩. অ্যাডমিন অর্ডার-পাতা — গোল্ড ফিল্টার-চিপ ═══ */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.fill('#email', ADMIN.email);
  await page.fill('#pw', ADMIN.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await settle(page);
  for (const theme of ['light', 'dark']) {
    await page.goto(`${BASE}/admin/orders`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await prefs(page, theme, 'lime');
    await shoot(page, `store-admin-orders-${theme}`, true);
  }
  await ctx.close();
}

await browser.close();
console.log('\nশট: audit/shots/store-*.png');
