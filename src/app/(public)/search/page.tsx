import Link from 'next/link';
import type { Metadata } from 'next';
import SafeImage from '@/components/fx/SafeImage';
import { normalizeQuery, SEARCH_MIN_LEN } from '@/lib/search';
import { searchProducts } from '@/lib/services/search';
import { bdt } from '@/lib/money';
import SearchBox from '@/components/SearchBox';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ সার্চ ফলাফল (Group I ১)
 *
 *   ⚠️ `force-dynamic` — ফলাফল প্রশ্ন-নির্ভর, তাই ক্যাশ করা অর্থহীন।
 *   হোম/প্রোডাক্ট পাতার `revalidate` অপরিবর্তিত আছে।
 *
 *   ⚠️ কোনো ব্যবহারকারী-নির্দিষ্ট তথ্য নেই — সার্চ ফল সবার জন্য এক
 *   (দেখুন `src/lib/services/search.ts`)।
 * ═══════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'সার্চ',
  // ★ সার্চ ফলাফলের পাতা ইন্ডেক্স করানো উচিত নয় — অসংখ্য পাতলা
  //   পাতা তৈরি হয় ও আসল প্রোডাক্ট পাতাগুলোর সাথে প্রতিযোগিতা করে
  robots: { index: false, follow: true },
};

export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const searchParams = await props.searchParams;
  const raw = searchParams.q ?? '';
  const q = normalizeQuery(raw);
  const results = q ? await searchProducts(q) : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <h1 className="lux-text text-2xl font-medium sm:text-[27px]">খুঁজুন</h1>

      <div className="mt-4 max-w-xl">
        <SearchBox initial={raw} autoFocus />
      </div>

      {!q ? (
        <p className="mt-8 text-sm" style={{ color: 'var(--v-mut)' }}>
          প্রোডাক্ট বা ক্যাটাগরির নাম লিখুন — কমপক্ষে {SEARCH_MIN_LEN} অক্ষর।
        </p>
      ) : results.length === 0 ? (
        <div className="card mt-8 p-8 text-center">
          <p className="text-base font-semibold">&ldquo;{q}&rdquo; — কিছু পাওয়া যায়নি</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--v-mut)' }}>
            বানান মিলিয়ে দেখুন, অথবা{' '}
            <Link href="/" className="underline" style={{ color: 'var(--v-ice)' }}>
              সব প্রোডাক্ট
            </Link>{' '}
            দেখুন।
          </p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm" style={{ color: 'var(--v-mut)' }}>
            {results.length}টি ফল
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((r) => (
              <li key={r.productId}>
                <Link
                  href={`/product/${r.productId}/${r.slug}`}
                  className="card flex h-full items-center gap-3 p-3 transition-transform hover:-translate-y-0.5"
                >
                  {/* ★ `relative` জরুরি — SafeImage `fill` ব্যবহার করে */}
                  <div
                    className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl"
                    style={{ background: 'var(--v-steel)' }}
                  >
                    {r.image ? (
                      <SafeImage src={r.image} alt={r.name} sizes="56px" className="object-cover" />
                    ) : (
                      <span aria-hidden style={{ color: 'var(--v-dim)' }}>◆</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{r.name}</p>
                    <p className="truncate text-xs" style={{ color: 'var(--v-mut)' }}>
                      {r.categoryName}
                    </p>
                    {r.fromPrice !== null && (
                      <p className="mt-1 text-sm font-bold" style={{ color: 'var(--accent-text)' }}>
                        {bdt(r.fromPrice)} থেকে
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
