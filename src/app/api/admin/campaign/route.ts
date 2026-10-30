import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { telegramEvent } from '@/lib/telegram';
import { getIp } from '@/lib/rateLimit';
import { cleanText, safeUrl } from '@/lib/sanitize';
import { campaignCreateSchema, campaignPatchSchema } from '@/lib/validation';
import { revalidatePath } from 'next/cache';
import { parseDhakaDateTime } from '@/lib/date';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ হোমপেজ বিপণন — Campaign CRUD (Option A, সম্পূর্ণ যোগমূলক)
 *
 *   একটিই মডেল হোমপেজের সব বিপণন-উপাদান ধরে (placement দিয়ে ভাগ:
 *   POPUP/HERO/SLIDER/NOTICE/STRIP/PROMO)। এই রুটই অ্যাডমিনকে
 *   পপআপ, ব্যানার, নোটিশ ও প্রচারণা তৈরি/সম্পাদনা/মোছার ক্ষমতা দেয়।
 *
 *   ⚠️ CLAUDE.md মেনে:
 *   §9  — প্রতিটি হ্যান্ডলার requireAdmin() দিয়ে শুরু, try/apiError এ মোড়া,
 *         zod schema (validation.ts) দিয়ে যাচাই।
 *   §9  — রেন্ডার হওয়া টেক্সট cleanText/safeUrl দিয়ে সাফ (XSS গার্ড)।
 *   §8  — প্রতিটি admin রুট adminLog() ডাকে (accountability)।
 *   কোনো বিদ্যমান API সরানো হয়নি; এটি নতুন রুট।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ ইনপুট টেক্সট/URL সাফ করে DB-উপযোগী মান বানায় */
function clean(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if ('placement' in input) out.placement = input.placement;
  if ('kind' in input) out.kind = input.kind;
  if ('title' in input) out.title = input.title ? cleanText(String(input.title), 160) : null;
  if ('subtitle' in input) out.subtitle = input.subtitle ? cleanText(String(input.subtitle), 400) : null;
  if ('badge' in input) out.badge = input.badge ? cleanText(String(input.badge), 40) : null;
  if ('ctaLabel' in input) out.ctaLabel = input.ctaLabel ? cleanText(String(input.ctaLabel), 60) : null;

  // ★ URL ফিল্ড — অবৈধ হলে থামায়, নিরাপদ হলে normalize করে
  if ('imageUrl' in input) {
    const raw = input.imageUrl ? String(input.imageUrl) : '';
    if (raw) { const s = safeUrl(raw); if (!s) throw new ApiError('ছবির লিংক অবৈধ', 400); out.imageUrl = s; }
    else out.imageUrl = null;
  }
  if ('ctaLink' in input) {
    const raw = input.ctaLink ? String(input.ctaLink) : '';
    if (raw) { const s = safeUrl(raw); if (!s) throw new ApiError('CTA লিংক অবৈধ', 400); out.ctaLink = s; }
    else out.ctaLink = null;
  }

  if ('dismissible' in input) out.dismissible = Boolean(input.dismissible);
  if ('frequency' in input) out.frequency = input.frequency;
  if ('isActive' in input) out.isActive = Boolean(input.isActive);
  // ★ অ্যাডমিনের `datetime-local` ('2026-09-17T20:00', অঞ্চল ছাড়া) = ঢাকার ঘড়ি-সময়।
  //   আগে `new Date()` সার্ভারের ঘড়ি ধরত — Vercel-এ প্রচারণা ৬ ঘণ্টা দেরিতে শুরু/শেষ হতো।
  if ('startsAt' in input) out.startsAt = input.startsAt ? parseDhakaDateTime(String(input.startsAt)) : null;
  if ('endsAt' in input) out.endsAt = input.endsAt ? parseDhakaDateTime(String(input.endsAt)) : null;
  if ('sortOrder' in input && input.sortOrder !== undefined) out.sortOrder = Number(input.sortOrder);
  return out;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = campaignCreateSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(parsed.error.errors[0]?.message || 'অবৈধ ডেটা', 400);
    }

    const data = clean(parsed.data as Record<string, unknown>);
    // ★ নতুন আইটেম একই placement এর শেষে বসে
    const count = await prisma.campaign.count({ where: { placement: parsed.data.placement } });
    const c = await prisma.campaign.create({
      data: { ...(data as object), placement: parsed.data.placement, sortOrder: count } as never,
    });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'CAMPAIGN_CREATE',
      targetId: String(c.id), detail: `${parsed.data.placement} — ${parsed.data.kind}`, ip: getIp(req),
    }).catch(() => {});

    // ★ শুধু **প্রকাশিত** (isActive) ক্যাম্পেইনই ইভেন্ট — খসড়া তৈরি
    //   করা প্রকাশ নয়, আর প্রতিটি খসড়ায় পিং দিলে সুইচটি অকেজো হতো।
    if ((c as { isActive?: boolean }).isActive) {
      telegramEvent(
        'campaign',
        '📣 ক্যাম্পেইন প্রকাশিত',
        `${parsed.data.placement} — ${parsed.data.kind} (${admin.name})`,
        '/admin/homepage',
      );
    }

    revalidatePath('/', 'layout');
    return Response.json({ success: true, id: c.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = campaignPatchSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(parsed.error.errors[0]?.message || 'অবৈধ ডেটা', 400);
    }
    const { id, ...rest } = parsed.data;

    const exists = await prisma.campaign.findUnique({ where: { id } });
    if (!exists) throw new ApiError('আইটেম পাওয়া যায়নি', 404);

    const data = clean(rest as Record<string, unknown>);
    await prisma.campaign.update({ where: { id }, data: data as never });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'CAMPAIGN_UPDATE',
      targetId: String(id),
      detail: 'isActive' in data
        ? (data.isActive ? 'চালু' : 'বন্ধ')
        : `হালনাগাদ (${Object.keys(data).join(', ')})`,
      ip: getIp(req),
    }).catch(() => {});

    // ★ বন্ধ → চালু হলেই "প্রকাশ"। `exists.isActive` মিলিয়ে দেখা হয়
    //   যাতে ইতিমধ্যে চালু থাকা ক্যাম্পেইনের সাধারণ সম্পাদনায় বারবার
    //   পিং না যায়।
    if ('isActive' in data && data.isActive === true && !exists.isActive) {
      telegramEvent(
        'campaign',
        '📣 ক্যাম্পেইন প্রকাশিত',
        `${exists.placement} — ${exists.kind} (${admin.name})`,
        '/admin/homepage',
      );
    }

    revalidatePath('/', 'layout');
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const { id } = await readJson(req);
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    const c = await prisma.campaign.findUnique({ where: { id: Number(id) } });
    if (!c) throw new ApiError('আইটেম পাওয়া যায়নি', 404);

    await prisma.campaign.delete({ where: { id: Number(id) } });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'CAMPAIGN_DELETE',
      targetId: String(id), detail: `${c.placement} — ${c.title || c.kind}`, ip: getIp(req),
    }).catch(() => {});

    revalidatePath('/', 'layout');
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
