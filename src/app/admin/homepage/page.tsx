import { prisma } from '@/lib/prisma';
import { getSettings, toClientSettings } from '@/lib/settings';
import { isBlobConfigured } from '@/lib/upload';
import CampaignManager, { type CampaignRow } from '@/components/admin/CampaignManager';
import HomeConfigForm from '@/components/admin/HomeConfigForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'হোমপেজ ব্যবস্থাপনা' };

/**
 * ★ হোমপেজ ব্যবস্থাপনা (Option A infra)
 *   এক জায়গা থেকে হোমপেজের সব বিপণন-উপাদান নিয়ন্ত্রণ:
 *   পপআপ · হিরো · ব্যানার · নোটিশ · স্ট্রিপ · প্রচারণা + সেকশন টগল।
 */
export default async function AdminHomepage() {
  let items: CampaignRow[] = [];
  let settings: Record<string, string> = {};
  try {
    const [rows, s] = await Promise.all([
      prisma.campaign.findMany({ orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }] }),
      getSettings(),
    ]);
    items = rows.map((c) => ({
      id: c.id,
      placement: c.placement,
      kind: c.kind,
      title: c.title,
      subtitle: c.subtitle,
      imageUrl: c.imageUrl,
      ctaLabel: c.ctaLabel,
      ctaLink: c.ctaLink,
      badge: c.badge,
      dismissible: c.dismissible,
      frequency: c.frequency,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      startsAt: c.startsAt ? c.startsAt.toISOString() : null,
      endsAt: c.endsAt ? c.endsAt.toISOString() : null,
    }));
    // ★★★ `HomeConfigForm` একটি ক্লায়েন্ট কম্পোনেন্ট — এর props
    //   RSC payload-এ ব্রাউজারে যায়। আগে এখানে **কোনো** redaction
    //   ছিল না, ফলে `telegram_bot_token` হুবহু HTML-এ চলে যেত
    //   (মাপা হয়েছে; tests/settings-leak.test.ts ধরেছে)।
    //   allowlist ছাড়া কিছুই পাঠানো হয় না।
    settings = toClientSettings(s);
  } catch {
    /* DB fail হলেও পেজ খোলে — খালি ফর্ম দেখাবে */
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">হোমপেজ ব্যবস্থাপনা</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">
          হোমপেজের পপআপ, ব্যানার, নোটিশ, প্রচারণা ও সেকশন — সব এখান থেকে নিয়ন্ত্রণ করুন।
          কোনো কোড লাগবে না; পরিবর্তন সাথে সাথেই সাইটে বসবে।
        </p>
      </div>

      {!isBlobConfigured() && (
        <div className="alert-warn">
          <strong>ছবি আপলোড এখনো চালু হয়নি।</strong> ছবি ছাড়া টেক্সট-উপাদান (নোটিশ, স্ট্রিপ) এখনই
          যোগ করা যাবে; ছবিসহ পপআপ/ব্যানারের জন্য <code className="rounded px-1.5 py-0.5 font-mono"
          style={{ background: 'rgba(255,255,255,.07)', color: 'var(--v-ink)', border: '1px solid var(--v-edge)' }}>BLOB_READ_WRITE_TOKEN</code> বসান।
        </div>
      )}

      <HomeConfigForm settings={settings} />
      <CampaignManager items={items} />
    </div>
  );
}
