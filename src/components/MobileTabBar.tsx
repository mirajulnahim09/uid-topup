'use client';

import { fetchMe } from '@/lib/clientFetch';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ মোবাইল বটম ট্যাব বার — অ্যাপের মতো নেভিগেশন
 *
 *   কেন: এই ব্যবসার প্রায় সব ট্রাফিক মোবাইল। প্রতিযোগী
 *   uidtopup.com এর সবচেয়ে স্পষ্ট মোবাইল-ফার্স্ট সিদ্ধান্তই হলো
 *   স্থায়ী বটম ন্যাভ (COMPETITOR_ANALYSIS.md idea #4)।
 *
 *   দুটি বিষয় ইচ্ছাকৃত:
 *   ১. "টাকা যোগ" প্রধান জায়গায় — ওয়ালেট রিচার্জ বারবার লাগে,
 *      অ্যাকাউন্ট সাব-পেজে লুকিয়ে রাখার জিনিস নয়।
 *   ২. "অর্ডার" এক ট্যাপ দূরে — ম্যানুয়াল ডেলিভারিতে অপেক্ষার
 *      সময় গ্রাহক বারবার স্ট্যাটাস দেখে; সেটা মেনে নিয়েই নকশা।
 *
 *   ★ অপেক্ষমান অর্ডার থাকলে ব্যাজ দেখায় — সবচেয়ে বেশি দেখা
 *     তথ্যটাই সবচেয়ে সহজে পাওয়া উচিত।
 * ═══════════════════════════════════════════════════════════
 */

type Tab = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** লগইন ছাড়াও দেখানো হবে? */
  publicTab?: boolean;
  /**
   * ★ শুধু হুবহু এই পাথেই active।
   *   দরকার কেন: `/account` prefix দিয়ে মেলালে `/account/orders` এ
   *   থাকা অবস্থায় "প্রোফাইল" ট্যাবও active দেখাত — একসাথে দুটি
   *   ট্যাবে aria-current="page", যা ভুল ও স্ক্রিনরিডারে বিভ্রান্তিকর।
   */
  exact?: boolean;
  /** ★ কেন্দ্রীয় উঁচু FAB — প্রধান কাজ (টাকা যোগ) দৃশ্যত সবচেয়ে গুরুত্বপূর্ণ। */
  primary?: boolean;
};

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

// ★ ক্রম ইচ্ছাকৃত: "টাকা যোগ" ঠিক মাঝখানে (index 2) — সেটি এখন
//   একটি উঁচু কেন্দ্রীয় FAB, তাই দৃশ্যত সবচেয়ে গুরুত্বপূর্ণ কাজটিই
//   বুড়ো আঙুলের সবচেয়ে সহজ নাগালে বসে।
const TABS: Tab[] = [
  { href: '/', label: 'হোম', publicTab: true, exact: true, icon: <Icon d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" /> },
  {
    href: '/account/orders',
    label: 'অর্ডার',
    icon: <Icon d="M4 5h16M4 12h16M4 19h10" />,
  },
  {
    href: '/account/wallet/deposit',
    label: 'টাকা যোগ',
    primary: true,
    icon: <Icon d="M12 5v14M5 12h14" />,
  },
  {
    href: '/contact',
    label: 'সাপোর্ট',
    publicTab: true,
    icon: <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  },
  {
    href: '/account',
    label: 'প্রোফাইল',
    // ★ exact — নাহলে /account/orders ও /account/wallet/... এও active দেখাত
    exact: true,
    icon: <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  },
];

export default function MobileTabBar() {
  const path = usePathname();
  const { status } = useSession();
  const authed = status === 'authenticated';
  const [pending, setPending] = useState(0);

  // ★ অপেক্ষমান অর্ডারের সংখ্যা — ব্যাজের জন্য
  useEffect(() => {
    if (!authed) {
      setPending(0);
      return;
    }
    let alive = true;
    // ★ শেয়ার্ড de-dup (4.5) — Navbar ও OrderForm একই তথ্য চায়
    fetchMe<{ pendingOrders?: number }>()
      .then((d) => {
        if (alive && d && typeof d.pendingOrders === 'number') setPending(d.pendingOrders);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authed, path]);

  // ★ অ্যাডমিন প্যানেলে দেখানো হয় না — ওখানে আলাদা নেভিগেশন
  if (path.startsWith('/admin')) return null;

  return (
    <nav
      aria-label="মোবাইল নেভিগেশন"
      className="fixed inset-x-0 bottom-0 z-[60] md:hidden"
      style={{
        background: 'var(--surface-bar)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--v-edge)',
        boxShadow: '0 -8px 30px rgba(0,0,0,.5)',
        // ★ আইফোনের হোম-বার এর জায়গা ছাড়ে
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* VOLT শক্তি-রেখা — উপরের ন্যাভবারের সাথে একই ভাষা */}
      <span aria-hidden="true" className="v-flow-line absolute inset-x-0 top-0 h-px" />
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map((t) => {
          // লগইন না থাকলে ব্যক্তিগত ট্যাব লগইনে পাঠায়
          const href = !authed && !t.publicTab ? `/login?callbackUrl=${encodeURIComponent(t.href)}` : t.href;
          const active = t.exact
            ? path === t.href
            : path === t.href || path.startsWith(`${t.href}/`);
          const showBadge = t.href === '/account/orders' && pending > 0;

          // ★ কেন্দ্রীয় উঁচু FAB — প্রধান কাজ (টাকা যোগ)
          if (t.primary) {
            return (
              <li key={t.href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  aria-label={t.label}
                  /**
                   * ⚠️ `pb-1.5` → `pb-2.5`।
                   *   ব্রাউজারে মাপা: বাকি চারটি ট্যাবের লেবেল বারের
                   *   উপর থেকে ৩৬px-এ বসে, কিন্তু এই একটির লেবেল
                   *   ৪১px-এ — অর্থাৎ **৫px নিচে**, বারের নিচের কিনারা
                   *   থেকে মাত্র ৬px দূরে (বাকিদের ১০px)। পাঁচটি
                   *   লেবেলের মধ্যে একটি লাইনচ্যুত থাকা ঠিক সেই ধরনের
                   *   অসংগতি যা "অগোছালো" মনে করায় অথচ আলাদা করে চোখে
                   *   পড়ে না। ১০px reserve দিলে পাঁচটিই এক রেখায় আসে।
                   *
                   * ⚠️ `mt-8` সরানো হলো — এটি কোনো কাজ করত না।
                   *   কলামটি `justify-end`, আর বৃত্তটি `position:absolute`
                   *   (প্রবাহের বাইরে), তাই লেবেলই একমাত্র in-flow সন্তান;
                   *   justify-end আগেই তাকে নিচে ঠেলে দেয় এবং উপরের
                   *   margin শূন্য জায়গায় শোষিত হয়। রেখে দিলে পরের
                   *   ডেভেলপার ভাবতেন এটি অবস্থান নিয়ন্ত্রণ করছে।
                   */
                  className="group relative flex min-h-[56px] flex-col items-center justify-end gap-1 px-1 pb-2.5"
                >
                  {/**
                    * ★★★ `position` ও `top` ইচ্ছাকৃতভাবে **ইনলাইন**।
                    *
                    *   আগে ক্লাসে `absolute -top-5` লেখা ছিল, কিন্তু
                    *   `.v-sheen` (globals.css:1302) নিজেই
                    *   `position:relative` বসায়। দুটির specificity
                    *   সমান (0,1,0), আর `.v-sheen` স্টাইলশিটে Tailwind
                    *   utilities-এর **পরে** থাকায় সে-ই জিতত।
                    *
                    *   ফল (লাইভ সাইটে মাপা): FAB বৃত্তটি ভাসত না,
                    *   layout-এ **জায়গা নিত** — তাই তার `<li>` হতো
                    *   ১০৮px আর পুরো বার ১০৯px, অথচ `globals.css`-এ
                    *   কনটেন্টের জন্য ছাড়া ছিল মাত্র ৫৬px। অর্থাৎ
                    *   প্রতিটি মোবাইল পাতার নিচের **৫৩px কনটেন্ট
                    *   বারের নিচে ঢাকা পড়ত**, আর "টাকা যোগ" লেবেলটি
                    *   বাকি লেবেলের অনেক নিচে ছিটকে যেত।
                    *
                    *   ইনলাইন স্টাইল যেকোনো ক্লাসকে হারায়, তাই এটি
                    *   ভবিষ্যতেও cascade-দুর্ঘটনায় ভাঙবে না।
                    *   ⚠️ `.v-sheen` নিজে **বদলানো হয়নি** — সেটি
                    *   সাধারণ utility, অন্য কোথাও ব্যবহার হতে পারে।
                    */}
                  <span
                    className="v-sheen grid h-14 w-14 place-items-center transition-transform duration-300 group-active:scale-95"
                    style={{
                      position: 'absolute',
                      top: -20, // = Tailwind এর `-top-5`
                      background: 'linear-gradient(140deg,var(--accent-2),var(--accent) 48%,var(--accent-strong))',
                      color: 'var(--accent-ink)',
                      borderRadius: 18,
                      border: '3px solid var(--v-void)',
                      boxShadow: '0 8px 22px -4px rgba(var(--accent-glow),.5), 0 4px 10px rgba(0,0,0,.4)',
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  </span>
                  <span className="v-hud text-[10px] font-bold leading-none" style={{ color: active ? 'var(--v-volt)' : 'var(--v-mut)' }}>{t.label}</span>
                </Link>
              </li>
            );
          }

          return (
            <li key={t.href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className="relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 transition-colors"
                style={{ color: active ? 'var(--violet)' : 'var(--v-mut)' }}
              >
                <span className="relative">
                  {t.icon}
                  {showBadge && (
                    <span
                      className="v-hud absolute -right-2 -top-1.5 grid h-4 min-w-[16px] place-items-center px-1 text-[9px] font-bold"
                      style={{ background: '#7c3aed', color: '#fff' }}
                      aria-label={`${pending} টি অপেক্ষমান অর্ডার`}
                    >
                      {pending > 9 ? '9+' : pending}
                    </span>
                  )}
                </span>
                <span className="v-hud text-[10px] font-semibold leading-none">{t.label}</span>
                {active && (
                  <span
                    className="absolute inset-x-4 top-0 h-0.5"
                    style={{ background: 'var(--violet)', boxShadow: '0 0 10px rgba(109,40,217,.5)' }}
                    aria-hidden="true"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
