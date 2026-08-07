import { requireAdmin, apiError } from '@/lib/guard';
import { allFeatureFlags } from '@/lib/featureFlags';

export const dynamic = 'force-dynamic';

/**
 * ★ Feature Flags — বর্তমান অবস্থা (অ্যাডমিন)।
 *   GET /api/admin/flags → সব flag ও তাদের on/off অবস্থা।
 *   সেভ করা হয় সাধারণ settings রুট দিয়ে (`flag_<key>` কী), তাই এখানে
 *   শুধু পড়া — DRY, আলাদা সেভ-লজিক নেই।
 */
export async function GET() {
  try {
    await requireAdmin();
    const flags = await allFeatureFlags();
    return Response.json({ flags });
  } catch (e) {
    return apiError(e);
  }
}
