'use client';

import { useTheme, ACCENTS, type AccentChoice } from './ThemeProvider';

/**
 * ★ অ্যাকসেন্ট-রঙ পিকার — এক ক্লিকে পুরো ব্র্যান্ড-অ্যাকশন রঙ বদলায়।
 *   ডিফল্ট Gaming Lime; ভবিষ্যৎ-প্রস্তুত purple/blue/red/orange।
 *   পছন্দ localStorage-এ থাকে (স্থায়ী)।
 */
const SWATCH: Record<AccentChoice, string> = {
  lime: '#c8ff3d', purple: '#8b5cf6', blue: '#3b82f6', red: '#f43f5e', orange: '#fb923c',
};
const LABEL: Record<AccentChoice, string> = {
  lime: 'Lime', purple: 'Purple', blue: 'Blue', red: 'Red', orange: 'Orange',
};

export default function AccentPicker() {
  const { accent, setAccent } = useTheme();
  return (
    <div role="group" aria-label="অ্যাকসেন্ট রঙ / Accent" className="inline-flex items-center gap-1.5">
      {ACCENTS.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => setAccent(a)}
          aria-pressed={accent === a}
          title={LABEL[a]}
          className="h-6 w-6 rounded-full transition-transform hover:scale-110"
          style={{
            background: SWATCH[a],
            outline: accent === a ? '2px solid var(--v-ink)' : '2px solid transparent',
            outlineOffset: 2,
          }}
        >
          <span className="sr-only">{LABEL[a]}</span>
        </button>
      ))}
    </div>
  );
}
