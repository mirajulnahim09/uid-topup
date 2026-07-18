import { notFound } from 'next/navigation';
import SafeImage from '@/components/fx/SafeImage';
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import OrderForm from '@/components/OrderForm';
import HowToOrder from '@/components/HowToOrder';

// ★ ৬০ সেকেন্ড ক্যাশ — প্রোডাক্ট/দাম সবার জন্য একই।
//   ইউজারের ব্যালেন্স OrderForm ক্লায়েন্ট-সাইডে আনে (/api/me), তাই ক্যাশ নিরাপদ।
export const revalidate = 60;

/**
 * ★ বিল্ডের সময়েই সব প্রোডাক্ট পেজ তৈরি করে রাখে — তাই ক্লিক করলেই সাথে সাথে খোলে।
 *   নতুন প্রোডাক্ট যোগ করলে সেটাও কাজ করবে (on-demand তৈরি হবে)।
 */
export async function generateStaticParams() {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, slug: true },
    });
    if (!Array.isArray(products)) return [];
    return products.map((p: (typeof products)[number]) => ({
      id: String(p.id),
      slug: p.slug,
    }));
  } catch {
    return []; // DB না পেলে বিল্ড ভাঙবে না
  }
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const id = Number(params.id);
  if (isNaN(id)) return { title: 'প্রোডাক্ট' };

  const p = await prisma.product.findUnique({
    where: { id },
    select: { name: true, description: true },
  });
  return { title: p?.name ?? 'প্রোডাক্ট', description: p?.description ?? undefined };
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (isNaN(id) || id < 1) notFound();

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { name: true } },
      variants: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      },
    },
  });

  if (!product || !product.isActive) notFound();

  return (
    <div className="mx-auto max-w-6xl page-x page-y">
      {/* ★ uidtopup স্টাইল — banner header */}
      <header className="animate-fade-up relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-purple-800 shadow-lg">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.3) 0%, transparent 40%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.2) 0%, transparent 40%)',
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-4 p-5 sm:p-7">
          <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/15 shadow-lg backdrop-blur sm:h-20 sm:w-20">
            {product.image ? (
              <SafeImage src={product.image} alt="" sizes="80px" className="object-cover" />
            ) : (
              <span className="text-3xl" aria-hidden="true">💎</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-extrabold text-white drop-shadow sm:text-2xl">
              {product.name}
            </h1>
            {product.description && (
              <p className="mt-0.5 text-xs text-white/80 sm:text-sm">{product.description}</p>
            )}
            <HowToOrder />
          </div>
        </div>
      </header>

      <OrderForm
        productName={product.name}
        uidLabel={product.uidLabel}
        uidHint={product.uidHint}
        variants={product.variants.map((v: (typeof product.variants)[number]) => ({
          id: v.id,
          label: v.label,
          price: Number(v.price),
          oldPrice: v.oldPrice ? Number(v.oldPrice) : null,
          stock: v.stock,
          isPopular: v.isPopular,
        }))}
      />
    </div>
  );
}
