import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { invalidateSettings } from '@/lib/settings';
import { normalizeSettingValue } from '@/lib/settingsPolicy';
import { revalidatePath } from 'next/cache';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { telegramEvent } from '@/lib/telegram';

// ★ কোন কী লেখা যাবে ও মান-যাচাই — `lib/settingsPolicy.ts` (BKP-01: backup
//   restore-ও একই নিয়ম মানে; আগে তালিকাটি কেবল এই ফাইলে ছিল)।

/**
 * ★ সাইট সেটিংস — এখানে min/max ডিপোজিট, রেফারেল বোনাস ও
 *   maintenance mode বদলানো যায়। সবগুলোই ব্যবসায়িক প্রভাব ফেলে,
 *   তাই কে কী বদলাল তা লগ হওয়া দরকার (3.3, AUDIT_REPORT.md M2)।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson(req);
    if (typeof body !== 'object' || !body) throw new ApiError('অবৈধ ডেটা', 400);

    const updates: { key: string; value: string }[] = [];

    for (const [key, raw] of Object.entries(body)) {
      // ★ allowlist + মান-যাচাই (XSS-নিরাপদ); `null` = নীরবে বাদ
      const value = normalizeSettingValue(key, raw);
      if (value === null) continue;
      updates.push({ key, value });
    }

    const minU = updates.find((u: (typeof updates)[number]) => u.key === 'min_deposit');
    const maxU = updates.find((u: (typeof updates)[number]) => u.key === 'max_deposit');
    if (minU && maxU && Number(minU.value) >= Number(maxU.value)) {
      throw new ApiError('সর্বনিম্ন ডিপোজিট সর্বোচ্চের চেয়ে কম হতে হবে', 400);
    }

    // ★ মেইনটেন্যান্স মোড বদলাল কি না — লেখার **আগের** মান দরকার,
    //   নাহলে "বদলেছে" আর "একই মান আবার সেভ হয়েছে" আলাদা করা যেত না।
    const maintU = updates.find((u) => u.key === 'maintenance_mode');
    let maintBefore: string | null = null;
    if (maintU) {
      const row = await prisma.setting
        .findUnique({ where: { key: 'maintenance_mode' } })
        .catch(() => null);
      maintBefore = row?.value ?? '0';
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
    //
    //   ⚠️ গোপন কী-র **মান** অডিট লগে যায় না। অডিট লগ DB-তে থাকে ও
    //   /admin/logs-এ দেখা যায়; সেখানে বট টোকেন লিখে রাখলে সেটিই
    //   আরেকটি ফাঁসের জায়গা হতো। কী-র নাম থাকে, মান নয়।
    if (updates.length > 0) {
      const SECRET_KEYS = new Set(['telegram_bot_token']);
      adminLog({
        adminId: admin.id,
        adminName: admin.name,
        action: 'SETTINGS_CHANGE',
        detail: updates
          .map((u) => (SECRET_KEYS.has(u.key) ? `${u.key}=<redacted>` : `${u.key}=${u.value}`))
          .join(', '),
        ip: getIp(req),
      }).catch(() => {});
    }

    // ★ সাইট বন্ধ/চালু হলে অপারেটর-গ্রুপে জানানো — এটি এমন ঘটনা
    //   যা সবার সাথে সাথে জানা দরকার (গ্রাহক অর্ডার করতে পারছে না)।
    if (maintU && maintBefore !== null && maintU.value !== maintBefore) {
      const on = maintU.value === '1';
      telegramEvent(
        'maintenance',
        on ? '🚧 মেইনটেন্যান্স মোড চালু' : '✅ মেইনটেন্যান্স মোড বন্ধ',
        on
          ? `সাইট এখন রক্ষণাবেক্ষণ মোডে — গ্রাহক অর্ডার করতে পারবে না। (${admin.name})`
          : `সাইট আবার স্বাভাবিক — অর্ডার নেওয়া চালু। (${admin.name})`,
        '/admin/site',
      );
    }

    revalidatePath('/', 'layout');
    // ★ ক্যাশ বাতিল (4.6) — পরিবর্তন যেন সাথে সাথেই কার্যকর হয়
    invalidateSettings();
    return Response.json({ success: true, updated: updates.length });
  } catch (e) {
    return apiError(e);
  }
}
