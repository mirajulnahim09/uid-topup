'use client';

import { useLocale } from './I18nProvider';
import { LOCALES, LOCALE_LABEL } from '@/lib/i18n';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ভাষা টগল — বাংলা ↔ English, **একটিই বোতাম**
 *
 *   আগে দুটি বোতাম ছিল, প্রতিটির উচ্চতা **২৭px** — অডিটে
 *   ৬০টি "ছোট ট্যাপ-টার্গেট" হিট। দুটি বিকল্পের মধ্যে টগলের
 *   জন্য দুটি বোতাম এমনিতেও অপ্রয়োজনীয়: বোতামটি এখন
 *   **যে ভাষায় যাওয়া যাবে** সেটিই দেখায় (বাংলায় থাকলে "EN")।
 *   ফল: লক্ষ্য ৪০px, হেডারে অর্ধেক জায়গা, আর ThemeToggle-এর
 *   সাথে একই আকার — সারিটি এখন সুসংগত দেখায়।
 *
 *   ⚠️ দুটি ভাষাই আগের মতোই পৌঁছানো যায়; পছন্দ কুকিতে সেভ
 *   হয়ে পরের ভিজিটেও থাকে (আচরণ অপরিবর্তিত)।
 *
 *   ⚠️ রঙ আগে `#7c3aed` হার্ডকোড ছিল — CLAUDE.md §1 অনুযায়ী
 *   রঙ কেবল টোকেনে থাকে, তাই টোকেনে সরানো হলো।
 * ═══════════════════════════════════════════════════════════
 */
export default function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();

  // ★ দুইয়ের বেশি ভাষা যোগ হলেও কাজ করে — ক্রমে পরেরটি
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length];
  const shortOf = (l: string) => (l === 'bn' ? 'বাং' : 'EN');

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      title={`${LOCALE_LABEL[locale]} → ${LOCALE_LABEL[next]}`}
      aria-label={`ভাষা / Language: ${LOCALE_LABEL[locale]}`}
      /* ★ ৪০px ন্যূনতম — ThemeToggle এর সাথে হুবহু এক মাপ */
      className={`grid h-10 shrink-0 place-items-center rounded-full border font-bold transition ${
        compact ? 'min-w-[40px] px-2 text-[11px]' : 'min-w-[40px] px-2.5 text-xs'
      }`}
      style={{ borderColor: 'var(--v-edge)', background: 'var(--v-fill)', color: 'var(--v-ink)' }}
    >
      {shortOf(next)}
      <span className="sr-only">{LOCALE_LABEL[locale]}</span>
    </button>
  );
}
