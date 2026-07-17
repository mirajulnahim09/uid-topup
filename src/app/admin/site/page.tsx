import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import SiteManager from '@/components/admin/SiteManager';
import { isEmailConfigured } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'সেটিংস' };

export default async function AdminSite() {
  const [settings, socials, payments] = await Promise.all([
    getSettings(),
    prisma.socialLink.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.paymentChannel.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">সেটিংস</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          সাইটের নাম, নোটিশ, সোশ্যাল লিংক ও পেমেন্ট নাম্বার।
        </p>
      </div>

      <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4">
        <p className="text-sm leading-relaxed text-rose-800">
          ⚠️ <strong>সবচেয়ে জরুরি:</strong> "💳 পেমেন্ট নাম্বার" ট্যাবে গিয়ে আপনার নিজের bKash /
          Nagad নাম্বার বসান। ডিফল্ট নাম্বার রেখে দিলে কাস্টমারের টাকা আপনার কাছে আসবে না!
        </p>
      </div>

      {!isEmailConfigured() && (
        <div className="alert-warn">
          ℹ️ ইমেইল নোটিফিকেশন চালু নেই। resend.com এ ফ্রি অ্যাকাউন্ট খুলে{' '}
          <code className="rounded bg-black/10 px-1">RESEND_API_KEY</code> বসান। (ছাড়াও সব কাজ করবে
          — শুধু কাস্টমার ইমেইল পাবে না।)
        </div>
      )}

      <p className="text-sm text-slate-500">
        🖼️ ব্যানার ছবি বদলাতে{' '}
        <Link href="/admin/banners" className="font-bold text-purple-600 hover:underline">
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
