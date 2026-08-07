'use client';

import { createContext, useContext } from 'react';
import type { Branding, LogoPair, LogoSlotKey } from '@/lib/branding';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ব্র্যান্ড কনটেক্সট — সার্ভার → ক্লায়েন্ট একবারই।
 *
 *   কেন দরকার: লগইন/রেজিস্টার/নেভের মতো **ক্লায়েন্ট** কম্পোনেন্ট
 *   নিজে DB পড়তে পারে না। প্রতিটির জন্য আলাদা fetch করলে প্রতি
 *   পাতায় বাড়তি অনুরোধ হতো, আর লোগো দেরিতে এসে ঝলকাত।
 *   রুট লেআউট একবার রেজলভ করে এখানে দিয়ে দেয়।
 *
 *   ⚠️ এখানে কোনো গোপন তথ্য নেই — লোগোর URL ও ব্র্যান্ড-লেখা
 *   এমনিতেই সর্বজনীন, তাই ক্লায়েন্টে পাঠানো নিরাপদ।
 * ═══════════════════════════════════════════════════════════
 */

const Ctx = createContext<Branding | null>(null);

export function BrandProvider({ value, children }: { value: Branding; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** ব্র্যান্ড — প্রোভাইডারের বাইরে হলে `null` (কল-সাইট ফলব্যাক দেবে) */
export function useBrand(): Branding | null {
  return useContext(Ctx);
}

/** একটি স্লটের লোগো-জোড়া — না থাকলে খালি (BrandLogo তখন VoltMark দেখাবে) */
export function useLogo(slot: LogoSlotKey): LogoPair {
  const b = useContext(Ctx);
  return b?.logos?.[slot] ?? { dark: '', light: '' };
}
