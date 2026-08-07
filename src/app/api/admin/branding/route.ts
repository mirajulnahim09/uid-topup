import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { invalidateSettings, getSettings } from '@/lib/settings';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { cleanText, safeUrl } from '@/lib/sanitize';
import { deleteImage } from '@/lib/upload';
import {
  LOGO_SLOTS, TEXT_FIELDS, logoKey, isTextField, resolveBranding,
  type LogoSlotKey, type BrandTheme,
} from '@/lib/branding';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

const SLOT_KEYS = new Set<string>(LOGO_SLOTS.map((s) => s.key));
const THEMES = new Set(['dark', 'light']);

/**
 * ★★★ ব্র্যান্ড আইডেন্টিটি API
 *
 *   GET  — বর্তমান ব্র্যান্ড (রেজলভড) + স্লট/ফিল্ড সংজ্ঞা
 *   POST — টেক্সট ও লোগো সংরক্ষণ, বা রিসেট
 *
 *   ⚠️ **allowlist**: টেক্সট কী `TEXT_FIELDS`-এ, স্লট `LOGO_SLOTS`-এ
 *   থাকতে হবে। নাহলে যেকোনো স্ট্রিং `Setting` টেবিলে ঢোকানো যেত।
 *   ⚠️ লোগোর URL `safeUrl()` দিয়ে যাচাই — `javascript:` বা বাইরের
 *   বিপজ্জনক স্কিম বসানো যাবে না।
 */
export async function GET() {
  try {
    await requireAdmin();
    const settings = await getSettings();
    return Response.json({
      branding: resolveBranding(settings),
      // কাঁচা মান — ইনপুট ঘরে ডিফল্ট নয়, অ্যাডমিন যা লিখেছে তাই দেখাতে হবে
      raw: Object.fromEntries(
        [...TEXT_FIELDS.map((f) => f.key)].map((k) => [k, settings[k] ?? '']),
      ),
      slots: LOGO_SLOTS,
      fields: TEXT_FIELDS,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson<{
      action?: string;
      text?: Record<string, unknown>;
      logos?: { slot?: string; theme?: string; url?: string | null }[];
      slot?: string; theme?: string;
    }>(req);

    const rows: { key: string; value: string }[] = [];
    const removedUrls: string[] = [];
    const changed: string[] = [];

    // ─────── সম্পূর্ণ রিসেট ───────
    if (body.action === 'reset-all') {
      const keys = [
        ...TEXT_FIELDS.filter((f) => f.key !== 'site_name' && f.key !== 'site_url').map((f) => f.key),
        ...LOGO_SLOTS.flatMap((s) => [logoKey(s.key, 'dark'), logoKey(s.key, 'light')]),
      ];
      // ★ আপলোড করা ফাইলগুলো স্টোরেজ থেকেও সরাই — নাহলে অনাথ ফাইল
      //   জমতে থাকত (অডিটে ঠিক এই ধরনের অনাথ রেফারেন্স ধরা পড়েছিল)।
      const existing = await prisma.setting.findMany({ where: { key: { in: keys } } });
      for (const r of existing) if (r.value?.startsWith('/')) removedUrls.push(r.value);
      await prisma.setting.deleteMany({ where: { key: { in: keys } } });
      invalidateSettings();
      revalidatePath('/', 'layout');
      for (const u of removedUrls) void deleteImage(u).catch(() => {});
      adminLog({
        adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
        detail: `ব্র্যান্ডিং সম্পূর্ণ রিসেট (${keys.length} কী, ${removedUrls.length} ফাইল)`, ip: getIp(req),
      }).catch(() => {});
      return Response.json({ success: true, message: 'ব্র্যান্ডিং ডিফল্টে ফিরিয়ে আনা হয়েছে' });
    }

    // ─────── টেক্সট ───────
    if (body.text && typeof body.text === 'object') {
      const limits = new Map(TEXT_FIELDS.map((f) => [f.key as string, f.max]));
      for (const [k, v] of Object.entries(body.text)) {
        if (!isTextField(k)) continue; // allowlist
        let value = String(v ?? '');
        if (k === 'site_url' && value) {
          const safe = safeUrl(value);
          if (!safe) throw new ApiError('সাইটের URL অবৈধ', 400);
          value = safe;
        } else {
          value = cleanText(value, limits.get(k) ?? 200);
        }
        rows.push({ key: k, value });
        changed.push(k);
      }
    }

    // ─────── লোগো ───────
    if (Array.isArray(body.logos)) {
      for (const l of body.logos) {
        const slot = String(l.slot ?? '');
        const theme = String(l.theme ?? '');
        if (!SLOT_KEYS.has(slot) || !THEMES.has(theme)) continue; // allowlist
        const key = logoKey(slot as LogoSlotKey, theme as BrandTheme);

        if (l.url === null || l.url === '') {
          // মুছে ফেলা — পুরনো ফাইলও স্টোরেজ থেকে সরাই
          const prev = await prisma.setting.findUnique({ where: { key } });
          if (prev?.value?.startsWith('/')) removedUrls.push(prev.value);
          await prisma.setting.deleteMany({ where: { key } });
          changed.push(`${key}=∅`);
          continue;
        }

        const url = safeUrl(String(l.url));
        if (!url) throw new ApiError(`${slot} — ছবির লিংক অবৈধ`, 400);
        // পুরনোটি বদলালে সেটিও সরাই
        const prev = await prisma.setting.findUnique({ where: { key } });
        if (prev?.value && prev.value !== url && prev.value.startsWith('/')) removedUrls.push(prev.value);
        rows.push({ key, value: url });
        changed.push(key);
      }
    }

    if (rows.length === 0 && changed.length === 0) {
      throw new ApiError('কিছুই বদলায়নি', 400);
    }

    if (rows.length) {
      await prisma.$transaction(rows.map((r) =>
        prisma.setting.upsert({ where: { key: r.key }, update: { value: r.value }, create: r })));
    }

    invalidateSettings();
    // ★ পুরো লেআউট রিভ্যালিডেট — লোগো/নাম নেভ, ফুটার ও মেটাডেটায় আছে,
    //   তাই একটিমাত্র পাতা রিভ্যালিডেট করলে বাকিগুলো বাসি থাকত।
    revalidatePath('/', 'layout');

    // অনাথ ফাইল পরিষ্কার — best-effort, ব্যর্থ হলেও সেটিংস সংরক্ষিত
    for (const u of [...new Set(removedUrls)]) void deleteImage(u).catch(() => {});

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      detail: `ব্র্যান্ডিং হালনাগাদ — ${changed.slice(0, 12).join(', ')}${changed.length > 12 ? ` (+${changed.length - 12})` : ''}`,
      ip: getIp(req),
    }).catch(() => {});

    const settings = await getSettings();
    return Response.json({
      success: true,
      updated: changed.length,
      cleaned: removedUrls.length,
      branding: resolveBranding(settings),
    });
  } catch (e) {
    return apiError(e);
  }
}
