import NovaCat from './NovaCat';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ LoadingStage — লোডিংয়ের **একমাত্র** দৃশ্য।
 *
 *   গ্লোবাল ওভারলে (`LoadingProvider`) ও সার্ভার-রেন্ডার করা
 *   বুট-পর্দা (`layout.tsx`) — দুটোই এটিই ব্যবহার করে। তাই
 *   পাতা-লোড, রুট-বদল, লগইন ও যেকোনো মিউটেশনে ব্যবহারকারী
 *   **হুবহু একই** জিনিস দেখে; কোথাও দ্বিতীয় কোনো লোডার নেই।
 *
 *   ⚠️ এটি একটি server component (কোনো hook নেই) — নাহলে
 *   বুট-পর্দায় বসানো যেত না, আর তখন আবার দুটি আলাদা দৃশ্য
 *   বানাতে হতো, যা ঠিক এই একত্রীকরণের বিপরীত।
 *
 *   বার্তা বদলায় **বিশুদ্ধ CSS**-এ (`.nv-msg`), কোনো টাইমার নেই —
 *   তাই JS চালু হওয়ার আগেও বুট-পর্দায় বার্তা ঘোরে।
 * ═══════════════════════════════════════════════════════════
 */
export default function LoadingStage({
  size = 260,
  uid = 'stage',
  still = false,
  /** নির্দিষ্ট কাজের বার্তা (যেমন "অর্ডার প্রসেস হচ্ছে…")। দিলে ঘূর্ণায়মান বার্তার বদলে এটিই দেখায়। */
  label,
  messages,
}: {
  size?: number;
  uid?: string;
  still?: boolean;
  label?: string;
  messages?: string[];
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <NovaCat size={size} uid={uid} still={still} />

      {/*
        ★ নির্দিষ্ট কাজ চললে সেই কাজের নামই সবচেয়ে সৎ বার্তা
          ("পেমেন্ট প্রসেস হচ্ছে…")। কোনো নির্দিষ্ট কাজ না থাকলে
          (পাতা লোড/বুট) সাধারণ বার্তাগুলো ঘুরিয়ে দেখানো হয়।
      */}
      {label ? (
        <p
          className="v-dsp text-[15px] font-bold sm:text-[16px]"
          style={{ color: 'var(--v-ink)', letterSpacing: '-.01em' }}
        >
          {label}
        </p>
      ) : (
        <p
          className="nv-msg v-dsp text-[15px] font-bold sm:text-[16px]"
          style={{ color: 'var(--v-ink)', letterSpacing: '-.01em' }}
        >
          {(messages ?? []).map((m) => <span key={m}>{m}</span>)}
        </p>
      )}

      {/* সরু অগ্রগতি-রেখা — শতাংশ নয়, কেবল "চলছে" ইঙ্গিত */}
      <span
        className="nv-bar mt-0.5 block h-[3px] w-[132px] rounded-full"
        style={{ background: 'color-mix(in srgb, var(--v-ink) 12%, transparent)' }}
        aria-hidden="true"
      >
        <i />
      </span>
    </div>
  );
}
