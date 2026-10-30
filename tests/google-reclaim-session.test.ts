/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Google reclaim — আক্রমণকারীর **চলমান সেশনও** বাতিল হতে হবে
 *   (EXTREME রেড-টিম, ২০২৬-০৯-২১)
 *
 *   `findOrCreateGoogleUser()` (C3) এর উদ্দেশ্য: কেউ আগে থেকে অন্যের
 *   ইমেইলে credentials-অ্যাকাউন্ট খুলে রাখলে (যাচাই-হীন), আসল মালিক Google
 *   দিয়ে ঢোকামাত্র মালিকানা ফেরত পাবেন ও "আগের (সম্ভাব্য আক্রমণকারীর)
 *   পাসওয়ার্ড আর কাজ করবে না"।
 *
 *   ফাঁক: পাসওয়ার্ড বদলাত, কিন্তু `sessionEpoch` নয় — আক্রমণকারী যদি আগেই
 *   লগইন করে থাকেন, তাঁর সেশন ৩০ দিন পর্যন্ত বৈধ থাকত। অথচ অ্যাকাউন্টটি
 *   এখন আসল মালিকের; তিনি টাকা জমা দিলে সেই সেশন দিয়েই অর্ডার করা যেত।
 *
 *   এখানে আসল `authOptions.callbacks.signIn` (Google পথ) চালানো হয় — কোনো
 *   মক নয়; আর আক্রমণকারীর সেশন আসল HTTP লগইন থেকে আসে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import type { Account, Profile, User } from 'next-auth';
import { db } from '../vitest.setup';
import { client, signedInUser } from './helpers/app';
import { authOptions } from '../src/lib/auth';

async function googleSignIn(email: string): Promise<boolean | string> {
  const account: Account = { provider: 'google', type: 'oauth', providerAccountId: `g-${email}` };
  const profile: Profile = { email, name: 'আসল মালিক' };
  const user: User = { id: `g-${email}`, email, name: 'আসল মালিক', role: 'USER' };
  return authOptions.callbacks!.signIn!({ user, account, profile });
}

describe('Google reclaim — সেশন', () => {
  it('যাচাই-হীন অ্যাকাউন্ট reclaim হলে আগের সেশন সাথে সাথে ৪০১', async () => {
    // "আক্রমণকারী" — credentials দিয়ে খোলা, যাচাই-হীন, লগইন করা
    const { user, client: attacker } = await signedInUser(db, {});
    expect(user.emailVerified).toBe(false);
    expect((await attacker.get('/api/me')).status).toBe(200);

    // আসল মালিক Google দিয়ে ঢুকলেন
    expect(await googleSignIn(user.email)).toBe(true);

    // ★ মূল দাবি — চলমান সেশন আর টাকার পথে ঢুকতে পারে না
    expect((await attacker.get('/api/me')).status).toBe(401);
    expect((await attacker.post('/api/order', { variantId: 1, playerUid: '1234567890' })).status).toBe(401);

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerified).toBe(true);
    expect(after.sessionEpoch).toBeGreaterThan(user.sessionEpoch);

    // পুরনো পাসওয়ার্ডও আর কাজ করে না (আগের আচরণ অক্ষত)
    expect(await client().login(user.email, user.plainPassword)).toBe(false);
  });

  it('ইতিমধ্যে যাচাইকৃত অ্যাকাউন্টে Google সাইন-ইন কাউকে বের করে দেয় না', async () => {
    const { user, client: owner } = await signedInUser(db, {});
    await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });

    expect(await googleSignIn(user.email)).toBe(true);

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.sessionEpoch).toBe(user.sessionEpoch);
    expect((await owner.get('/api/me')).status).toBe(200);
    expect(await client().login(user.email, user.plainPassword)).toBe(true);
  });
});
