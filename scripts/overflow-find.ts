import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { chromium } from 'playwright-core';
import { existsSync } from 'fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync)!;
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const TARGETS = (process.argv[2] || '/admin/tools').split(',');

(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  await db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
  await db.$disconnect();

  const b = await chromium.launch({ headless: true, executablePath: exe });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', EMAIL);
  await p.fill('input[type="password"]', PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 });

  for (const t of TARGETS) {
    await p.goto('http://localhost:3000' + t, { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(800);
    // ★ `--expand` — গোটানো প্যানেল খুলে তবেই মাপা। কিছু ওভারফ্লো
    //   কেবল প্যানেল খোলা অবস্থাতেই দেখা দেয়।
    if (process.argv.includes('--expand')) {
      await p.evaluate(`(function () {
        document.querySelectorAll('details:not([open])').forEach(function (d) { d.open = true; });
        var b = document.querySelectorAll('[aria-expanded="false"]');
        for (var i = 0; i < b.length && i < 25; i++) {
          var l = (b[i].getAttribute('aria-label') || '') + ' ' + (b[i].className || '');
          if (/মেনু|menu|drawer|নোটিফিকেশন/i.test(l)) continue;
          try { b[i].click(); } catch (e) {}
        }
      })()`).catch(() => {});
      await p.waitForTimeout(900);
    }
    const r = await p.evaluate(`(function () {
      var vw = document.documentElement.clientWidth;
      var out = [];
      document.querySelectorAll('body *').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        var cs = getComputedStyle(el);
        if (cs.position === 'fixed') return;
        if (r.right > vw + 1) {
          // সবচেয়ে ভেতরের অপরাধী চাই — যার কোনো সন্তান নিজে উপচে পড়ছে না
          var childOver = false;
          for (var i = 0; i < el.children.length; i++) {
            var cr = el.children[i].getBoundingClientRect();
            if (cr.right > vw + 1) { childOver = true; break; }
          }
          if (!childOver) {
            out.push({
              tag: el.tagName,
              cls: String(el.className).slice(0, 70),
              text: (el.textContent || '').trim().slice(0, 40),
              right: Math.round(r.right), w: Math.round(r.width), vw: vw,
              overflowX: cs.overflowX, minW: cs.minWidth, ws: cs.whiteSpace
            });
          }
        }
      });
      return { vw: vw, scrollW: document.documentElement.scrollWidth, offenders: out.slice(0, 8) };
    })()`);
    console.log('\n' + t, JSON.stringify(r, null, 1));
  }
  await b.close();
})();
