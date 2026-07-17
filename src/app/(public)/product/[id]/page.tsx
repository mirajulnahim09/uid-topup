import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** /product/1 → /product/1/free-fire-bd-server এ পাঠায় */
export default async function ProductRedirect({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (isNaN(id) || id < 1) notFound();

  const p = await prisma.product.findUnique({
    where: { id },
    select: { slug: true, isActive: true },
  });
  if (!p || !p.isActive) notFound();

  redirect(`/product/${id}/${p.slug}`);
}
