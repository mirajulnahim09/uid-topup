/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অ্যাক্সেসিবিলিটি স্ক্যান (চূড়ান্ত অডিট, ২০২৬-০৯-১৭)
 *
 *   প্রতিটি মূল পাতায় (অতিথি · গ্রাহক · অ্যাডমিন) আসল DOM থেকে:
 *     ১. নামহীন ইন্টারঅ্যাকটিভ উপাদান — স্ক্রিন-রিডার যা "বোতাম" ছাড়া
 *        কিছু বলতে পারে না (aria-label/labelledby/লেখা/title/label[for]/alt)
 *     ২. `<html lang>` আছে কি না
 *     ৩. ডুপ্লিকেট `id` — `label[for]` ও `aria-describedby` ভুল উপাদানে যায়
 *     ৪. কীবোর্ড: Tab চাপলে ফোকাস **দেখা যায়** কি না (outline/box-shadow)
 *
 *   ⚠️ স্বয়ংক্রিয় স্ক্যান কেবল নির্ণয়যোগ্য ত্রুটি ধরে — "অর্থবোধক নাম"
 *   বা পাঠক্রম মানুষের বিচার চায়। তাই এটি সর্বনিম্ন মান, সম্পূর্ণ অডিট নয়।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/a11y-scan.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE } from './_db';
import { openBrowser } from './_browser';
import type { BrowserContext } from 'playwright-core';

let total = 0;
let fail = 0;
function check(name: string, ok: boolean, note = '') {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

/**
 * ⚠️ স্ট্রিং, ফাংশন নয় — tsx (esbuild keepNames) ভেতরের নামযুক্ত ফাংশনে
 *   `__name()` বসায়, যা ব্রাউজারে নেই: `ReferenceError: __name is not defined`।
 *   `page.evaluate(string)` CDP দিয়ে যায়, তাই পাতার CSP-ও একে আটকায় না।
 */
const SCAN = `(() => {
  var visible = function (el) {
    var r = el.getBoundingClientRect(); var cs = getComputedStyle(el);
    // content of a closed <details> (outside its <summary>) is not rendered: innerText is ""
    // there although the box still reports a size, which read as an unnamed control
    var closed = el.closest("details:not([open])");
    if (closed && !el.closest("summary")) return false;
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  var nameOf = function (el) {
    var aria = el.getAttribute("aria-label"); if (aria && aria.trim()) return aria.trim();
    var lb = el.getAttribute("aria-labelledby");
    if (lb) {
      var t = lb.split(/\\s+/).map(function (id) { var n = document.getElementById(id); return n ? n.textContent : ""; }).join(" ").trim();
      if (t) return t;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      if (el.id) { var l = document.querySelector("label[for=\\"" + CSS.escape(el.id) + "\\"]"); if (l && l.textContent.trim()) return l.textContent.trim(); }
      var wrap = el.closest("label"); if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
      var title = el.getAttribute("title"); if (title && title.trim()) return title.trim();
      if (el.placeholder && el.placeholder.trim()) return "(placeholder) " + el.placeholder;
      if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button") && el.value) return el.value;
      return "";
    }
    var text = el.innerText ? el.innerText.trim() : ""; if (text) return text;
    var img = el.querySelector("img[alt], svg[aria-label], [role=img][aria-label]");
    var alt = img ? (img.getAttribute("alt") || img.getAttribute("aria-label")) : "";
    if (alt && alt.trim()) return alt.trim();
    var t2 = el.getAttribute("title"); return t2 ? t2.trim() : "";
  };
  var describe = function (el) {
    var cls = (typeof el.className === "string" ? el.className : "").split(/\\s+/).slice(0, 2).join(".");
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "") + (el.getAttribute("href") ? "[href=" + el.getAttribute("href") + "]" : "");
  };
  var unnamed = [];
  document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=checkbox], [role=tab], [role=switch]")
    .forEach(function (el) { if (visible(el) && !nameOf(el)) unnamed.push(describe(el)); });
  var ids = {}; document.querySelectorAll("[id]").forEach(function (el) { ids[el.id] = (ids[el.id] || 0) + 1; });
  var dupIds = Object.keys(ids).filter(function (k) { return ids[k] > 1; }).map(function (k) { return k + "×" + ids[k]; });
  return { lang: document.documentElement.lang, unnamed: unnamed, dupIds: dupIds };
})()`;

async function focusVisibleRatio(ctx: BrowserContext, path: string) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
  let seen = 0; let visibleFocus = 0; const invisible: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      return { ring, tag: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 20)}"` };
    });
    if (!r) continue;
    seen++;
    if (r.ring) visibleFocus++; else invisible.push(r.tag);
  }
  await page.close();
  return { seen, visibleFocus, invisible };
}

async function ctxFor(browser: Awaited<ReturnType<typeof openBrowser>>, email?: string, password?: string) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 800 } });
  if (email) {
    await db.rateLimitBucket.deleteMany({});
    const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
    await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
      form: { csrfToken, email, password: password ?? '', json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
    });
  }
  return ctx;
}

async function main() {
  const product = await db.product.findFirst({ where: { isActive: true }, select: { id: true, slug: true } });
  const browser = await openBrowser({ headless: true });
  const SETS = [
    { who: 'অতিথি', ctx: await ctxFor(browser), pages: ['/', '/login', '/register', '/forgot-password', '/search?q=diamond', `/product/${product?.id}/${product?.slug}`, '/track', '/contact', '/faq'] },
    { who: 'গ্রাহক', ctx: await ctxFor(browser, 'customer@uidtopup.local', 'Customer@2026Secure'), pages: ['/account', '/account/orders', '/account/profile', '/account/wallet/deposit', '/account/tickets', '/account/notifications'] },
    { who: 'অ্যাডমিন', ctx: await ctxFor(browser, 'admin@uidtopup.local', 'Admin@2026Secure'), pages: ['/admin', '/admin/orders', '/admin/deposits', '/admin/users', '/admin/products', '/admin/coupons', '/admin/site', '/admin/logs', '/admin/withdrawals'] },
  ];

  // ★ নিয়ন্ত্রণ-পরীক্ষা — "০টি নামহীন" যেন ফাঁকা মাপ না হয়: ইচ্ছাকৃত ত্রুটি
  //   বসিয়ে দেখা হয় স্ক্যানার সত্যিই ধরে কি না
  {
    const page = await SETS[0].ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.evaluate(`(() => {
      const b = document.createElement('button'); b.style.cssText = 'position:fixed;top:0;left:0;width:40px;height:40px;z-index:9999';
      b.id = 'a11y-probe'; document.body.appendChild(b);
      const d = document.createElement('div'); d.id = 'a11y-probe'; document.body.appendChild(d);
    })()`);
    const r = (await page.evaluate(SCAN)) as { unnamed: string[]; dupIds: string[] };
    check('নিয়ন্ত্রণ: ইচ্ছাকৃত নামহীন বোতাম ধরা পড়ে', r.unnamed.some((u) => u.includes('a11y-probe')), r.unnamed.join(', '));
    check('নিয়ন্ত্রণ: ইচ্ছাকৃত ডুপ্লিকেট id ধরা পড়ে', r.dupIds.some((d) => d.startsWith('a11y-probe')), r.dupIds.join(', '));
    await page.close();
  }

  for (const set of SETS) {
    console.log(`\n── ${set.who} ──`);
    for (const p of set.pages) {
      const page = await set.ctx.newPage();
      await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const r = (await page.evaluate(SCAN)) as { lang: string; unnamed: string[]; dupIds: string[] };
      await page.close();
      // ★ ভাষা-বদল (i18n) থাকায় `bn` বা `en` দুটোই বৈধ — খালি নয়, এটুকুই দাবি
      check(`${p} · html lang`, /^(bn|en)\b/.test(r.lang), r.lang || 'নেই');
      check(`${p} · নামহীন কন্ট্রোল নেই`, r.unnamed.length === 0, r.unnamed.slice(0, 5).join(', ') || '০');
      check(`${p} · ডুপ্লিকেট id নেই`, r.dupIds.length === 0, r.dupIds.slice(0, 5).join(', ') || '০');
    }
    const f = await focusVisibleRatio(set.ctx, set.pages[0]);
    check(`${set.pages[0]} · Tab-ফোকাস দৃশ্যমান (${f.visibleFocus}/${f.seen})`, f.seen > 0 && f.visibleFocus === f.seen, f.invisible.slice(0, 4).join(', ') || 'সবগুলো');
    await set.ctx.close();
  }

  await db.rateLimitBucket.deleteMany({});
  await browser.close();
  await db.$disconnect();
  console.log(`\n════ ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''} ════`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
