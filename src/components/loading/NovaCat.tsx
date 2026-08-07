/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ NOVA — "The Charge-Up" · প্ল্যাটফর্মের একমাত্র লোডিং দৃশ্য
 *
 *   ── কেন ধারণাটাই বদলানো হলো ──
 *   আগের সংস্করণে বিড়াল একটি **সাধারণ শক্তি-গোলক** নিয়ে খেলত।
 *   সেটি সুন্দর ছিল, কিন্তু ব্র্যান্ড-নিরপেক্ষ — যেকোনো ওয়েবসাইট
 *   হুবহু ওটাই ব্যবহার করতে পারত। একটি লোডিং পর্দা মনে রাখার মতো
 *   হয় তখনই, যখন সে **পণ্যটির গল্প** বলে।
 *
 *   এখানে গল্পটি আক্ষরিকভাবে এই প্ল্যাটফর্মের কাজ:
 *     বিড়াল একটি **ডায়মন্ড** থাবা দিয়ে ছুড়ে দেয় →
 *     সেটি **SS UID TOPUP-এর ষড়ভুজ চিহ্নে** গিয়ে লাগে →
 *     চিহ্নের বজ্র **জ্বলে ওঠে**, শকওয়েভ ছড়ায় →
 *     বিড়াল খুশিতে চোখ কুঁচকে হাসে → চিহ্ন ম্লান হয় → আবার।
 *
 *   অর্থাৎ প্রতিটি লুপে গ্রাহক নিজের টপ-আপটাই ঘটতে দেখেন। ডায়মন্ড
 *   = পণ্য, ষড়ভুজ = ব্র্যান্ড (`VoltMark`-এর হুবহু জ্যামিতি), বজ্র
 *   জ্বলে ওঠা = "টপ-আপ সম্পন্ন"।
 *
 *   ── আবেগের কাঠামো (এটাই মূল নকশা) ──
 *   প্রত্যাশা → আঘাত → **পরিশোধ** → আনন্দ। পুরনো লুপে "পরিশোধ"
 *   ছিল না, তাই দেখতে ভালো লাগলেও কিছু *ঘটত* না। এখানে ৪৪%-এ
 *   একটি স্পষ্ট শীর্ষমুহূর্ত আছে — আলো, শকওয়েভ, বিড়ালের প্রতিক্রিয়া।
 *
 *   ── ব্র্যান্ড-চিহ্ন যা মনে গেঁথে যায় ──
 *   • বিড়ালের গলায় **লাইম কলার + ষড়ভুজ ট্যাগ** — চরিত্রটি
 *     ব্র্যান্ডের, ধার করা স্টক-ম্যাসকট নয়।
 *   • চোখের মণি ব্র্যান্ড-লাইম।
 *   • মঞ্চ, HUD-বন্ধনী ও স্ক্যান-রেখা — গেম-লঞ্চারের ভাষা।
 *
 *   ── কেন SVG, কেন ফিল্টার নয় ──
 *   সব আভা **radial-gradient** দিয়ে আঁকা; `filter: blur()` প্রতিটি
 *   ফ্রেমে র‍্যাস্টার চায়। দেখতে bloom, খরচে সাধারণ আকৃতি।
 *
 *   ⚠️ সব গতি `globals.css`-এ (`.nv-*`)। এখানে শুধু জ্যামিতি।
 *   ⚠️ **server component** — বুট-পর্দায় (JS চালুর আগে) একই দৃশ্য
 *   দেখাতে হয়, তাই কোনো hook ব্যবহার করা যাবে না।
 * ═══════════════════════════════════════════════════════════
 */
export default function NovaCat({
  size = 260,
  uid = 'nv',
  /** `true` হলে সব গতি থেমে থাকে */
  still = false,
}: {
  size?: number;
  uid?: string;
  still?: boolean;
}) {
  const g = (n: string) => `${uid}-${n}`;

  /* ── ব্র্যান্ড-চিহ্নের জ্যামিতি ──
     `VoltMark.tsx` এর হুবহু বিন্দুগুলো, কেন্দ্র (352,118) ও R=46 এ
     স্কেল করা (s = 46/21)। হাতে নতুন করে আঁকা হয়নি — লোগো "প্রায়
     একই রকম" হলে সেটি ব্র্যান্ড নয়, নকল। */
  const HEX = '352,72 391.84,95 391.84,141 352,164 312.16,141 312.16,95';
  const HEX_INNER = '352,83.4 381.57,100.5 381.57,135.5 352,152.6 322.43,135.5 322.43,100.5';
  const BOLT = 'M359.67 89.52 L334.48 121.29 H347.18 L344.33 146.48 L369.52 114.71 H356.82 Z';

  return (
    <svg
      className={`nv-svg${still ? ' nv-still' : ''}`}
      width={size}
      height={size * 0.59}
      /* ⚠️ প্রস্থ ৪৪০ — ডায়মন্ড ডানে ১০২px উড়ে যায় ও চিহ্নের আভা
         ১.৬× পর্যন্ত বাড়ে। মাপে-মাপে viewBox দিলে চক্রের ঠিক
         শীর্ষমুহূর্তে আভাটি কেটে যেত — যা কেবল মাঝ-অ্যানিমেশনে
         ধরা পড়ে, স্থির অবস্থায় নয়। */
      viewBox="0 0 440 260"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        {/* ── পশম ── */}
        <linearGradient id={g('fur')} x1=".28" y1="0" x2=".72" y2="1">
          <stop offset="0" stopColor="#6d7ca8" />
          <stop offset=".42" stopColor="#445075" />
          <stop offset="1" stopColor="#1e2740" />
        </linearGradient>
        <linearGradient id={g('furHead')} x1=".3" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#7d8cb8" />
          <stop offset=".45" stopColor="#4c5980" />
          <stop offset="1" stopColor="#28324f" />
        </linearGradient>
        <linearGradient id={g('fluff')} x1=".5" y1="0" x2=".5" y2="1">
          <stop offset="0" stopColor="#f6f9ff" />
          <stop offset="1" stopColor="#c6d2e8" />
        </linearGradient>
        {/* রিম-লাইট — চিহ্নের দিক (ডান) থেকে */}
        <linearGradient id={g('rim')} x1="1" y1=".75" x2=".1" y2=".1">
          <stop offset="0" stopColor="#d8ff6a" stopOpacity="1" />
          <stop offset=".45" stopColor="#a6ee3d" stopOpacity=".7" />
          <stop offset="1" stopColor="#7de3ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={g('cool')} x1="0" y1=".2" x2="1" y2=".9">
          <stop offset="0" stopColor="#7de3ff" stopOpacity=".5" />
          <stop offset="1" stopColor="#7de3ff" stopOpacity="0" />
        </linearGradient>

        {/* ── ব্র্যান্ড ত্রয়ী: চিহ্নের গ্রেডিয়েন্ট (VoltMark এর মতোই) ── */}
        <linearGradient id={g('mark')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c8ff3d" />
          <stop offset=".52" stopColor="#7de3ff" />
          <stop offset="1" stopColor="#7b2cff" />
        </linearGradient>
        {/* চিহ্ন থেকে বজ্র কেটে নেওয়া — VoltMark এর কৌশলই */}
        <mask id={g('cut')}>
          <polygon points={HEX} fill="#fff" />
          <path d={BOLT} fill="#000" />
        </mask>

        {/* ── ডায়মন্ড: আইস-নীল, পণ্যের রঙ ── */}
        <linearGradient id={g('diaTop')} x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#bdefff" />
          <stop offset="1" stopColor="#6cc9f0" />
        </linearGradient>
        <linearGradient id={g('diaBot')} x1=".2" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor="#8ddcf7" />
          <stop offset=".55" stopColor="#3aa6d8" />
          <stop offset="1" stopColor="#1b6f9c" />
        </linearGradient>

        {/* ── আভা ও ছায়া ── */}
        <radialGradient id={g('bloomIce')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#7de3ff" stopOpacity=".6" />
          <stop offset=".35" stopColor="#7de3ff" stopOpacity=".22" />
          <stop offset="1" stopColor="#7de3ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={g('bloomLime')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#e8ffb0" stopOpacity=".85" />
          <stop offset=".28" stopColor="#c8ff3d" stopOpacity=".4" />
          <stop offset=".65" stopColor="#a6ee3d" stopOpacity=".1" />
          <stop offset="1" stopColor="#a6ee3d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={g('stage')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#7de3ff" stopOpacity=".26" />
          <stop offset=".5" stopColor="#7b2cff" stopOpacity=".08" />
          <stop offset="1" stopColor="#7b2cff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={g('amb')} cx=".5" cy=".45" r=".5">
          <stop offset="0" stopColor="#8fb0ff" stopOpacity=".2" />
          <stop offset=".6" stopColor="#7de3ff" stopOpacity=".07" />
          <stop offset="1" stopColor="#7de3ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={g('shade')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#03050b" stopOpacity=".55" />
          <stop offset=".55" stopColor="#03050b" stopOpacity=".26" />
          <stop offset="1" stopColor="#03050b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={g('iris')} cx=".38" cy=".3" r=".78">
          <stop offset="0" stopColor="#dcff92" />
          <stop offset=".4" stopColor="#a5e83f" />
          <stop offset=".78" stopColor="#5fa81c" />
          <stop offset="1" stopColor="#2b5c0d" />
        </radialGradient>
      </defs>

      {/* ═══ পরিবেশের আভা ═══ */}
      <ellipse className="nv-amb" cx="210" cy="122" rx="205" ry="104" fill={`url(#${g('amb')})`} />

      {/* ═══ HUD বন্ধনী — লঞ্চারের ফ্রেম ═══
          কোণগুলো দৃশ্যটিকে "একটি পর্দা" বানায়, ভাসমান স্টিকার নয় */}
      <g className="nv-hud" stroke="#7de3ff" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".38">
        <path d="M14 40V18h22M426 40V18h-22M14 220v22h22M426 220v22h-22" />
      </g>

      {/* ═══ মঞ্চ — ষড়ভুজ শক্তি-প্ল্যাটফর্ম ═══ */}
      <ellipse cx="170" cy="216" rx="150" ry="30" fill={`url(#${g('stage')})`} />
      <g className="nv-grid" stroke="#7de3ff" strokeWidth="1" fill="none" opacity=".22">
        <polygon points="170,196 218,208 218,226 170,238 122,226 122,208" />
        <polygon points="170,204 200,211.5 200,222.5 170,230 140,222.5 140,211.5" />
      </g>

      {/* ═══ ছায়া ═══ */}
      <ellipse className="nv-shadow" cx="163" cy="215" rx="92" ry="17" fill={`url(#${g('shade')})`} />

      {/* ═══ ভাসমান কণা ═══ */}
      <g fill="#c8ff3d">
        <circle className="nv-mote nv-mote--1" cx="72" cy="76" r="1.8" />
        <circle className="nv-mote nv-mote--2" cx="404" cy="58" r="1.4" />
        <circle className="nv-mote nv-mote--3" cx="262" cy="38" r="1.6" />
        <circle className="nv-mote nv-mote--4" cx="118" cy="34" r="1.3" />
        <circle className="nv-mote nv-mote--5" cx="418" cy="186" r="1.5" />
        <circle className="nv-mote nv-mote--6" cx="44" cy="140" r="1.2" />
      </g>

      {/* ══════════ ব্র্যান্ড-চিহ্ন — চার্জের লক্ষ্য ══════════ */}
      <g className="nv-mark">
        {/* আঘাতের আভা — শুধু চার্জ হওয়ার সময় জ্বলে */}
        <circle className="nv-mark-bloom" cx="352" cy="118" r="86" fill={`url(#${g('bloomLime')})`} />

        {/* শকওয়েভ — দুটি রিং, একটু পিছিয়ে */}
        <polygon className="nv-shock nv-shock--1" points={HEX} fill="none"
          stroke="#e8ffb0" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon className="nv-shock nv-shock--2" points={HEX} fill="none"
          stroke="#7de3ff" strokeWidth="1.8" strokeLinejoin="round" />

        {/* ম্লান অবস্থা — অপেক্ষারত চিহ্ন */}
        <g className="nv-mark-dim">
          {/* ⚠️ ম্লান মানে **অদৃশ্য নয়** — অপেক্ষারত লক্ষ্যটি না দেখা
              গেলে ডায়মন্ড কোথায় যাচ্ছে তা বোঝা যেত না, আর হালকা
              থিমে ২৬% অস্বচ্ছতা প্রায় মিলিয়ে যাচ্ছিল। */}
          <polygon points={HEX} fill={`url(#${g('mark')})`} mask={`url(#${g('cut')})`} opacity=".42" />
          <polygon points={HEX} fill="none" stroke={`url(#${g('mark')})`} strokeWidth="2.4"
            strokeLinejoin="round" opacity=".72" />
          <polygon points={HEX_INNER} fill="none" stroke="rgba(125,227,255,.28)" strokeWidth="1.1"
            strokeLinejoin="round" />
        </g>

        {/* জ্বলন্ত অবস্থা — চার্জ সম্পন্ন */}
        <g className="nv-mark-lit">
          <polygon points={HEX} fill={`url(#${g('mark')})`} mask={`url(#${g('cut')})`} />
          <polygon points={HEX} fill="none" stroke="#eaffb8" strokeWidth="2.4" strokeLinejoin="round" />
          <polygon points={HEX_INNER} fill="none" stroke="rgba(232,255,176,.7)" strokeWidth="1.3"
            strokeLinejoin="round" />
          {/* বজ্রটি নেগেটিভ-স্পেস — তাই তার পেছনে আলো দিলে সেটিই জ্বলে */}
          <path className="nv-bolt" d={BOLT} fill="#f6ffe0" opacity=".95" />
        </g>

        {/* আঘাতের রশ্মি */}
        <g className="nv-burst" stroke="#eaffb8" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M352 46V22M352 190v24M410 118h24M294 118h-24M394 76l17-17M394 160l17 17M310 76l-17-17M310 160l-17 17" />
        </g>
      </g>

      {/* ══════════ বিড়াল ══════════ */}
      <g className="nv-body">
        {/* ═══ লেজ — দেহের পিছনে, বাঁ দিকে ═══ */}
        <g className="nv-tail">
          <path d="M115 200c-30 6-52-8-58-30-6-21 4-42 20-49"
            stroke={`url(#${g('fur')})`} strokeWidth="17" strokeLinecap="round" fill="none" />
          <path d="M115 200c-30 6-52-8-58-30-6-21 4-42 20-49"
            stroke={`url(#${g('cool')})`} strokeWidth="5" strokeLinecap="round" fill="none" opacity=".75" />
        </g>

        {/* ═══ পিছনের পা ═══ */}
        <ellipse cx="105" cy="200" rx="27" ry="15" fill={`url(#${g('fur')})`} />
        <ellipse cx="221" cy="200" rx="27" ry="15" fill={`url(#${g('fur')})`} />

        <g className="nv-breathe">
          {/* ═══ দেহ ═══ */}
          <path d="M99 206c-9-38 0-76 20-95 14-13 36-17 55-12 26 7 43 29 46 58 2 21-3 38-11 49z"
            fill={`url(#${g('fur')})`} />
          <path d="M99 206c-9-38 0-76 20-95 8-8 19-13 30-15-14 8-24 22-29 38-7 22-7 47-2 72z"
            fill={`url(#${g('cool')})`} opacity=".5" />
          {/* বুকের পশম */}
          <path d="M127 206c-8-27-4-50 8-63 8-9 21-10 30-4 12 8 19 24 19 42 0 11-2 20-5 25z"
            fill={`url(#${g('fluff')})`} />
          <ellipse cx="163" cy="204" rx="60" ry="10" fill="#0a0f1e" opacity=".22" />
        </g>

        <ellipse cx="105" cy="203" rx="15" ry="8.5" fill={`url(#${g('fluff')})`} opacity=".95" />
        <ellipse cx="221" cy="203" rx="15" ry="8.5" fill={`url(#${g('fluff')})`} opacity=".95" />
        <ellipse cx="105" cy="202" rx="5" ry="3" fill="#f2a8bd" opacity=".55" />

        {/* ═══ মাথা ═══ */}
        <g className="nv-head">
          <g className="nv-ear-l">
            <path d="M121 72 103 22l48 26z" fill={`url(#${g('furHead')})`} />
            <path d="M124 66 113 34l26 15z" fill="#f2a8bd" opacity=".45" />
          </g>
          <g className="nv-ear-r">
            <path d="M199 72 217 22l-48 26z" fill={`url(#${g('furHead')})`} />
            <path d="M196 66 207 34l-26 15z" fill="#f2a8bd" opacity=".45" />
            <path d="M217 22 200 71" stroke={`url(#${g('rim')})`} strokeWidth="3.4" strokeLinecap="round" />
          </g>

          <ellipse cx="160" cy="92" rx="57" ry="49" fill={`url(#${g('furHead')})`} />
          <path d="M160 43c-31 0-57 22-57 49 0 17 10 32 26 41-10-11-16-25-16-41 0-24 19-44 47-49z"
            fill={`url(#${g('cool')})`} opacity=".55" />
          <ellipse cx="160" cy="134" rx="40" ry="10" fill="#0a0f1e" opacity=".26" />

          <ellipse cx="125" cy="106" rx="12" ry="7" fill="#f2a8bd" opacity=".3" />
          <ellipse cx="195" cy="106" rx="12" ry="7" fill="#f2a8bd" opacity=".3" />

          {/* চোখ */}
          <g className="nv-eyes">
            <g>
              <ellipse cx="139" cy="88" rx="12" ry="14" fill="#080b13" />
              <ellipse cx="139" cy="88" rx="9.6" ry="11.6" fill={`url(#${g('iris')})`} />
              <ellipse className="nv-pupil" cx="139" cy="88" rx="4.2" ry="8.4" fill="#080b13" />
              <circle cx="143" cy="82" r="3.6" fill="#fff" opacity=".96" />
              <circle cx="135" cy="94" r="1.8" fill="#fff" opacity=".55" />
            </g>
            <g>
              <ellipse cx="181" cy="88" rx="12" ry="14" fill="#080b13" />
              <ellipse cx="181" cy="88" rx="9.6" ry="11.6" fill={`url(#${g('iris')})`} />
              <ellipse className="nv-pupil" cx="181" cy="88" rx="4.2" ry="8.4" fill="#080b13" />
              <circle cx="185" cy="82" r="3.6" fill="#fff" opacity=".96" />
              <circle cx="177" cy="94" r="1.8" fill="#fff" opacity=".55" />
            </g>
          </g>

          {/* খুশির চোখ — চার্জ সম্পন্ন হওয়ার পর */}
          <g className="nv-eyes-happy" stroke="#080b13" strokeWidth="3.6" strokeLinecap="round" fill="none">
            <path d="M130 90c4.5-6.5 13.5-6.5 18 0" />
            <path d="M172 90c4.5-6.5 13.5-6.5 18 0" />
          </g>

          {/* নাক ও মুখ */}
          <path d="M160 108l-6-5h12z" fill="#f2a8bd" />
          <path d="M160 109v4.4m0 0c-3.8 0-5.6-2.3-5.6-2.3m5.6 2.3c3.8 0 5.6-2.3 5.6-2.3"
            stroke="#080b13" strokeWidth="2" strokeLinecap="round" fill="none" opacity=".85" />

          <g stroke="#eef3ff" strokeWidth="1.6" strokeLinecap="round" opacity=".55">
            <path d="M115 100H91M116 107l-22 6M116 93l-22-6" />
            <path d="M205 100h24M204 107l22 6M204 93l22-6" />
          </g>

          <path d="M217 92a57 49 0 0 1 0 84" stroke={`url(#${g('rim')})`} strokeWidth="4"
            strokeLinecap="round" fill="none" transform="translate(-29 -50)" />
        </g>

        {/* ═══ ব্র্যান্ড কলার + ষড়ভুজ ট্যাগ ═══
            ⚠️ এটিই চরিত্রটিকে **এই** ব্র্যান্ডের করে তোলে। কলার ছাড়া
            এটি "একটি বিড়াল"; কলার সহ এটি SS UID TOPUP-এর বিড়াল। */}
        <g className="nv-collar">
          <path d="M131 136c9 8 20 12 30 12s21-4 30-12" stroke="#c8ff3d" strokeWidth="7"
            strokeLinecap="round" fill="none" />
          <path d="M131 136c9 8 20 12 30 12s21-4 30-12" stroke="#eaffb8" strokeWidth="2.4"
            strokeLinecap="round" fill="none" opacity=".65" />
          {/* ঝুলন্ত ষড়ভুজ ট্যাগ — ছোট VoltMark */}
          <g className="nv-tag">
            <polygon points="161,149 170,154 170,164 161,169 152,164 152,154"
              fill={`url(#${g('mark')})`} />
            <polygon points="161,149 170,154 170,164 161,169 152,164 152,154"
              fill="none" stroke="#eaffb8" strokeWidth="1" opacity=".8" />
            <path d="M162.6 153.5 157.5 160h2.6l-.6 5 5.1-6.5h-2.6z" fill="#0a0f1e" opacity=".85" />
          </g>
        </g>

        {/* ═══ আঘাতকারী থাবা ═══ */}
        <g className="nv-paw">
          <ellipse cx="189" cy="142" rx="17" ry="15" fill="#0a0f1e" opacity=".28" />
          {/* ⚠️ পায়ের চারপাশে একটি গাঢ় রেখা — নাহলে উল্লাসের ভঙ্গিতে
              (থাবা তোলা) হালকা পশমের হাতটি হালকা দেহের সামনে মিলিয়ে
              যেত এবং পাঞ্জাটি একটি **বিচ্ছিন্ন সাদা দাগ** মনে হতো।
              স্ক্রিনশটেই ধরা পড়েছে; জ্যামিতি ঠিক ছিল, কনট্রাস্ট নয়। */}
          <path d="M179 128c11-6 25-4 35 3l14 8c9 5 9 16 0 21-9 5-19 2-25-4l-23-14c-7-4-7-11-1-14z"
            fill={`url(#${g('furHead')})`} stroke="#141c30" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M183 141l23 14c6 6 16 9 25 4" stroke="#151d33" strokeWidth="4"
            strokeLinecap="round" fill="none" opacity=".6" />
          <ellipse cx="235" cy="150" rx="17" ry="13.5" fill={`url(#${g('fluff')})`} />
          <ellipse cx="235" cy="150" rx="17" ry="13.5" fill="none" stroke="#1b2439"
            strokeWidth="1.4" opacity=".35" />
          <ellipse cx="237" cy="153" rx="6.4" ry="4.6" fill="#f2a8bd" opacity=".85" />
          <circle cx="229" cy="144" r="2.8" fill="#f2a8bd" opacity=".7" />
          <circle cx="243" cy="143" r="2.8" fill="#f2a8bd" opacity=".7" />
          <path d="M214 131l14 8c8 5 9 15 1 20" stroke={`url(#${g('rim')})`} strokeWidth="3.6"
            strokeLinecap="round" fill="none" />
        </g>

        {/* দেহের ডান কিনারায় রিম-লাইট */}
        <path d="M194 100c16 12 26 32 27 55 .5 11 0 21-2 30"
          stroke={`url(#${g('rim')})`} strokeWidth="4.5" strokeLinecap="round" fill="none" opacity=".85" />
      </g>

      {/* ══════════ ডায়মন্ড — পণ্যটি নিজেই ══════════ */}
      <g className="nv-dia">
        <ellipse className="nv-dia-streak" cx="266" cy="150" rx="52" ry="11"
          fill={`url(#${g('bloomIce')})`} />
        <circle className="nv-dia-bloom" cx="266" cy="150" r="40" fill={`url(#${g('bloomIce')})`} />
        {/* মুকুট (উপরের অংশ) */}
        <path d="M254 138h24l9 10h-42z" fill={`url(#${g('diaTop')})`} />
        {/* প্যাভিলিয়ন (নিচের চূড়া) */}
        <path d="M245 148h42l-21 25z" fill={`url(#${g('diaBot')})`} />
        {/* দিক-নির্দেশক ফ্যাসেট — কাচের ভাব */}
        <g stroke="#f2fbff" strokeWidth="1.1" opacity=".55" fill="none">
          <path d="M254 138l-9 10M278 138l9 10M266 138v10M245 148l21 25M287 148l-21 25M258 148l8 25M274 148l-8 25" />
        </g>
        <path d="M256 140h9l-3 5h-9z" fill="#ffffff" opacity=".7" />
        {/* কক্ষপথে ঝিকিমিকি */}
        <g className="nv-dia-sat">
          <circle cx="266" cy="150" r="2.4" fill="#eaffff" transform="translate(30 0)" />
          <circle cx="266" cy="150" r="1.7" fill="#c8ff3d" transform="translate(-30 0)" />
        </g>
        <g fill="#bdefff">
          <circle className="nv-trail-p nv-trail-p--1" cx="266" cy="150" r="3.4" />
          <circle className="nv-trail-p nv-trail-p--2" cx="266" cy="150" r="2.6" />
          <circle className="nv-trail-p nv-trail-p--3" cx="266" cy="150" r="1.9" />
        </g>
      </g>

      {/* ═══ থাবার আঘাতের স্ফুলিঙ্গ ═══ */}
      <g className="nv-spark" fill="none" strokeLinecap="round">
        <g stroke="#eaffff" strokeWidth="5" opacity=".5">
          <path d="M246 150h13M237 135l9 7M237 165l9-7M243 123l4 11M243 177l4-11" />
        </g>
        <g stroke="#5ec5ef" strokeWidth="2.2">
          <path d="M246 150h13M237 135l9 7M237 165l9-7M243 123l4 11M243 177l4-11" />
        </g>
      </g>
    </svg>
  );
}
