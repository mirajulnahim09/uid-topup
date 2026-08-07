'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ থিম কনটেক্সট — Dark / Light / System (Auto)
 *
 *   • পছন্দ localStorage('theme') এ থাকে — পরের ভিজিটেও মনে থাকে।
 *   • 'system' হলে OS এর prefers-color-scheme অনুসরণ করে এবং OS
 *     বদলালে লাইভ আপডেট হয়।
 *   • প্রকৃত রঙ CSS টোকেনে; এখানে শুধু `<html data-theme>` স্ট্যাম্প।
 *   • flash এড়াতে প্রথম রঙ layout এর inline স্ক্রিপ্ট আগেই বসিয়ে দেয়;
 *     এই Provider সেটির সাথে state সিঙ্ক করে।
 *   • বদলানোর মুহূর্তে `.theme-anim` ক্লাস মসৃণ ট্রানজিশন দেয়
 *     (reduced-motion হলে বৈশ্বিক নিয়ম সেটিকেও থামায়)।
 * ═══════════════════════════════════════════════════════════
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type Resolved = 'light' | 'dark';
export type AccentChoice = 'lime' | 'purple' | 'blue' | 'red' | 'orange';
export const ACCENTS: AccentChoice[] = ['lime', 'purple', 'blue', 'red', 'orange'];

// ★ H3 — ধ্রুবক ও init-স্ক্রিপ্ট এখন `@/lib/themeScript` এ, কারণ
//   middleware (edge) কেও স্ক্রিপ্টটির হ্যাশ লাগে আর এই ফাইলটি
//   `'use client'`। এখান থেকে পুনঃরপ্তানি করা হয় যাতে বিদ্যমান
//   import পথগুলো অক্ষত থাকে।
export { THEME_KEY, ACCENT_KEY, THEME_INIT_SCRIPT } from '@/lib/themeScript';
import { THEME_KEY, ACCENT_KEY } from '@/lib/themeScript';

type Ctx = {
  theme: ThemeChoice;      // ইউজারের পছন্দ (system সহ)
  resolved: Resolved;      // আসলে যা দেখানো হচ্ছে
  setTheme: (t: ThemeChoice) => void;
  accent: AccentChoice;
  setAccent: (a: AccentChoice) => void;
};

const ThemeContext = createContext<Ctx | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(choice: ThemeChoice): Resolved {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<Resolved>('dark');
  const [accent, setAccentState] = useState<AccentChoice>('lime');
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** `<html data-theme>` + মেটা theme-color সেট করি, ঐচ্ছিক ট্রানজিশন সহ */
  const apply = useCallback((next: Resolved, animate: boolean) => {
    const html = document.documentElement;
    if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      html.classList.add('theme-anim');
      if (animTimer.current) clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => html.classList.remove('theme-anim'), 400);
    }
    html.dataset.theme = next;

    /**
     * ★★★ M5 — মেটা theme-color এখন **টোকেন থেকে** পড়া হয়।
     *   আগে `next === 'dark' ? '#0a0b11' : '#f4f6fb'` হার্ডকোড ছিল —
     *   অর্থাৎ একই রঙ দুই জায়গায়। `globals.css`-এ `--v-void` বদলালে
     *   ব্রাউজারের অ্যাড্রেস-বার/স্ট্যাটাস-বার পুরনো রঙেই থেকে যেত
     *   আর কেউ টের পেত না (মোবাইলে ছাড়া চোখেও পড়ে না)।
     *   `dataset.theme` উপরে বসানোর পর `getComputedStyle` নতুন মানই দেয়।
     *   ⚠️ fallback রাখা হয়েছে — টোকেন কোনো কারণে খালি এলে (খুব
     *   আগেভাগে কল, বা CSS লোড হয়নি) মেটা ট্যাগ যেন খালি না হয়।
     */
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const token = getComputedStyle(html).getPropertyValue('--v-void').trim();
      meta.setAttribute('content', token || (next === 'dark' ? '#0a0b11' : '#f4f6fb'));
    }
    setResolved(next);
  }, []);

  // মাউন্টে: সংরক্ষিত পছন্দ পড়ি (inline স্ক্রিপ্ট ইতিমধ্যে রঙ বসিয়েছে)
  useEffect(() => {
    let stored: ThemeChoice = 'system';
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') stored = v;
    } catch { /* */ }
    setThemeState(stored);
    /**
     * ★★★ M5 — আগে এখানে কেবল `setResolved(...)` ছিল, `apply()` নয়।
     *   ফলে মাউন্টে মেটা `theme-color` **কখনো হালনাগাদ হতো না** —
     *   `layout.tsx` এর স্থির `themeColor: '#0a0b11'` রয়ে যেত।
     *   বাস্তব প্রভাব: light থিমের ব্যবহারকারী প্রতিবার পাতা লোডে
     *   মোবাইল ব্রাউজারের অ্যাড্রেস-বার **গাঢ়** দেখতেন, যতক্ষণ না
     *   নিজে হাতে থিম টগল করেন। ইনলাইন স্ক্রিপ্ট রঙ ঠিক করত, কিন্তু
     *   মেটা ট্যাগ ছোঁয়াই হতো না।
     *   ⚠️ animate=false — মাউন্টে ট্রানজিশন দিলে প্রথম রেন্ডারেই
     *   অপ্রয়োজনীয় ঝলক হতো।
     */
    apply(resolve(stored), false);

    let a: AccentChoice = 'lime';
    try {
      const v = localStorage.getItem(ACCENT_KEY);
      if (v && (ACCENTS as string[]).includes(v)) a = v as AccentChoice;
    } catch { /* */ }
    setAccentState(a);
    document.documentElement.dataset.accent = a;
  }, [apply]);

  // 'system' হলে OS পরিবর্তন লাইভ শোনে
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply(mq.matches ? 'dark' : 'light', true);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, apply]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* */ }
    apply(resolve(next), true);
  }, [apply]);

  const setAccent = useCallback((next: AccentChoice) => {
    setAccentState(next);
    try { localStorage.setItem(ACCENT_KEY, next); } catch { /* */ }
    const html = document.documentElement;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      html.classList.add('theme-anim');
      if (animTimer.current) clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => html.classList.remove('theme-anim'), 400);
    }
    html.dataset.accent = next;
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme, accent, setAccent }), [theme, resolved, setTheme, accent, setAccent]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  // Provider এর বাইরে ডাকলেও ভাঙে না
  if (!ctx) return { theme: 'system', resolved: 'dark', setTheme: () => {}, accent: 'lime', setAccent: () => {} };
  return ctx;
}

/**
 * ★ flash-প্রতিরোধী inline স্ক্রিপ্ট — layout এর <head> এ বসে, প্রথম
 *   paint এর আগেই `data-theme` সেট করে। এই স্ট্রিং সরাসরি dangerouslySet
 *   করা হয় (কোনো ইউজার-ইনপুট নেই, তাই নিরাপদ)।
 */
// ★ THEME_INIT_SCRIPT উপরে `@/lib/themeScript` থেকে পুনঃরপ্তানি করা হয়েছে।
