import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { safeUrl } from '@/lib/sanitize';
import StoreHowFaq from '@/components/home/StoreHowFaq';

export const revalidate = 300;
export const metadata = { title: 'কিভাবে অর্ডার করবেন — টিউটোরিয়াল' };

/**
 * Tutorial — the "Tutorial" tab the reference sites have in their bottom
 * nav. Video comes from the admin setting `tutorial_video_url`; it opens
 * on YouTube (no third-party iframe, so the CSP stays unchanged).
 */
export default async function TutorialPage() {
  let settings: Record<string, string> = {};
  try {
    settings = await getSettings();
  } catch {
    /* page still renders the written guide */
  }
  const video = settings.tutorial_video_url ? safeUrl(settings.tutorial_video_url) : null;

  return (
    <div className="pb-6">
      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 sm:pt-10">
        <div className="tut-hero relative overflow-hidden rounded-[22px] px-5 py-8 sm:px-10 sm:py-12">
          <span className="relative inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-bold"
            style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}>
            টিউটোরিয়াল
          </span>
          <h1 className="relative mt-3 max-w-2xl text-[26px] font-extrabold leading-tight text-white sm:text-[38px]" style={{ letterSpacing: '-.02em' }}>
            নিজের টপ-আপ নিজেই করুন — ৩ ধাপে
          </h1>
          <p className="relative mt-2 max-w-xl text-[14px] leading-relaxed sm:text-[16px]" style={{ color: 'rgba(255,255,255,.86)' }}>
            প্যাকেজ বাছাই, পেমেন্ট আর ডেলিভারি — পুরো প্রক্রিয়া এক জায়গায়।
          </p>
          <div className="relative mt-5 flex flex-wrap gap-3">
            {video && (
              <a href={video} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-[48px] items-center gap-2.5 rounded-xl px-5 text-[14px] font-bold"
                style={{ background: '#fff', color: '#111827' }}>
                <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: '#ef4444', color: '#fff' }} aria-hidden>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                </span>
                ভিডিও দেখুন (YouTube)
              </a>
            )}
            <Link href="/#catalog" className="inline-flex min-h-[48px] items-center gap-2 rounded-xl px-5 text-[14px] font-bold"
              style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.28)' }}>
              এখনই টপ-আপ করুন →
            </Link>
          </div>
        </div>
      </section>
      <StoreHowFaq />
    </div>
  );
}
