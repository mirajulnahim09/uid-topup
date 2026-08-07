import Link from 'next/link';
import Icon, { type IconName } from '@/components/fx/Icon';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ EmptyState — সব "কিছু নেই" অবস্থার একটিই প্রিমিয়াম প্যাটার্ন।
 *
 *   আগে কিছু খালি-অবস্থা ছিল আইকন+CTA সহ সুন্দর, আবার কিছু ছিল
 *   নিছক ধূসর এক লাইন টেক্সট — অসামঞ্জস্য। এই কম্পোনেন্ট সেই
 *   অসঙ্গতি দূর করে: বৃত্তাকার আইকন-টাইল + শিরোনাম + সহায়ক বার্তা
 *   + ঐচ্ছিক CTA। থিম/অ্যাকসেন্ট টোকেনভিত্তিক, তাই light/dark ও
 *   যেকোনো অ্যাকসেন্টে মানানসই।
 *
 *   `inCard=false` দিলে বাইরের কার্ড ছাড়া (টেবিলের ভেতর/সেকশনে বসাতে)।
 * ═══════════════════════════════════════════════════════════
 */
export default function EmptyState({
  icon = 'box',
  title,
  hint,
  cta,
  ctaHref,
  secondaryCta,
  secondaryHref,
  inCard = true,
  compact = false,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  cta?: string;
  ctaHref?: string;
  secondaryCta?: string;
  secondaryHref?: string;
  inCard?: boolean;
  compact?: boolean;
}) {
  const body = (
    <div className={`text-center ${compact ? 'py-8' : 'py-14'}`}>
      <span
        className="mx-auto grid place-items-center rounded-2xl"
        style={{
          height: compact ? 48 : 60,
          width: compact ? 48 : 60,
          background: 'var(--tint-violet)',
          border: '1px solid var(--v-edge2)',
          color: 'var(--violet)',
        }}
        aria-hidden="true"
      >
        <Icon name={icon} size={compact ? 24 : 28} />
      </span>
      <p className={`mt-4 font-bold ${compact ? 'text-[15px]' : 'text-lg'}`} style={{ color: 'var(--v-ink)' }}>
        {title}
      </p>
      {hint && (
        <p className="prose-measure mx-auto mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--v-mut)' }}>
          {hint}
        </p>
      )}
      {(cta || secondaryCta) && (
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          {cta && ctaHref && <Link href={ctaHref} className="btn-primary px-6">{cta}</Link>}
          {secondaryCta && secondaryHref && <Link href={secondaryHref} className="btn-ghost px-6">{secondaryCta}</Link>}
        </div>
      )}
    </div>
  );

  return inCard ? <div className="card">{body}</div> : body;
}
