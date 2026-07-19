import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { invalidateSettings } from '@/lib/settings';
import { cleanText, safeUrl } from '@/lib/sanitize';
import { revalidatePath } from 'next/cache';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';

// ★ শুধু এই key গুলো লেখা যাবে — arbitrary key নয়
const ALLOWED = new Set([
  'site_name', 'site_logo', 'site_notice',
  'hero_title', 'hero_subtitle',
  'min_deposit', 'max_deposit',
  'referral_bonus', 'referral_min_deposit',
  'support_email', 'support_phone', 'support_hours',
  'maintenance_mode', 'maintenance_message',
]);

const URL_KEYS = new Set(['site_logo']);
const NUM_KEYS = new Set([
  'min_deposit', 'max_deposit', 'referral_bonus', 'referral_min_deposit',
]);

/**
 * ★ সাইট সেটিংস — এখানে min/max ডিপোজিট, রেফারেল বোনাস ও
 *   maintenance mode বদলানো যায়। সবগুলোই ব্যবসায়িক প্রভাব ফেলে,
 *   তাই কে কী বদলাল তা লগ হওয়া দরকার (3.3, AUDIT_REPORT.md M2)।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    if (typeof body !== 'object' || !body) throw new ApiError('অবৈধ ডেটা', 400);

    const updates: { key: string; value: string }[] = [];

    for (const [key, raw] of Object.entries(body)) {
      if (!ALLOWED.has(key)) continue; // ★ unknown key silently ignore

      let value = String(raw ?? '');

      if (NUM_KEYS.has(key)) {
        const n = Number(value);
        if (isNaN(n) || n < 0) throw new ApiError(`${key} — সঠিক সংখ্যা দিন`, 400);
        value = String(n);
      } else if (URL_KEYS.has(key)) {
        if (value) {
          const safe = safeUrl(value);
          if (!safe) throw new ApiError(`${key} — অবৈধ URL`, 400);
          value = safe;
        }
      } else {
        value = cleanText(value, 1000); // ★ XSS guard
      }

      updates.push({ key, value });
    }

    const minU = updates.find((u: (typeof updates)[number]) => u.key === 'min_deposit');
    const maxU = updates.find((u: (typeof updates)[number]) => u.key === 'max_deposit');
    if (minU && maxU && Number(minU.value) >= Number(maxU.value)) {
      throw new ApiError('সর্বনিম্ন ডিপোজিট সর্বোচ্চের চেয়ে কম হতে হবে', 400);
    }

    await prisma.$transaction(
      updates.map((u: (typeof updates)[number]) =>
        prisma.setting.upsert({
          where: { key: u.key },
          update: { value: u.value },
          create: { key: u.key, value: u.value },
        })
      )
    );

    // ★ কোন কোন সেটিং বদলাল — নাম উল্লেখ করে, যাতে পরে
    //   "কে ডিপোজিট সীমা বদলেছিল" খুঁজে বের করা যায়
    if (updates.length > 0) {
      adminLog({
        adminId: admin.id,
        adminName: admin.name,
        action: 'SETTINGS_CHANGE',
        detail: updates.map((u) => `${u.key}=${u.value}`).join(', '),
        ip: getIp(req),
      }).catch(() => {});
    }

    revalidatePath('/', 'layout');
    // ★ ক্যাশ বাতিল (4.6) — পরিবর্তন যেন সাথে সাথেই কার্যকর হয়
    invalidateSettings();
    return Response.json({ success: true, updated: updates.length });
  } catch (e) {
    return apiError(e);
  }
}
