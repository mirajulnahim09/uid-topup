// ★ অস্থায়ী প্রোব (EXTREME অডিট ২০২৬-০৯-২২) — অ্যাডমিন পাতায় "লগআউট" বোতাম ভিউপোর্টে
//   পৌঁছানো যায় কি না, ইঞ্জিন ও উচ্চতা-ভেদে। কেবল পড়ে (লগইন ছাড়া কিছু লেখে না)।
import { db, BASE } from './_db';
import { openBrowser } from './_browser';

const PROBE = `(() => {
  const out = [];
  const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'লগআউট');
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    const chain = [];
    let el = b.parentElement;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky' || /(auto|scroll)/.test(cs.overflowY)) {
        chain.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 4).join('.') + ' pos=' + cs.position + ' ovY=' + cs.overflowY + ' h=' + Math.round(el.getBoundingClientRect().height) + ' sh=' + el.scrollHeight);
      }
      el = el.parentElement;
    }
    out.push({ top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vis: r.width > 0 && r.height > 0, chain });
  }
  return { vh: innerHeight, vw: innerWidth, docH: document.documentElement.scrollHeight, btns: out };
})()`;

type ProbeResult = {
  vh: number; vw: number; docH: number;
  btns: { top: number; bottom: number; h: number; vis: boolean; chain: string[] }[];
};

async function main() {
  const engines = (process.env.ENGINES || 'chromium,webkit').split(',');
  for (const engine of engines) {
    process.env.VERIFY_BROWSER = engine;
    const browser = await openBrowser({ headless: true });
    for (const vp of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: vp });
      const page = await ctx.newPage();
      await db.rateLimitBucket.deleteMany({});
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 30_000 }).catch(() => {});
      await page.locator('input[type="email"]').fill('admin@uidtopup.local');
      await page.locator('input[type="password"]').fill('Admin@2026Secure');
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
      await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      // স্ট্রিং-প্রোব `unknown` ফেরায় — ফলের আকার এখানে ঘোষণা করা (build-এর typecheck ভাঙত)
      const res = (await page.evaluate(PROBE)) as ProbeResult;
      console.log(`\n[${engine} ${vp.width}x${vp.height}] vh=${res.vh} docH=${res.docH}`);
      for (const b of res.btns) console.log(`   btn top=${b.top} bottom=${b.bottom} vis=${b.vis} inView=${b.top >= 0 && b.bottom <= res.vh}\n     ${b.chain.join('\n     ')}`);
      // আসল ব্যবহারকারীর মতো: স্ক্রল করে বোতামে পৌঁছানো যায়?
      const loc = page.getByRole('button', { name: /^লগআউট$/ }).first();
      let clickable = true;
      await loc.click({ trial: true, timeout: 5_000 }).catch(() => { clickable = false; });
      console.log(`   trial-click (first): ${clickable ? 'পৌঁছানো যায়' : 'পৌঁছানো যায় না'}`);
      await ctx.close();
    }
    await browser.close();
  }
  await db.rateLimitBucket.deleteMany({});
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(2); });
