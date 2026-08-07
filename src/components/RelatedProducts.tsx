import Link from 'next/link';
import SafeImage from '@/components/fx/SafeImage';
import Icon from '@/components/fx/Icon';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ সম্পর্কিত প্রোডাক্ট — ক্রস-সেল (5.12)
 *
 *   একই ক্যাটাগরির অন্য প্রোডাক্ট দেখানো হয়। কেন এটাই যথেষ্ট:
 *   গ্রাহক "Free Fire ডায়মন্ড" খুঁজতে এসে ভুল প্রোডাক্টে পৌঁছালে
 *   এতদিন হোমপেজে ফিরে গিয়ে আবার খুঁজতে হতো। এটি সেই ফেরার
 *   পথটুকু বাঁচায়।
 *
 *   ⚠️ কোনো "সুপারিশ" অ্যালগরিদম নেই — ইচ্ছাকৃত। ক্লিক/কেনার
 *   ইতিহাস থেকে সুপারিশ বানাতে হলে সেই তথ্য জমাতে হতো, আর এই
 *   সাইটের আকারে তার ফল হতো এলোমেলো। একই ক্যাটাগরি সহজ, সৎ ও
 *   পূর্বানুমেয়।
 *
 *   ⚠️ Server Component — কোনো ক্লায়েন্ট JS যোগ করে না।
 * ═══════════════════════════════════════════════════════════
 */

export type RelatedItem = {
  id: number;
  name: string;
  slug: string;
  image: string | null;
  soldOut: boolean;
};

export default function RelatedProducts({ items }: { items: RelatedItem[] }) {
  // ★ কিছু না থাকলে কিছুই দেখানো হয় না — খালি সেকশন হেডিং নয়
  if (items.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="related-heading">
      <div className="flex items-center gap-3">
        <span className="h-px w-8" style={{ background: 'var(--v-ice)' }} aria-hidden="true" />
        <span className="hud">একই ধরনের</span>
      </div>
      <h2 id="related-heading" className="v-dsp mt-3 text-lg font-extrabold sm:text-xl" style={{ color: 'var(--v-ink)' }}>
        এগুলোও দেখতে পারেন
      </h2>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((p) => (
          <Link key={p.id} href={`/product/${p.id}/${p.slug}`} prefetch={false} className="prod-card group block">
            <div
              className="relative grid aspect-[16/11] place-items-center overflow-hidden"
              style={{ background: 'linear-gradient(150deg,#6d28d9,#4c1d95)' }}
            >
              {p.image ? (
                <SafeImage
                  src={p.image}
                  alt=""
                  sizes="(max-width:640px) 50vw, 220px"
                  className="object-cover transition-transform duration-700 group-hover:scale-110"
                />
              ) : (
                /* ছবিহীন ফলব্যাক — Arsenal এর ক্রেস্টের ছোট সংস্করণ,
                   যাতে দুই জায়গায় একই ভাষা থাকে */
                <span className="relative grid place-items-center" aria-hidden="true">
                  <span
                    className="absolute h-16 w-16 transition-transform duration-700 group-hover:rotate-[30deg]"
                    style={{ border: '1.5px solid rgba(200,255,61,.45)', clipPath: 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)' }}
                  />
                  <span
                    className="grid h-12 w-12 place-items-center"
                    style={{
                      background: 'radial-gradient(circle at 40% 35%, rgba(200,255,61,.28), rgba(6,8,14,.85) 72%)',
                      boxShadow: '0 0 22px -6px rgba(200,255,61,.7)',
                      clipPath: 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                      color: '#fff',
                    }}
                  >
                    <Icon name="gem" size={22} strokeWidth={1.6} />
                  </span>
                </span>
              )}
              <span
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
                style={{ background: 'linear-gradient(180deg, transparent, rgba(6,8,14,.85))' }}
                aria-hidden="true"
              />
              {p.soldOut && (
                <span
                  className="v-hud absolute left-2 top-2 px-2 py-1 text-[9px] font-bold uppercase backdrop-blur"
                  style={{
                    background: 'rgba(5,6,10,.8)',
                    color: 'var(--v-mut)',
                    border: '1px solid var(--v-edge2)',
                    letterSpacing: '.1em',
                  }}
                >
                  সব শেষ
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="v-dsp text-[12.5px] font-bold leading-tight" style={{ color: 'var(--v-ink)' }}>
                {p.name}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
