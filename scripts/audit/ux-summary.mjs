/**
 * ═══════════════════════════════════════════════════════════
 * ★ মোবাইল-অডিটের JSON → পড়ার মতো সারসংক্ষেপ
 *
 *   node scripts/audit/ux-summary.mjs <audit.json>
 *
 *   `mobile-ux-audit.mjs` প্রতি ভিউপোর্ট × প্রতি পাতার কাঁচা মাপ
 *   লেখে — হাজারো এন্ট্রি, চোখে দেখে সিদ্ধান্ত নেওয়া যায় না।
 *   এখানে একই ত্রুটি কতবার ও কোন রুটে এসেছে তা **গুনে** শীর্ষগুলো
 *   দেখানো হয়, কারণ ৩০০+ হিটের বেশিরভাগই গুটিকয় শেয়ার্ড
 *   কম্পোনেন্ট/টোকেন থেকে আসে — একটি সম্পাদনায় শত হিট সারে।
 *
 *   UIUX_PROBLEM_MAP.md এর সব সংখ্যা এই স্ক্রিপ্ট থেকেই এসেছে,
 *   তাই "আগে vs পরে" আবার মাপতে হলে এটিই চালাতে হবে।
 * ═══════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const taps = new Map(), zooms = new Map(), clips = new Map(), errs = new Map(), aa = new Map();
const routes = new Map();
for (const [vp, pages] of Object.entries(r.viewports)) for (const p of pages) {
  for (const t of p.smallTaps || []) {
    const k = `${String(t.h).padStart(3)}x${String(t.w).padStart(3)}  ${t.selector.slice(0,52)}  "${(t.text||'').trim().slice(0,18)}"`;
    bump(taps, k); if (!routes.has(k)) routes.set(k, new Set()); routes.get(k).add(p.route);
  }
  /* ★ aaTaps = টেবিল-ঘরের লেখা-লিংক: WCAG 2.5.8 AA (২৪px) পার করে,
     প্রকল্পের ৪০px নিয়মে পড়ে না — ইচ্ছাকৃত, তাই ত্রুটির তালিকা থেকে
     আলাদা। গোনা হয় যাতে সিদ্ধান্তটি অদৃশ্য না হয়ে যায়। */
  for (const t of p.aaTaps || []) bump(aa, `${String(t.h).padStart(3)}x${String(t.w).padStart(3)}  ${t.selector.slice(0,52)}  @${p.route}`);
  for (const z of p.zoomInputs || []) bump(zooms,`${z.fontSize}px  ${z.selector.slice(0,48)}  @${p.route}  [${vp.split('@')[0]}]`);
  for (const c of p.clipped || []) bump(clips, `${c.selector.slice(0,44)} :: ${(c.text||'').slice(0,28)} @${p.route}`);
  for (const e of p.consoleErrors || []) bump(errs, String(e).replace(/\s+/g,' ').slice(0,95));
}
const top = (m,n,t,withRoutes) => { console.log(`\n=== ${t} (${m.size}) ===`);
  [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n).forEach(([k,v])=>console.log(`  ${String(v).padStart(3)}× ${k}${withRoutes&&routes.get(k)?'  ['+[...routes.get(k)].slice(0,2).join(' ')+']':''}`)); };
top(taps,16,'ছোট ট্যাপ',true); top(zooms,8,'জুম'); top(clips,6,'ক্লিপ'); top(errs,8,'কনসোল');
top(aa,6,'AA-পাস টেবিল-লিংক (ত্রুটি নয়, ইচ্ছাকৃত ২৪px)');
