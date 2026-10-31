import { notFound, redirect } from 'next/navigation';
import SafeImage from '@/components/fx/SafeImage';
import Diamond from '@/components/fx/Diamond';
import RelatedProducts from '@/components/RelatedProducts';
import ProductReviews from '@/components/ProductReviews';
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import OrderForm from '@/components/OrderForm';
import HowToOrder from '@/components/HowToOrder';
import { getSettings } from '@/lib/settings';
import { isFeatureEnabled } from '@/lib/featureFlags';
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
export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const params = await props.params;
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

export default async function ProductPage(props: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const params = await props.params;
  const id = Number(params.id);
  if (isNaN(id) || id < 1) notFound();

  const [product, settings, channels, related, reviews, reviewStats] = await Promise.all([
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
    // ★ একই ক্যাটাগরির অন্য প্রোডাক্ট (5.12)
    //   ⚠️ `product` এখনো লোড হয়নি, তাই categoryId এখানে সরাসরি
    //   জানা নেই — তাই nested query তে বর্তমান প্রোডাক্টের ক্যাটাগরি
    //   বের করা হয়। এতে Promise.all এর সমান্তরালতা নষ্ট হয় না।
    prisma.product.findMany({
      where: {
        isActive: true,
        id: { not: id },
        category: { is: { isActive: true, products: { some: { id } } } },
      },
      orderBy: { sortOrder: 'asc' },
      take: 4,
      select: {
        id: true, name: true, slug: true, image: true,
        variants: { where: { isActive: true }, select: { stock: true } },
      },
    }),
    // ★ প্রকাশ্য রিভিউ (5.1) — এই প্রোডাক্টের যেকোনো ভ্যারিয়েন্টের
    //   অর্ডারের বিপরীতে দেওয়া। `select` দিয়ে কেবল প্রয়োজনীয়
    //   ফিল্ড — গ্রাহকের ইমেইল/ব্যালেন্স কখনোই নয় (CLAUDE.md §8)।
    prisma.review.findMany({
      where: { isPublished: true, order: { is: { variant: { is: { productId: id } } } } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true, rating: true, body: true, photoUrl: true, createdAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.review.aggregate({
      where: { isPublished: true, order: { is: { variant: { is: { productId: id } } } } },
      _count: { _all: true },
      _avg: { rating: true },
    }),
  ]);

  if (!product || !product.isActive) notFound();

  // ★ ক্যানোনিক্যাল slug (4.3) — id ঠিক থাকলে যেকোনো slug দিয়েই পাতাটি
  //   খুলত, ফলে একই প্রোডাক্ট অসীম সংখ্যক URL-এ 200 দিত (duplicate
  //   content)। এখন ভুল slug স্থায়ীভাবে আসল ঠিকানায় পাঠায় —
  //   `/product/[id]` আগে থেকেই যা করত, তারই সাথে সঙ্গতিপূর্ণ।
  //
  // ★★★ বাংলা slug — তুলনার আগে decode, redirect-এ encode।
  //   ব্রাউজারে ধরা (চূড়ান্ত অডিট): অ্যাডমিন বাংলা নামে প্রোডাক্ট বানালে
  //   `slugify` বাংলা অক্ষর রাখে, অথচ Next 14 `params.slug` দেয় percent-
  //   encoded। ফলে তুলনা **সবসময়** অমিল → `redirect()` কাঁচা বাংলা URL
  //   `Location` হেডারে বসাত → Node `ERR_INVALID_CHAR` → **HTTP 500**।
  //   অর্থাৎ বাংলা-নামের প্রোডাক্টের পাতা কখনোই খুলত না, কেনাও যেত না।
  //   `decodeURIComponent` ইতিমধ্যে-decoded লেখায় no-op (slug-এ `%` থাকে না)।
  let requested = params.slug;
  try { requested = decodeURIComponent(params.slug); } catch { /* ভাঙা %-এনকোডিং → অমিলই ধরি */ }
  if (requested !== product.slug) {
    redirect(`/product/${id}/${encodeURIComponent(product.slug)}`);
  }

  const sla = slaFromSettings(settings);

  return (
    <div className="mx-auto max-w-6xl page-x page-y">
      {/* ★ uidtopup স্টাইল — banner header */}
      {/* ★ Maison হেডার (Phase 6)
          ⚠️ আগে এখানে ছিল `from-indigo-600 via-purple-600 to-purple-800` —
          পুরনো "neon gaming" প্যালেট, যা CLAUDE.md §3 অনুযায়ী বাতিল।
          গ্রাহকমুখী পাতায় এটিই ছিল সবচেয়ে বড় দৃশ্যগত অসঙ্গতি।
          এখন সাইটের বাকি অংশের মতোই glass + সোনালি উষ্ণতা। */}
      <header
        className="animate-fade-up relative mb-6 overflow-hidden rounded-2xl"
        style={{
          border: '1px solid var(--v-edge)',
          background: 'linear-gradient(135deg, rgba(139,92,246,.22), rgba(56,189,248,.10) 55%, var(--v-pit) 100%)',
          boxShadow: '0 12px 44px -16px rgba(139,92,246,.4)',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 46%, rgba(139,92,246,.12) 0%, transparent 46%), radial-gradient(circle at 82% 18%, rgba(14,165,233,.10) 0%, transparent 44%)',
          }}
          aria-hidden="true"
        />
        {/* ★ উপরের প্রান্তে সোনালি hairline — ব্র্যান্ড উচ্চারণ */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(109,40,217,.4), transparent)' }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-4 p-5 sm:p-7">
          <div
            className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl backdrop-blur sm:h-20 sm:w-20"
            style={{ background: 'var(--v-steel)', border: '1px solid var(--v-edge2)' }}
          >
            {product.image ? (
              <SafeImage src={product.image} alt="" sizes="80px" className="object-cover" />
            ) : (
              /* ★ ব্র্যান্ডের নিজস্ব হীরা — ইমোজি নয় (CLAUDE.md §7) */
              <Diamond size={34} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="dsp text-lg font-semibold sm:text-2xl" style={{ color: 'var(--ink)' }}>
              {product.name}
            </h1>
            {product.description && (
              <p className="mt-1 text-xs sm:text-sm" style={{ color: 'var(--mut)' }}>{product.description}</p>
            )}
            {/* ★ ডেলিভারির সৎ প্রতিশ্রুতি — কেনার আগেই স্পষ্ট।
                ⚠️ রঙ আগে হার্ডকোড `#bef264` ছিল — গাঢ়-থিমের লাইম, যা
                এই হালকা glass-কার্ডে **১.৪:১** কনট্রাস্টে কার্যত
                অপাঠ্য ছিল (৩৯০px স্ক্রিনশটে ধরা পড়ে)। এখন
                `.sig-chip--success`, যার রঙ `--sem-success` টোকেন
                থেকে আসে ও দুই থিমেই AA পার করে। */}
            <p className="sig-chip sig-chip--success mt-2">
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
          qrImage: c.qrImage ?? null,
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

      {/* ★ প্রকাশ্য রিভিউ (5.1) — ক্রস-সেলের আগে, কারণ আস্থা আগে,
          পরের কেনাকাটার প্রস্তাব পরে। Feature flag দিয়ে বন্ধ করা যায়। */}
      {(await isFeatureEnabled('reviews')) && (
        <ProductReviews
          count={reviewStats._count._all}
          average={reviewStats._avg.rating}
          items={reviews.map((r: (typeof reviews)[number]) => ({
            id: r.id,
            rating: r.rating,
            body: r.body,
            photoUrl: r.photoUrl,
            createdAt: r.createdAt,
            // ★ কেবল প্রথম নাম — গোপনীয়তা (উপরের নোট দ্রষ্টব্য)
            name: (r.user?.name ?? 'গ্রাহক').trim().split(/\s+/)[0],
          }))}
        />
      )}

      {/* ★ ক্রস-সেল (5.12) — অর্ডার ফর্মের পরে, কারণ মূল কাজ আগে */}
      <RelatedProducts
        items={related.map((r: (typeof related)[number]) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          image: r.image,
          soldOut: r.variants.length > 0 && r.variants.every((v) => v.stock === 0),
        }))}
      />
    </div>
  );
}
