import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { createBackup, validateBackup, restoreBackup } from '@/lib/telegram/backup';

export const dynamic = 'force-dynamic';

/**
 * ★★★ ব্যাকআপ ও পুনরুদ্ধার API
 *
 *   GET  ?passphrase=…  → ফাইল ডাউনলোড (পাসফ্রেজ দিলে টোকেনও সিল হয়ে যায়)
 *   POST action=validate → **কিছুই লেখে না**, শুধু প্রিভিউ ও সমস্যা
 *   POST action=restore  → প্রয়োগ; `confirm:true` ছাড়া চলবে না
 *
 *   ⚠️ পুনরুদ্ধার কখনো নিঃশব্দে হয় না — আগে যাচাই, তারপর স্পষ্ট
 *   নিশ্চিতকরণ। কনফিগ হারানো এখানে সবচেয়ে বড় ক্ষতি।
 */
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(req.url);
    const passphrase = (url.searchParams.get('passphrase') || '').trim();

    if (passphrase && passphrase.length < 8) {
      throw new ApiError('পাসফ্রেজ কমপক্ষে ৮ অক্ষরের হতে হবে', 400);
    }

    const backup = await createBackup({ passphrase: passphrase || undefined });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      // ⚠️ পাসফ্রেজ কখনো লগে যায় না — শুধু গোপন মান ছিল কি না
      detail: `টেলিগ্রাম ব্যাকআপ ডাউনলোড (secrets=${backup.secretsIncluded ? 'sealed' : 'none'})`,
      ip: getIp(req),
    }).catch(() => {});

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="telegram-backup-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson<{
      action?: string; file?: unknown; passphrase?: string;
      deep?: boolean; confirm?: boolean; replace?: boolean;
    }>(req);

    const passphrase = typeof body.passphrase === 'string' && body.passphrase.trim()
      ? body.passphrase.trim() : undefined;

    if (!body.file) throw new ApiError('ব্যাকআপ ফাইল দরকার', 400);

    // ── যাচাই (এবং প্রিভিউ) ──
    const result = await validateBackup(body.file, { passphrase, deep: Boolean(body.deep) });

    if (body.action === 'validate') {
      return Response.json(result);
    }

    if (body.action === 'restore') {
      if (!result.valid) {
        throw new ApiError(
          `ব্যাকআপ যাচাইয়ে ব্যর্থ: ${result.issues.filter((i) => i.level === 'error')[0]?.message ?? 'অজানা'}`,
          400,
        );
      }
      // ★★★ নিশ্চিতকরণ ছাড়া কখনোই বিদ্যমান কনফিগ বদলানো হয় না
      if (!body.confirm) {
        throw new ApiError('নিশ্চিতকরণ ছাড়া পুনরুদ্ধার করা যাবে না', 400);
      }

      const out = await restoreBackup(body.file, { passphrase, replace: Boolean(body.replace) });

      adminLog({
        adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
        detail: `টেলিগ্রাম পুনরুদ্ধার — ${out.bots} বট, ${out.templates} টেমপ্লেট, ${out.jobs} জব, ${out.settings} সেটিং, টোকেন ${out.tokensRestored}${body.replace ? ' (প্রতিস্থাপন)' : ' (যোগ)'}`,
        ip: getIp(req),
      }).catch(() => {});

      return Response.json({
        success: true, restored: out,
        message: out.tokensRestored > 0
          ? 'পুনরুদ্ধার সম্পন্ন — টোকেনসহ।'
          : 'পুনরুদ্ধার সম্পন্ন — টোকেন ছিল না, তাই বটে টোকেন বসিয়ে নিন।',
      });
    }

    throw new ApiError('অজানা কাজ', 400);
  } catch (e) {
    return apiError(e);
  }
}
