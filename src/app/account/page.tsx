import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { bdt } from '@/lib/money';
import { fmtDate, fmtDay } from '@/lib/date';
import ReferralCard from '@/components/ReferralCard';
import DataUnavailable from '@/components/DataUnavailable';
import Icon from '@/components/fx/Icon';
import EmptyState from '@/components/EmptyState';
import LogoutButton from '@/components/LogoutButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'প্রোফাইল' };

export default async function AccountPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  // ★ DB সাময়িকভাবে অকেজো হলে ভুল সংখ্যা (৳0.00) দেখানো যাবে না —
  //   তার বদলে সৎ "দেখানো যাচ্ছে না" স্ক্রিন। বিস্তারিত: DataUnavailable.tsx
  let user: Awaited<ReturnType<typeof loadUser>> = null;
  let settings: Record<string, string> = {};
  let refEarn: Awaited<ReturnType<typeof loadRefEarn>> | null = null;

  async function loadUser() {
    return prisma.user.findUnique({
      where: { id: session!.user.id },
      include: {
        ledger: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { orders: true, deposits: true, referrals: true } },
      },
    });
  }
  async function loadRefEarn() {
    return prisma.ledgerEntry.aggregate({
      where: { userId: session!.user.id, type: 'REFERRAL_BONUS' },
      _sum: { amount: true },
    });
  }

  try {
    [user, settings, refEarn] = await Promise.all([loadUser(), getSettings(), loadRefEarn()]);
  } catch (e) {
    console.error('[account] db unavailable:', e);
    return <DataUnavailable title="প্রোফাইল এখন দেখানো যাচ্ছে না" retryHref="/account" />;
  }

  if (!user || !refEarn) return null;

  return (
    <div className="space-y-6">
      {/* ★★★ শিরোনামের পাশেই লগআউট।
          কেন এখানে: বটম-বারের "প্রোফাইল" ট্যাপ করলে ব্যবহারকারী ঠিক
          এই পাতাতেই আসেন, তাই ফোনে বেরোনোর পথটি এখানেই সবচেয়ে
          স্বাভাবিক। আগে লগআউট ছিল কেবল হ্যামবার্গার মেনুর একদম নিচে,
          যেটি ফোনে বটম-বারের আড়ালে ঢাকা পড়ত (Navbar.tsx দ্রষ্টব্য)।
          ⚠️ "সব ডিভাইস থেকে সাইন-আউট" আলাদা ও ভিন্ন কাজ — সেটি
          `/account/profile` এ যেমন ছিল তেমনই আছে। */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">আমার প্রোফাইল</h1>
        <LogoutButton />
      </div>

      {/**
        * ═══ পরিসংখ্যান গ্রিড ═══
        *
        * ⚠️⚠️ আগে এটি ছিল `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` —
        *   অর্থাৎ ৬৪০px-এর **নিচে একটিই কলাম**। ফলে ফোনে চারটি কার্ড
        *   একটির নিচে আরেকটি, প্রতিটি ~৩৪০px উঁচু। মাপা: ৩৯০px ফোনে
        *   `/account` পাতার মোট উচ্চতা **৩৪৭৪px** — মূলত পাঁচটি সংখ্যা
        *   দেখানোর জন্য। এটিই "ডেস্কটপ পাতা ফোনে চেপে ঢোকানো" এর
        *   পাঠ্যপুস্তকীয় উদাহরণ: বিন্যাসটি ভাঙে না, কিন্তু কেউ এটিকে
        *   ফোনের জন্য নকশা করেনি।
        *
        *   এখন ফোনেও **দুই কলাম**। ব্যালেন্স পুরো প্রস্থ জুড়ে থাকে,
        *   কারণ (ক) এটিই সবচেয়ে গুরুত্বপূর্ণ সংখ্যা, আর (খ) ৳১,২৫,০০০.০০
        *   জাতীয় মান অর্ধেক কলামে (৩২০px-এ ১০৬px কনটেন্ট-প্রস্থ)
        *   আঁটতই না।
        */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* ★ ব্যালেন্স — সবচেয়ে গুরুত্বপূর্ণ সংখ্যা, তাই সোনালি
            উচ্চারণ (Phase 6)। Tailwind gradient bridge দিয়ে ঠিক
            হয় না, তাই সরাসরি টোকেনে। */}
        <div
          className="card col-span-2 p-5 lg:col-span-1"
          style={{ background: 'linear-gradient(140deg, rgba(230,197,132,.16), var(--v-void))' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--gold)' }}>
            ব্যালেন্স
          </p>
          <p className="dsp mt-1 text-3xl font-bold" style={{ color: 'var(--ink)' }}>{bdt(user.balance)}</p>
          <Link href="/account/wallet/deposit" className="btn-primary mt-3 w-full">টাকা যোগ করুন</Link>
        </div>

        {/**
          * ★ পুরো কার্ডটিই এখন লিংক, ভিতরে আলাদা বোতাম নেই।
          *
          *   কেন: অর্ধেক-প্রস্থ কার্ডে ৩২০px ফোনে কনটেন্টের জায়গা
          *   ৯৮px, অথচ `.btn` এর নিজস্ব `px-6` (৪৮px) বাদ দিলে
          *   "অর্ডার দেখুন" লেখার জন্য থাকত ৫০px — লেখা ভেঙে যেত।
          *   গন্তব্য অপরিবর্তিত (`/account/orders`), কেবল আঘাত-এলাকা
          *   এখন গোটা কার্ড — মোবাইলে এটিই বড় ও সহজ লক্ষ্য।
          */}
        <Link href="/account/orders" className="card block p-4 transition hover:-translate-y-0.5 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">মোট অর্ডার</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">{user._count.orders}</p>
          <p className="mt-3 inline-flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--v-ice)' }}>
            অর্ডার দেখুন
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
          </p>
        </Link>

        <div className="card p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">ডিপোজিট</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">{user._count.deposits}</p>
          <p className="mt-3 text-xs text-slate-400">
            সদস্য: {fmtDay(user.createdAt)}
          </p>
        </div>

        {/* ★ Maison রেফারেল কার্ড (Phase 6)
            আগে ছিল `from-purple-50 to-purple-100` — Tailwind gradient,
            যা theme bridge দিয়ে ঠিক করা যায় না (bridge কেবল
            background-color বদলায়, gradient নয়)। তাই সরাসরি টোকেনে। */}
        <div
          className="card col-span-2 p-4 sm:p-5 lg:col-span-1"
          style={{ background: 'linear-gradient(140deg, rgba(154,140,247,.14), rgba(230,197,132,.07))' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
            রেফারেল আয়
          </p>
          <p className="dsp mt-1 text-2xl font-bold sm:text-3xl" style={{ color: 'var(--ink)' }}>
            {bdt(refEarn._sum.amount ?? 0)}
          </p>
          <p className="mt-3 text-xs" style={{ color: 'var(--mut)' }}>
            {user._count.referrals} জন রেফার করেছেন
          </p>
        </div>
      </div>

      {/* দ্রুত লিংক */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: '/account/orders', icon: 'box' as const, label: 'অর্ডার' },
          { href: '/account/wallet/deposit', icon: 'wallet' as const, label: 'টাকা যোগ' },
          { href: '/account/notifications', icon: 'bell' as const, label: 'নোটিফিকেশন' },
          // ★ Group I (৪) — সাপোর্ট টিকিট
          { href: '/account/tickets', icon: 'chat' as const, label: 'সাপোর্ট' },
          { href: '/account/profile', icon: 'gear' as const, label: 'সেটিংস' },
        ].map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="card p-4 text-center transition hover:-translate-y-1"
          >
            <span className="mx-auto grid h-11 w-11 place-items-center" style={{ border: '1px solid var(--v-edge)', color: 'var(--v-ice)' }}>
              <Icon name={l.icon} size={20} />
            </span>
            <p className="v-hud mt-2.5 text-xs font-bold" style={{ color: 'var(--v-ink)' }}>{l.label}</p>
          </a>
        ))}
      </div>

      <ReferralCard
        code={user.referralCode}
        bonus={Number(settings.referral_bonus || 20)}
        minDeposit={Number(settings.referral_min_deposit || 100)}
        count={user._count.referrals}
      />

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">অ্যাকাউন্ট তথ্য</h2>
          <a href="/account/profile" className="inline-flex min-h-[40px] items-center text-sm font-bold hover:underline" style={{ color: 'var(--v-volt)' }}>
            এডিট
          </a>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">নাম</dt>
            <dd className="font-medium text-slate-900">{user.name}</dd>
          </div>
          <div>
            <dt className="text-slate-400">ইমেইল</dt>
            <dd className="break-all font-medium text-slate-900">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-400">মোবাইল</dt>
            <dd className="font-mono font-medium text-slate-900">{user.phone}</dd>
          </div>
          <div>
            <dt className="text-slate-400">যোগদান</dt>
            <dd className="font-medium text-slate-900">{fmtDate(user.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-slate-900">লেনদেনের ইতিহাস</h2>
        {/**
          * ⚠️ বাকি তিনটি গ্রাহক-তালিকা (`/account/orders`,
          *   `/account/wallet/deposit`, `/account/smm-orders`) মোবাইলে
          *   আলাদা কার্ড-মার্কআপ রাখে (`md:hidden` + `hidden md:block`),
          *   কিন্তু **এটি রাখত না** — এখানে ছিল কেবল একটি ৬৪০px চওড়া
          *   টেবিল একটি অনুভূমিক স্ক্রলারে। অর্থাৎ গ্রাহকের নিজের
          *   খতিয়ান — যেখানে তিনি দেখেন টাকা কোথায় গেল — ফোনে
          *   ডানে-বাঁয়ে না টানলে পড়াই যেত না।
          *
          *   এখানে দ্বিতীয় মার্কআপ লেখা হয়নি, `.tbl--stack` দেওয়া
          *   হয়েছে — সারিগুলো কেবল পড়ার জন্য, কোনো বোতাম নেই, তাই
          *   CSS-রূপান্তরই যথেষ্ট (globals.css-এ বিস্তারিত)।
          */}
        <div className="table-wrap">
          <table className="tbl tbl--stack">
            <thead>
              <tr>
                <th scope="col">তারিখ</th>
                <th scope="col">ধরন</th>
                <th scope="col">বিবরণ</th>
                <th scope="col" className="num">পরিমাণ</th>
                <th scope="col" className="num">ব্যালেন্স</th>
              </tr>
            </thead>
            <tbody>
              {user.ledger.map((l: (typeof user.ledger)[number]) => {
                const amt = Number(l.amount);
                return (
                  <tr key={l.id}>
                    <td data-label="তারিখ" className="whitespace-nowrap text-xs text-slate-400">{fmtDate(l.createdAt)}</td>
                    <td data-label="ধরন" className="text-xs">{l.type}</td>
                    {/* ★ ফোনে নোটটি লেবেলের ডানে বসে, তাই ডান-সারিবদ্ধ —
                        নাহলে লম্বা নোট দুই লাইনে ভেঙে বাঁয়ে ঝুলে থাকত */}
                    <td data-label="বিবরণ" className="text-xs text-slate-400 max-md:text-right">{l.note}</td>
                    <td data-label="পরিমাণ" className={`whitespace-nowrap num font-semibold ${
                      amt >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {amt >= 0 ? '+' : ''}{bdt(l.amount)}
                    </td>
                    <td data-label="ব্যালেন্স" className="whitespace-nowrap num text-slate-400">
                      {bdt(l.balanceAfter)}
                    </td>
                  </tr>
                );
              })}
              {user.ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4">
                    <EmptyState inCard={false} compact icon="wallet"
                      title="এখনো কোনো লেনদেন নেই"
                      hint="টাকা যোগ বা অর্ডার করলে সম্পূর্ণ ইতিহাস এখানে দেখাবে।" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
