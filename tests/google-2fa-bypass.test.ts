/**
 * Google sign-in must not bypass TOTP 2FA (audit 2026-10-31, F-01).
 *
 * The credentials provider demands a TOTP code when `twoFactorEnabled` is
 * true, but the Google path in `authOptions.callbacks.signIn` only looked
 * at `isBanned`. Any 2FA-protected account (admins above all) could be
 * entered with nothing but the Google account behind the same email, so
 * the second factor protected nothing.
 *
 * Runs the real `signIn` callback (no mocks), like google-reclaim-session.
 */
import { describe, it, expect } from 'vitest';
import type { Account, Profile, User } from 'next-auth';
import { db } from '../vitest.setup';
import { createUser, createAdmin } from './helpers/factories';
import { authOptions } from '../src/lib/auth';

async function googleSignIn(email: string): Promise<boolean | string> {
  const account: Account = { provider: 'google', type: 'oauth', providerAccountId: `g-${email}` };
  const profile: Profile = { email, name: 'Owner' };
  const user: User = { id: `g-${email}`, email, name: 'Owner', role: 'USER' };
  return authOptions.callbacks!.signIn!({ user, account, profile });
}

describe('Google sign-in vs 2FA', () => {
  it('refuses a verified admin account that has 2FA enabled', async () => {
    const admin = await createAdmin(db);
    await db.user.update({
      where: { id: admin.id },
      data: { emailVerified: true, twoFactorEnabled: true, twoFactorSecret: 'enc:placeholder' },
    });
    expect(await googleSignIn(admin.email)).not.toBe(true);
  });

  it('refuses a verified customer account that has 2FA enabled', async () => {
    const u = await createUser(db);
    await db.user.update({
      where: { id: u.id },
      data: { emailVerified: true, twoFactorEnabled: true, twoFactorSecret: 'enc:placeholder' },
    });
    expect(await googleSignIn(u.email)).not.toBe(true);
  });

  it('still allows Google sign-in when 2FA is off (no regression)', async () => {
    const u = await createUser(db);
    await db.user.update({ where: { id: u.id }, data: { emailVerified: true } });
    expect(await googleSignIn(u.email)).toBe(true);
  });

  it('a refused 2FA reclaim still locks the squatter out (password and sessions reset)', async () => {
    const u = await createUser(db);
    await db.user.update({
      where: { id: u.id },
      data: { twoFactorEnabled: true, twoFactorSecret: 'enc:placeholder' },
    });
    expect(await googleSignIn(u.email)).not.toBe(true);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.emailVerified).toBe(true);
    expect(after.sessionEpoch).toBeGreaterThan(u.sessionEpoch);
  });
});
