'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  type Locale,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  normalizeLocale,
  translate,
} from '@/lib/i18n';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ভাষা কনটেক্সট (ফিচার ১০)
 *
 *   `useT()` দেয় অনুবাদ ফাংশন; `useLocale()` দেয় বর্তমান ভাষা ও
 *   বদলানোর উপায়। ভাষা কুকিতে (LOCALE_COOKIE) থাকে যাতে পরের
 *   ভিজিটেও মনে থাকে ও সার্ভার <html lang> ঠিক দিতে পারে।
 * ═══════════════════════════════════════════════════════════
 */

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<Ctx | null>(null);

function readCookieLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  return normalizeLocale(m ? decodeURIComponent(m[1]) : null);
}

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);

  // ক্লায়েন্টে কুকি থেকে সিঙ্ক (সার্ভার initialLocale না দিলে)
  useEffect(() => {
    const c = readCookieLocale();
    if (c !== locale) setLocaleState(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    // এক বছর মেয়াদি কুকি
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    // <html lang> আপডেট করি (স্ক্রিন-রিডার/SEO)
    document.documentElement.lang = l;
  }, []);

  const t = useCallback((key: string) => translate(locale, key), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** অনুবাদ ফাংশন — t('nav.catalog') */
export function useT(): (key: string) => string {
  const ctx = useContext(I18nContext);
  // Provider এর বাইরে ডাকলেও ভাঙে না — বাংলা ফেরে
  if (!ctx) return (key: string) => translate(DEFAULT_LOCALE, key);
  return ctx.t;
}

/** বর্তমান ভাষা ও টগল */
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const ctx = useContext(I18nContext);
  if (!ctx) return { locale: DEFAULT_LOCALE, setLocale: () => {} };
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}
