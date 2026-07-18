/**
 * ★ Crafted brilliant-cut diamond — সাইটের signature element।
 *   logo, hero, product card — সব জায়গায় একই gem (emoji নয়)।
 *   dispersion = ভেতরে রংধনু আলোর ঝিলিক (হীরার refraction)।
 */
export default function Diamond({
  size = 60,
  dispersion = false,
  className = '',
}: {
  size?: number;
  dispersion?: boolean;
  className?: string;
}) {
  const uid = dispersion ? 'd' : 'p';
  return (
    <svg
      viewBox="0 0 200 214"
      width={size}
      height={(size * 214) / 200}
      className={className}
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`t-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbfdff" /><stop offset="1" stopColor="#c6dbf6" />
        </linearGradient>
        <linearGradient id={`pl-${uid}`} x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stopColor="#a2bdf2" /><stop offset="1" stopColor="#453eb2" />
        </linearGradient>
        <linearGradient id={`pr-${uid}`} x1="1" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#b8c8f5" /><stop offset="1" stopColor="#6156d6" />
        </linearGradient>
        <linearGradient id={`pc-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4dffa" /><stop offset="1" stopColor="#2a2468" />
        </linearGradient>
        <linearGradient id={`rn-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff6ec7" /><stop offset=".33" stopColor="#7d5fff" />
          <stop offset=".66" stopColor="#4dd0ff" /><stop offset="1" stopColor="#a7ffcf" />
        </linearGradient>
      </defs>

      {/* crown */}
      <polygon points="66,58 134,58 150,84 50,84" fill={`url(#t-${uid})`} />
      <polygon points="66,58 100,58 100,44 78,44" fill="#eef5ff" />
      <polygon points="134,58 100,58 100,44 122,44" fill="#dde9fc" />
      <polygon points="50,84 66,58 40,84" fill="#c9daf5" />
      <polygon points="150,84 134,58 160,84" fill="#d8e6fc" />
      {/* girdle */}
      <polygon points="40,84 160,84 150,92 50,92" fill="#8b97e2" opacity=".5" />
      {/* pavilion */}
      <polygon points="50,92 100,92 100,204" fill={`url(#pl-${uid})`} />
      <polygon points="150,92 100,92 100,204" fill={`url(#pr-${uid})`} />
      <polygon points="72,92 128,92 100,204" fill={`url(#pc-${uid})`} opacity=".93" />
      <polygon points="50,92 72,92 100,204" fill="#362f88" opacity=".9" />
      <polygon points="150,92 128,92 100,204" fill="#4c43a8" opacity=".9" />
      {/* dispersion */}
      {dispersion && (
        <>
          <polygon className="gem-disp" points="60,88 96,92 100,204 74,150" fill={`url(#rn-${uid})`} opacity=".42" />
          <polygon className="gem-disp" points="140,88 104,92 100,204 126,150" fill={`url(#rn-${uid})`} opacity=".3" />
        </>
      )}
      <polygon className={dispersion ? 'gem-disp' : ''} points="70,50 96,50 74,205" fill="#fff" opacity=".2" />
    </svg>
  );
}
