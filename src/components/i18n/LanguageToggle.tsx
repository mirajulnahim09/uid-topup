'use client';

import { useLocale } from './I18nProvider';
import { LOCALES, LOCALE_LABEL } from '@/lib/i18n';

/**
 * ★ ভাষা টগল (ফিচার ১০) — বাংলা ↔ English
 *   কম্প্যাক্ট: দুই বোতাম, সক্রিয়টি হাইলাইট। কুকিতে সেভ হয়,
 *   পরের ভিজিটেও মনে থাকে। compact=true হলে ছোট আকার (মোবাইল)।
 */
export default function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      className="inline-flex items-center rounded-full border p-0.5"
      style={{ borderColor: 'var(--v-edge)', background: 'var(--v-fill)' }}
      role="group"
      aria-label="ভাষা / Language"
    >
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={active}
            className={`rounded-full font-bold transition ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'}`}
            style={
              active
                ? { background: '#7c3aed', color: '#fff' }
                : { background: 'transparent', color: 'var(--v-mut)' }
            }
          >
            {l === 'bn' ? 'বাং' : 'EN'}
            <span className="sr-only">{LOCALE_LABEL[l]}</span>
          </button>
        );
      })}
    </div>
  );
}
