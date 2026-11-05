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

/** ★ Phase A — ARC টোকেন। ভূমিকা কঠোরভাবে মানা হয়েছে:
 *  mint = লাইভ/স্বাভাবিক, ember = মনোযোগ দরকার, ধূসর = বন্ধ।
 *
 *  ⚠️ `busy` আগে হুবহু `open`-এর রঙ ব্যবহার করত (দুটোই volt) —
 *  অর্থাৎ "সব ঠিক আছে" আর "দেরি হচ্ছে" এক রঙে। এটি C3-এর
 *  (success ≡ warning) ঠিক একই ত্রুটি, কেবল অন্য ফাইলে। এখন
 *  `--sem-warning` — টোকেনটি দুই থিমেই আলাদা মান রাখে। */
const STYLE: Record<OpsStatus['level'], { dot: string; border: string; bg: string; label: string }> = {
  open: {
    dot: 'var(--sem-success)',
    border: 'color-mix(in srgb, var(--sem-success) 28%, transparent)',
    bg: 'color-mix(in srgb, var(--sem-success) 6%, transparent)',
    label: 'অনলাইন',
  },
  busy: {
    dot: 'var(--sem-warning)',
    border: 'color-mix(in srgb, var(--sem-warning) 30%, transparent)',
    bg: 'color-mix(in srgb, var(--sem-warning) 8%, transparent)',
    label: 'ব্যস্ত',
  },
  closed: {
    dot: 'var(--v-dim)',
    border: 'var(--v-edge)',
    bg: 'var(--v-void)',
    label: 'বন্ধ',
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
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
        <span className="flex shrink-0 items-center gap-2">
          <span
            className={status.level === 'open' ? 'v-blink h-1.5 w-1.5 shrink-0 rounded-full' : 'h-1.5 w-1.5 shrink-0 rounded-full'}
            style={{
              background: s.dot,
              boxShadow: status.level === 'open' ? `0 0 10px ${s.dot}` : undefined,
            }}
            aria-hidden="true"
          />
          <span className="hud hidden sm:inline" style={{ color: s.dot }}>{s.label}</span>
        </span>
        <span className="hidden h-3 w-px shrink-0 sm:block" style={{ background: 'var(--v-edge2)' }} aria-hidden="true" />
        <p className="text-xs leading-relaxed sm:text-[13px]" style={{ color: 'var(--v-ink)' }}>
          {status.message}
        </p>
      </div>
    </div>
  );
}
