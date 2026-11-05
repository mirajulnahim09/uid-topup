import SafeImage from './SafeImage';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ProductImage — প্রোডাক্ট থাম্বনেইলের একমাত্র উৎস।
 *
 *   হোমপেজ, ক্যাটালগ, ফিচারড, সম্পর্কিত, সার্চ, ড্যাশবোর্ড,
 *   অ্যাডমিন প্রিভিউ — সব জায়গায় এই একটি কম্পোনেন্ট। ফলে কভার
 *   ইমেজ, blur-প্লেসহোল্ডার, lazy-load, aspect ও fallback-এর
 *   আচরণ সর্বত্র অভিন্ন; একটিও কার্ড আলাদাভাবে বদলাতে হয় না।
 *
 *   • `src` থাকলে → next/image (WebP/AVIF, srcset, lazy) কভার-ফিট,
 *     পিছনে একটি shimmer "blur" প্লেসহোল্ডার (ছবি লোড হলে ঢেকে দেয়)।
 *   • `src` না থাকলে → পেশাদার fallback (ব্র্যান্ড গ্রেডিয়েন্ট +
 *     হীরা + প্যাকেজ-সংখ্যা), ইমোজি নয় (CLAUDE.md §7)।
 *
 *   ⚠️ প্যারেন্ট অবশ্যই `position:relative` ও একটি নির্দিষ্ট aspect
 *     দেবে — এই কম্পোনেন্ট সেই বাক্সটি পূর্ণ করে (`absolute inset-0`)।
 * ═══════════════════════════════════════════════════════════
 */

export type ImageTone = { g1: string; g2: string };

const DEFAULT_TONE: ImageTone = { g1: '#8b5cf6', g2: '#6d28d9' };

export default function ProductImage({
  src,
  alt,
  tone = DEFAULT_TONE,
  mono,
  sizes = '(max-width:640px) 45vw, (max-width:1024px) 30vw, 240px',
  priority = false,
}: {
  src?: string | null;
  alt: string;
  tone?: ImageTone;
  /** fallback-এ দেখানো ছোট লেবেল (যেমন প্যাকেজ সংখ্যা "355") */
  mono?: string;
  sizes?: string;
  priority?: boolean;
}) {
  if (src) {
    return (
      <>
        {/* blur/shimmer প্লেসহোল্ডার — ছবি না আসা পর্যন্ত */}
        <span aria-hidden="true" className="skeleton absolute inset-0" />
        <SafeImage
          src={src}
          alt={alt}
          sizes={sizes}
          priority={priority}
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </>
    );
  }

  // ── পেশাদার fallback ──
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 grid place-items-center overflow-hidden"
      style={{ background: `linear-gradient(150deg, ${tone.g1}, ${tone.g2})` }}
    >
      <span
        className="absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,.22), transparent 60%)' }}
      />
      {/* soft diagonal sheen + facet pattern instead of a cropped giant glyph */}
      <span
        className="absolute inset-0 opacity-[.18]"
        style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 1px, transparent 1px 14px)' }}
      />
      {mono && (
        <span
          className="absolute bottom-1.5 right-2 font-extrabold leading-none"
          style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,.75)', fontFamily: "var(--font-unbounded),var(--font-anek),sans-serif" }}
        >
          {mono}
        </span>
      )}
      <span
        className="relative grid h-[52px] w-[52px] place-items-center rounded-[16px] shadow-lg transition-transform duration-300 group-hover:scale-110"
        style={{ background: 'rgba(255,255,255,.18)', backdropFilter: 'blur(4px)' }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7">
          <path d="M6 3h12l4 6-10 12L2 9z" />
          <path d="M2 9h20" />
        </svg>
      </span>
    </span>
  );
}
