import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { prisma } from '@/lib/prisma';
import { SocialIcon, SOCIAL_META } from '@/components/SocialIcons';
import ContactHero from '@/components/ContactHero';

export const revalidate = 300;
export const metadata = { title: 'যোগাযোগ' };

export default async function ContactPage() {
  let settings: Record<string, string> = {};
  let socials: { id: number; platform: string; url: string; label: string | null }[] = [];

  try {
    [settings, socials] = await Promise.all([
      getSettings(),
      prisma.socialLink.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, platform: true, url: true, label: true },
      }),
    ]);
  } catch {
    /* ignore */
  }

  return (
    <div className="mx-auto max-w-3xl prose-measure px-4 py-10">
      <ContactHero />

      <div className="mt-8 space-y-4">
        {settings.support_phone && (
          <a
            href={`tel:${settings.support_phone}`}
            className="card flex items-center gap-4 p-5 transition hover:-translate-y-1 hover:shadow-md"
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-100 text-2xl">
              📞
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-slate-400">ফোন / WhatsApp</p>
              <p className="text-lg font-bold text-slate-900">{settings.support_phone}</p>
            </div>
          </a>
        )}

        {settings.support_email && (
          <a
            href={`mailto:${settings.support_email}`}
            className="card flex items-center gap-4 p-5 transition hover:-translate-y-1 hover:shadow-md"
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-100 text-2xl">
              ✉️
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-slate-400">ইমেইল</p>
              <p className="truncate text-lg font-bold text-slate-900">{settings.support_email}</p>
            </div>
          </a>
        )}

        {settings.support_hours && (
          <div className="card flex items-center gap-4 p-5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-amber-100 text-2xl">
              🕐
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-slate-400">সময়</p>
              <p className="text-lg font-bold text-slate-900">{settings.support_hours}</p>
            </div>
          </div>
        )}
      </div>

      {socials.length > 0 && (
        <div className="mt-8">
          <p className="mb-3 text-center text-sm font-bold text-slate-500">
            সোশ্যাল মিডিয়ায় আমরা
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {socials.map((s) => {
              const meta = SOCIAL_META[s.platform];
              return (
                <a
                  key={s.id}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={s.label || meta?.label || s.platform}
                  className={`grid h-12 w-12 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:-translate-y-1 hover:shadow-md ${
                    meta?.color ?? ''
                  }`}
                >
                  <SocialIcon platform={s.platform} size={22} />
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8 rounded-xl border border-blue-200 bg-blue-50 p-4 text-center">
        <p className="text-sm text-blue-800">
          অর্ডার নিয়ে সমস্যা? <strong>TrxID ও স্ক্রিনশট</strong> সহ মেসেজ দিলে দ্রুত সমাধান পাবেন।
        </p>
        <Link href="/faq" className="mt-2 inline-flex min-h-[40px] items-center text-sm font-bold text-blue-700 hover:underline">
          সাধারণ প্রশ্ন দেখুন →
        </Link>
      </div>
    </div>
  );
}
