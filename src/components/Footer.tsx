import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { SocialIcon, SOCIAL_META } from './SocialIcons';

export default async function Footer() {
  let socials: { id: number; platform: string; url: string; label: string | null }[] = [];
  let settings: Record<string, string> = {};

  try {
    [socials, settings] = await Promise.all([
      prisma.socialLink.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, platform: true, url: true, label: true },
      }),
      getSettings(),
    ]);
  } catch { /* DB fail হলেও footer render হবে */ }

  const siteName = settings?.site_name || 'UID TopUp';

  return (
    <footer className="relative mt-16" style={{ borderTop: '1px solid var(--line)' }}>
      {/* neon top line */}
      <div className="absolute left-0 right-0 top-0 h-px" style={{ background: 'linear-gradient(90deg,transparent,#ff2d78,#22e0ee,#8b5cf6,transparent)' }} />

      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* brand */}
          <div>
            <div className="mb-2 flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl text-xl floaty"
                style={{ background: 'linear-gradient(135deg,#8b5cf6,#ff2d78)', boxShadow: '0 0 22px rgba(255,45,120,.5)' }}>💎</span>
              <div>
                <h2 className="grad-text text-lg font-extrabold uppercase leading-none">{siteName}</h2>
                <p className="mt-0.5 text-[11px] font-semibold" style={{ color: 'var(--mut)' }}>কম দামে ভালো সার্ভিস</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--mut)' }}>
              ফ্রি ফায়ার ডায়মন্ড ও গেমিং টপ আপ — দ্রুত ডেলিভারি, ২৪/৭ সাপোর্ট।
            </p>

            {(socials?.length ?? 0) > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {(socials ?? []).map((s: (typeof socials)[number]) => {
                  const meta = SOCIAL_META[s.platform];
                  return (
                    <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer nofollow"
                      aria-label={s.label || meta?.label || s.platform} title={s.label || meta?.label || s.platform}
                      className="grid h-9 w-9 place-items-center rounded-lg transition hover:-translate-y-0.5"
                      style={{ border: '1px solid var(--line)', background: 'rgba(139,92,246,.1)', color: 'var(--mut)' }}>
                      <SocialIcon platform={s.platform} />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* links */}
          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--cyan)' }}>লিংক</h2>
            <ul className="space-y-2.5 text-sm" style={{ color: 'var(--mut)' }}>
              <li><Link href="/" className="fnav">হোম</Link></li>
              <li><Link href="/faq" className="fnav">সাধারণ প্রশ্ন</Link></li>
              <li><Link href="/contact" className="fnav">যোগাযোগ</Link></li>
              <li><Link href="/account/orders" className="fnav">আমার অর্ডার</Link></li>
            </ul>
          </div>

          {/* policies */}
          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--cyan)' }}>নীতিমালা</h2>
            <ul className="space-y-2.5 text-sm" style={{ color: 'var(--mut)' }}>
              <li><Link href="/terms" className="fnav">শর্তাবলী</Link></li>
              <li><Link href="/privacy" className="fnav">গোপনীয়তা</Link></li>
              <li><Link href="/refund" className="fnav">রিফান্ড নীতি</Link></li>
            </ul>
          </div>

          {/* support */}
          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--cyan)' }}>সাপোর্ট</h2>
            <ul className="space-y-2.5 text-sm" style={{ color: 'var(--mut)' }}>
              {settings?.support_email && (
                <li>ইমেইল: <a href={`mailto:${settings.support_email}`} className="fnav">{settings.support_email}</a></li>
              )}
              {settings?.support_phone && <li>ফোন: {settings.support_phone}</li>}
              {settings?.support_hours && <li>সময়: {settings.support_hours}</li>}
            </ul>
            <p className="mt-3 text-xs leading-relaxed" style={{ color: '#7d78a6' }}>
              অর্ডার জনিত সমস্যায় স্ক্রিনশট ও TrxID সহ মেসেজ দিন।
            </p>
          </div>
        </div>

        <div className="mt-10 pt-6 text-center text-xs" style={{ borderTop: '1px solid var(--line)', color: '#7d78a6' }}>
          © {new Date().getFullYear()} {siteName}. সর্বস্বত্ব সংরক্ষিত.
          <span className="mx-2" aria-hidden="true">·</span>
          ১৮ বছরের নিচে অভিভাবকের অনুমতি ছাড়া অর্ডার নিষিদ্ধ।
        </div>
      </div>

      <style>{`.fnav{transition:color .2s,padding .2s}.fnav:hover{color:#22e0ee;padding-left:4px}`}</style>
    </footer>
  );
}
