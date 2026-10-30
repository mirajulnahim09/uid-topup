import { cache } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './auth';
import { prisma } from './prisma';
import type { SafeUser } from './guard';
import { isSessionRevoked } from './sessionRevocation';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ পাতার পাহারা (SEC-01) — প্রতিটি /admin ও /account **পাতার** নিজস্ব,
 *     DB-যাচাই করা গার্ড: role + ban + sessionEpoch।
 *
 *   ── কেন লেআউটের গার্ড যথেষ্ট নয় (মাপা, অনুমান নয়) ──
 *   Next 14.2.35 `walk-tree-with-flight-router-state.js:40–51`: ক্লায়েন্টের
 *   `Next-Router-State-Tree` হেডারে যে সেগমেন্ট আগে থেকেই আছে, সার্ভার সেখান
 *   থেকে রেন্ডার **শুরুই করে না** — প্রথম অমিল সেগমেন্ট থেকে করে। অর্থাৎ
 *   সফট-নেভিগেশনে `admin/layout.tsx` চলেই না, আর পাতা নিজে গার্ড না করলে
 *   বাতিল (epoch-অমিল) বা ব্যান হওয়া সেশনও পাতার ডেটা পেত।
 *   middleware কেবল JWT পড়ে (edge, DB নয়), আর jwt callback epoch দেখে
 *   ৫ মিনিটে একবার — তাই সেগুলোও এই ফাঁক বন্ধ করে না।
 *   পাতা (`page.tsx`) প্রতিটি অনুরোধে সার্ভারে চলেই, তাই গার্ড এখানে।
 *
 *   ── নিয়ম হুবহু `requireUser()` (guard.ts) এর মতো ──
 *   একই তিনটি শর্ত, একই "দাবি না থাকলে epoch 0" নিয়ম — পাতা ও API একই
 *   সেশনকে কখনো আলাদা রায় দেয় না। পার্থক্য কেবল ব্যর্থতায়: API দেয় 401/403,
 *   পাতা দেয় `redirect()` — পাতায় ত্রুটি-পর্দা নয়, লগইনে ফেরা।
 *
 *   ⚠️ `redirect()` একটি বিশেষ ত্রুটি ছোড়ে (NEXT_REDIRECT)। তাই কল-সাইটে
 *   গার্ডটি **প্রথম await**, কোনো try/catch-এর ভেতরে নয় — নাহলে catch সেটি
 *   গিলে ফেলে গার্ড নিঃশব্দে নিষ্ক্রিয় করে দিত।
 *   ⚠️ `callbackUrl` স্থির অভ্যন্তরীণ পথ — ইউজারের ইনপুট থেকে নয় (open redirect নয়)।
 * ═══════════════════════════════════════════════════════════
 */

/**
 * ★ এক অনুরোধে একবারই — React `cache()` অনুরোধ-সীমিত memo।
 *   হার্ড-লোডে লেআউট ও পাতা দুজনেই ডাকে; DB কোয়েরি একটিই হয়।
 *   অনুরোধ-সীমিত বলে এক ব্যবহারকারীর ফল অন্যের কাছে যায় না।
 *   ⚠️ DB ব্যর্থ হলে throw — পাতা ত্রুটি দেখায়, ডেটা নয় (fail-closed)।
 */
const loadPageUser = cache(async (): Promise<SafeUser | null> => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const [user, revoked] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, role: true, isBanned: true, sessionEpoch: true },
    }),
    isSessionRevoked(session.user.sid), // ★ AUTH-05 — requireUser()-এর হুবহু নিয়ম
  ]);
  if (!user || user.isBanned || revoked) return null;

  // ★ requireUser()-এর হুবহু নিয়ম: পুরনো টোকেনে দাবি না থাকলে 0
  const claimed = typeof session.user.epoch === 'number' ? session.user.epoch : 0;
  if (claimed !== user.sessionEpoch) return null;

  return { id: user.id, name: user.name, email: user.email, role: user.role };
});

/** ★ গ্রাহকের পাতা — বৈধ সেশন না থাকলে লগইনে */
export async function requireUserPage(area: '/account' | '/admin' = '/account'): Promise<SafeUser> {
  const user = await loadPageUser();
  if (!user) redirect(`/login?callbackUrl=${area}`);
  return user;
}

/** ★ অ্যাডমিনের পাতা — বৈধ সেশন না থাকলে লগইনে, অ্যাডমিন না হলে হোমে */
export async function requireAdminPage(): Promise<SafeUser> {
  const user = await requireUserPage('/admin');
  if (user.role !== 'ADMIN') redirect('/');
  return user;
}
