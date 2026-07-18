import { prisma } from '@/lib/prisma';
import BannerManager from '@/components/admin/BannerManager';
import { isBlobConfigured } from '@/lib/upload';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ব্যানার ছবি' };

export default async function AdminBanners() {
  const banners = await prisma.banner.findMany({ orderBy: { sortOrder: 'asc' } });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">ব্যানার ছবি</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">
          হোমপেজের উপরে যে বড় ছবি স্লাইড হয় — এখান থেকে বদলান।
        </p>
      </div>

      {!isBlobConfigured() && (
        <div className="alert-warn">
          ⚠️ <strong>ছবি আপলোড এখনো চালু হয়নি।</strong> Vercel Dashboard → Storage → Blob তৈরি
          করে <code className="rounded bg-black/10 px-1">BLOB_READ_WRITE_TOKEN</code> বসান।
          তারপর এখানে ছবি আপলোড করতে পারবেন।
        </div>
      )}

      <BannerManager
        banners={banners.map((b: (typeof banners)[number]) => ({
          id: b.id,
          image: b.image,
          title: b.title,
          subtitle: b.subtitle,
          link: b.link,
          isActive: b.isActive,
          sortOrder: b.sortOrder,
        }))}
      />
    </div>
  );
}
