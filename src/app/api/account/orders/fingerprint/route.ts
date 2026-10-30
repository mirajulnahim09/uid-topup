import { requireUser, apiError, ApiError } from '@/lib/guard';
import { orderFingerprint, type OrderScope } from '@/lib/orderFingerprint';

export const dynamic = 'force-dynamic';

/**
 * ★★★ SCL-02 — `GET /api/account/orders/fingerprint?scope=recent|smm|one&id=…`
 *   কেবল নিজের অর্ডারের ছাপ (`orderFingerprint`, lib-এ ব্যাখ্যা)। `AutoRefresh`
 *   প্রতি ৩০s এটি চায়; ছাপ বদলালে তবেই পুরো পাতা রিফ্রেশ হয়।
 *   অন্যের অর্ডার-id দিলে ছাপ হয় "খালি তালিকা"র — কোনো তথ্য ফাঁস নয়।
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const u = new URL(req.url);
    const kind = u.searchParams.get('scope') || 'recent';
    let scope: OrderScope;
    if (kind === 'one') {
      const id = u.searchParams.get('id') || '';
      if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new ApiError('অবৈধ অর্ডার', 400);
      scope = { kind: 'one', orderId: id };
    } else if (kind === 'recent' || kind === 'smm') {
      scope = { kind };
    } else {
      throw new ApiError('অবৈধ scope', 400);
    }
    const v = await orderFingerprint(user.id, scope);
    return Response.json({ v }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return apiError(e);
  }
}
