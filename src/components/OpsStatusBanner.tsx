/**
 * ★ পরিচালন-অবস্থার ব্যানার (2.17)
 *
 *   সার্ভার কম্পোনেন্ট — কোনো ক্লায়েন্ট JS লাগে না।
 *   তিনটি অবস্থা, তিনটি আলাদা রঙ — কিন্তু সবগুলোই সৎ:
 *     open   — স্বাভাবিক
 *     busy   — দেরি হচ্ছে, স্বীকার করা হচ্ছে
 *     closed — অফিস বন্ধ, কখন খুলবে বলা হচ্ছে
 */
import type { OpsStatus } from '@/lib/opsStatus';

const STYLE: Record<OpsStatus['level'], { dot: string; border: string; bg: string }> = {
  open: {
    dot: '#5fe0a6',
    border: 'rgba(127,224,187,.30)',
    bg: 'rgba(127,224,187,.07)',
  },
  busy: {
    dot: 'var(--gold)',
    border: 'rgba(230,197,132,.32)',
    bg: 'rgba(230,197,132,.07)',
  },
  closed: {
    dot: 'var(--mut)',
    border: 'var(--hair)',
    bg: 'rgba(255,255,255,.03)',
  },
};

export default function OpsStatusBanner({ status }: { status: OpsStatus | null }) {
  // ★ তথ্য না থাকলে কিছুই দেখাই না — অনুমান করা বার্তার চেয়ে ভালো
  if (!status) return null;

  const s = STYLE[status.level];

  return (
    <div
      className="border-b"
      style={{ borderColor: s.border, background: s.bg }}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2.5 page-x py-2.5">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: s.dot,
            boxShadow: status.level === 'open' ? `0 0 10px ${s.dot}` : undefined,
          }}
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed sm:text-sm" style={{ color: 'var(--ink)' }}>
          {status.message}
        </p>
      </div>
    </div>
  );
}
