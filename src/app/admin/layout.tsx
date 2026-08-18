import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import AdminNav from '@/components/admin/AdminNav';
import AdminSearch from '@/components/admin/AdminSearch';
import LogoutButton from '@/components/LogoutButton';
import ThemeToggle from '@/components/theme/ThemeToggle';
import BrandLogo from '@/components/brand/BrandLogo';
import { getBranding } from '@/lib/branding';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // ★ middleware এ প্রথম guard আছে — এটা দ্বিতীয় স্তর (defense in depth)
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login?callbackUrl=/admin');
  if (session.user.role !== 'ADMIN') redirect('/');

  // ★ DB থেকেও role re-verify — পুরনো JWT ধরবে
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isBanned: true },
  });
  if (!me || me.role !== 'ADMIN' || me.isBanned) redirect('/');

  // ★ অ্যাডমিন হেডারের লোগো — অ্যাডমিন প্যানেলও একই ব্র্যান্ড দেখায়
  const brandLogos = (await getBranding()).logos.compact;

  const [pendingDeposits, pendingOrders] = await Promise.all([
    prisma.deposit.count({ where: { status: 'PENDING' } }),
    prisma.order.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
  ]);

  return (
    <div className="min-h-screen">
      {/* ★ Maison অ্যাডমিন হেডার (Phase 6)
          আগে ছিল `bg-purple-50` + `border-purple-200` — গাঢ় সাইটের
          ভেতরে একটি উজ্জ্বল সাদা-বেগুনি দ্বীপ। এখন একই glass ভাষা। */}
      <header
        className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ borderBottom: '1px solid var(--hair)', background: 'var(--surface-adminnav)' }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 page-x py-3.5">
          <div className="flex items-center gap-3">
            {/* ★ অ্যাডমিন হেডারেও অ্যাডমিনের নিজের লোগো — কমপ্যাক্ট স্লট,
                কারণ এখানে জায়গা সীমিত। না থাকলে কিছুই দেখায় না
                (ব্যাজ + "কন্ট্রোল প্যানেল" লেখাই যথেষ্ট)। */}
            {(brandLogos.dark || brandLogos.light) && (
              <BrandLogo logos={brandLogos} slot="compact" alt="" height={26} />
            )}
            <span
              className="rounded-md px-2.5 py-1 text-[10px] font-bold uppercase"
              style={{
                background: 'rgba(230,197,132,.14)',
                border: '1px solid rgba(230,197,132,.38)',
                color: 'var(--gold)',
                letterSpacing: '.12em',
              }}
            >
              Admin
            </span>
            <span className="dsp hidden text-sm font-semibold sm:inline" style={{ color: 'var(--ink)' }}>
              কন্ট্রোল প্যানেল
            </span>
          </div>
          {/* ★ gap 3 → 2: লগআউট যোগ হওয়ায় ৩২০px ফোনে সারিটি আঁটসাঁট।
              তিনটিই `shrink-0`, তাই কিছু চেপে গিয়ে অপাঠ্য হয় না। */}
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Link
              href="/"
              className="inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap text-sm transition-colors"
              style={{ color: 'var(--mut)' }}
            >
              {/* ★ ৩২০px-এ কেবল তীরচিহ্ন — পুরো লেখাটি রাখলে লগআউটসহ
                  সারিটি ওভারফ্লো করত। sr-only লেবেল থাকায় স্ক্রিনরিডারে
                  অর্থ অটুট। */}
              <span aria-hidden="true">←</span>
              <span className="ml-1 hidden xs:inline">সাইটে ফিরুন</span>
              <span className="sr-only">সাইটে ফিরুন</span>
            </Link>
            {/* ★★★ অ্যাডমিনের লগআউট — আগে এই হেডারে কোনো লগআউটই ছিল না */}
            <LogoutButton compact />
          </div>
        </div>
      </header>

      <AdminNav pendingDeposits={pendingDeposits} pendingOrders={pendingOrders} />

      {/* ★ সর্বজনীন সার্চ — প্রতিটি অ্যাডমিন পেজে (3.2)।
          গ্রাহকের মেসেজ থেকে যা-ই পেস্ট হোক, উত্তর এখানেই মেলে। */}
      <div className="mx-auto max-w-7xl page-x pt-5">
        <AdminSearch />
      </div>

      <main id="main" className="mx-auto max-w-7xl page-x py-6 sm:py-5">{children}</main>
    </div>
  );
}
