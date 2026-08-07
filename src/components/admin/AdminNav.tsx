'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'হোম', icon: '🏠' },
  { href: '/admin/deposits', label: 'টাকা যোগ', icon: '💰', key: 'deposits' },
  { href: '/admin/orders', label: 'অর্ডার', icon: '📦', key: 'orders' },
  { href: '/admin/products', label: 'প্রোডাক্ট ও দাম', icon: '🏷️' },
  // ★ হোমপেজ বিপণন ব্যবস্থাপনা (Option A) — পপআপ/ব্যানার/নোটিশ/প্রচারণা
  { href: '/admin/homepage', label: 'হোমপেজ', icon: '🎬' },
  { href: '/admin/banners', label: 'ব্যানার ছবি', icon: '🖼️' },
  { href: '/admin/media', label: 'মিডিয়া', icon: '📸' },
  { href: '/admin/coupons', label: 'কুপন', icon: '🎟️' },
  { href: '/admin/users', label: 'ইউজার', icon: '👤' },
  { href: '/admin/reports', label: 'রিপোর্ট', icon: '📊' },
  { href: '/admin/logs', label: 'লগ', icon: '📋' },
  { href: '/admin/payments', label: 'পেমেন্ট', icon: '💳' },
  { href: '/admin/integrations', label: 'ইন্টিগ্রেশন', icon: '🔌' },
  { href: '/admin/telegram', label: 'টেলিগ্রাম', icon: '✈️' },
  { href: '/admin/tools', label: 'টুলস', icon: '🛠️' },
  { href: '/admin/branding', label: 'ব্র্যান্ডিং', icon: '🎨' },
  { href: '/admin/site', label: 'সেটিংস', icon: '⚙️' },
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
              <span aria-hidden="true">{l.icon}</span>
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
