import Link from 'next/link';
import { getSettings } from '@/lib/settings';

export const revalidate = 300;
export const metadata = { title: 'আমাদের সম্পর্কে' };

/**
 * About Us. The body is the admin's own text (`about_text`); without it
 * we show only facts the site already states (what it sells, how
 * payment and delivery work, contact details) — no invented claims.
 */
export default async function AboutPage() {
  let s: Record<string, string> = {};
  try {
    s = await getSettings();
  } catch {
    /* render defaults */
  }
  const name = s.site_name || 'UID TopUp';
  const paragraphs = (s.about_text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const fallback = [
    `${name} একটি অনলাইন টপ-আপ প্ল্যাটফর্ম — Free Fire ডায়মন্ড, মেম্বারশিপ, গিফট কার্ড ও ডিজিটাল সাবস্ক্রিপশন এক জায়গায়।`,
    'bKash, Nagad, Rocket সহ দেশীয় পেমেন্ট মাধ্যমে পেমেন্ট করা যায়। প্রতিটি অর্ডারের অবস্থা অ্যাকাউন্টে ধাপে ধাপে দেখা যায়, আর বাতিল হলে টাকা ওয়ালেটে ফেরত যায়।',
  ];

  const facts = [
    s.support_hours && { k: 'সাপোর্ট সময়', v: s.support_hours },
    s.support_email && { k: 'ইমেইল', v: s.support_email },
    s.support_phone && { k: 'ফোন', v: s.support_phone },
  ].filter(Boolean) as { k: string; v: string }[];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <p className="text-center text-[12px] font-bold uppercase tracking-[.14em]" style={{ color: 'var(--violet)' }}>About</p>
      <h1 className="mt-2 text-center text-[28px] font-extrabold sm:text-[36px]" style={{ color: 'var(--v-ink)', letterSpacing: '-.02em' }}>
        আমাদের সম্পর্কে
      </h1>

      <div className="card mt-8 space-y-4 p-6 text-[15px] leading-[1.85] sm:p-8" style={{ color: 'var(--v-ink)', borderRadius: 18 }}>
        {(paragraphs.length ? paragraphs : fallback).map((p, i) => (
          <p key={i} className="whitespace-pre-line">{p}</p>
        ))}
      </div>

      {facts.length > 0 && (
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.k} className="card p-4" style={{ borderRadius: 14 }}>
              <dt className="text-[11px] font-bold uppercase" style={{ color: 'var(--v-mut)', letterSpacing: '.04em' }}>{f.k}</dt>
              <dd className="mt-1 break-all text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>{f.v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13.5px] font-bold">
        <Link href="/tutorial" className="hover:underline" style={{ color: 'var(--v-ice)' }}>কিভাবে অর্ডার করবেন</Link>
        <Link href="/contact" className="hover:underline" style={{ color: 'var(--v-ice)' }}>যোগাযোগ</Link>
        <Link href="/refund" className="hover:underline" style={{ color: 'var(--v-ice)' }}>রিফান্ড নীতি</Link>
        <Link href="/terms" className="hover:underline" style={{ color: 'var(--v-ice)' }}>শর্তাবলী</Link>
      </div>
    </div>
  );
}
