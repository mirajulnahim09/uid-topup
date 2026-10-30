import type { Metadata } from 'next';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import BrandingManager from '@/components/admin/BrandingManager';
import { getSettings } from '@/lib/settings';
import { resolveBranding, LOGO_SLOTS, TEXT_FIELDS } from '@/lib/branding';
import { storageReady, storageReason } from '@/lib/upload';
import { requireAdminPage } from '@/lib/pageGuard';

export const metadata: Metadata = { title: 'ব্র্যান্ডিং' };
export const dynamic = 'force-dynamic';

/**
 * ★ /admin/branding — ব্র্যান্ড আইডেন্টিটির একক কেন্দ্র।
 *
 *   এখানকার কিছুই গোপন নয় (লোগোর URL সর্বজনীন, ব্র্যান্ড-লেখাও),
 *   তাই পুরো কনফিগ নিরাপদে ক্লায়েন্টে পাঠানো যায় — টেলিগ্রাম
 *   পাতার মতো এখানে গোপন-ছাঁকনির দরকার নেই।
 */
export default async function AdminBrandingPage() {
  // ★ SEC-01 — পাতার নিজস্ব DB-গার্ড (সফট-নেভিগেশনে লেআউট চলে না)
  await requireAdminPage();
  const settings = await getSettings();
  const branding = resolveBranding(settings);

  const raw = Object.fromEntries(
    TEXT_FIELDS.map((f) => [f.key, settings[f.key] ?? '']),
  ) as Record<string, string>;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="ব্র্যান্ডিং"
        subtitle="লোগো, নাম ও মেটাডেটা — সবই এখান থেকে। কোনো কোড বা ফাইল সম্পাদনার দরকার নেই; সংরক্ষণ করলেই পুরো সাইটে কার্যকর হয়।"
      />

      {!storageReady() && (
        <p className="card p-3.5 text-[12px] leading-relaxed" style={{ color: 'var(--v-heat)' }}>
          ⚠️ ছবি আপলোড এখন চালু নেই — {storageReason() || 'স্টোরেজ কনফিগার করা হয়নি'}।
          ব্র্যান্ড-লেখা এখনই বদলানো যাবে, তবে লোগো আপলোডের জন্য স্টোরেজ দরকার।
        </p>
      )}

      <BrandingManager
        initial={branding}
        raw={raw}
        slots={LOGO_SLOTS}
        fields={TEXT_FIELDS.map((f) => ({ key: f.key, label: f.label, hint: f.hint, max: f.max }))}
      />
    </div>
  );
}
