'use client';

import { useEffect } from 'react';

/**
 * Buttons that start a full-page redirect (Google sign-in, sign-out) stay
 * busy while the browser leaves. If the user comes back with the Back button,
 * the page can be restored from the back/forward cache with that state frozen
 * ("please wait…", disabled) — call `reset` whenever that happens.
 * `reset` must be stable (useCallback / state setter wrapper).
 */
export function useResetOnBfcacheRestore(reset: () => void): void {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) reset(); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reset]);
}
