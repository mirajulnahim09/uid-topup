import type { Metadata } from 'next';
import MediaBrowser from '@/components/admin/MediaBrowser';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { requireAdminPage } from '@/lib/pageGuard';

export const metadata: Metadata = { title: 'মিডিয়া লাইব্রেরি' };
export const dynamic = 'force-dynamic';

/**
 * ★ /admin/media — কেন্দ্রীয় মিডিয়া লাইব্রেরি পেজ।
 *   একবার আপলোড → সর্বত্র ব্যবহার। search / ফোল্ডার / sort / unused /
 *   SEO মেটাডেটা — সবই এখানে।
 */
export default async function AdminMediaPage() {
  // ★ SEC-01 — পাতার নিজস্ব DB-গার্ড (সফট-নেভিগেশনে লেআউট চলে না)
  await requireAdminPage();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="মিডিয়া লাইব্রেরি"
        subtitle="একবার আপলোড করুন, সব জায়গায় ব্যবহার করুন। প্রোডাক্ট, ব্যানার, ক্যাম্পেইন, পপআপ — সব ছবি এখানে।"
      />
      <MediaBrowser mode="manage" />
    </div>
  );
}
