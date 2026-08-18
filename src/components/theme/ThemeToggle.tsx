'use client';

import { useTheme, type ThemeChoice } from './ThemeProvider';
import { useT } from '@/components/i18n/I18nProvider';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ থিম টগল — Light → Dark → System, **একটিই বোতাম**
 *
 *   ── কেন সেগমেন্টেড কন্ট্রোল থেকে সরানো হলো ──
 *   আগে তিনটি আলাদা বোতাম ছিল, প্রতিটি **২৮×২৮px**। অডিটে
 *   (৫১৪ পাতা-মাপ) এই তিনটিই ছিল সবচেয়ে বড় একক ত্রুটি —
 *   **৩০০টি** "ছোট ট্যাপ-টার্গেট" হিটের উৎস। ৪৪px আঙুলের
 *   জন্য ২৮px লক্ষ্য মানে প্রতিবার ভুল বোতামে চাপ পড়ার ঝুঁকি।
 *
 *   তিনটিকে ৪০px করলে কন্ট্রোলটি ~১২৮px চওড়া হতো, আর
 *   ৩২০px ফোনে অ্যাডমিন হেডারে ইতিমধ্যেই আছে ব্র্যান্ড-চিপ,
 *   "সাইটে ফিরুন" ও লগআউট — সারিটি উপচে পড়ত। একটিই বোতাম
 *   দুটো সমস্যাই একসাথে মেটায়: লক্ষ্য ৪০px, আর হেডারে
 *   ~৮৮px জায়গা ফেরত আসে।
 *
 *   ⚠️ **কোনো বিকল্প হারায়নি** — তিনটি মোডই আছে, কেবল ক্রমে।
 *   বর্তমান মোডের আইকন দেখায়, `aria-label`/`title` বলে দেয়
 *   এখন কী আছে ও চাপলে কী হবে। স্ক্রিন-রিডারে অবস্থা ঘোষিত।
 *
 *   ইমোজি নয়, SVG (প্ল্যাটফর্মভেদে বদলায় না — CLAUDE.md §7)।
 * ═══════════════════════════════════════════════════════════
 */

function Moon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function Sun() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function Monitor() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/** ক্রম — চাপলে পরেরটিতে যায়, তারপর আবার প্রথমটিতে */
const CYCLE: ThemeChoice[] = ['light', 'dark', 'system'];
const ICON: Record<ThemeChoice, React.ReactNode> = {
  light: <Sun />,
  dark: <Moon />,
  system: <Monitor />,
};

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const t = useT();

  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];
  const nowLabel = t('theme.' + theme);
  const nextLabel = t('theme.' + next);

  return (
    <button
      type="button"
      /* ★ পুরনো hook/স্ক্রিপ্টের জন্য অ্যাট্রিবিউটটি রাখা হলো —
         এখন এটি **বর্তমান** পছন্দ জানায় */
      data-theme-choice={theme}
      onClick={() => setTheme(next)}
      title={`${nowLabel} → ${nextLabel}`}
      aria-label={`${t('theme.label')}: ${nowLabel}`}
      /* ★ ৪০px — এই প্রকল্পের ন্যূনতম ছোঁয়ার মাপ (§17)।
         compact-এও ৪০, কারণ আঙুল ছোট হয় না। */
      className={`grid shrink-0 place-items-center rounded-full border transition ${compact ? 'h-10 w-10' : 'h-10 w-10'}`}
      style={{ borderColor: 'var(--v-edge)', background: 'var(--v-fill)', color: 'var(--v-ink)' }}
    >
      {ICON[theme]}
      {/* ★ অবস্থাটি স্ক্রিন-রিডারে পড়া যায়, চোখে নয় */}
      <span className="sr-only">{nowLabel}</span>
    </button>
  );
}
