/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ VOLT MARK v2 — ব্র্যান্ড চিহ্ন (পুনর্নকশা, 2026-08-01)
 *
 *   ── কেন নতুন করে আঁকা হলো ──
 *   আগে সাইটে **দুটি আলাদা লোগো** ছিল: ন্যাভবার/ফুটারে কাটা-কোণ
 *   প্লেট (VoltMark v1), আর ব্রাউজার-ট্যাব ও PWA আইকনে সম্পূর্ণ
 *   ভিন্ন একটি **হীরা** (`icon.svg`, Diamond.tsx থেকে নেওয়া)।
 *   অর্থাৎ ট্যাবে এক ব্র্যান্ড, হেডারে আরেক — এটি ব্র্যান্ড নয়,
 *   দুর্ঘটনা। v2 একটিই চিহ্ন, সব জায়গায়।
 *
 *   ── নকশার যুক্তি ──
 *   • **ষড়ভুজ** = গেমিং/HUD এর ভাষা (বৃত্ত বা চৌকো নয় — ওগুলো
 *     সাধারণ)। সাইটের প্যানেল-জ্যামিতির সাথেও মেলে।
 *   • **নেগেটিভ-স্পেস বজ্র** = "তাৎক্ষণিক টপ-আপ" এর সরাসরি রূপক।
 *     বজ্রটি আঁকা হয়নি — প্লেট **কেটে** বের করা হয়েছে (mask)।
 *     কম উপাদান, বেশি মনে থাকে, আর ১৬px এ ঘেঁটে যায় না।
 *   • **এক টানা গ্রেডিয়েন্ট** (lime→ice→violet) — ব্র্যান্ডের
 *     বিদ্যমান ত্রয়ী, তাই সম্পূর্ণ নতুন লাগে না, ধারাবাহিক লাগে।
 *
 *   ── কেন দুই থিমেই কাজ করে ──
 *   চিহ্নটি **ভরাট** (কেবল আউটলাইন নয়), তাই সাদা পটেও একটি কঠিন
 *   রঙিন আকৃতি হিসেবে দাঁড়ায়। হালকা থিমে বাইরের রেখা গাঢ় হয়
 *   (`tone="ink"`), নাহলে lime প্রান্ত সাদায় মিলিয়ে যেত।
 *
 *   ⚠️ ছোট আকারে (≤20px) ভেতরের HUD রেখাগুলো নিজে থেকেই বাদ পড়ে —
 *   নাহলে ফ্যাভিকনে সেগুলো কাদা হয়ে যেত।
 * ═══════════════════════════════════════════════════════════
 */
export default function VoltMark({
  size = 40,
  uid = 'a',
  className = '',
  glow = true,
  /** `plate` — ফ্যাভিকন/PWA এর জন্য গাঢ় গোল-চৌকো পটভূমি */
  plate = false,
}: {
  size?: number;
  /** একই পাতায় একাধিক চিহ্ন থাকলে gradient/mask id আলাদা রাখে */
  uid?: string;
  className?: string;
  glow?: boolean;
  plate?: boolean;
}) {
  // ষড়ভুজ — চোঁকা-শীর্ষ (pointy-top), কেন্দ্র (24,24), R=21
  const HEX = '24,3 42.19,13.5 42.19,34.5 24,45 5.81,34.5 5.81,13.5';
  // বজ্র — প্লেট থেকে কেটে নেওয়া হয় (mask এ কালো)
  const BOLT = 'M27.5 11 L16 25.5 H21.8 L20.5 37 L32 22.5 H26.2 Z';
  const detail = size >= 22; // ছোট আকারে ভেতরের রেখা বাদ

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      style={glow ? { filter: 'drop-shadow(0 0 10px rgba(200,255,61,.32))' } : undefined}
    >
      <defs>
        <linearGradient id={`vm-g-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c8ff3d" />
          <stop offset=".52" stopColor="#7de3ff" />
          <stop offset="1" stopColor="#7b2cff" />
        </linearGradient>
        {/* প্লেট থেকে বজ্র কেটে নেওয়া — সাদা থাকে, কালো কাটা যায় */}
        <mask id={`vm-cut-${uid}`}>
          <polygon points={HEX} fill="#fff" />
          <path d={BOLT} fill="#000" />
        </mask>
      </defs>

      {plate && <rect width="48" height="48" rx="11" fill="#0a0b11" />}

      {/* মূল ভরাট ষড়ভুজ, ভেতরে বজ্রের ফাঁক */}
      <polygon
        points={HEX}
        fill={`url(#vm-g-${uid})`}
        mask={`url(#vm-cut-${uid})`}
        transform={plate ? 'translate(24 24) scale(.84) translate(-24 -24)' : undefined}
      />

      {/* বাইরের রেখা — হালকা পটভূমিতে কিনারা ধরে রাখে */}
      <polygon
        points={HEX}
        fill="none"
        stroke={`url(#vm-g-${uid})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity=".9"
        transform={plate ? 'translate(24 24) scale(.84) translate(-24 -24)' : undefined}
      />

      {/* HUD গভীরতা — ভেতরের ম্লান ষড়ভুজ (কেবল বড় আকারে) */}
      {detail && !plate && (
        <polygon
          points="24,8.2 37.5,16 37.5,32 24,39.8 10.5,32 10.5,16"
          fill="none"
          stroke="rgba(125,227,255,.35)"
          strokeWidth=".9"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
