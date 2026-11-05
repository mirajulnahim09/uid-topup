/**
 * ═══════════════════════════════════════════════════════════
 * Brand mark v3 — "Gem Lift" (2026-10-31)
 *
 *   A violet app-tile holding a faceted gem whose lower half carries an
 *   upward arrow: the gem is the product (diamonds, gift codes), the
 *   arrow is the action (top-up). One mark everywhere — navbar, footer,
 *   favicon (`src/app/icon.svg` is a static copy; change both together).
 *
 *   Why it works on both themes: the mark is a solid tile with its own
 *   background, so it never depends on the page colour.
 *   At ≤ 20 px the facet lines and the sparkle drop out (they would
 *   turn to mud in a favicon).
 *
 *   The component name and props are unchanged (`VoltMark`), so every
 *   existing call site keeps working.
 * ═══════════════════════════════════════════════════════════
 */
export default function VoltMark({
  size = 40,
  uid = 'a',
  className = '',
  glow = true,
  /** kept for API compatibility — the tile is always drawn now */
  plate = false,
}: {
  size?: number;
  /** keeps gradient ids unique when several marks share a page */
  uid?: string;
  className?: string;
  glow?: boolean;
  plate?: boolean;
}) {
  const detail = size > 20;
  void plate;

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      style={glow ? { filter: 'drop-shadow(0 4px 12px rgba(124,58,237,.45))' } : undefined}
    >
      <defs>
        <linearGradient id={`gl-tile-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset=".55" stopColor="#5b21b6" />
          <stop offset="1" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id={`gl-gem-${uid}`} x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stopColor="#ecfccb" />
          <stop offset=".45" stopColor="#bef264" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id={`gl-shine-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#gl-tile-${uid})`} />
      <rect x="2" y="2" width="44" height="22" rx="13" fill={`url(#gl-shine-${uid})`} />
      <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" fill="none" stroke="#fff" strokeOpacity=".18" />

      {/* gem */}
      <path d="M12.5 19.5 L18.3 12 H29.7 L35.5 19.5 L24 37 Z" fill={`url(#gl-gem-${uid})`} />
      {detail && (
        <path
          d="M12.5 19.5 H35.5 M18.3 12 L21.4 19.5 L24 12 L26.6 19.5 L29.7 12"
          fill="none" stroke="#1e1b4b" strokeOpacity=".32" strokeWidth="1" strokeLinejoin="round"
        />
      )}
      {/* lift arrow */}
      <path
        d="M24 31.5 V23.4 M20.4 26.8 L24 23.2 L27.6 26.8"
        fill="none" stroke="#1e1b4b" strokeWidth={detail ? 2.4 : 3} strokeLinecap="round" strokeLinejoin="round"
      />
      {detail && <path d="M37.5 8.2 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1z" fill="#ecfccb" />}
    </svg>
  );
}
