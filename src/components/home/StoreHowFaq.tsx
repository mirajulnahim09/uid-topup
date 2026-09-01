import Link from 'next/link';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ HOW-TO-ORDER · RULES · FAQ · CTA — reference-শৈলীর তথ্য-ব্লক
 *
 *   reference সাইটগুলোর মতো সোজা, তথ্যভিত্তিক টোন — কিন্তু নিজের
 *   শব্দে লেখা। server component (কোনো state নেই; FAQ <details>)।
 *   supportHours prop সেট থাকলে প্রকৃত সময় দেখায়, নাহলে fallback।
 * ═══════════════════════════════════════════════════════════
 */

const STEPS = [
  { n: '০১', h: 'প্যাকেজ নির্বাচন করুন', p: 'পছন্দের Diamond প্যাকেজটি বাছুন এবং আপনার Free Fire Player ID/UID সঠিকভাবে বসান।', icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></> },
  { n: '০২', h: 'পেমেন্ট সম্পন্ন করুন', p: 'Buy Now-তে ক্লিক করে bKash / Nagad / Rocket দিয়ে Send Money করুন, তারপর সেন্ডার নম্বর ও Transaction ID দিন।', icon: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></> },
  { n: '০৩', h: 'ডেলিভারি বুঝে নিন', p: 'Place Order-এর পর সাধারণত ২০ মিনিটের ভিতরে ডায়মন্ড পৌঁছে যায়। অবস্থা Order History-তে দেখতে পাবেন।', icon: <path d="M20 6L9 17l-5-5" /> },
];

const RULES = [
  'শুধুমাত্র Bangladesh সার্ভারের Player ID/UID দিয়ে Top Up করা যাবে। অন্য সার্ভারের UID হলে অর্ডার করবেন না।',
  'Diamond নিতে শুধু আপনার Player ID/UID লাগবে — পাসওয়ার্ড কখনো লাগে না।',
  'UID ভুল দিয়ে Diamond না পেলে কর্তৃপক্ষ দায়ী থাকবে না, তাই অর্ডারের আগে দুইবার মিলিয়ে নিন।',
  'সাধারণত ২০ মিনিটে অর্ডার Complete হয়; ব্যস্ত সময়ে সর্বোচ্চ ১ ঘণ্টা।',
  'অর্ডার Cancel হলে কারণ Order History-তে থাকবে এবং টাকা ওয়ালেটে ফেরত যাবে।',
];

const FAQS: [string, string][] = [
  ['অর্ডার Complete হতে কতক্ষণ লাগে?', 'সাধারণত ২০ মিনিটের ভিতরে Order Complete করা হয়। ব্যস্ত সময়ে সর্বোচ্চ ১ ঘণ্টা লাগতে পারে। এর মধ্যে ডেলিভারি না পেলে মেসেঞ্জারে যোগাযোগ করুন।'],
  ['Player ID/UID কোথায় পাব?', 'Free Fire গেমে প্রোফাইলে ঢুকলে নামের নিচে একটি সংখ্যাসূচক ID দেখতে পাবেন। এটিই আপনার UID — নিকনেম নয়, শুধু নম্বরটি ব্যবহার করুন।'],
  ['UID ভুল দিলে কী হবে?', 'UID ভুল দিয়ে Diamond না পেলে কর্তৃপক্ষ দায়ী থাকবে না। তাই অর্ডার করার আগে অবশ্যই UID দুইবার মিলিয়ে নিবেন।'],
  ['কোন কোন মাধ্যমে পেমেন্ট করা যায়?', 'bKash, Nagad, Rocket এবং Upay দিয়ে Send Money করে পেমেন্ট করতে পারবেন। চাইলে আগে ওয়ালেটে টাকা যোগ করে পরে অর্ডার করতে পারেন।'],
  ['পাসওয়ার্ড কি দিতে হবে?', 'না। Diamond টপ আপের জন্য শুধু আপনার Player ID/UID লাগবে। আমরা কখনো আপনার অ্যাকাউন্টের পাসওয়ার্ড চাইব না।'],
];

export default function StoreHowFaq() {
  return (
    <>
      {/* ═══ কিভাবে অর্ডার করবেন ═══ */}
      <section id="how" className="mt-6" style={{ background: 'linear-gradient(180deg, rgba(139,92,246,.06), transparent 45%)', borderTop: '1px solid var(--v-edge)', borderBottom: '1px solid var(--v-edge)' }}>
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="mx-auto max-w-xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-bold" style={{ background: 'rgba(139,92,246,.16)', color: 'var(--violet)', letterSpacing: '.04em' }}>অর্ডার প্রসেস</span>
            <h2 className="mt-3.5 font-extrabold" style={{ fontSize: 'clamp(1.5rem,3.5vw,2.1rem)', letterSpacing: '-.02em', color: 'var(--v-ink)' }}>কিভাবে অর্ডার করবেন?</h2>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>মাত্র কয়েকটি ধাপে আপনার Free Fire অ্যাকাউন্টে ডায়মন্ড নিয়ে নিন।</p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.n} className="card v-panel--hov relative p-6" style={{ background: 'var(--v-steel)' }}>
                <span className="absolute right-5 top-4 font-extrabold leading-none" style={{ fontSize: '3rem', color: 'var(--v-edge2)' }}>{s.n}</span>
                <span className="grid h-[52px] w-[52px] place-items-center rounded-[14px] text-white"
                  style={{ background: [ 'linear-gradient(135deg,#84cc16,#65a30d)', 'linear-gradient(135deg,#0ea5e9,#0284c7)', 'linear-gradient(135deg,#8b5cf6,#6d28d9)' ][i] }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{s.icon}</svg>
                </span>
                <h3 className="mt-4 text-[17px] font-bold" style={{ color: 'var(--v-ink)' }}>{s.h}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>{s.p}</p>
              </div>
            ))}
          </div>

          {/* নিয়ম + UID */}
          <div className="mt-6 grid gap-4 md:grid-cols-[1.3fr_1fr]">
            <div className="card p-6" style={{ borderLeft: '4px solid #65a30d' }}>
              <h4 className="mb-4 flex items-center gap-2.5 text-[16px] font-extrabold" style={{ color: 'var(--v-ink)' }}>
                <span style={{ color: '#65a30d' }}>⦿</span> অর্ডার করার আগে যা জানা জরুরি
              </h4>
              <ul className="flex flex-col gap-3">
                {RULES.map((r, i) => (
                  <li key={i} className="relative pl-6 text-[13.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
                    <span className="absolute left-0 top-0" style={{ color: '#65a30d' }}>⦿</span>{r}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-6" style={{ borderLeft: '4px solid #0284c7' }}>
              <h4 className="mb-4 flex items-center gap-2.5 text-[16px] font-extrabold" style={{ color: 'var(--v-ink)' }}>
                <span className="grid h-6 w-6 place-items-center rounded-full text-[14px] font-extrabold" style={{ background: 'var(--sem-info-tint)', color: 'var(--sem-info)' }}>?</span>
                Player ID/UID কোথায় পাবেন
              </h4>
              <ol className="flex flex-col gap-3.5">
                {['Free Fire গেমে ঢুকে বাম পাশে প্রোফাইল ছবিতে ট্যাপ করুন।', 'নামের নিচে একটি সংখ্যাসূচক ID দেখতে পাবেন।', 'এই নম্বরটিই আপনার UID — শুধু নম্বরটি কপি করে বসান।'].map((t, i) => (
                  <li key={i} className="relative pl-9 text-[13.5px] leading-snug" style={{ color: 'var(--v-mut)' }}>
                    <span className="absolute left-0 top-[-2px] grid h-6 w-6 place-items-center rounded-lg text-[12px] font-extrabold text-white" style={{ background: '#0284c7', fontFamily: "'Unbounded',sans-serif" }}>{i + 1}</span>{t}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="mx-auto max-w-xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-bold" style={{ background: 'rgba(139,92,246,.16)', color: 'var(--violet)', letterSpacing: '.04em' }}>সাধারণ প্রশ্ন</span>
          <h2 className="mt-3.5 font-extrabold" style={{ fontSize: 'clamp(1.5rem,3.5vw,2.1rem)', letterSpacing: '-.02em', color: 'var(--v-ink)' }}>প্রশ্ন ও উত্তর</h2>
        </div>
        <div className="mx-auto mt-8 flex max-w-3xl flex-col gap-2.5">
          {FAQS.map(([q, a], i) => (
            <details key={i} className="card overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-semibold" style={{ color: 'var(--v-ink)' }}>
                {q}
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ background: 'rgba(139,92,246,.16)', color: 'var(--violet)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </summary>
              <p className="px-5 pb-4 text-[14px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <div className="relative overflow-hidden rounded-[22px] px-8 py-12 text-center text-white" style={{ background: 'linear-gradient(120deg,#4c1d95,#6d28d9 55%,#7c3aed)', boxShadow: '0 12px 40px -12px rgba(109,40,217,.4)' }}>
          <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 h-72 w-72 rounded-full" style={{ background: 'radial-gradient(circle,rgba(163,230,53,.28),transparent 65%)' }} />
          <h2 className="relative mx-auto max-w-2xl font-extrabold" style={{ fontSize: 'clamp(1.6rem,4vw,2.4rem)', lineHeight: 1.15 }}>
            এখনই Top Up করুন <span style={{ color: 'var(--accent-2)' }}>কম দামে, দ্রুত ডেলিভারিতে</span>
          </h2>
          <p className="relative mx-auto mt-3.5 max-w-md text-[15px]" style={{ opacity: 0.9 }}>প্যাকেজ বাছুন, Player ID/UID দিন আর bKash-এ পেমেন্ট করুন। বাকিটা আমরা দেখছি।</p>
          <div className="relative mt-6 flex flex-wrap justify-center gap-3">
            <Link href="#catalog" className="inline-flex min-h-[46px] items-center gap-2 rounded-xl px-7 text-[14px] font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
              Top Up করুন
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
            </Link>
            <Link href="/track" className="inline-flex min-h-[46px] items-center rounded-xl px-7 text-[14px] font-bold" style={{ background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)' }}>
              অর্ডার ট্র্যাক করুন
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
