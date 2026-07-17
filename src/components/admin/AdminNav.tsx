'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'হোম', icon: '🏠' },
  { href: '/admin/deposits', label: 'টাকা যোগ', icon: '💰', key: 'deposits' },
  { href: '/admin/orders', label: 'অর্ডার', icon: '📦', key: 'orders' },
  { href: '/admin/products', label: 'প্রোডাক্ট ও দাম', icon: '🏷️' },
  { href: '/admin/banners', label: 'ব্যানার ছবি', icon: '🖼️' },
  { href: '/admin/coupons', label: 'কুপন', icon: '🎟️' },
  { href: '/admin/users', label: 'ইউজার', icon: '👤' },
  { href: '/admin/reports', label: 'রিপোর্ট', icon: '📊' },
  { href: '/admin/logs', label: 'লগ', icon: '📋' },
  { href: '/admin/tools', label: 'টুলস', icon: '🛠️' },
  { href: '/admin/site', label: 'সেটিংস', icon: '⚙️' },
];

export default function AdminNav({
  pendingDeposits, pendingOrders,
}: {
  pendingDeposits: number;
  pendingOrders: number;
}) {
  const path = usePathname();

  return (
    <nav className="border-b border-slate-200 bg-white shadow-sm" aria-label="অ্যাডমিন মেনু">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4">
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
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-4 py-3.5 text-sm font-semibold transition ${
                active
                  ? 'border-purple-600 bg-purple-50 text-purple-700'
                  : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span aria-hidden="true">{l.icon}</span>
              {l.label}
              {count > 0 && (
                <span className="grid h-5 min-w-[20px] animate-pulse place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
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
