'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon, { type IconName } from '@/components/fx/Icon';

/**
 * ⚠️ আগে প্রতিটি আইটেমে **ইমোজি** ছিল (🏠 💰 📦 …), অথচ বাকি পুরো
 *   অ্যাপ `Icon.tsx`-এর লাইন-সেট ব্যবহার করে। ইমোজি প্ল্যাটফর্মভেদে
 *   বদলায় (Windows/Android/iOS তিন রকম), নিজের রঙ নিয়ে আসে — তাই
 *   সক্রিয় ট্যাবের বেগুনি রঙ শুধু লেখায় লাগত, চিহ্নে নয় — আর
 *   baseline অসম বলে সারিবদ্ধও হতো না। SVG আইকন `currentColor`
 *   নেয়, ফলে সক্রিয়/hover অবস্থায় চিহ্ন ও লেখা একসাথে রঙ বদলায়।
 */
const LINKS: { href: string; label: string; icon: IconName; key?: string }[] = [
  { href: '/admin', label: 'হোম', icon: 'home' },
  { href: '/admin/deposits', label: 'টাকা যোগ', icon: 'wallet', key: 'deposits' },
  { href: '/admin/orders', label: 'অর্ডার', icon: 'box', key: 'orders' },
  { href: '/admin/products', label: 'প্রোডাক্ট ও দাম', icon: 'tag' },
  // ★ হোমপেজ বিপণন ব্যবস্থাপনা (Option A) — পপআপ/ব্যানার/নোটিশ/প্রচারণা
  { href: '/admin/homepage', label: 'হোমপেজ', icon: 'play' },
  { href: '/admin/banners', label: 'ব্যানার ছবি', icon: 'image' },
  { href: '/admin/media', label: 'মিডিয়া', icon: 'camera' },
  { href: '/admin/codes', label: 'কোড স্টক', icon: 'gem' },
  { href: '/admin/coupons', label: 'কুপন', icon: 'gift' },
  { href: '/admin/users', label: 'ইউজার', icon: 'user' },
  { href: '/admin/reports', label: 'রিপোর্ট', icon: 'chart' },
  { href: '/admin/logs', label: 'লগ', icon: 'list' },
  // ★ Group I (৪) — গ্রাহকের অভিযোগ ও বিরোধ
  { href: '/admin/tickets', label: 'টিকিট', icon: 'chat' },
  // ★ Group I (৫) — ওয়ালেট থেকে টাকা তোলার অনুরোধ
  { href: '/admin/withdrawals', label: 'টাকা তোলা', icon: 'bank' },
  { href: '/admin/payments', label: 'পেমেন্ট', icon: 'card' },
  { href: '/admin/integrations', label: 'ইন্টিগ্রেশন', icon: 'plug' },
  // ★ Group I (৩) — ইন্টিগ্রেশনের পাশে, কারণ এটিও বাইরের সার্ভিসের কনফিগ
  { href: '/admin/otp', label: 'যাচাই কোড', icon: 'shield' },
  { href: '/admin/telegram', label: 'টেলিগ্রাম', icon: 'send' },
  { href: '/admin/tools', label: 'টুলস', icon: 'wrench' },
  { href: '/admin/branding', label: 'ব্র্যান্ডিং', icon: 'palette' },
  { href: '/admin/site', label: 'সেটিংস', icon: 'gear' },
];

export default function AdminNav({
  pendingDeposits, pendingOrders,
}: {
  pendingDeposits: number;
  pendingOrders: number;
}) {
  const path = usePathname();

  // ★ Maison অ্যাডমিন নেভ (Phase 6) — আগে ছিল সাদা bg + বেগুনি
  //   active state। এখন সোনালি active accent, glass পটভূমি।
  return (
    <nav
      className="sticky top-[57px] z-30 backdrop-blur-xl"
      style={{ borderBottom: '1px solid var(--hair)', background: 'var(--surface-adminnav)' }}
      aria-label="অ্যাডমিন মেনু"
    >
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto page-x">
        {LINKS.map((l) => {
          const active = path === l.href;
          const count =
            l.key === 'deposits' ? pendingDeposits : l.key === 'orders' ? pendingOrders : 0;

          return (
            <Link
              key={l.href}
              href={l.href}
              prefetch
              aria-current={active ? 'page' : undefined}
              className="admin-tab"
              data-active={active ? 'true' : undefined}
            >
              <Icon name={l.icon} size={17} />
              {l.label}
              {count > 0 && (
                /* ★ গণনা ব্যাজ — `animate-pulse` সরানো হয়েছে।
                   নিরন্তর স্পন্দন মনোযোগ কাড়ে ঠিকই, কিন্তু অ্যাডমিন
                   দিনভর এই পাতায় থাকেন; অবিরাম নড়াচড়া ক্লান্তিকর
                   ও reduced-motion এর চেতনার বিরুদ্ধে। */
                <span
                  className="grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-[10px] font-bold"
                  style={{ background: '#7c3aed', color: '#fff' }}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
