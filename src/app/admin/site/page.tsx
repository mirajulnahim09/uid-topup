import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import SiteManager from '@/components/admin/SiteManager';
import { isEmailConfigured } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'সেটিংস' };

export default async function AdminSite() {
  const [rawSettings, socials, payments] = await Promise.all([
    getSettings(),
    prisma.socialLink.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.paymentChannel.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  // ★★★ গোপন মান ক্লায়েন্টে পাঠানো হয় না।
  //
  //   `SiteManager` একটি ক্লায়েন্ট কম্পোনেন্ট, তাই এর props
  //   RSC payload-এ সিরিয়ালাইজ হয়ে **ব্রাউজারে চলে যায়** —
  //   view-source/devtools-এ প্লেইনটেক্সট। বট টোকেন সেখানে
  //   যাওয়ার কোনো কারণ নেই।
  //
  //   ⚠️ টেলিগ্রাম কনফিগ এখন সম্পূর্ণভাবে `/admin/telegram`-এ —
  //   দুই জায়গায় একই জিনিস সম্পাদনা করা গেলে কোনটা জিতবে তা
  //   অস্পষ্ট হতো, আর এখানকার পুরনো ফিল্ডগুলো নতুন এনক্রিপ্টেড
  //   স্টোর ব্যবহার করত না।
  const { telegram_bot_token: _redacted, telegram_chat_id: _redacted2, ...settings } = rawSettings;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">সেটিংস</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">
          সাইটের নাম, নোটিশ, সোশ্যাল লিংক ও পেমেন্ট নাম্বার।
        </p>
      </div>

      <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4">
        <p className="text-sm leading-relaxed text-rose-800">
          ⚠️ <strong>সবচেয়ে জরুরি:</strong> &ldquo;💳 পেমেন্ট নাম্বার&rdquo; ট্যাবে গিয়ে আপনার নিজের bKash /
          Nagad নাম্বার বসান। ডিফল্ট নাম্বার রেখে দিলে কাস্টমারের টাকা আপনার কাছে আসবে না!
        </p>
      </div>

      {!isEmailConfigured() && (
        <div className="alert-warn">
          ℹ️ ইমেইল নোটিফিকেশন চালু নেই। resend.com এ ফ্রি অ্যাকাউন্ট খুলে{' '}
          {/* ★ `bg-black/10` গাঢ় প্যানেলের উপর আরও গাঢ় করত — মাপা
              কনট্রাস্ট ছিল ১.৬৪:১। এখন হালকা টোকেন-ভিত্তিক চিপ। */}
          <code className="rounded px-1.5 py-0.5 font-mono" style={{ background: 'rgba(255,255,255,.07)', color: 'var(--v-ink)', border: '1px solid var(--v-edge)' }}>RESEND_API_KEY</code> বসান। (ছাড়াও সব কাজ করবে
          — শুধু কাস্টমার ইমেইল পাবে না।)
        </div>
      )}

      <p className="text-sm text-slate-500">
        🖼️ ব্যানার ছবি বদলাতে{' '}
        <Link href="/admin/banners" className="inline-flex min-h-[24px] items-center font-bold hover:underline" style={{ color: 'var(--v-ice)' }}>
          ব্যানার ছবি
        </Link>{' '}
        পেজে যান।
      </p>

      <SiteManager
        settings={settings}
        socials={socials.map((s: (typeof socials)[number]) => ({
          id: s.id,
          platform: s.platform,
          url: s.url,
          label: s.label,
          isActive: s.isActive,
        }))}
        payments={payments.map((p: (typeof payments)[number]) => ({
          id: p.id,
          method: p.method,
          accountNo: p.accountNo,
          accountType: p.accountType,
          instruction: p.instruction,
          isActive: p.isActive,
        }))}
      />
    </div>
  );
}
