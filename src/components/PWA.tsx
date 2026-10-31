'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/i18n/I18nProvider';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ PWA — সার্ভিস-ওয়ার্কার রেজিস্ট্রেশন + "অ্যাপ ইনস্টল" প্রম্পট
 *
 *   দুটি কাজ:
 *   ১. প্রোডাকশনে `/sw.js` রেজিস্টার করে — "Add to Home Screen" যোগ্য
 *      হয় (dev-এ নয়, নাহলে HMR ভাঙে)।
 *   ২. `beforeinstallprompt` ধরে একটি দৃষ্টিনন্দন, বন্ধযোগ্য কার্ড দেখায়।
 *
 *   ── কেন নতুন করে লেখা (আগের সমস্যা) ──
 *   আগে বন্ধ করলে শুধু একটি স্থায়ী ফ্ল্যাগ বসত, কিন্তু `beforeinstallprompt`
 *   লিসেনার সচল থাকত — ব্রাউজার একই সেশনে ইভেন্টটি আবার পাঠালে পপআপ
 *   **আবার ফিরে আসত**। এখন:
 *     • বন্ধ করলে একটি **সময়ভিত্তিক backoff** বসে (১ম বার ১৪ দিন,
 *       ২য় বার ৪৫ দিন, ৩য় বার ১২০ দিন — তারপর আর দেখায় না)।
 *     • একই সেশনে বন্ধ করার পর একটি in-memory গার্ড পুনরায় দেখানো ঠেকায়।
 *     • ইনস্টল হয়ে গেলে (বা standalone মোডে) স্থায়ীভাবে বন্ধ।
 *   পেশাদার PWA প্যাটার্ন — উপলভ্য থাকে, কিন্তু বিরক্তিকর নয়।
 * ═══════════════════════════════════════════════════════════
 */

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const STORE_KEY = 'uid_pwa_v2';
const DAY = 86_400_000;
// ★ প্রতিবার বন্ধ করলে পরের বার দেখানোর আগে ন্যূনতম বিরতি (ক্রমবর্ধমান)।
//   তালিকা শেষ হলে আর কখনো দেখায় না।
const BACKOFF_DAYS = [14, 45, 120];
// ★ প্রথম দেখানোর আগে সামান্য বিলম্ব — ব্যবহারকারী একটু ব্রাউজ করার পর
//   (সাথে সাথে পপ করলে বিরক্তিকর ও কম রূপান্তরিত হয়)।
const FIRST_SHOW_DELAY = 3500;

type Store = { dismissedAt?: number; count?: number; installed?: boolean };

function readStore(): Store {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Store;
  } catch {
    return {};
  }
}
function writeStore(s: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode ইত্যাদি — নীরবে উপেক্ষা */
  }
}

/** এখন পপআপ দেখানো যায় কি না — backoff ও installed যাচাই */
function mayShow(s: Store): boolean {
  if (s.installed) return false;
  const count = s.count ?? 0;
  if (count >= BACKOFF_DAYS.length) return false; // সব backoff শেষ — আর নয়
  if (s.dismissedAt) {
    // সদ্য বন্ধ করা count-এর জন্য প্রযোজ্য বিরতি (আগের ধাপ)
    const waitDays = BACKOFF_DAYS[Math.min(count - 1, BACKOFF_DAYS.length - 1)] ?? 0;
    if (count > 0 && Date.now() - s.dismissedAt < waitDays * DAY) return false;
  }
  return true;
}

export default function PWA() {
  const t = useT();
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);
  // ★ একই সেশনে বন্ধ করার পর refired ইভেন্টে আর দেখাবে না
  const suppressedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── সার্ভিস-ওয়ার্কার (শুধু প্রোডাকশন) ──
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  // ── ইনস্টল প্রম্পট ধরা ──
  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      // ইতিমধ্যে ইনস্টল করা — স্থায়ীভাবে চিহ্নিত করি
      writeStore({ ...readStore(), installed: true });
      return;
    }

    if (!mayShow(readStore())) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      // ★ একই সেশনে বন্ধ করা থাকলে refired ইভেন্ট উপেক্ষা করি
      if (suppressedRef.current) return;
      setDeferred(e as BIPEvent);
      // সামান্য বিলম্বে দেখাই — সাথে সাথে নয়
      timerRef.current = setTimeout(() => {
        if (!suppressedRef.current) setShow(true);
      }, FIRST_SHOW_DELAY);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const onInstalled = () => {
      writeStore({ ...readStore(), installed: true });
      suppressedRef.current = true;
      setShow(false);
      setDeferred(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /** বন্ধ করা — count বাড়ে, backoff টাইমস্ট্যাম্প বসে, সেশন-গার্ড অন */
  function close() {
    suppressedRef.current = true;
    setShow(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    const s = readStore();
    writeStore({ ...s, count: (s.count ?? 0) + 1, dismissedAt: Date.now() });
  }

  async function install() {
    if (!deferred) return;
    let accepted = false;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      accepted = choice.outcome === 'accepted';
    } catch {
      /* prompt() দুবার ডাকা ইত্যাদি — নীরবে */
    }
    suppressedRef.current = true;
    setShow(false);
    setDeferred(null);
    if (accepted) {
      writeStore({ ...readStore(), installed: true });
    } else {
      // native প্রম্পটেও না বললে — বন্ধ করার মতোই backoff
      const s = readStore();
      writeStore({ ...s, count: (s.count ?? 0) + 1, dismissedAt: Date.now() });
    }
  }

  if (!show || !deferred) return null;

  return (
    <div
      className="animate-pop fixed bottom-[72px] left-3 right-3 z-[85] mx-auto max-w-sm md:bottom-5 md:left-5 md:right-auto"
      role="dialog"
      aria-label={t('pwa.title')}
    >
      <div
        className="v-panel relative flex items-center gap-3 p-3.5 pr-10"
        style={{ ['--nc' as string]: '12px', ['--panel-edge' as string]: 'var(--v-volt-surf)', ['--panel-fill' as string]: 'var(--v-steel)' }}
      >
        <button
          onClick={close}
          aria-label={t('common.close')}
          className="absolute right-1 top-1 grid h-9 w-9 place-items-center"
          style={{ color: 'var(--v-mut)' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>

        <span
          className="grid h-11 w-11 shrink-0 place-items-center"
          style={{ background: 'rgba(200,255,61,.14)', border: '1px solid rgba(200,255,61,.32)', borderRadius: 10, color: 'var(--v-volt)' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="v-dsp text-[13.5px] font-extrabold leading-snug" style={{ color: 'var(--v-ink)' }}>
            {t('pwa.title')}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: 'var(--v-mut)' }}>
            {t('pwa.subtitle')}
          </p>
        </div>

        <button onClick={install} className="v-btn v-btn--volt shrink-0" style={{ minHeight: 40, padding: '0 1rem', fontSize: '.8rem' }}>
          {t('pwa.install')}
        </button>
      </div>
    </div>
  );
}
