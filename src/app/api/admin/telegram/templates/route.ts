import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import {
  getTemplates, saveTemplate, resetTemplate, preview, varsFor, TEMPLATES,
} from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * ★ বার্তা টেমপ্লেট API — তালিকা, সংরক্ষণ, ডিফল্টে ফেরা, লাইভ প্রিভিউ।
 *
 *   প্রিভিউ **সার্ভারে** রেন্ডার হয়, ক্লায়েন্টে নয় — যাতে অ্যাডমিন
 *   ঠিক সেটাই দেখে যা টেলিগ্রামে যাবে (একই `render()` ফাংশন)।
 */
export async function GET() {
  try {
    await requireAdmin();
    const list = await getTemplates();
    return Response.json({
      templates: list.map((t) => ({
        ...t,
        vars: varsFor(t.key),
        preview: preview(t.body, t.key),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson<{ action?: string; key?: string; body?: string; enabled?: boolean }>(req);

    const known = new Set<string>(TEMPLATES.map((t) => t.key));
    if (body.key && !known.has(body.key)) throw new ApiError('অজানা টেমপ্লেট', 400);

    switch (body.action) {
      // ★ লাইভ প্রিভিউ — কিছুই সংরক্ষণ করে না
      case 'preview': {
        if (!body.key || typeof body.body !== 'string') throw new ApiError('key ও body দরকার', 400);
        return Response.json({ preview: preview(body.body, body.key), vars: varsFor(body.key) });
      }

      case 'save': {
        if (!body.key || typeof body.body !== 'string') throw new ApiError('key ও body দরকার', 400);
        if (body.body.length > 3000) throw new ApiError('টেমপ্লেট খুব বড় (সর্বোচ্চ ৩০০০ অক্ষর)', 400);
        const def = TEMPLATES.find((t) => t.key === body.key);
        await saveTemplate(body.key, body.body, body.enabled !== false, def?.label ?? body.key);
        adminLog({
          adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
          detail: `টেলিগ্রাম টেমপ্লেট সংরক্ষিত — ${body.key}`, ip: getIp(req),
        }).catch(() => {});
        return Response.json({ success: true, preview: preview(body.body, body.key) });
      }

      case 'reset': {
        if (!body.key) throw new ApiError('key দরকার', 400);
        await resetTemplate(body.key);
        const def = TEMPLATES.find((t) => t.key === body.key);
        adminLog({
          adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
          detail: `টেলিগ্রাম টেমপ্লেট ডিফল্টে — ${body.key}`, ip: getIp(req),
        }).catch(() => {});
        return Response.json({
          success: true, body: def?.body ?? '',
          preview: def ? preview(def.body, def.key) : '',
        });
      }

      default:
        throw new ApiError('অজানা কাজ', 400);
    }
  } catch (e) {
    return apiError(e);
  }
}
