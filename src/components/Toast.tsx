'use client';

import {
  createContext, useCallback, useContext, useEffect, useState, type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Kind = 'success' | 'error' | 'info' | 'warning';
type T = { id: string; kind: Kind; message: string };

type Ctx = {
  toast: (m: string, k?: Kind) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast must be inside <ToastProvider>');
  return c;
}

const STYLE: Record<Kind, { cls: string; icon: string }> = {
  success: { cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', icon: '✓' },
  error: { cls: 'border-red-300 bg-red-50 text-red-800', icon: '✕' },
  warning: { cls: 'border-amber-300 bg-amber-50 text-amber-800', icon: '⚠' },
  info: { cls: 'border-rose-300 bg-rose-50 text-rose-800', icon: 'ℹ' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<T[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((t) => t.filter((x: (typeof t)[number]) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: Kind = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      setTimeout(() => remove(id), kind === 'error' ? 6000 : 4000);
    },
    [remove]
  );

  const value: Ctx = {
    toast,
    success: useCallback((m: string) => toast(m, 'success'), [toast]),
    error: useCallback((m: string) => toast(m, 'error'), [toast]),
    info: useCallback((m: string) => toast(m, 'info'), [toast]),
  };

  return (
    <ToastCtx.Provider value={value}>
      {children}

      {/* ♿ aria-live — screen reader ঘোষণা করবে */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end"
      >
        <AnimatePresence mode="popLayout">
        {toasts.map((t: (typeof toasts)[number]) => {
          const s = STYLE[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border-2 px-4 py-3 shadow-xl ${s.cls}`}
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0 font-bold">{s.icon}</span>
              <p className="flex-1 text-sm leading-relaxed">{t.message}</p>
              <button
                onClick={() => remove(t.id)}
                aria-label="বন্ধ করুন"
                className="shrink-0 rounded p-0.5 opacity-60 transition hover:opacity-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          );
        })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/** ★ confirm() এর বদলে accessible modal — Escape, backdrop click, focus */
export function ConfirmDialog({
  open, title, message, confirmLabel = 'নিশ্চিত', cancelLabel = 'বাতিল',
  danger = false, onConfirm, onCancel, children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cd-title"
          className="fixed inset-0 z-[90] grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
        <h2 id="cd-title" className="text-lg font-bold text-slate-900">{title}</h2>
        {message && (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
            {message}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={onCancel} className="btn-ghost">{cancelLabel}</button>
              <button onClick={onConfirm} autoFocus className={danger ? 'btn-danger' : 'btn-primary'}>
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
