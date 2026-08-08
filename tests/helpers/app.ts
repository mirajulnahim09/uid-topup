/**
 * ★ globalSetup থেকে সার্ভারের ঠিকানা টেস্টে আনা (Group D)
 *
 *   `provide`/`inject` ভিটেস্টের নিজস্ব পথ — globalSetup আলাদা
 *   প্রসেসে চলে, তাই সাধারণ import দিয়ে মান ভাগ করা যায় না।
 */
import { inject } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Client } from './http';
import { createUser, createAdmin, DEFAULT_PASSWORD } from './factories';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
    /** SSLCommerz mock গেটওয়ে যে পোর্টে চলবে (Next-ও এটিই জানে) */
    sslczMockPort: number;
  }
}

export function baseUrl(): string {
  return inject('baseUrl');
}

export function sslczMockPort(): number {
  return inject('sslczMockPort');
}

export function client(): Client {
  return new Client(baseUrl());
}

/** ★ ইউজার বানিয়ে সাথে সাথেই আসল HTTP লগইন — টেস্টের সাধারণ শুরু */
export async function signedInUser(
  db: PrismaClient,
  opts: Parameters<typeof createUser>[1] = {},
) {
  const user = await createUser(db, opts);
  const c = client();
  await c.loginOrThrow(user.email, user.plainPassword ?? DEFAULT_PASSWORD);
  return { user, client: c };
}

export async function signedInAdmin(db: PrismaClient) {
  const admin = await createAdmin(db);
  const c = client();
  await c.loginOrThrow(admin.email, admin.plainPassword ?? DEFAULT_PASSWORD);
  return { admin, client: c };
}
