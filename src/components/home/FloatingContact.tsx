import { SocialIcon, SOCIAL_META } from '@/components/SocialIcons';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ FLOATING CONTACT — সবসময়-হাতের-কাছে যোগাযোগ বোতাম (Phase 5)
 *
 *   প্রতিটি প্রতিযোগীর একটি স্থায়ী WhatsApp/Telegram বোতাম আছে —
 *   দ্বিধায় থাকা ক্রেতার প্রশ্ন করার জায়গা। এই সাইটে ছিল না; প্রশ্ন
 *   থাকলে ফুটার খুঁজতে হতো। এখন অ্যাডমিন-নিয়ন্ত্রিত (float_contact_*)
 *   একটি বোতাম নিচ-ডান কোণে থাকে।
 *
 *   ⚠️ অবস্থান: নিচ-**ডান** — Phase 3-এর `FloatingCard` নিচ-**বাঁয়ে**,
 *   তাই দুটি কখনো একে অপরের উপর পড়ে না।
 *   ⚠️ মোবাইলে বটম-ট্যাব বারের উপরে (bottom-[84px]) যাতে ঢাকা না পড়ে।
 *   ⚠️ সার্ভার কম্পোনেন্ট, বিশুদ্ধ CSS — কোনো ক্লায়েন্ট JS নেই;
 *   `animate-ping` reduced-motion-এ globals.css নিজেই থামিয়ে দেয়।
 *   ⚠️ url আগেই page.tsx-এ `safeUrl` দিয়ে যাচাই করা (defense-in-depth)।
 * ═══════════════════════════════════════════════════════════
 */
export default function FloatingContact({ type, url }: { type: string; url: string }) {
  const meta = SOCIAL_META[type];
  if (!meta) return null;

  const accent = type === 'whatsapp' ? '#25D366' : type === 'telegram' ? '#26A5E4' : 'var(--v-ice)';

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${meta.label}-এ সাহায্যের জন্য যোগাযোগ করুন`}
      title={`${meta.label} সাপোর্ট`}
      className="v-panel group fixed bottom-[84px] right-4 z-[80] flex min-h-[52px] items-center gap-2.5 px-4 transition-transform duration-300 hover:-translate-y-1 sm:bottom-6 sm:right-6"
      style={{
        ['--nc' as string]: '12px',
        ['--panel-fill' as string]: 'var(--v-steel)',
        ['--panel-edge' as string]: accent,
      }}
    >
      {/* স্পন্দিত বলয় — চোখ টানে, reduced-motion-এ থেমে যায় */}
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full"
          style={{ background: accent, opacity: 0.35 }}
        />
        <span className="relative inline-flex" style={{ color: accent }}>
          <SocialIcon platform={type} size={22} />
        </span>
      </span>
      <span className="v-hud text-[13px] font-bold" style={{ color: 'var(--v-ink)' }}>
        সাহায্য চাই?
      </span>
    </a>
  );
}
