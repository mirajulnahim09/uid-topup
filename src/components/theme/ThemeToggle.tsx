'use client';

import { useTheme, type ThemeChoice } from './ThemeProvider';
import { useT } from '@/components/i18n/I18nProvider';

/**
 * ★ থিম টগল — Dark / Light / System, কম্প্যাক্ট সেগমেন্টেড কন্ট্রোল।
 *   পরিষ্কার SVG আইকন (ইমোজি নয় — প্ল্যাটফর্মভেদে বদলায়, CLAUDE.md §7)।
 *   প্রতিটি এক ক্লিকে; সক্রিয়টি হাইলাইট হয়। স্ক্রিন-রিডারে নাম ঘোষণা।
 */

function Moon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function Sun() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function Monitor() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

const OPTIONS: { key: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { key: 'light', label: 'Light', icon: <Sun /> },
  { key: 'dark', label: 'Dark', icon: <Moon /> },
  { key: 'system', label: 'System', icon: <Monitor /> },
];

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const t = useT();

  return (
    <div
      className="inline-flex items-center rounded-full border p-0.5"
      style={{ borderColor: 'var(--v-edge)', background: 'var(--v-fill)' }}
      role="group"
      aria-label={t('theme.label')}
    >
      {OPTIONS.map((o) => {
        const active = o.key === theme;
        return (
          <button
            key={o.key}
            type="button"
            data-theme-choice={o.key}
            onClick={() => setTheme(o.key)}
            aria-pressed={active}
            title={t('theme.' + o.key)}
            className={`grid place-items-center rounded-full transition ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}
            style={
              active
                ? { background: '#7c3aed', color: '#fff' }
                : { background: 'transparent', color: 'var(--v-mut)' }
            }
          >
            {o.icon}
            <span className="sr-only">{t('theme.' + o.key)}</span>
          </button>
        );
      })}
    </div>
  );
}
