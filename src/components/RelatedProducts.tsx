import Link from 'next/link';
import SafeImage from '@/components/fx/SafeImage';
import Diamond from '@/components/fx/Diamond';

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
      <div className="eyebrow">Also available</div>
      <h2 id="related-heading" className="dsp mt-2 text-lg font-medium sm:text-xl">
        একই ধরনের অন্যান্য
      </h2>
      <div className="rule-gold mt-3" />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((p) => (
          <Link key={p.id} href={`/product/${p.id}/${p.slug}`} prefetch={false} className="prod-card group block">
            <div
              className="relative grid aspect-[16/11] place-items-center overflow-hidden"
              style={{ background: 'linear-gradient(150deg,#101228,#080a18)' }}
            >
              {p.image ? (
                <SafeImage
                  src={p.image}
                  alt=""
                  sizes="(max-width:640px) 50vw, 220px"
                  className="object-cover transition-transform duration-700 group-hover:scale-110"
                />
              ) : (
                <Diamond size={40} />
              )}
              {p.soldOut && (
                <span
                  className="absolute left-2 top-2 rounded-md px-2 py-1 text-[9px] font-bold uppercase backdrop-blur"
                  style={{
                    background: 'rgba(10,10,18,.72)',
                    color: 'var(--mut)',
                    border: '1px solid var(--hair)',
                    letterSpacing: '.1em',
                  }}
                >
                  সব শেষ
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="dsp text-[12px] font-semibold leading-tight" style={{ color: '#f2f3fa' }}>
                {p.name}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
