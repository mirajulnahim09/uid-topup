'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import LoadingStage from '@/components/loading/LoadingStage';
import { useT } from '@/components/i18n/I18nProvider';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ বৈশ্বিক লোডিং ওভারলে — একটিই "কিছু হচ্ছে" ভাষা
 *
 *   ── সমস্যা ──
 *   এতদিন প্রতিটি ফর্ম নিজের মতো অপেক্ষা দেখাত: কোথাও বোতামের
 *   লেখা বদলাত, কোথাও কিছুই হতো না — ৪৫টি mutation কল-সাইটের
 *   আচরণ ৪৫ রকম। ধীর নেটওয়ার্কে গ্রাহক বুঝত না অর্ডার গেছে কি
 *   না, তাই **দুবার ক্লিক** করত।
 *
 *   ── সমাধান ও কেন এইভাবে ──
 *   ৪৫টি ফাইলে হাত না দিয়ে **একটিমাত্র জায়গায়** `window.fetch`
 *   মুড়ে দেওয়া হয়েছে। ফলে আজকের ও **ভবিষ্যতের** প্রতিটি
 *   mutation/আপলোড/পেমেন্ট স্বয়ংক্রিয়ভাবে ঢাকা পড়ে — কল-সাইটে
 *   কোনো কোড যোগ করতে হয় না, ভুলে যাওয়ার সুযোগও নেই।
 *
 *   ── তিনটি সংযমের নিয়ম (নাহলে এটি অত্যাচার হতো) ──
 *   ১. **GET কখনো ওভারলে দেখায় না।** পড়া মানে অপেক্ষা করানো নয়;
 *      ব্যালেন্স/নোটিফিকেশন পোলিং নীরবেই চলে (req: "non-blocking
 *      where appropriate")।
 *   ২. **GRACE বিলম্ব** — ২৬০ms এর আগে শেষ হওয়া কাজ কিছুই দেখায়
 *      না। দ্রুত কাজে ওভারলে ঝলকানো কিছু না-দেখানোর চেয়ে খারাপ।
 *   ৩. **MIN_SHOW** — একবার দেখা গেলে অন্তত ৪২০ms থাকে, নাহলে
 *      চোখের সামনে strobe করত।
 *
 *   ⚠️ SAFETY_MS: কোনো কারণে promise কখনো settle না করলেও ওভারলে
 *   ২০ সেকেন্ডে নিজে থেকে সরে যায়। গ্রাহককে কখনো পর্দার পেছনে
 *   আটকে রাখা যাবে না — এটি আপসযোগ্য নয়।
 *
 *   ⚠️ অবশ্যই `I18nProvider` এর **ভেতরে** মাউন্ট করতে হবে (লেবেল
 *   অনুবাদের জন্য) — `Providers.tsx` দেখুন।
 * ═══════════════════════════════════════════════════════════
 */

/**
 * ★★★ দুটি স্তর — "blocking" ও "ambient" (ব্রিফ: *use blocking and
 *   non-blocking loading intelligently depending on the action*)
 *
 *   • **blocking** — পূর্ণপর্দা শক্তি-কেন্দ্র, ইনপুট আটকায়।
 *     কেবল সেসব কাজে যেখানে দুবার ক্লিক **ক্ষতিকর**: টাকা
 *     (অর্ডার/ডিপোজিট/পেমেন্ট), পরিচয় (লগইন/রেজিস্টার), আপলোড।
 *   • **ambient** — উপরে সরু শক্তি-রেখা, কিছুই আটকায় না।
 *     বাকি সব: অ্যাডমিন সেভ, তালিকা রিফ্রেশ, রুট বদল।
 *
 *   ভুল স্তর বাছলে সিস্টেমটাই অত্যাচার হয়ে যেত — প্রতিটি ছোট
 *   অ্যাডমিন টগলে পুরো পর্দা ঢেকে দেওয়া ভয়ানক UX।
 */
type Tier = 'block' | 'ambient';

/** blocking কাজ — দুবার ক্লিক ক্ষতিকর, তাই পর্দা আটকানো হয় */
const BLOCKING_PATHS: RegExp[] = [
  /^\/api\/(order|smm-order|checkout)/,
  /^\/api\/deposit/,
  /^\/api\/payment/,
  /^\/api\/(register|reset-password|forgot-password)/,
  /^\/api\/auth\/(callback|signin|signout)/,
  /upload/,
];

/** এর চেয়ে দ্রুত শেষ হলে কিছুই দেখানো হয় না (ঝলকানি রোধ) */
const GRACE_MS = 220;
/** টাকা/পরিচয়/আপলোড — প্রায় সাথে সাথেই ঢাকা পড়া উচিত */
const CRITICAL_GRACE_MS = 120;
/** ambient রেখা সস্তা ও অ-বিঘ্নকারী — একটু আগেই দেখানো যায় */
const AMBIENT_GRACE_MS = 180;
/**
 * পাতা বদল — গ্রাহক স্পষ্টভাবে এখানে ওভারলে **দেখতে চান**, তাই
 * grace ছোট। তবু শূন্য নয়: তাৎক্ষণিক (ক্যাশড) ন্যাভিগেশনে ঝলকানি
 * এড়াতে সামান্য দেরি দরকার।
 */
const ROUTE_GRACE_MS = 150;
/** একবার দেখা গেলে ন্যূনতম যতক্ষণ থাকবে */
const MIN_SHOW_MS = 420;
/** fade-out এর দৈর্ঘ্য — CSS `.v-ovl--out` এর সমান রাখতে হবে */
const FADE_MS = 220;
/** শেষ রক্ষা — আটকে যাওয়া কাজ এতক্ষণে জোর করে ছেড়ে দেওয়া হয় */
const SAFETY_MS = 20_000;

/**
 * ★ যেসব mutation ইচ্ছাকৃতভাবে নীরব — ব্যাকগ্রাউন্ড কাজ, গ্রাহক
 *   এগুলোর জন্য অপেক্ষা করে নেই।
 *   · `/api/notifications` PATCH — বেল খুললে "পড়া হয়েছে" চিহ্ন
 *   · `/api/auth/_log`      — next-auth এর ক্লায়েন্ট-লগ
 */
const SILENT_PATHS: RegExp[] = [/^\/api\/notifications\/?$/, /^\/api\/auth\/_log\/?$/];

/** এই হেডার দিলে যেকোনো অনুরোধ নীরব — ভবিষ্যতের ব্যাকগ্রাউন্ড কাজের জন্য */
export const SILENT_HEADER = 'x-volt-silent';

/*
 * ⚠️ `claimLoadingScope()` সরানো হয়েছে (২০২৬-০৮-০৬ একত্রীকরণ)।
 *
 *   ওটি ছিল দুটি সমান্তরাল ওভারলে-ব্যবস্থার মধ্যে সংঘাত এড়ানোর
 *   জোড়াতালি — লগইনের নিজস্ব ম্যাসকট গ্লোবাল ওভারলেকে চুপ করাত।
 *   এখন ওভারলে **একটিই**, তাই সংঘাতের উৎসই নেই এবং দাবির
 *   ব্যবস্থাটিও অপ্রয়োজনীয়। সমস্যা সমাধান নয়, সমস্যা বিলুপ্ত।
 */

type Job = { label: string; at: number; grace: number; tier: Tier };

type StartOpts = { tier?: Tier; grace?: number };

type LoadingApi = {
  /** কাজ শুরু — ফেরত আসা id দিয়ে `stop()` ডাকতে হবে */
  start: (label?: string, opts?: StartOpts) => number;
  stop: (id: number) => void;
  /** যেকোনো async কাজ মুড়ে দেওয়ার সহজ উপায় (fetch নয় এমন কাজেও) */
  withLoading: <T>(fn: () => Promise<T>, label?: string, opts?: StartOpts) => Promise<T>;
};

const Ctx = createContext<LoadingApi | null>(null);

/** যেকোনো ক্লায়েন্ট কম্পোনেন্ট থেকে ম্যানুয়াল নিয়ন্ত্রণ */
export function useLoading(): LoadingApi {
  const ctx = useContext(Ctx);
  // ★ Provider ছাড়া ব্যবহার হলেও কখনো ক্র্যাশ করবে না (no-op)
  return ctx ?? NOOP_API;
}

const NOOP_API: LoadingApi = {
  start: () => -1,
  stop: () => {},
  withLoading: (fn) => fn(),
};

/**
 * ★ কোন স্তরে দেখানো হবে।
 *
 *   ⚠️ **সিদ্ধান্ত বদলেছে (গ্রাহকের নির্দেশে):** এখন প্রতিটি
 *   mutation ও প্রতিটি পাতা-বদল পূর্ণ ওভারলে দেখায় — "সব সেক্টরে,
 *   পাতা বদলের সময়ও"। আগে অ্যাডমিন সেভ/তালিকা রিফ্রেশ কেবল উপরের
 *   রেখা দেখাত।
 *
 *   `BLOCKING_PATHS` তবু রাখা হয়েছে: ওগুলো টাকা/পরিচয়/আপলোড, যেগুলো
 *   grace ছাড়াই সাথে সাথে ঢাকা পড়া উচিত (নিচে `graceFor` দেখুন)।
 *
 *   ⚠️ যা বদলায়নি: **GET কখনো ওভারলে দেখায় না**। ব্যালেন্স-পোলিং
 *   ৫.২ সেকেন্ড পর্যন্ত লাগে — পড়াকে ব্লক করলে প্রতিটি পেজ লোড
 *   পাঁচ সেকেন্ড আটকে থাকত।
 */
function tierFor(_path: string, _upload: boolean): Tier {
  return 'block';
}

/** টাকা/আপলোডে দ্রুত, বাকি কাজে সামান্য অপেক্ষা (ঝলকানি রোধ) */
function graceFor(path: string, upload: boolean): number {
  return upload || BLOCKING_PATHS.some((re) => re.test(path)) ? CRITICAL_GRACE_MS : GRACE_MS;
}

/* ─────────── অনুরোধ শ্রেণিবিভাগ (বিশুদ্ধ সহায়ক) ─────────── */

function hasHeader(init: RequestInit | undefined, name: string): boolean {
  const h = init?.headers;
  if (!h) return false;
  if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get(name) !== null;
  if (Array.isArray(h)) return h.some((p) => String(p[0]).toLowerCase() === name);
  return Object.keys(h as Record<string, string>).some((k) => k.toLowerCase() === name);
}

function pathOf(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}

export default function LoadingProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const path = usePathname();

  // ★ ref-এ রাখা হয় যাতে ভাষা বদলালে fetch-মোড়ক আবার বসাতে না হয়
  const tRef = useRef(t);
  tRef.current = t;

  // ── চলমান কাজের খাতা (state নয় — প্রতি অনুরোধে রি-রেন্ডার অপচয়) ──
  const jobs = useRef(new Map<number, Job>());
  const seq = useRef(0);
  // প্রতি কাজের দুটি টাইমার: [grace, safety] — আনমাউন্টে দুটোই মুছতে হয়
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>[]>());
  const visible = useRef(false);
  const shownAt = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeJob = useRef<number | null>(null);

  const [ovl, setOvl] = useState<{ on: boolean; out: boolean; label: string }>({
    on: false,
    out: false,
    label: '',
  });
  /** ambient স্তর — সবসময় mount থাকে, কেবল opacity বদলায় (সস্তা) */
  const [ambient, setAmbient] = useState(false);

  /** খাতা দেখে সিদ্ধান্ত: ওভারলে দেখাবে, না সরাবে */
  const evaluate = useCallback(() => {
    const now = Date.now();
    // grace পেরোনো কাজগুলোর মধ্যে **সবচেয়ে পুরনোটির** লেবেল দেখানো হয়
    let due: Job | null = null;
    let anyAmbient = false;
    for (const j of jobs.current.values()) {
      if (now - j.at < j.grace) continue;
      anyAmbient = true; // যেকোনো চলমান কাজেই উপরের রেখা জ্বলে
      if (j.tier === 'block' && (!due || j.at < due.at)) due = j;
    }
    setAmbient(anyAmbient);

    if (due) {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      if (!visible.current) {
        visible.current = true;
        shownAt.current = now;
      }
      const label = due.label;
      setOvl((p) => (p.on && !p.out && p.label === label ? p : { on: true, out: false, label }));
      return;
    }

    // কিছুই বাকি নেই — MIN_SHOW মেনে সরানো হয়
    if (!visible.current || hideTimer.current) return;
    const left = Math.max(0, MIN_SHOW_MS - (now - shownAt.current));
    hideTimer.current = setTimeout(() => {
      setOvl((p) => (p.on ? { ...p, out: true } : p));
      hideTimer.current = setTimeout(() => {
        visible.current = false;
        hideTimer.current = null;
        setOvl({ on: false, out: false, label: '' });
      }, FADE_MS);
    }, left);
  }, []);

  const stop = useCallback(
    (id: number) => {
      if (id < 0 || !jobs.current.has(id)) return;
      jobs.current.delete(id);
      const tms = timers.current.get(id);
      if (tms) {
        tms.forEach(clearTimeout);
        timers.current.delete(id);
      }
      evaluate();
    },
    [evaluate],
  );

  const start = useCallback(
    (label?: string, opts?: StartOpts) => {
      const tier: Tier = opts?.tier ?? 'block';
      const grace = opts?.grace ?? (tier === 'ambient' ? AMBIENT_GRACE_MS : GRACE_MS);
      const id = ++seq.current;
      jobs.current.set(id, { label: label || '', at: Date.now(), grace, tier });
      timers.current.set(id, [
        // grace পেরোলে দেখানোর সিদ্ধান্ত
        setTimeout(evaluate, grace),
        // ⚠️ শেষ রক্ষা — কোনো কাজ কখনো ওভারলে আটকে রাখতে পারবে না
        setTimeout(() => stop(id), SAFETY_MS),
      ]);
      return id;
    },
    [evaluate, stop],
  );

  const withLoading = useCallback(
    async <T,>(fn: () => Promise<T>, label?: string, opts?: StartOpts): Promise<T> => {
      const id = start(label, opts);
      try {
        return await fn();
      } finally {
        stop(id);
      }
    },
    [start, stop],
  );

  /* ─────────── ১. fetch মোড়ক — সব mutation / আপলোড / পেমেন্ট ─────────── */
  useEffect(() => {
    const orig = window.fetch;

    /**
     * ★ ফাঁকা স্ট্রিং = "এই কাজের নিজস্ব নাম নেই" → পর্দায় ঘূর্ণায়মান
     *   প্রিমিয়াম বার্তাগুলো চলবে।
     *
     *   ⚠️ প্রমাণীকরণ ও পাতা-বদল ইচ্ছাকৃতভাবে **নামহীন**। আগে ওগুলোর
     *   জন্যও একটি স্থির লেবেল ("যাচাই করা হচ্ছে…") দেখানো হতো, ফলে
     *   লগইনের সময় ঘূর্ণায়মান বার্তা কখনো দেখাই যেত না — অথচ ঠিক
     *   সেখানেই সেগুলো দেখানোর কথা। টাকা ও আপলোডের ক্ষেত্রে লেবেল
     *   থাকে, কারণ সেখানে "কী হচ্ছে" জানানোটাই বেশি জরুরি; সাধারণ
     *   বিজ্ঞাপনী বাক্য ঘোরানো সেখানে অসৎ হতো।
     */
    const labelFor = (p: string, upload: boolean): string => {
      const tr = tRef.current;
      if (upload) return tr('load.uploading');
      if (/^\/api\/(order|smm-order)/.test(p)) return tr('load.order');
      if (/^\/api\/(deposit|payment)/.test(p) || p.includes('payment')) return tr('load.payment');
      if (/^\/api\/admin\//.test(p)) return tr('load.saving');
      return '';
    };

    window.fetch = function voltFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      let id = -1;
      try {
        let url = '';
        let method = init?.method;
        if (typeof input === 'string') url = input;
        else if (typeof URL !== 'undefined' && input instanceof URL) url = input.href;
        else if (typeof Request !== 'undefined' && input instanceof Request) {
          url = input.url;
          method = method || input.method;
        }

        const m = (method || 'GET').toUpperCase();
        // ★ পড়া (GET/HEAD) কখনো ওভারলে দেখায় না — পোলিং নীরব থাকে
        if (m !== 'GET' && m !== 'HEAD' && !hasHeader(init, SILENT_HEADER)) {
          const p = pathOf(url);
          if (!SILENT_PATHS.some((re) => re.test(p))) {
            const upload = typeof FormData !== 'undefined' && init?.body instanceof FormData;
            id = start(labelFor(p, upload), { tier: tierFor(p, upload), grace: graceFor(p, upload) });
          }
        }
      } catch {
        /* শ্রেণিবিভাগ ব্যর্থ হলেও অনুরোধ কখনো আটকাবে না */
      }

      // ⚠️ .then/.catch নয় — `finally` তে error কখনো গিলে ফেলা হয় না
      return orig.call(window, input as RequestInfo, init).finally(() => stop(id));
    };

    return () => {
      window.fetch = orig;
    };
  }, [start, stop]);

  /* ─────────── ২. রুট ট্রানজিশন ─────────── */
  const endRoute = useCallback(() => {
    if (routeJob.current !== null) {
      stop(routeJob.current);
      routeJob.current = null;
    }
  }, [stop]);

  /**
   * ★ পাতা বদল — এখন **পূর্ণ ওভারলে** (গ্রাহকের নির্দেশ: "পাতা
   *   বদলের সময়ও")। আগে কেবল উপরের রেখা দেখাত।
   *
   *   পাশাপাশি সুবিধা: ওভারলে ইনপুট আটকায়, তাই ন্যাভিগেশন চলাকালীন
   *   দ্বিতীয় লিংকে ক্লিক করে দুটি রুট একসাথে চালু হতে পারে না।
   */
  const beginRoute = useCallback(() => {
    if (routeJob.current !== null) stop(routeJob.current);
    // ★ নামহীন — পাতা-বদলেও ঘূর্ণায়মান বার্তাগুলোই চলে
    routeJob.current = start('', { tier: 'block', grace: ROUTE_GRACE_MS });
  }, [start, stop]);

  useEffect(() => {
    /**
     * ★ ইন্টার্নাল লিংকে ক্লিক — NavProgress এর মতোই শনাক্তকরণ।
     *
     * ⚠️ এখানে `e.defaultPrevented` **পরীক্ষা করা যাবে না**। Next এর
     *   `<Link>` নিজের হ্যান্ডলারে `preventDefault()` ডেকে তবেই
     *   `router.push()` চালায়; ইভেন্টটি document এ পৌঁছানোর সময়
     *   defaultPrevented সবসময় true। ওটা দেখে ফিরে গেলে **কোনো**
     *   রুট-ট্রানজিশনই ধরা পড়ত না (Playwright এ ধরা পড়েছিল)।
     *   অর্থাৎ prevented হওয়াটাই ক্লায়েন্ট-ন্যাভিগেশনের স্বাক্ষর।
     */
    function onClick(e: MouseEvent) {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      if (a.getAttribute('target') === '_blank' || a.hasAttribute('download')) return;
      // একই পাতা বা কেবল #anchor — কোনো ন্যাভিগেশন হয় না
      if (href.split('#')[0] === window.location.pathname) return;
      beginRoute();
    }

    /**
     * ★ নেটিভ (fetch নয়) ফর্ম-সাবমিশন — পুরো পাতা বদলাবে।
     *   bubble ধাপে শোনা হয় বলে React এর onSubmit ততক্ষণে চলে গেছে;
     *   `defaultPrevented` মিথ্যা মানে সত্যিই ব্রাউজার ন্যাভিগেট করছে।
     */
    function onSubmit(e: Event) {
      if (!e.defaultPrevented) beginRoute();
    }

    function onPop() {
      beginRoute();
    }

    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit);
      window.removeEventListener('popstate', onPop);
    };
  }, [beginRoute]);

  // পাতা বদলে গেছে — রুট-কাজ শেষ
  useEffect(() => {
    endRoute();
  }, [path, endRoute]);

  // আনমাউন্টে সব টাইমার পরিষ্কার (leak রোধ)
  useEffect(() => {
    const tms = timers.current;
    return () => {
      tms.forEach((pair) => pair.forEach(clearTimeout));
      tms.clear();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const api = useMemo<LoadingApi>(() => ({ start, stop, withLoading }), [start, stop, withLoading]);

  return (
    <Ctx.Provider value={api}>
      {children}

      {/* ── ambient স্তর: উপরে সরু শক্তি-রেখা, কিছুই আটকায় না ──
          সবসময় mount থাকে (শূন্য খরচ, কেবল একটি div) — mount/unmount
          করলে প্রতিবার fade-in ধরতে rAF-নাচ লাগত। এটিই পুরনো
          `NavProgress` এর স্থলাভিষিক্ত, তাই দুটি আলাদা ব্যবস্থা নেই। */}
      {/* ⚠️ `role="progressbar"` দেওয়া হয়নি: উপাদানটি `aria-hidden`,
          তাই একটি ভূমিকা ঘোষণা করা স্ববিরোধী হতো। এটি সম্পূর্ণ
          অলংকারিক — blocking স্তরের `role="status"` ই ঘোষণা করে। */}
      <div className="v-ambient" data-on={ambient ? 'true' : undefined} aria-hidden="true">
        <span className="v-ambient__beam" />
      </div>

      {/* ── blocking স্তর: প্ল্যাটফর্মের **একমাত্র** পূর্ণপর্দা লোডার ──
          আগে এখানে `BrandedLoader`/`EnergyCore` ছিল আর লগইনে আলাদা
          একটি `MascotLoader` — দুটি সমান্তরাল ব্যবস্থা। এখন একটিই।
          লগইনও এই পথেই আসে (`/api/auth/callback` BLOCKING_PATHS-এ),
          তাই লগইন পাতায় নিজস্ব কোনো লোডার মাউন্ট করতে হয় না। */}
      {ovl.on && (
        <div
          className={`v-ovl${ovl.out ? ' v-ovl--out' : ''}`}
          role="status"
          aria-live="polite"
          aria-busy="true"
          onMouseDown={(e) => e.preventDefault()}
        >
          <LoadingStage
            uid="ovl"
            /* ★ CSS-এ `max-width:100%` থাকায় এটি **সর্বোচ্চ** প্রস্থ —
               সরু পর্দায় নিজে থেকেই ছোট হয়ে যায় */
            size={400}
            // ★ নির্দিষ্ট কাজ চললে তার নাম; নাহলে ঘূর্ণায়মান বার্তা
            label={ovl.label || undefined}
            messages={[t('load.rotate1'), t('load.rotate2'), t('load.rotate3')]}
          />
        </div>
      )}
    </Ctx.Provider>
  );
}
