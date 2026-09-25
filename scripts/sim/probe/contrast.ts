// ★ হোমের বাঁ-পাশের সক্রিয় ক্যাটাগরি ("সব প্রোডাক্ট") — লেখা বনাম পটভূমির কনট্রাস্ট, দুই থিমে
//   ⚠️ evaluate-এ **স্ট্রিং** — tsx নামযুক্ত arrow-এ `__name` বসায়, পাতায় সেটি নেই (memory: harness traps)
import { db, BASE } from '../_lib';
import { openBrowser } from '../../verify/_browser';

const PROBE = `(() => {
  const el = [...document.querySelectorAll('a,button')].find((e) => e.innerText.trim().startsWith('সব প্রোডাক্ট'));
  if (!el) return null;
  const parse = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (x) => 0.2126 * f(x[0]) + 0.7152 * f(x[1]) + 0.0722 * f(x[2]);
  const textEl = [...el.querySelectorAll('*')].find((n) => (n.innerText || '').trim() === 'সব প্রোডাক্ট') || el;
  const fg = getComputedStyle(textEl).color;
  let node = el; let bg = 'rgb(255,255,255)';
  while (node) { const c = getComputedStyle(node).backgroundColor; const a = parse(c)[3]; if (!/transparent/.test(c) && (a === undefined || a > 0.5)) { bg = c; break; } node = node.parentElement; }
  const L1 = lum(parse(fg)), L2 = lum(parse(bg));
  let op = 1; let n2 = textEl; while (n2) { op *= Number(getComputedStyle(n2).opacity); n2 = n2.parentElement; }
  return { fg, bg, effectiveOpacity: op, ratio: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2), cls: String(el.className).slice(0, 140) };
})()`;

(async () => {
  const b = await openBrowser({ headless: true });
  for (const theme of ['light', 'dark'] as const) {
    const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* */ } }, theme);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    console.log(theme, JSON.stringify(await p.evaluate(PROBE)));
    await ctx.close();
  }
  await b.close();
})().finally(() => db.$disconnect());
