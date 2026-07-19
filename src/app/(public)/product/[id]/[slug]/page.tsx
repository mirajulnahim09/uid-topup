import { notFound, redirect } from 'next/navigation';
import SafeImage from '@/components/fx/SafeImage';
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import OrderForm from '@/components/OrderForm';
import HowToOrder from '@/components/HowToOrder';
import { getSettings } from '@/lib/settings';
import { slaFromSettings, slaPromiseText } from '@/lib/sla';

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

/**
 * ★★★ soft-404 সমাধান (4.3)
 *
 *   আগে এখানে প্রোডাক্ট না পেলেও `{ title: 'প্রোডাক্ট' }` ফেরত যেত,
 *   অর্থাৎ metadata সফলভাবে তৈরি হয়ে যেত। Next.js `generateMetadata`
 *   পেজ কম্পোনেন্টের **আগে** চালায় — তাই ততক্ষণে রেসপন্স 200 হিসেবে
 *   স্থির হয়ে যেত, আর পেজের ভেতরের `notFound()` কেবল *দেখতে* 404
 *   পাতা দেখাত, স্ট্যাটাস 200-ই থাকত।
 *
 *   ফল: সার্চ ইঞ্জিন "পাওয়া যায়নি" পাতাটিকে বৈধ পাতা ভেবে ইনডেক্স
 *   করত (soft-404) — প্রতিটি ভুল লিংক একটি ইনডেক্সযোগ্য খালি পাতা।
 *
 *   ⚠️ সমাধান: অস্তিত্ব যাচাই **metadata স্তরেই** করা, যেখানে
 *   সিদ্ধান্তটা এখনো স্ট্যাটাসে প্রভাব ফেলতে পারে। এতে ISR (revalidate
 *   = 60) বা পেজ ট্রানজিশনের কিছুই বদলাতে হয় না।
 */
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const id = Number(params.id);
  if (isNaN(id) || id < 1) notFound();

  const p = await prisma.product.findUnique({
    where: { id },
    select: { name: true, description: true, isActive: true },
  });

  // ★ নেই বা নিষ্ক্রিয় — পেজে যাওয়ার আগেই আসল 404
  if (!p || !p.isActive) notFound();

  return { title: p.name, description: p.description ?? undefined };
}

export default async function ProductPage({
  params,
}: {
  params: { id: string; slug: string };
}) {
  const id = Number(params.id);
  if (isNaN(id) || id < 1) notFound();

  const [product, settings, channels] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { name: true } },
        variants: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
        },
      },
    }),
    getSettings(),
    // ★ ডাইরেক্ট পে এর জন্য পেমেন্ট নাম্বার
    prisma.paymentChannel.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  if (!product || !product.isActive) notFound();

  // ★ ক্যানোনিক্যাল slug (4.3) — id ঠিক থাকলে যেকোনো slug দিয়েই পাতাটি
  //   খুলত, ফলে একই প্রোডাক্ট অসীম সংখ্যক URL-এ 200 দিত (duplicate
  //   content)। এখন ভুল slug স্থায়ীভাবে আসল ঠিকানায় পাঠায় —
  //   `/product/[id]` আগে থেকেই যা করত, তারই সাথে সঙ্গতিপূর্ণ।
  if (params.slug !== product.slug) {
    redirect(`/product/${id}/${product.slug}`);
  }

  const sla = slaFromSettings(settings);

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
            {/* ★ ডেলিভারির সৎ প্রতিশ্রুতি — কেনার আগেই স্পষ্ট */}
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur sm:text-xs">
              <span aria-hidden="true">⏱</span>
              ডেলিভারি: {slaPromiseText(sla)}
            </p>
            <HowToOrder />
          </div>
        </div>
      </header>

      <OrderForm
        productId={product.id}
        productName={product.name}
        uidLabel={product.uidLabel}
        uidHint={product.uidHint}
        channels={channels.map((c: (typeof channels)[number]) => ({
          id: c.id,
          method: c.method,
          accountNo: c.accountNo,
          accountType: c.accountType,
          instruction: c.instruction ?? '',
        }))}
        variants={product.variants.map((v: (typeof product.variants)[number]) => ({
          id: v.id,
          label: v.label,
          price: Number(v.price),
          oldPrice: v.oldPrice ? Number(v.oldPrice) : null,
          stock: v.stock,
          isPopular: v.isPopular,
          deliveryMinutes: v.deliveryMinutes,
        }))}
      />
    </div>
  );
}
