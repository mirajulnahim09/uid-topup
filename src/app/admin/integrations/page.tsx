import type { Metadata } from 'next';
import Link from 'next/link';
import IntegrationsManager from '@/components/admin/IntegrationsManager';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { allProviderInfos } from '@/lib/integrations/hub';

export const metadata: Metadata = { title: 'ইন্টিগ্রেশন হাব' };
export const dynamic = 'force-dynamic';

/**
 * ★ /admin/integrations — সব বাহ্যিক ইন্টিগ্রেশনের একক কেন্দ্র।
 *   পেমেন্ট, ফুলফিলমেন্ট, SMS, ইমেইল, পুশ, ওয়েবহুক, স্টোরেজ, AI,
 *   অ্যানালিটিক্স — প্রতিটি প্রোভাইডার-ভিত্তিক (SOLID)। এখান থেকে
 *   চালু/বন্ধ/নির্বাচন করা যায়; মূল ব্যবসায়িক যুক্তি বদলাতে হয় না।
 */
export default async function AdminIntegrationsPage() {
  const infos = await allProviderInfos();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="ইন্টিগ্রেশন হাব"
        subtitle="সব বাহ্যিক সার্ভিস এক জায়গায় — প্রোভাইডার-ভিত্তিক, SOLID আর্কিটেকচার। নতুন প্রোভাইডার যোগ করতে মূল কোড বদলাতে হয় না (registry-তে এক লাইন)। কোনো লাইভ ইন্টিগ্রেশন এখন সক্রিয় নয়।"
      />
      {/* ★ টেলিগ্রাম এই হাবের অংশ নয় — এটি একটি **লাইভ** ইন্টিগ্রেশন
          যার নিজস্ব সংযোগ-অবস্থা ও ইভেন্ট সুইচ আছে, তাই আলাদা পাতা।
          এখানে শুধু পথনির্দেশ, যাতে অ্যাডমিন খুঁজে পায়। */}
      <Link
        href="/admin/telegram"
        className="card flex items-center justify-between gap-3 p-4 transition hover:opacity-90"
      >
        <span className="min-w-0">
          <span className="block text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>
            ✈️ টেলিগ্রাম বট — অপারেটর নোটিফিকেশন
          </span>
          <span className="block text-[12px]" style={{ color: 'var(--v-mut)' }}>
            সংযোগের অবস্থা, ইভেন্ট নির্বাচন ও টেস্ট মেসেজ — আলাদা পাতায় পরিচালিত।
          </span>
        </span>
        <span className="shrink-0 text-[13px] font-bold" style={{ color: 'var(--v-ice)' }}>
          খুলুন →
        </span>
      </Link>

      <IntegrationsManager initial={infos} />
    </div>
  );
}
