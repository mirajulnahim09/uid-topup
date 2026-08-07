'use client';

import { SessionProvider } from 'next-auth/react';
import { MotionConfig } from 'framer-motion';
import { ToastProvider } from './Toast';
import ErrorBoundary from './ErrorBoundary';
import LoadingProvider from './fx/LoadingProvider';
import { I18nProvider } from './i18n/I18nProvider';
import type { Locale } from '@/lib/i18n';

export default function Providers({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  return (
    <SessionProvider
      // ★ ৫ মিনিট পর পর refetch — ban/role change ধরবে
      refetchInterval={5 * 60}
      refetchOnWindowFocus
    >
      {/* ★ যারা animation কমাতে চান (OS সেটিং) — তাদের জন্য সব animation বন্ধ */}
      <MotionConfig reducedMotion="user">
        <I18nProvider initialLocale={initialLocale}>
          {/* ★ LoadingProvider অবশ্যই I18nProvider এর ভেতরে — ওভারলের
              লেবেল গ্রাহকের ভাষায় দেখাতে `useT()` লাগে।

              ⚠️ পুরনো `NavProgress` মুছে ফেলা হয়েছে: তার কাজ (উপরের
              অগ্রগতি-রেখা) এখন এই প্রোভাইডারের **ambient স্তর**।
              দুটি আলাদা লোডিং ব্যবস্থা রাখলে একই ন্যাভিগেশনে দুটো
              বার একসাথে চলত। */}
          <LoadingProvider>
            <ToastProvider>
              <ErrorBoundary>{children}</ErrorBoundary>
            </ToastProvider>
          </LoadingProvider>
        </I18nProvider>
      </MotionConfig>
    </SessionProvider>
  );
}
