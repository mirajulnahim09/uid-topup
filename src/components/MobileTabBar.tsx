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

const TABS: Tab[] = [
  { href: '/', label: 'হোম', publicTab: true, exact: true, icon: <Icon d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" /> },
  {
    href: '/account/wallet/deposit',
    label: 'টাকা যোগ',
    icon: <Icon d="M12 5v14M5 12h14" />,
  },
  {
    href: '/account/orders',
    label: 'অর্ডার',
    icon: <Icon d="M4 5h16M4 12h16M4 19h10" />,
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
        background: 'rgba(8,7,15,.92)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderTop: '1px solid var(--hair)',
        // ★ আইফোনের হোম-বার এর জায়গা ছাড়ে
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map((t) => {
          // লগইন না থাকলে ব্যক্তিগত ট্যাব লগইনে পাঠায়
          const href = !authed && !t.publicTab ? `/login?callbackUrl=${encodeURIComponent(t.href)}` : t.href;
          const active = t.exact
            ? path === t.href
            : path === t.href || path.startsWith(`${t.href}/`);
          const showBadge = t.href === '/account/orders' && pending > 0;

          return (
            <li key={t.href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className="relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 transition-colors"
                style={{ color: active ? 'var(--gold)' : 'var(--mut)' }}
              >
                <span className="relative">
                  {t.icon}
                  {showBadge && (
                    <span
                      className="absolute -right-2 -top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full px-1 text-[9px] font-bold"
                      style={{ background: 'var(--gold)', color: '#08070f' }}
                      aria-label={`${pending} টি অপেক্ষমান অর্ডার`}
                    >
                      {pending > 9 ? '9+' : pending}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium leading-none">{t.label}</span>
                {active && (
                  <span
                    className="absolute inset-x-4 top-0 h-0.5 rounded-full"
                    style={{ background: 'var(--gold)' }}
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
