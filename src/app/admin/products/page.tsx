import { prisma } from '@/lib/prisma';
import ProductManager from '@/components/admin/ProductManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'প্রোডাক্ট' };

export default async function AdminProducts() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      products: {
        orderBy: { sortOrder: 'asc' },
        include: { variants: { orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }] } },
      },
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">প্রোডাক্ট, ছবি ও দাম</h1>
        <p className="mt-1 text-sm text-slate-400">
          ছবিতে ক্লিক করে বদলান। দাম বদলালে শুধু নতুন অর্ডারে প্রভাব পড়বে — পুরনো অর্ডারে দাম
          snapshot হিসেবে সংরক্ষিত।
        </p>
      </div>

      <ProductManager
        categories={categories.map((c: (typeof categories)[number]) => ({
          id: c.id,
          name: c.name,
          products: c.products.map((p: (typeof c.products)[number]) => ({
            id: p.id,
            name: p.name,
            image: p.image,
            description: p.description,
            uidLabel: p.uidLabel,
            uidHint: p.uidHint,
            isActive: p.isActive,
            variants: p.variants.map((v: (typeof p.variants)[number]) => ({
              id: v.id,
              label: v.label,
              price: Number(v.price),
              costPrice: Number(v.costPrice),
              oldPrice: v.oldPrice ? Number(v.oldPrice) : null,
              stock: v.stock,
              isActive: v.isActive,
              isPopular: v.isPopular,
            })),
          })),
        }))}
      />
    </div>
  );
}
