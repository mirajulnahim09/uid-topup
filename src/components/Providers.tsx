'use client';

import { SessionProvider } from 'next-auth/react';
import { MotionConfig } from 'framer-motion';
import { ToastProvider } from './Toast';
import ErrorBoundary from './ErrorBoundary';
import NavProgress from './NavProgress';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // ★ ৫ মিনিট পর পর refetch — ban/role change ধরবে
      refetchInterval={5 * 60}
      refetchOnWindowFocus
    >
      {/* ★ যারা animation কমাতে চান (OS সেটিং) — তাদের জন্য সব animation বন্ধ */}
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <NavProgress />
          <ErrorBoundary>{children}</ErrorBoundary>
        </ToastProvider>
      </MotionConfig>
    </SessionProvider>
  );
}
