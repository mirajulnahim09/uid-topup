import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { prisma } from './prisma';

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'ApiError';
  }
}

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'ADMIN';
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

/** ★ Permission guard — DB থেকেও role verify হয় */
export async function requireAdmin(): Promise<SafeUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new ApiError('অনুমতি নেই', 403);
  return user;
}

/** সব API route এর error handler */
export function apiError(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json({ error: e.message }, { status: e.status });
  }

  console.error('[api] unexpected:', e);
  return Response.json(
    { error: 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।' },
    { status: 500 }
  );
}
