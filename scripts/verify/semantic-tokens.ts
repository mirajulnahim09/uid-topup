/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ভূমিকা-রঙ (`--sem-*`) — লক্ষ্যভিত্তিক যাচাই
 *
 *   দাবি যা প্রমাণ করতে হবে:
 *     ১. অবস্থা-বাহী রঙের **হার্ডকোড লিটারেল আর নেই** (যেগুলো ছিল,
 *        তাদের তালিকা নিচে — প্রতিটির ছাড় কারণসহ)
 *     ২. প্রতিটি নতুন প্রকাশ **ব্রাউজারে resolve হয়** — অর্থাৎ
 *        `color-mix()` সমর্থিত, নীরবে ফাঁকা হয়ে যায় না
 *     ৩. প্রতিটি মান **দুই থিমে আলাদা** — এটাই মূল কথা, কারণ
 *        পুরনো লিটারেলগুলোর দোষ ছিল "থিম জানে না"
 *     ৪. লেখা-ভূমিকার রঙে কার্ডের বিপরীতে কনট্রাস্ট **≥ ৪.৫:১**
 *        (WCAG 1.4.3), আর পুরনো লিটারেল সেখানে কত ছিল — পাশাপাশি
 *     ৫. আসল পাতায় আসল নোডগুলো ওই মানগুলোই দেখাচ্ছে (ফিক্সচার
 *        দিয়ে বানানো অবস্থায়)
 *
 *   ⚠️ এটি অডিট নয় — নতুন কিছু খোঁজে না, কেবল এই দাবিগুলো মাপে।
 *
 *   ⚠️⚠️ probe **স্ট্রিং**, ফাংশন নয়: tsx/esbuild এর `keepNames`
 *      নামযুক্ত ফাংশনে `__name(...)` জোড়ে যা ব্রাউজারে নেই। এই
 *      কোডবেসে সেটি আগে দুবার ঘটেছে (`tbl-stack.ts` দ্রষ্টব্য)।
 *      একই কারণে `waitForFunction(string)` ব্যবহার করা হয়নি —
 *      সেটি পাতার ভিতরে eval করে, আর অ্যাপের CSP-তে `unsafe-eval`
 *      নেই, তাই **ভুয়া** কনসোল-ত্রুটি তৈরি হতো (২০২৬-০৮-৩০ এ মাপা)।
 *
 *   চালানো:
 *     node scripts/prod-rig.mjs                       # আলাদা শেলে
 *     npx tsx scripts/verify/_fixture-semantic.ts
 *     VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/semantic-tokens.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { SLA_WARN_MIN } from '../../src/lib/slaBreach';
import { openBrowser } from './_browser';
import type { Page } from 'playwright-core';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let pass = 0;
const fails: string[] = [];
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fails.push(`${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}

/* ═══════════ ১. স্ট্যাটিক — যে লিটারেলগুলো সরানো হয়েছে ═══════════ */

/**
 * প্রতিটি এন্ট্রি: রঙ, কোন ভূমিকায় ছিল, আর কোথায় থাকা **বৈধ**।
 * ছাড়গুলো ইচ্ছাকৃত ও কারণসহ — নীরব ছাড় দিলে এই যাচাইটাই অর্থহীন।
 */
const RETIRED: Array<{ re: RegExp; was: string; hex: string; role: 'success' | 'warning' | 'danger' | 'info'; exempt: string[] }> = [
  { re: /rgba\(\s*242\s*,\s*168\s*,\s*196/g, was: 'গোলাপি', hex: '#f2a8c4', role: 'danger', exempt: [] },
  { re: /rgba\(\s*127\s*,\s*224\s*,\s*187/g, was: 'মিন্ট', hex: '#7fe0bb', role: 'success', exempt: [] },
  { re: /rgba\(\s*224\s*,\s*120\s*,\s*120/g, was: 'ম্লান লাল', hex: '#e07878', role: 'danger', exempt: [] },
  { re: /rgba\(\s*120\s*,\s*200\s*,\s*160/g, was: 'সবুজ আভা', hex: '#78c8a0', role: 'success', exempt: [] },
  { re: /rgba\(\s*230\s*,\s*160\s*,\s*90/g, was: 'কমলা আভা', hex: '#e6a05a', role: 'warning', exempt: [] },
  { re: /rgba\(\s*34\s*,\s*197\s*,\s*94/g, was: 'সবুজ আভা', hex: '#22c55e', role: 'success', exempt: [] },
  { re: /#e07878\b/gi, was: 'ম্লান লাল', hex: '#e07878', role: 'danger', exempt: [] },
  { re: /#6ec49a\b/gi, was: 'মিন্ট সবুজ', hex: '#6ec49a', role: 'success', exempt: [] },
  { re: /#e0a05a\b/gi, was: 'অ্যাম্বার', hex: '#e0a05a', role: 'warning', exempt: [] },
  { re: /#22c55e\b/gi, was: 'সবুজ', hex: '#22c55e', role: 'success', exempt: [] },
  { re: /#e0a83a\b/gi, was: 'অ্যাম্বার', hex: '#e0a83a', role: 'warning', exempt: [] },
  // ★ ছাড়: `email.ts` — HTML ইমেইল, সেখানে CSS ভেরিয়েবল বলে কিছু নেই
  { re: /#94a3b8\b/gi, was: 'স্লেট', hex: '#94a3b8', role: 'info', exempt: ['src/lib/email.ts'] },
  // ★ ছাড়: `StorefrontShell` — ওটি সাজসজ্জার গ্রেডিয়েন্ট-প্রিসেট,
  //   অবস্থা-বাহী নয়; UIUX_PROBLEM_MAP §১৩.৬ এর ২৬৯টির অংশ (আলাদা কাজ)
  { re: /#38bdf8\b/gi, was: 'আকাশি', hex: '#38bdf8', role: 'info', exempt: ['src/components/home/StorefrontShell.tsx'] },
  /**
   * ★ ২০২৬-০৯-০১ — স্টোরফ্রন্টের পালা।
   *   ছাড়: `globals.css` — সেখানেই টোকেনের **সংজ্ঞা**, তাই মানটি
   *   থাকা বাধ্যতামূলক। `StoreHowFaq` এ দুটি বাকি — সেখানে
   *   রংদুটি **বুলেট-গ্লিফ ও borderLeft**, অর্থাৎ সাজসজ্জা —
   *   পাশের লেখাই অর্থ বহন করে, তাই WCAG অনুসারে ছাড়প্রাপ্ত।
   */
  /*
   * ⚠️ ২০২৬-০৯-২১ (EXTREME রেড-টিম): নিচের তিনটি regex-এ `\b`-এর জায়গায় **আসল
   *   backspace বাইট (0x08)** বসে ছিল — ২০২৬-০৯-০১ থেকে তিনটিই কখনো কিছু মেলায়নি,
   *   অর্থাৎ যাচাইটি ফাঁপা সবুজ ছিল। সারানোর পর একমাত্র আঘাত `StorefrontShell`-এর
   *   ক্যাটাগরি-থাম্বনেইল গ্রেডিয়েন্ট-স্টপ (`g2`) — `#38bdf8`-এর মতোই সাজসজ্জার
   *   প্যালেট, অবস্থা-বাহী নয়; তাই একই কারণে ছাড়।
   */
  { re: /#1a1408\b/gi, was: 'গোল্ড-চিপের near-black', hex: '#1a1408', role: 'success', exempt: ['src/app/globals.css'] },
  { re: /#65a30d\b/gi, was: 'ব্যাজ "নতুন"', hex: '#65a30d', role: 'success', exempt: ['src/app/globals.css', 'src/components/home/StoreHowFaq.tsx'] },
  { re: /#0284c7\b/gi, was: 'ব্যাজ "জনপ্রিয়"', hex: '#0284c7', role: 'info', exempt: ['src/app/globals.css', 'src/components/home/StoreHowFaq.tsx', 'src/components/home/StorefrontShell.tsx'] },
];

/** কোড-লাইন থেকে মন্তব্য বাদ — ইতিহাস লেখা থাকা দোষ নয় */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e)) out.push(p);
  }
  return out;
}

function staticScan(): void {
  console.log('\n── ১. স্ট্যাটিক: অবসরপ্রাপ্ত লিটারেল ──');
  const files = walk('src');
  for (const item of RETIRED) {
    const hits: string[] = [];
    for (const f of files) {
      const rel = f.split(path.sep).join('/');
      if (item.exempt.some((x) => rel.endsWith(x))) continue;
      const body = stripComments(readFileSync(f, 'utf8'));
      item.re.lastIndex = 0;
      const n = (body.match(item.re) || []).length;
      if (n) hits.push(`${rel}×${n}`);
    }
    ok(`${item.hex} (${item.was} · ${item.role}) কোডে নেই`, hits.length === 0, hits.length ? hits : undefined);
  }
}

/* ═══════ ২. যে প্রকাশগুলো এখন ব্যবহৃত — কোড থেকেই সংগ্রহ ═══════ */

/**
 * ★ হাতে লেখা তালিকা নয় — বদলানো ফাইলগুলো পড়ে **সোর্স থেকেই** তোলা।
 *   নাহলে যাচাইটি আমার স্মৃতি মাপত, কোড নয়।
 */
const CHANGED = [
  'src/components/SlaCountdown.tsx',
  'src/components/admin/DepositQueue.tsx',
  'src/components/admin/CopyButton.tsx',
  'src/components/admin/PaymentProviders.tsx',
  'src/components/admin/OrderTable.tsx',
  'src/components/admin/CustomerTimeline.tsx',
  'src/components/admin/OpsMetrics.tsx',
  'src/app/admin/orders/page.tsx',
  'src/app/account/orders/[id]/page.tsx',
  'src/app/account/wallet/deposit/page.tsx',
  // ২০২৬-০৯-০১ — পাবলিক স্টোরফ্রন্ট
  'src/components/home/StorefrontShell.tsx',
  'src/components/home/StoreHowFaq.tsx',
];

function harvest(): string[] {
  const set = new Set<string>();
  for (const f of CHANGED) {
    const body = stripComments(readFileSync(f, 'utf8'));
    for (const m of body.matchAll(/color-mix\(in srgb,\s*var\(--sem-[a-z]+\)\s*\d+%,\s*transparent\)/g)) set.add(m[0]);
    for (const m of body.matchAll(/var\(--sem-(?:success|warning|danger|info)\)/g)) set.add(m[0]);
  }
  return [...set].sort();
}

/* ═══════════════ ৩. ব্রাউজারে মাপা ═══════════════ */

type Probe = {
  tokens: Record<string, string>;
  card: string;
  exprs: Record<string, string>;
  ratios: Record<string, number>;
  oldRatios: Record<string, number>;
  tintRatios?: Record<string, number>;
};

/** পাতার ভিতরে চলে — ES5, স্ট্রিং হিসেবে পাঠানো */
function probeSrc(exprs: string[], oldHexes: Record<string, string>, tint: Array<[string, string]>): string {
  return `(function(){
  var EX = ${JSON.stringify(exprs)};
  var OLD = ${JSON.stringify(oldHexes)};
  var TINT = ${JSON.stringify(tint)};
  var host = document.createElement('div');
  host.style.position='fixed'; host.style.left='-9999px'; host.style.top='0';
  document.body.appendChild(host);
  function computed(prop, val){
    var d = document.createElement('div');
    d.style.setProperty(prop, val);
    host.appendChild(d);
    var v = getComputedStyle(d)[prop === 'background-color' ? 'backgroundColor' : 'color'];
    host.removeChild(d);
    return v;
  }
  function parse(s){
    var m = s.match(/rgba?\\(([^)]+)\\)/);
    if (m) {
      var p = m[1].split(/[ ,\\/]+/).filter(function(x){return x.length});
      return { r:parseFloat(p[0]), g:parseFloat(p[1]), b:parseFloat(p[2]), a:p.length>3?parseFloat(p[3]):1 };
    }
    var c = s.match(/color\\(srgb ([^)]+)\\)/);
    if (c) {
      var q = c[1].split(/[ \\/]+/).filter(function(x){return x.length});
      return { r:parseFloat(q[0])*255, g:parseFloat(q[1])*255, b:parseFloat(q[2])*255, a:q.length>3?parseFloat(q[3]):1 };
    }
    return null;
  }
  function lum(c){
    function ch(v){ v=v/255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }
    return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b);
  }
  function over(fg,bg){
    var a=fg.a;
    return { r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1 };
  }
  function ratio(a,b){
    var l1=lum(a), l2=lum(b);
    var hi=Math.max(l1,l2), lo=Math.min(l1,l2);
    return Math.round(((hi+0.05)/(lo+0.05))*100)/100;
  }
  function hex2rgb(h){
    return { r:parseInt(h.substr(1,2),16), g:parseInt(h.substr(3,2),16), b:parseInt(h.substr(5,2),16), a:1 };
  }

  var rootCS = getComputedStyle(document.documentElement);
  var tokens = {};
  ['--sem-success','--sem-warning','--sem-danger','--sem-info'].forEach(function(k){
    tokens[k] = computed('color', 'var(' + k + ')');
  });
  var cardStr = computed('background-color', 'var(--v-pit)');
  var card = parse(cardStr);

  var exprs = {}, ratios = {}, oldRatios = {};
  for (var i=0;i<EX.length;i++){
    var e = EX[i];
    var v = computed('background-color', e);
    exprs[e] = v;
    var p = parse(v);
    if (p && card) ratios[e] = ratio(over(p, card), card);
  }
  for (var k in OLD) { if (OLD.hasOwnProperty(k) && card) oldRatios[k] = ratio(hex2rgb(OLD[k]), card); }

  // ভূমিকা-রঙ তার নিজের টিন্টের উপর (টিন্ট আগে কার্ডের উপর সমতল করা হয়)
  var tintRatios = {};
  for (var ti=0; ti<TINT.length; ti++){
    var fgS = computed('color', TINT[ti][0]);
    var bgS = computed('color', TINT[ti][1]);
    var fgP = parse(fgS), bgP = parse(bgS);
    if (fgP && bgP && card) {
      var flatBg = bgP.a < 1 ? over(bgP, card) : bgP;
      var flatFg = fgP.a < 1 ? over(fgP, flatBg) : fgP;
      tintRatios[TINT[ti][0] + '|' + TINT[ti][1]] = ratio(flatFg, flatBg);
    }
  }

  document.body.removeChild(host);
  return { tokens: tokens, card: cardStr, exprs: exprs, ratios: ratios, oldRatios: oldRatios, tintRatios: tintRatios };
})()`;
}

/** পাতার নোড খুঁজে computed রঙ — লেখা দেখে */
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
      if (t.indexOf(N[key]) === -1) continue;
      // সবচেয়ে ভিতরের মিল — বাইরের মোড়ক নয়
      var deeper = false;
      for (var j=0;j<el.children.length;j++){
        if ((el.children[j].textContent||'').indexOf(N[key]) !== -1) { deeper = true; break; }
      }
      if (!deeper) { found = el; break; }
    }
    if (!found) { out[key] = null; continue; }
    var cs = getComputedStyle(found);
    /**
     * ⚠️ পূর্বপুরুষ তিন ধাপ পর্যন্ত দেখা হয়। প্রথম সংস্করণে কেবল
     *   সরাসরি প্যারেন্ট দেখা হতো, আর তাতে DepositQueue এর সংকেত-বাক্স
     *   দুটি মিথ্যা লাল দিত: লেখাটি ভিতরের span এ, কিন্তু TONE এর
     *   আভা/বর্ডার দুই ধাপ উপরের p/label এ বসে।
     *
     *   ⚠️⚠️ এই মন্তব্যে backtick লেখা যাবে না — গোটা probe-টি একটি
     *   template literal, তাই একটি backtick-ও স্ট্রিংটি ভেঙে দেয়
     *   (প্রথমবার ঠিক তা-ই হয়েছিল, esbuild transform error)।
     */
    var anc = [], el2 = found.parentElement, hops = 0;
    while (el2 && hops < 3) {
      var a = getComputedStyle(el2);
      anc.push({ background: a.backgroundColor, border: a.borderTopColor, color: a.color });
      el2 = el2.parentElement; hops++;
    }
    out[key] = {
      color: cs.color,
      background: cs.backgroundColor,
      border: cs.borderTopColor,
      ancestors: anc,
      text: (found.textContent||'').trim().slice(0, 60),
    };
  }
  return out;
})()`;
}

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const CUSTOMER = { email: 'semtok.customer@dev.local', password: 'Customer@2026Secure' };

async function settle(page: Page) {
  await page.waitForSelector('#v-boot', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.fill('#email', who.email);
  await page.fill('#pw', who.password);
  try {
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
  } catch {
    // ★ কাঁচা TimeoutError নয় — পাতায় কী লেখা আছে সেটিই আসল কারণ।
    //   (সবচেয়ে সম্ভাব্য: রেট-লিমিট; `RateLimitBucket` খালি করে আবার চালান)
    const msg = await page.evaluate(`(function(){
      var el = document.querySelector('[role="alert"], .alert, .v-toast');
      return el ? (el.textContent||'').trim().slice(0,160) : '';
    })()`).catch(() => '');
    throw new Error(`লগইন হলো না (${who.email}) — পাতার বার্তা: ${msg || '(কিছু নেই)'}`);
  }
  await settle(page);
}

async function main() {
  console.log(`ডাটাবেস: ${dbLabel()} · সার্ভার: ${BASE}`);

  staticScan();

  const exprs = harvest();
  console.log(`\n── ২. কোড থেকে তোলা প্রকাশ: ${exprs.length} টি ──`);
  ok('অন্তত একটি `--sem-*` প্রকাশ ব্যবহৃত', exprs.length > 0);
  exprs.forEach((e) => console.log(`     ${e}`));

  // ★ ভূমিকা-রঙ **নিজের টিন্টের উপর** — এটাই ব্যাজের আসল পটভূমি।
  //   কার্ডের বিপরীতে মাপা যথেষ্ট নয়: `--sem-success` সাদা কার্ডে
  //   ৫.০২:১, কিন্তু নিজের ১৬% টিন্টে ৪.০৩:১ (AA ফেল)। সেই কারণেই
  //   `--sem-*-tint` থিম-প্রতি আলাদা।
  const TINTED: Array<[string, string]> = [
    ['var(--sem-success)', 'var(--sem-success-tint)'],
    ['var(--sem-info)', 'var(--sem-info-tint)'],
  ];

  // পুরনো লিটারেল — পাশাপাশি তুলনার জন্য
  const oldHexes: Record<string, string> = {
    'success (পুরনো #6ec49a)': '#6ec49a',
    'warning (পুরনো #e0a05a)': '#e0a05a',
    'danger (পুরনো #e07878)': '#e07878',
  };

  const fx = await db.user.findUnique({
    where: { email: CUSTOMER.email },
    select: { id: true, orders: { select: { id: true, status: true, slaDueAt: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!fx) throw new Error('ফিক্সচার নেই — আগে `npx tsx scripts/verify/_fixture-semantic.ts` চালান');
  const breachedOrder = fx.orders.find((o) => o.status === 'PENDING' && o.slaDueAt && o.slaDueAt < new Date());
  const refundedOrder = fx.orders.find((o) => o.status === 'REFUNDED');
  if (!breachedOrder || !refundedOrder) throw new Error('ফিক্সচারের অর্ডার পাওয়া যায়নি');

  /**
   * ★ "ঘনিয়ে আসা" (soon) শাখাটি **সময়ের সাথে পচে যায়** — ফিক্সচার
   *   ৩০ মিনিটের বেশি পুরনো হলে সেটিও breached হয়ে যায়, আর যাচাই
   *   "নোড পাওয়া গেল না" বলে লাল হয়। ঠিক সেটিই একবার ঘটেছে।
   *   তাই মাপার ঠিক আগে জানালাটি আবার বসিয়ে নেওয়া হয় — ডেভ DB,
   *   টাকা নড়ে না, কেবল একটি সময়ের ছাপ।
   */
  const soonOrder = fx.orders.find(
    (o) => o.status === 'PENDING' && o.id !== breachedOrder.id,
  );
  if (soonOrder) {
    await db.order.update({
      where: { id: soonOrder.id },
      data: { slaDueAt: new Date(Date.now() + (SLA_WARN_MIN - 5) * 60_000) },
    });
  }

  const browser = await openBrowser({ headless: true });
  const measured: Record<string, Probe> = {};
  const nodes: Record<string, Record<string, unknown>> = {};

  /**
   * ★ ভূমিকা-প্রতি **একটিই** লগইন, তারপর থিম বদলে reload।
   *
   *   ⚠️ কেন: প্রথম সংস্করণে প্রতি থিমে নতুন কনটেক্সট ও নতুন লগইন হতো —
   *      এক রানে ৪টি, কয়েক রানে ডজনখানেক। C4-এর পর `login:*` পথ
   *      **fail-closed** রেট-লিমিটেড, তাই তৃতীয় রানে অ্যাডমিন লগইন
   *      আটকে গেল আর স্ক্রিপ্ট `/login` এ ঝুলে রইল — দেখে মনে হচ্ছিল
   *      অ্যাপ ভাঙা, আসলে যাচাই নিজেই নিজের সীমায় পড়েছিল।
   */
  const setTheme = async (page: Page, t: string) => {
    await page.evaluate(`(function(){ try { localStorage.setItem('theme', '${t}'); } catch (e) {} })()`);
  };

  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const adminPage = await adminCtx.newPage();
  await login(adminPage, ADMIN);

  const custCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const custPage = await custCtx.newPage();
  await login(custPage, CUSTOMER);

  for (const theme of ['dark', 'light'] as const) {
    console.log(`\n── ৩. ব্রাউজার · থিম: ${theme} ──`);

    // ─ অ্যাডমিন দিক ─
    const page = adminPage;
    await setTheme(page, theme);
    await page.goto(`${BASE}/admin/orders`, { waitUntil: 'domcontentloaded' });
    await settle(page);

    measured[theme] = (await page.evaluate(probeSrc(exprs, oldHexes, TINTED))) as Probe;

    nodes[`${theme}:admin/orders`] = (await page.evaluate(nodeSrc({
      banner: 'টি অর্ডারের সময় পেরিয়ে গেছে',
      tableBreached: 'দেরি',
      tableSoon: 'মিনিট বাকি',
    }))) as Record<string, unknown>;

    await page.goto(`${BASE}/admin/deposits`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    nodes[`${theme}:admin/deposits`] = (await page.evaluate(nodeSrc({
      tierElevated: 'বাড়তি যাচাই দরকার',
      tierTrusted: 'পরিচিত গ্রাহক',
      signalWarn: 'নিবন্ধিত নাম্বারের সাথে মিলছে না',
      signalGood: 'টি সফল ডিপোজিট',
    }))) as Record<string, unknown>;

    await page.goto(`${BASE}/admin/payments`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    nodes[`${theme}:admin/payments`] = (await page.evaluate(`(function(){
      var set = ${JSON.stringify(Object.values(measured[theme].tokens))};
      var all = document.querySelectorAll('body *');
      var hits = [];
      for (var i=0;i<all.length;i++){
        var c = getComputedStyle(all[i]).color;
        if (set.indexOf(c) !== -1) hits.push({ tag: all[i].tagName, color: c, text: (all[i].textContent||'').trim().slice(0,24) });
      }
      return { count: hits.length, sample: hits.slice(0, 6) };
    })()`)) as Record<string, unknown>;

    // ─ গ্রাহক দিক ─
    const p2 = custPage;
    await setTheme(p2, theme);

    await p2.goto(`${BASE}/account/orders/${breachedOrder.id}`, { waitUntil: 'domcontentloaded' });
    await settle(p2);
    nodes[`${theme}:account/order-breached`] = (await p2.evaluate(nodeSrc({
      slaLate: 'দেরি হয়ে গেছে',
    }))) as Record<string, unknown>;

    await p2.goto(`${BASE}/account/orders/${refundedOrder.id}?placed=1`, { waitUntil: 'domcontentloaded' });
    await settle(p2);
    nodes[`${theme}:account/order-refunded`] = (await p2.evaluate(nodeSrc({
      placedCard: 'গ্রহণ করা হয়েছে',
      cancelledIcon: '↩',
    }))) as Record<string, unknown>;

    await p2.goto(`${BASE}/account/wallet/deposit`, { waitUntil: 'domcontentloaded' });
    await settle(p2);
    nodes[`${theme}:account/wallet-deposit`] = (await p2.evaluate(nodeSrc({
      rejectHeading: 'কেন বাতিল হলো',
    }))) as Record<string, unknown>;
  }

  await adminCtx.close();
  await custCtx.close();
  await browser.close();

  /* ── দাবি ── */
  console.log('\n── ৪. দাবি ──');

  const d = measured.dark, l = measured.light;

  for (const k of ['--sem-success', '--sem-warning', '--sem-danger', '--sem-info']) {
    ok(`${k} দুই থিমে আলাদা`, d.tokens[k] !== l.tokens[k], { dark: d.tokens[k], light: l.tokens[k] });
  }

  for (const e of exprs) {
    const dv = d.exprs[e], lv = l.exprs[e];
    const resolved = !!dv && dv !== 'rgba(0, 0, 0, 0)';
    ok(`resolve হয়: ${e}`, resolved, resolved ? undefined : { dark: dv });
    ok(`দুই থিমে আলাদা: ${e}`, dv !== lv, { dark: dv, light: lv });
  }

  // লেখা-ভূমিকা: `var(--sem-*)` — কার্ডের বিপরীতে ≥ ৪.৫:১
  for (const theme of ['dark', 'light'] as const) {
    const m = measured[theme];
    for (const e of exprs.filter((x) => x.startsWith('var('))) {
      const r = m.ratios[e];
      ok(`কনট্রাস্ট ≥৪.৫ (${theme}) ${e} = ${r}:১`, typeof r === 'number' && r >= 4.5, { ratio: r, card: m.card });
    }
  }

  // টিন্টের উপর লেখা — ≥৪.৫:১
  for (const theme of ['dark', 'light'] as const) {
    const m = measured[theme];
    for (const [fg, bg] of TINTED) {
      const r = m.tintRatios?.[`${fg}|${bg}`];
      ok(`টিন্টে কনট্রাস্ট ≥৪.৫ (${theme}) ${fg} on ${bg} = ${r}:১`, typeof r === 'number' && r >= 4.5, { ratio: r });
    }
  }

  // পুরনো বনাম নতুন — কেবল মাপ, দাবি নয়
  console.log('\n── ৫. পুরনো লিটারেল বনাম নতুন টোকেন (কার্ডের বিপরীতে) ──');
  for (const theme of ['dark', 'light'] as const) {
    const m = measured[theme];
    for (const [label, hex] of Object.entries(oldHexes)) {
      const role = label.split(' ')[0];
      const nu = m.ratios[`var(--sem-${role})`];
      console.log(`  ${theme.padEnd(5)} ${label} = ${m.oldRatios[label]}:১   →   var(--sem-${role}) = ${nu}:১`);
    }
  }

  // আসল নোড — টোকেনের মানই দেখাচ্ছে কি না
  console.log('\n── ৬. আসল পাতার নোড ──');
  const valuesOf = (theme: 'dark' | 'light') =>
    new Set([...Object.values(measured[theme].tokens), ...Object.values(measured[theme].exprs)]);

  for (const [key, res] of Object.entries(nodes)) {
    const theme = key.startsWith('dark') ? 'dark' : 'light';
    if (key.includes('admin/payments')) {
      const c = (res as { count: number }).count;
      ok(`${key}: `.padEnd(10) + `ভূমিকা-টোকেনে রাঙানো নোড আছে (${c} টি)`, c > 0, res);
      continue;
    }
    const set = valuesOf(theme as 'dark' | 'light');
    for (const [name, v] of Object.entries(res)) {
      if (v === null) { ok(`${key} → ${name}: নোড পাওয়া গেল`, false, 'অনুপস্থিত'); continue; }
      const n = v as { color: string; background: string; border: string; ancestors: Array<Record<string, string>> };
      const candidates = [n.color, n.background, n.border];
      for (const a of n.ancestors || []) candidates.push(a.background, a.border, a.color);
      const hit = candidates.some((x) => x && set.has(x));
      ok(`${key} → ${name}: টোকেন-মান দেখাচ্ছে`, hit, n);
    }
  }

  mkdirSync('audit', { recursive: true });
  writeFileSync('audit/semantic-tokens.json', JSON.stringify({ exprs, measured, nodes }, null, 1));
  console.log('\nফল: audit/semantic-tokens.json');

  console.log(`\n${fails.length ? '✗' : '✓'} ${pass} পাস · ${fails.length} ব্যর্থ`);
  if (fails.length) { fails.forEach((f) => console.log(`   ✗ ${f}`)); process.exitCode = 1; }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
