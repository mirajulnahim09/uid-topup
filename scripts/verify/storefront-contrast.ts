/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ স্টোরফ্রন্টের অবস্থা-বাহী রঙ — লক্ষ্যভিত্তিক যাচাই
 *
 *   `semantic-tokens.ts` অ্যাডমিন-দিকের `--sem-*` মাপে। এই স্ক্রিপ্টটি
 *   **পাবলিক দোকান** মাপে — যে পাতাটি প্রতিটি গ্রাহক প্রথমে দেখেন।
 *
 *   দাবি যা প্রমাণ করতে হবে:
 *     ১. হিরো-প্যানেলের লেখা **৫টি প্রিসেট × ২ থিম = ১০ সমন্বয়েই**
 *        পাস করে। আগে ৯টি ফেল করত, purple-এ ১.০০:১ (অদৃশ্য) —
 *        কারণ পটভূমি inline হার্ডকোড বেগুনি, অথচ লেখা `--accent-2`।
 *     ২. অবস্থা-ব্যাজগুলো **নিজের টিন্টের উপর** ≥৪.৫:১। কার্ডের
 *        বিপরীতে মাপা যথেষ্ট নয় — লেখাটি টিন্টের উপরেই বসে।
 *     ৩. প্রোডাক্ট-কার্ডের অস্বচ্ছ ব্যাজে সাদা লেখা ≥৪.৫:১।
 *     ৪. লাইভ-ফিডের বিভাজক **দুই থিমেই** দৃশ্যমান (আগে লাইটে
 *        সাদার উপর সাদা = ১.০০:১)।
 *     ৫. `--gold` চিপের লেখা দুই থিমে ≥৪.৫:১।
 *     ৬. আসল নোডগুলো সত্যিই ঐ মানগুলো দেখাচ্ছে।
 *
 *   ⚠️ হিরোর পটভূমি একটি **গ্রেডিয়েন্ট**, একক রঙ নয়। তাই
 *      `getComputedStyle` যথেষ্ট নয় — একই স্টপ ও কোণ দিয়ে একটি
 *      canvas-এ গ্রেডিয়েন্টটি আঁকা হয় ও লেখার বাক্সের নিচের
 *      **আসল পিক্সেলগুলো** পড়া হয়। ক্যানভাস ও CSS দুটোই sRGB-তে
 *      ইন্টারপোলেট করে, তাই মানটি অনুমান নয়।
 *
 *   ⚠️⚠️ probe **স্ট্রিং**, ফাংশন নয় (tsx/esbuild এর `keepNames`
 *      নামযুক্ত ফাংশনে `__name(...)` জোড়ে, যা ব্রাউজারে নেই)।
 *      একই কারণে এই মন্তব্যে **backtick লেখা যাবে না**।
 *
 *   চালানো (লগইন লাগে না — পুরোটাই পাবলিক পাতা):
 *     node scripts/prod-rig.mjs                    # আলাদা শেলে
 *     VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/storefront-contrast.ts
 * ═══════════════════════════════════════════════════════════
 */
import { BASE } from './_db';
import { openBrowser } from './_browser';
import type { Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

let pass = 0;
const fails: string[] = [];
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fails.push(`${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}

const ACCENTS = ['lime', 'purple', 'blue', 'red', 'orange'] as const;
const THEMES = ['dark', 'light'] as const;
type Accent = (typeof ACCENTS)[number];
type Theme = (typeof THEMES)[number];

/**
 * টোকেন-জোড়া যা মাপা হবে: [লেখা, যে পৃষ্ঠতলে বসে, ন্যূনতম অনুপাত, নাম]
 * ★ `--sem-*` এর সঙ্গী `--sem-*-tint` — কার্ড নয়। এটাই আসল পটভূমি।
 */
const PAIRS: Array<[string, string, number, string]> = [
  ['var(--sem-success)', 'var(--sem-success-tint)', 4.5, 'সফল-ব্যাজের লেখা নিজের টিন্টে'],
  ['var(--sem-info)', 'var(--sem-info-tint)', 4.5, 'তথ্য-ব্যাজের লেখা নিজের টিন্টে'],
  ['#ffffff', 'var(--badge-sold)', 4.5, 'ব্যাজ "সোল্ড আউট" — সাদা লেখা'],
  ['#ffffff', 'var(--badge-sale)', 4.5, 'ব্যাজ "ছাড়" — সাদা লেখা'],
  ['#ffffff', 'var(--badge-popular)', 4.5, 'ব্যাজ "জনপ্রিয়" — সাদা লেখা'],
  ['#ffffff', 'var(--badge-new)', 4.5, 'ব্যাজ "নতুন" — সাদা লেখা'],
  ['var(--gold-ink)', 'var(--gold)', 4.5, 'ফিল্টার-চিপের লেখা --gold পৃষ্ঠতলে'],
];

/** টোকেন-জোড়ার কনট্রাস্ট, পাতার ভিতরে computed মান থেকে */
function pairsSrc(pairs: Array<[string, string, number, string]>): string {
  return `(function(){
  var P = ${JSON.stringify(pairs)};
  var host = document.createElement('div');
  host.style.position='fixed'; host.style.left='-9999px'; host.style.top='0';
  document.body.appendChild(host);
  function computed(val){
    var d = document.createElement('div');
    d.style.color = val;
    host.appendChild(d);
    var v = getComputedStyle(d).color;
    host.removeChild(d);
    return v;
  }
  function parse(s){
    var m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    var p = m[1].split(/[ ,\\/]+/).filter(function(x){return x.length});
    return { r:parseFloat(p[0]), g:parseFloat(p[1]), b:parseFloat(p[2]), a:p.length>3?parseFloat(p[3]):1 };
  }
  function lum(c){
    function ch(v){ v=v/255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }
    return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b);
  }
  function over(fg,bg){
    var a=fg.a;
    return { r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1 };
  }
  function ratio(a,b){
    var l1=lum(a), l2=lum(b), hi=Math.max(l1,l2), lo=Math.min(l1,l2);
    return Math.round(((hi+0.05)/(lo+0.05))*100)/100;
  }
  // কার্ডই সব টিন্টের নিচের স্তর
  var card = parse(computed('var(--v-pit)'));
  var out = {};
  for (var i=0;i<P.length;i++){
    var fgS = computed(P[i][0]), bgS = computed(P[i][1]);
    var fg = parse(fgS), bg = parse(bgS);
    if (!fg || !bg) { out[P[i][3]] = { error:'parse', fg:fgS, bg:bgS }; continue; }
    var bgFlat = bg.a < 1 ? over(bg, card) : bg;
    var fgFlat = fg.a < 1 ? over(fg, bgFlat) : fg;
    out[P[i][3]] = { fg:fgS, bg:bgS, need:P[i][2], ratio: ratio(fgFlat, bgFlat) };
  }
  document.body.removeChild(host);
  return out;
})()`;
}

/**
 * হিরো-প্যানেল: গ্রেডিয়েন্টটি canvas-এ পুনরায় এঁকে লেখার বাক্সের
 * নিচের আসল পিক্সেল পড়া হয়। CSS কোণ (deg) → canvas ভেক্টর রূপান্তর
 * স্পেক অনুসারে: ০deg = নিচ→উপর, ঘড়ির কাঁটার দিকে বাড়ে।
 */
const heroSrc = `(function(){
  function parse(s){
    var m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    var p = m[1].split(/[ ,\\/]+/).filter(function(x){return x.length});
    return { r:parseFloat(p[0]), g:parseFloat(p[1]), b:parseFloat(p[2]), a:p.length>3?parseFloat(p[3]):1 };
  }
  function lum(c){
    function ch(v){ v=v/255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }
    return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b);
  }
  function ratio(a,b){
    var l1=lum(a), l2=lum(b), hi=Math.max(l1,l2), lo=Math.min(l1,l2);
    return Math.round(((hi+0.05)/(lo+0.05))*100)/100;
  }
  function over(fg,bg){
    var a=fg.a;
    return { r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1 };
  }

  // ── ১. হিরো-প্যানেল খুঁজি: যার backgroundImage-এ #4c1d95 আছে ──
  var hero = null, all = document.querySelectorAll('div');
  for (var i=0;i<all.length;i++){
    var bi = getComputedStyle(all[i]).backgroundImage || '';
    if (bi.indexOf('76, 29, 149') !== -1) { hero = all[i]; break; }
  }
  if (!hero) return { error: 'হিরো-প্যানেল পাওয়া গেল না' };
  var hb = hero.getBoundingClientRect();
  var bgImage = getComputedStyle(hero).backgroundImage;

  // ── ২. একই গ্রেডিয়েন্ট canvas-এ ──
  var deg = 120;
  var mm = bgImage.match(/(-?[\\d.]+)deg/);
  if (mm) deg = parseFloat(mm[1]);
  var stops = [];
  var re = /rgba?\\(([^)]+)\\)\\s+([\\d.]+)%/g, m2;
  while ((m2 = re.exec(bgImage))) {
    var p = m2[1].split(/[ ,\\/]+/).filter(function(x){return x.length});
    stops.push({ r:parseFloat(p[0]), g:parseFloat(p[1]), b:parseFloat(p[2]), pos:parseFloat(m2[2])/100 });
  }
  if (stops.length < 2) return { error: 'গ্রেডিয়েন্ট-স্টপ পড়া গেল না', bgImage: bgImage };

  var W = Math.max(1, Math.round(hb.width)), H = Math.max(1, Math.round(hb.height));
  var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  // CSS deg → রেখার দুই প্রান্ত (স্পেকের সূত্র)
  var rad = (deg) * Math.PI / 180;
  var lineLen = Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad));
  var cx = W/2, cy = H/2;
  var dx = Math.sin(rad) * lineLen/2, dy = -Math.cos(rad) * lineLen/2;
  var g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  for (var s=0;s<stops.length;s++)
    g.addColorStop(Math.min(1, Math.max(0, stops[s].pos)), 'rgb(' + stops[s].r + ',' + stops[s].g + ',' + stops[s].b + ')');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // ── ৩. যে নোডগুলো মাপব ──
  var targets = {};
  var h1 = hero.querySelector('h1');
  if (h1) targets.heading = h1.querySelector('span:last-child') || h1;
  var links = hero.querySelectorAll('a');
  for (var k=0;k<links.length;k++){
    if ((links[k].getAttribute('href')||'').indexOf('#how') === 0) { targets.secondaryLink = links[k]; break; }
  }
  /**
   * ⚠️ হারনেস-ত্রুটি (মাপা): আগে width="13" দেখে বাছা হতো, কিন্তু
   *   গৌণ লিংকের তীরটিও ঠিক ১৩×১৩ — তাই প্রতিবার **তীরটিই** মাপা
   *   হতো (fg সাদা, text ফাঁকা, অবস্থান লিংকের সমান)। ✓ এর পাথ
   *   অনন্য, তাই সেটিই চিহ্ন।
   */
  var paths = hero.querySelectorAll('path');
  for (var q=0;q<paths.length;q++){
    var dd = paths[q].getAttribute('d') || '';
    if (dd.indexOf('M4 12.5') === 0) { targets.checkGlyph = paths[q].parentNode; break; }
  }

  var out = {};
  for (var key in targets) {
    if (!targets.hasOwnProperty(key)) continue;
    var el = targets[key];
    var rb = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var fgS = (key === 'checkGlyph') ? cs.stroke : cs.color;
    var fg = parse(fgS);
    if (!fg) { out[key] = { error:'রঙ পড়া গেল না', raw:fgS }; continue; }

    // বাক্সের ভিতরে ৫×৫ নমুনা — সবচেয়ে খারাপটিই ফল
    var worst = null, worstPx = null;
    for (var a=0;a<5;a++) for (var b=0;b<5;b++){
      var px = Math.round(rb.left - hb.left + (rb.width  * (a+0.5)/5));
      var py = Math.round(rb.top  - hb.top  + (rb.height * (b+0.5)/5));
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      var d = ctx.getImageData(px, py, 1, 1).data;
      var bg = { r:d[0], g:d[1], b:d[2], a:1 };
      var f = fg.a < 1 ? over(fg, bg) : fg;
      var r = ratio(f, bg);
      if (worst === null || r < worst) { worst = r; worstPx = { x:px, y:py, bg:'rgb('+d[0]+','+d[1]+','+d[2]+')' }; }
    }
    out[key] = {
      fg: fgS,
      fontSizePx: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      worstRatio: worst,
      worstAt: worstPx,
      text: (el.textContent||'').trim().slice(0, 40),
    };
  }
  out._hero = { w: Math.round(hb.width), h: Math.round(hb.height), deg: deg, stops: stops.length };
  return out;
})()`;

/** পাতার নোড খুঁজে computed রঙ (লেখা দেখে) — semantic-tokens.ts এর মতোই */
function nodeSrc(needles: Record<string, string>): string {
  return `(function(){
  var N = ${JSON.stringify(needles)};
  var out = {};
  var all = document.querySelectorAll('body *');
  for (var key in N) {
    if (!N.hasOwnProperty(key)) continue;
    var found = null;
    for (var i=0;i<all.length;i++){
      var el = all[i];
      var t = (el.textContent||'').trim();
      var want = N[key], exact = want.charAt(0) === '=';
      if (exact) { if (t !== want.slice(1)) continue; }
      else if (t.indexOf(want) === -1) continue;
      var deeper = false;
      for (var j=0;j<el.children.length;j++){
        var ct = (el.children[j].textContent||'');
        if (exact ? (ct.trim() === want.slice(1)) : (ct.indexOf(want) !== -1)) { deeper = true; break; }
      }
      /**
       * ⚠️ হারনেস-ত্রুটি (মাপা): "সম্পন্ন" লেখাটি পাতায় **দুইবার** —
       *   লাইভ-ফিডের কলাম-শিরোনামে (hud-mut, পটভূমিহীন) আর প্রতিটি
       *   সারির ব্যাজে। DOM ক্রমে শিরোনাম আগে, তাই প্রথম মিলটিই
       *   ভুল নোড দিত। যেটির নিজস্ব পটভূমি আছে সেটিই ব্যাজ; না
       *   পেলে প্রথমটিতেই ফেরত যাই।
       */
      if (!deeper) {
        if (!found) found = el;
        if (getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)') { found = el; break; }
      }
    }
    if (!found) { out[key] = null; continue; }
    var cs = getComputedStyle(found);
    out[key] = {
      color: cs.color,
      background: cs.backgroundColor,
      borderBottom: cs.borderBottomColor,
      text: (found.textContent||'').trim().slice(0, 40),
    };
  }
  /**
   * লাইভ-ফিডের সারি-বিভাজক।
   * ⚠️ হারনেস-ত্রুটি (মাপা): আগে document-ক্রমে **প্রথম** যোগ্য div
   *   নেওয়া হতো, কিন্তু ব্যাজধারী কার্ডটিও যোগ্য (তারও borderBottom
   *   আছে, .card এর --v-edge)। ফলে মান আসত rgba(255,255,255,.09) —
   *   সারির --hairline (.05) নয়। এখন সেই div-ই নেওয়া হয় যার ভিতরে
   *   আর কোনো যোগ্য div **নেই** — অর্থাৎ প্রকৃত সারিটি।
   */
  var rows = document.querySelectorAll('div');
  var cands = [];
  for (var r=0;r<rows.length;r++){
    var bb = getComputedStyle(rows[r]).borderBottomColor;
    var bw = getComputedStyle(rows[r]).borderBottomWidth;
    var hasBadge = false, sp = rows[r].querySelectorAll('span');
    for (var q=0;q<sp.length;q++) {
      if ((sp[q].textContent||'').trim() !== 'সম্পন্ন') continue;
      // পটভূমিহীনটি কলাম-শিরোনাম, ব্যাজ নয় — বিভাজকও তখন ভুল সারির
      if (getComputedStyle(sp[q]).backgroundColor === 'rgba(0, 0, 0, 0)') continue;
      hasBadge = true; break;
    }
    if (parseFloat(bw) > 0 && hasBadge) cands.push({ el: rows[r], color: bb, width: bw });
  }
  for (var ci=0; ci<cands.length; ci++){
    var inner = false;
    for (var cj=0; cj<cands.length; cj++){
      if (ci !== cj && cands[ci].el.contains(cands[cj].el)) { inner = true; break; }
    }
    if (!inner) { out._feedDivider = { color: cands[ci].color, width: cands[ci].width }; break; }
  }
  return out;
})()`;
}

type PairRes = Record<string, { fg: string; bg: string; need: number; ratio: number } | { error: string }>;

async function settle(page: Page) {
  await page.waitForSelector('#v-boot', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(350);
}

async function setPrefs(page: Page, theme: Theme, accent: Accent) {
  await page.evaluate(`(function(){
    try { localStorage.setItem('theme', '${theme}'); localStorage.setItem('accent', '${accent}'); } catch (e) {}
  })()`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
}

async function main() {
  console.log(`সার্ভার: ${BASE}`);
  const browser = await openBrowser({ headless: true });
  const results: Record<string, unknown> = {};

  /**
   * দুটি প্রস্থ — মোবাইল ও ডেস্কটপ। কারণ হিরোর গ্রেডিয়েন্ট প্রস্থের
   * সাথে ঘোরে, তাই একটিতে পাস মানে অন্যটিতেও পাস নয়। ডান কলামের
   * লাইভ-ফিডটি কেবল xl (≥১২৮০px) এ ফোটে, তাই সেটিও ডেস্কটপেই মাপা।
   */
  for (const [wName, width, height] of [['mobile', 390, 844], ['desktop', 1366, 900]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await settle(page);

    for (const theme of THEMES) {
      for (const accent of ACCENTS) {
        await setPrefs(page, theme, accent);
        const hero = (await page.evaluate(heroSrc)) as Record<string, { worstRatio: number; fg: string; fontSizePx: number; fontWeight: string; text: string }>;
        results[`hero:${wName}:${theme}:${accent}`] = hero;
      }

      // টোকেন-জোড়া ও নোড — প্রিসেট-নিরপেক্ষ, তাই ডিফল্টে একবার
      await setPrefs(page, theme, 'lime');
      results[`pairs:${wName}:${theme}`] = (await page.evaluate(pairsSrc(PAIRS))) as PairRes;
      results[`nodes:${wName}:${theme}`] = (await page.evaluate(nodeSrc({
        completedBadge: '=সম্পন্ন',
        uidBadge: '=?',
      }))) as Record<string, unknown>;
    }
    await ctx.close();
  }
  await browser.close();

  /* ═══════ দাবি ═══════ */
  console.log('\n── ১. হিরো-প্যানেল: ৫ প্রিসেট × ২ থিম × ২ প্রস্থ ──');
  for (const wName of ['mobile', 'desktop']) {
    for (const theme of THEMES) {
      for (const accent of ACCENTS) {
        const h = results[`hero:${wName}:${theme}:${accent}`] as Record<string, { worstRatio: number; fontSizePx: number; fontWeight: string }>;
        if (!h || (h as unknown as { error?: string }).error) { ok(`হিরো ${wName}/${theme}/${accent}`, false, h); continue; }
        for (const [key, label, need] of [
          ['heading', 'শিরোনাম', 3],          // bold ≥১৮.৬৬px = large text
          ['secondaryLink', 'গৌণ লিংক', 4.5], // ছোট লেখা
          ['checkGlyph', '✓ গ্লিফ', 3],       // অর্থবহ গ্রাফিক
        ] as const) {
          const n = h[key];
          if (!n) { ok(`${wName}/${theme}/${accent} → ${label}: নোড পাওয়া গেল`, false, 'অনুপস্থিত'); continue; }
          // large-text ছাড় কেবল সত্যিই বড় হলে
          const isLarge = n.fontSizePx >= 24 || (n.fontSizePx >= 18.66 && parseInt(n.fontWeight, 10) >= 700);
          const req = key === 'heading' ? (isLarge ? 3 : 4.5) : need;
          ok(`${wName}/${theme}/${accent} ${label} = ${n.worstRatio}:১ (দরকার ${req})`, n.worstRatio >= req, n);
        }
      }
    }
  }

  console.log('\n── ২. টোকেন-জোড়া (লেখা তার আসল পৃষ্ঠতলে) ──');
  for (const wName of ['mobile', 'desktop']) {
    for (const theme of THEMES) {
      const p = results[`pairs:${wName}:${theme}`] as PairRes;
      for (const [, , need, label] of PAIRS) {
        const r = p[label];
        if (!r || 'error' in r) { ok(`${wName}/${theme} ${label}`, false, r); continue; }
        ok(`${wName}/${theme} ${label} = ${r.ratio}:১ (দরকার ${need})`, r.ratio >= need, r);
      }
    }
  }

  console.log('\n── ৩. আসল নোড ──');
  for (const wName of ['mobile', 'desktop']) {
    for (const theme of THEMES) {
      const n = results[`nodes:${wName}:${theme}`] as Record<string, { color?: string; background?: string } | null>;
      const badge = n.completedBadge;
      if (badge) {
        ok(`${wName}/${theme} "সম্পন্ন" ব্যাজ টিন্ট-পটভূমি পেয়েছে`, !!badge.background && badge.background !== 'rgba(0, 0, 0, 0)', badge);
        ok(`${wName}/${theme} "সম্পন্ন" ব্যাজের লেখা --sem-success`, badge.color === (theme === 'dark' ? 'rgb(163, 230, 53)' : 'rgb(21, 128, 61)'), badge);
      }
      const uid = n.uidBadge;
      if (uid) {
        ok(`${wName}/${theme} "?" ব্যাজের লেখা --sem-info`, uid.color === (theme === 'dark' ? 'rgb(125, 211, 252)' : 'rgb(3, 105, 161)'), uid);
        ok(`${wName}/${theme} "?" ব্যাজ টিন্ট-পটভূমি পেয়েছে`, !!uid.background && uid.background !== 'rgba(0, 0, 0, 0)', uid);
      } else {
        console.log(`  · ${wName}/${theme} "সম্পন্ন" ব্যাজ — লাইভ-ফিডে সম্পন্ন অর্ডার নেই, তাই মাপা হয়নি`);
      }
      const div = (n as Record<string, { color?: string; width?: string } | null>)._feedDivider;
      // ★ কড়া দাবি: হুবহু `--hairline`। "স্বচ্ছ নয়" যথেষ্ট নয় —
      //   ভুল নোড ধরলে সেটিও পাস করত (ঠিক তা-ই একবার হয়েছিল)।
      const want = theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 41, 0.06)';
      if (div) ok(`${wName}/${theme} ফিড-বিভাজক = --hairline`, div.color === want, { got: div, want });
      else ok(`${wName}/${theme} ফিড-বিভাজক নোড পাওয়া গেল`, false);
    }
  }

  mkdirSync('audit', { recursive: true });
  writeFileSync('audit/storefront-contrast.json', JSON.stringify(results, null, 1));
  console.log('\nফল: audit/storefront-contrast.json');
  console.log(`\n${fails.length ? '✗' : '✓'} ${pass} পাস · ${fails.length} ব্যর্থ`);
  if (fails.length) { fails.forEach((f) => console.log(`   ✗ ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
