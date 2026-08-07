/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ থিম-init স্ক্রিপ্ট — সার্ভার ও edge দুই জায়গা থেকেই দরকার
 *
 *   ── কেন `ThemeProvider.tsx` থেকে সরানো হলো (H3) ──
 *   `middleware.ts` (edge runtime) এই স্ট্রিংটির SHA-256 হ্যাশ CSP-তে
 *   বসায়। কিন্তু `ThemeProvider.tsx` একটি `'use client'` কম্পোনেন্ট —
 *   সেখান থেকে import করলে React ও পুরো কম্পোনেন্ট গাছ edge বান্ডলে
 *   ঢুকে যেত। তাই ধ্রুবকগুলো এখানে, নির্ভরতা-বিহীন একটি মডিউলে।
 *
 *   ⚠️ এই স্ট্রিং বদলালে CSP হ্যাশও বদলাবে — সেটি রানটাইমে গণনা হয়,
 *   তাই হাতে কিছু হালনাগাদ করতে হয় না। কিন্তু **স্ট্রিংটি স্থির
 *   থাকতে হবে** (কোনো per-request মান ঢোকানো যাবে না), নাহলে হ্যাশ
 *   প্রতি অনুরোধে বদলে যাবে ও ক্যাশিং অর্থহীন হবে।
 * ═══════════════════════════════════════════════════════════
 */
export const THEME_KEY = 'theme';
export const ACCENT_KEY = 'accent';

/**
 * ★ প্রথম paint-এর আগেই সংরক্ষিত থিম বসায় — নাহলে গাঢ় থিমে
 *   এক ঝলক সাদা দেখা যেত (FOUC)।
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.accent=localStorage.getItem('${ACCENT_KEY}')||'lime';}catch(e){document.documentElement.dataset.theme='dark';document.documentElement.dataset.accent='lime';}})();`;
