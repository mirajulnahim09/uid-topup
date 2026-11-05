'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SEARCH_MIN_LEN, SEARCH_MAX_LEN, type SearchHit } from '@/lib/search';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ সার্চ বাক্স (Group I ১) — নেভবার ও সার্চ পাতা দুই জায়গায়
 *
 *   ⚠️ সাজেশন **ঐচ্ছিক সুবিধা**, ফিচার নয়: JS না চললে বা API ব্যর্থ
 *   হলেও ফর্মটি সাধারণ `GET /search?q=` হিসেবে কাজ করে। তাই সার্চ
 *   কখনোই ক্লায়েন্ট-সাইড JS-এর উপর নির্ভরশীল নয়।
 *
 *   ⚠️ debounce ২৫০ms — প্রতিটি কী-স্ট্রোকে কল করলে একটি শব্দ লিখতেই
 *   ৮টি DB কোয়েরি হতো (Neon-এ সংযোগ সীমিত, H4)।
 * ═══════════════════════════════════════════════════════════
 */
export default function SearchBox({
  initial = '',
  autoFocus = false,
  compact = false,
  onNavigate,
}: {
  initial?: string;
  autoFocus?: boolean;
  compact?: boolean;
  /** ★ নেভিগেশনের মুহূর্তে — মোবাইল মেনু এটি দিয়ে নিজেকে বন্ধ করে */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * ★★★ সার্চ জমা দেওয়ার পর সাজেশন আর ফিরে আসবে না।
   *
   *   ব্রাউজারে ধরা পড়া বাগ (৩৯০px, চূড়ান্ত অডিট): লিখে সাথে সাথে Enter
   *   চাপলে `submit()` ড্রপডাউন বন্ধ করত, কিন্তু ২৫০ms debounce-এর ঝুলে
   *   থাকা অনুরোধটি পরে ফিরে `setOpen(true)` করত — ফলাফল-পাতায় পুরনো
   *   সাজেশন আবার খুলে আসল ফলাফল ঢেকে দিত। এখন জমা/বাছাইয়ের পর দেরিতে
   *   আসা উত্তর উপেক্ষিত; নতুন করে টাইপ করলেই আবার চালু।
   */
  const settled = useRef(false);

  /**
   * ★★★ ব্যবহারকারী **নিজে** কিছু টাইপ করেছেন কি না।
   *
   *   ⚠️ ব্রাউজারে ধরা পড়া বাগ: `/search?q=membership` খুললে বাক্সটি
   *   `initial` নিয়ে জন্মায়, ফলে নিচের effect সাথে সাথেই চলত —
   *   সাজেশন ড্রপডাউন **নিজে থেকে খুলে** সার্ভার-রেন্ডার করা আসল
   *   ফলাফল গ্রিডটাই ঢেকে দিত, আর একই কোয়েরি **দুবার** চলত
   *   (একবার সার্ভারে, একবার ক্লায়েন্টে — Neon-এ অকারণ সংযোগ, H4)।
   *
   *   সাজেশন কেবল **টাইপ করার সহায়তা**; যে লেখাটি নিয়ে বাক্সটি
   *   জন্মেছে তার উত্তর ইতিমধ্যেই পাতায় আছে।
   */
  const typed = useRef(false);

  // ★ বাইরে ক্লিক করলে সাজেশন বন্ধ
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    // ★ জন্মের সময়ের লেখা — সাজেশন নয় (কারণ `typed` এর উপরে লেখা)
    if (!typed.current) return;

    const term = q.trim();
    if (term.length < SEARCH_MIN_LEN) {
      setHits([]);
      return;
    }

    // ★ AbortController — দ্রুত টাইপ করলে পুরনো উত্তর নতুনটিকে
    //   চাপা দিয়ে দিত (out-of-order response)
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ac.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { results?: SearchHit[] };
        if (settled.current) return; // ★ ইতিমধ্যে জমা/বাছাই হয়ে গেছে
        setHits(Array.isArray(data.results) ? data.results.slice(0, 6) : []);
        setOpen(true);
      } catch {
        /* বাতিল বা নেটওয়ার্ক — ফর্ম submit তবু কাজ করে */
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [q]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term.length < SEARCH_MIN_LEN) return;
    settled.current = true;
    setOpen(false);
    onNavigate?.();
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }

  return (
    <div ref={boxRef} className="relative w-full">
      {/* ★ আসল `form` + `action` — JS ছাড়াও কাজ করে */}
      {/* ★★★ সার্চ-বাক্সে আগে ইনলাইন `fontSize: 13` ছিল। ইনলাইন স্টাইল
          যেকোনো মিডিয়া-কোয়েরিকে হারায়, তাই `.input` এর টাচ-নিরাপদ
          ১৬px নিয়মটি এই বাক্সে পৌঁছাতই না — ফোন ল্যান্ডস্কেপে ও
          ট্যাবলেটে হেডারের সার্চে ট্যাপ করলেই iOS পুরো পাতা জুম করে
          দিত (এবং নিজে থেকে ফিরত না)। ঘন চেহারাটি এখন
          `.input-compact` ক্লাসে, যা কেবল মাউস-চালিত পর্দায় ছোট
          ফন্ট বসায় — দেখতে আগের মতোই, টাচে নিরাপদ। */}
      <form onSubmit={submit} action="/search" method="get" role="search">
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => {
            typed.current = true;
            settled.current = false;
            setQ(e.target.value);
          }}
          onFocus={() => hits.length > 0 && setOpen(true)}
          maxLength={SEARCH_MAX_LEN}
          autoFocus={autoFocus}
          placeholder="প্রোডাক্ট খুঁজুন…"
          aria-label="প্রোডাক্ট খুঁজুন"
          className={`input w-full${compact ? ' input-compact' : ''}`}
        />
      </form>

      {open && hits.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl"
          style={{
            background: 'var(--v-pit)',
            border: '1px solid var(--v-edge2)',
            boxShadow: 'var(--v-shadow-3)',
          }}
        >
          {hits.map((h) => (
            <li key={h.productId}>
              <button
                type="button"
                onClick={() => {
                  settled.current = true;
                  setOpen(false);
                  onNavigate?.();
                  router.push(`/product/${h.productId}/${h.slug}`);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--v-steel)]"
              >
                <span className="min-w-0">
                  <span className="block truncate">{h.name}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--v-mut)' }}>
                    {h.categoryName}
                  </span>
                </span>
                {h.fromPrice !== null && (
                  <span className="shrink-0 text-xs font-bold" style={{ color: 'var(--accent-text)' }}>
                    ৳{h.fromPrice}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
