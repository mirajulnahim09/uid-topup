import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { prisma } from './prisma';

export class ApiError extends Error {
  /**
   * ★ ঐচ্ছিক মেশিন-পাঠযোগ্য কোড।
   *
   *   কেন দরকার: একই HTTP status একাধিক কারণে আসতে পারে। যেমন 409
   *   হয় "অর্ডার আর বদলানো যাবে না", আবার "অন্য অ্যাডমিন ধরে আছে"
   *   (3.7) — প্রথমটায় থামতে হবে, দ্বিতীয়টায় টেক-ওভার জিজ্ঞেস করতে
   *   হবে। বাংলা বার্তা মিলিয়ে পার্থক্য করা ভঙ্গুর — বার্তা বদলালেই
   *   ভেঙে যেত। তাই কোড।
   *
   *   পুরনো সব `throw new ApiError(msg, status)` অপরিবর্তিত কাজ করে।
   */
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Role = 'USER' | 'ADMIN';

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

/** লগইন বাধ্যতামূলক — ban check সহ */
export async function requireUser(): Promise<SafeUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new ApiError('লগইন করুন', 401);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isBanned: true },
  });

  if (!user) throw new ApiError('ইউজার পাওয়া যায়নি', 401);
  if (user.isBanned) throw new ApiError('আপনার অ্যাকাউন্ট বন্ধ করা হয়েছে', 403);

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * ★★★ অ্যাডমিন অনুমতি — DB থেকেও role verify হয়
 *
 *   ⚠️ এই প্ল্যাটফর্মে প্রশাসনিক ভূমিকা **একটিই**: `ADMIN` (মালিক)।
 *   ডিপোজিট অনুমোদন, অর্ডার প্রসেসিং, ব্যালেন্স সমন্বয়, গ্রাহক
 *   ব্যবস্থাপনা, সার্চ, রিফান্ড, সেটিংস — সবই মালিকের হাতে।
 *   স্তরভিত্তিক (STAFF) ভূমিকা ইচ্ছাকৃতভাবে **রাখা হয়নি**, যাতে
 *   অনুমতির নিয়ম একটাই থাকে এবং কোথায় কার কী ক্ষমতা তা নিয়ে
 *   কোনো অস্পষ্টতা না থাকে।
 */
export async function requireAdmin(): Promise<SafeUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new ApiError('অনুমতি নেই', 403);
  return user;
}

/** সব API route এর error handler */
export function apiError(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json(
      e.code ? { error: e.message, code: e.code } : { error: e.message },
      { status: e.status }
    );
  }

  console.error('[api] unexpected:', e);
  return Response.json(
    { error: 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।' },
    { status: 500 }
  );
}
