'use client';

import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Kind = 'success' | 'error' | 'info' | 'warning';
type T = { id: string; kind: Kind; message: string };

type Ctx = {
  toast: (m: string, k?: Kind) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
  warning: (m: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast must be inside <ToastProvider>');
  return c;
}

/**
 * ★ ভূমিকা → ক্লাস + আইকন।
 *
 *   ⚠️ এখানে **কোনো Tailwind প্যালেট-ক্লাস নেই** (`bg-emerald-50`,
 *   `text-rose-800` …)। কারণ `globals.css`-এর legacy-bridge ব্লক
 *   ওই ক্লাসগুলোকে `!important` দিয়ে পুনর্লিখন করে — inline প্যানেলের
 *   জন্য বানানো ১২% অস্বচ্ছ ফিল ও গুলিয়ে-যাওয়া ভূমিকা-রঙ। তাতে
 *   info দেখতে হুবহু error এর মতো হতো আর navbar টোস্টের ভেতর দিয়ে
 *   দেখা যেত। রঙ এখন `--v-toast-*` টোকেনে, `.v-toast--*` ক্লাসে।
 *
 *   আইকন টেক্সট-গ্লিফ (`✓ ✕ ⚠ ℹ`) থেকে **SVG**-তে সরানো হয়েছে:
 *   গ্লিফগুলো ফন্টভেদে আলাদা প্রস্থ/বেসলাইন নেয়, বাংলা লেখার পাশে
 *   বসলে লাইন-বক্স টেনে বিন্যাস ভেঙে দিত।
 */
const STYLE: Record<Kind, { cls: string; icon: ReactNode }> = {
  success: {
    cls: 'v-toast--success',
    icon: <path d="M20 6L9 17l-5-5" />,
  },
  error: {
    cls: 'v-toast--error',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
  },
  warning: {
    cls: 'v-toast--warning',
    icon: <><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  },
  info: {
    cls: 'v-toast--info',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  },
};

/** একসাথে সর্বোচ্চ কয়টি টোস্ট দেখানো হবে */
const MAX_STACK = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<T[]>([]);
  /** ★ টাইমার ref — unmount-এ পরিষ্কার করতে (আগে leak হতো) */
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: Kind = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // ★ আগে ছিল `[...t.slice(-3), new]` — অর্থাৎ ৪টি জমত। এখন
      //   যোগ করে **তারপর** কাটি, তাই সীমা সত্যিই MAX_STACK।
      setToasts((list) => [...list, { id, kind, message }].slice(-MAX_STACK));
      timers.current.set(id, setTimeout(() => remove(id), kind === 'error' ? 6000 : 4000));
    },
    [remove]
  );

  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); map.clear(); };
  }, []);

  /**
   * ★★★ sticky হেডারের ঠিক নিচে বসানো।
   *
   *   আগে হোস্ট `sm:top-0` ছিল, অর্থাৎ টোস্ট **navbar-এর উপরে** বসত
   *   (navbar z-40, টোস্ট z-100)। পৃষ্ঠতল স্বচ্ছ হওয়ায় থিম-টগল ও
   *   "রেজিস্টার" বোতাম টোস্টের ভেতর দিয়ে দেখা যেত — ঠিক যাকে
   *   "আইকন ওভারল্যাপ / লেখা ভাঙা" বলা হয়েছে।
   *
   *   উচ্চতা পাতাভেদে আলাদা (পাবলিক ৭০px · অ্যাডমিন ৬৯+৫৯=১২৮px),
   *   তাই স্থির মান বসানো যায় না — রানটাইমে মেপে নিই।
   */
  const [hostTop, setHostTop] = useState(88);
  useLayoutEffect(() => {
    if (!toasts.length) return;
    let bottom = 0;
    document.querySelectorAll<HTMLElement>('header, nav').forEach((el) => {
      const pos = getComputedStyle(el).position;
      if (pos !== 'sticky' && pos !== 'fixed') return;
      const r = el.getBoundingClientRect();
      // ভিউপোর্টের উপরে আটকে থাকা বার-ই কেবল গোনা
      if (r.height > 0 && r.top <= 8 && r.bottom > bottom) bottom = r.bottom;
      else if (r.height > 0 && r.top > 0 && r.top < 200 && r.bottom > bottom) bottom = r.bottom;
    });
    setHostTop(Math.round(bottom) + 12);
  }, [toasts.length]);

  const value: Ctx = {
    toast,
    success: useCallback((m: string) => toast(m, 'success'), [toast]),
    error: useCallback((m: string) => toast(m, 'error'), [toast]),
    info: useCallback((m: string) => toast(m, 'info'), [toast]),
    warning: useCallback((m: string) => toast(m, 'warning'), [toast]),
  };

  return (
    <ToastCtx.Provider value={value}>
      {children}

      {/* ♿ aria-live — screen reader ঘোষণা করবে */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="v-toast-host"
        style={{ ['--v-toast-top' as string]: `${hostTop}px` } as React.CSSProperties}
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => {
            const s = STYLE[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: -12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 48, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                role={t.kind === 'error' ? 'alert' : 'status'}
                className={`v-toast ${s.cls}`}
              >
                <span aria-hidden="true" className="v-toast__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round">
                    {s.icon}
                  </svg>
                </span>
                <p className="v-toast__msg">{t.message}</p>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  aria-label="বন্ধ করুন"
                  className="v-toast__x"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
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
  const panelRef = useRef<HTMLDivElement>(null);
  // ★★★ BUG-fix: ডাবল-ক্লিক গার্ড। onConfirm সাধারণত async কাজ শুরু করে
  //   (অর্ডার/পেমেন্ট) কিন্তু dialog বন্ধ হতে এক re-render লাগে — সেই
  //   ফাঁকে দ্রুত দ্বিতীয় ক্লিক দ্বিতীয়বার onConfirm চালাত (double-order/
  //   double-action)। প্রথম ক্লিকেই বাটন disable করি। open বদলালে reset।
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (!open) setConfirming(false); }, [open]);

  useEffect(() => {
    if (!open) return;
    // ★ কীবোর্ড: Escape বন্ধ করে, আর Tab ফোকাস ডায়ালগের ভেতরেই আটকে
    //   রাখে (focus trap) — নাহলে Tab চাপলে ফোকাস পেছনের পাতায় চলে
    //   যেত, যা modal-এর জন্য WCAG 2.4.3 ভাঙে। শুধু কীবোর্ড আচরণ যোগ;
    //   দৃশ্য/লজিক অপরিবর্তিত।
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
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
            ref={panelRef}
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
              <button
                onClick={() => { if (confirming) return; setConfirming(true); onConfirm(); }}
                disabled={confirming}
                autoFocus
                className={danger ? 'btn-danger' : 'btn-primary'}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
