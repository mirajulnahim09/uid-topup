import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/guard';
import { requireResellerRead } from '@/lib/reseller/readGuard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reseller/products — the catalogue a script needs to place
 * orders: every active package with its `variantId` and the price THIS
 * key's owner will actually pay.
 *
 * The price shown follows the same rule as placeOrder(): a RESELLER pays
 * `resellerPrice` only when it is set and > 0, otherwise the normal price.
 * It is informational — the order endpoint always re-reads the locked row.
 * Cost price is never exposed.
 */
export async function GET(req: Request) {
  try {
    const actor = await requireResellerRead(req);
    const isReseller = actor.user.tier === 'RESELLER';

    const cats = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, name: true, slug: true,
        products: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true, name: true, slug: true, uidLabel: true, deliveryType: true,
            variants: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
              select: { id: true, label: true, price: true, resellerPrice: true, stock: true, deliveryMinutes: true },
            },
          },
        },
      },
    });

    const data = cats
      .map((c) => ({
        category: { id: c.id, name: c.name, slug: c.slug },
        products: c.products.map((p) => ({
          productId: p.id,
          name: p.name,
          slug: p.slug,
          inputLabel: p.uidLabel,
          deliveryType: p.deliveryType,
          packages: p.variants.map((v) => {
            const rp = v.resellerPrice === null ? null : Number(v.resellerPrice);
            const useReseller = isReseller && rp !== null && Number.isFinite(rp) && rp > 0;
            return {
              variantId: v.id,
              label: v.label,
              price: (useReseller ? rp! : Number(v.price)).toFixed(2),
              listPrice: Number(v.price).toFixed(2),
              resellerRate: useReseller,
              inStock: v.stock !== 0,
              deliveryMinutes: v.deliveryMinutes,
            };
          }),
        })),
      }))
      .filter((c) => c.products.length > 0);

    return Response.json({ success: true, tier: actor.user.tier, currency: 'BDT', categories: data });
  } catch (e) {
    return apiError(e);
  }
}
