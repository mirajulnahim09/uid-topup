/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUD-01 — গ্রাহকের নিজের নিরাপত্তা-কাজ অডিটে ADMIN নয়, CUSTOMER
 *
 *   `adminLog()` actorType সবসময় ADMIN লিখত; `/api/account/2fa` (চালু/বন্ধ) ও
 *   `/api/account/sessions/revoke-all` সেটিই ডাকত — ফলে গ্রাহকের কাজ "অ্যাডমিনের
 *   কাজ" হিসেবে জমা পড়ত (ভুল ফরেনসিক, লগের actor-ফিল্টার বিকৃত)। দাবি (আসল HTTP):
 *     · গ্রাহকের 2FA চালু/বন্ধ ও সব-ডিভাইস-সাইন-আউট → actorType CUSTOMER, role USER
 *     · অ্যাডমিন নিজের জন্য একই কাজ করলে → ADMIN (বাস্তব ভূমিকা অনুযায়ী)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin, signedInUser } from './helpers/app';
import { DEFAULT_PASSWORD } from './helpers/factories';
import { generateTotp } from '../src/lib/totp';
import type { Client } from './helpers/http';

const STEP_MS = 30_000;
beforeEach(async () => {
  const into = Date.now() % STEP_MS;
  if (into > STEP_MS - 10_000) await new Promise((r) => setTimeout(r, STEP_MS - into + 200));
});

async function enableThenDisable(c: Client) {
  const setup = await c.post<{ secret: string }>('/api/account/2fa', { action: 'setup' });
  const secret = setup.body.secret;
  expect((await c.post('/api/account/2fa', {
    action: 'enable', password: DEFAULT_PASSWORD, secret, token: generateTotp(secret, Date.now() - STEP_MS),
  })).status).toBe(200);
  expect((await c.post('/api/account/2fa', {
    action: 'disable', password: DEFAULT_PASSWORD, token: generateTotp(secret, Date.now()),
  })).status).toBe(200);
}
/**
 * ★ লগ best-effort (`logActivity(...).catch()`, await করা হয় না) — উত্তর আসার মুহূর্তে সারিটি
 *   এখনো লেখা না-ও হতে পারে। তাই অল্প অপেক্ষা (audit-events.test.ts-এর মতো)। এটি দাবি দুর্বল
 *   করে না: ৩ সেকেন্ডেও না এলে খালি ফেরে আর টেস্ট আগের মতোই ব্যর্থ হয়।
 *   (২০২৬-০৯-২৭: পূর্ণ রানে একবার `[]` পাওয়া গিয়েছিল — রেস, পণ্যের ত্রুটি নয়।)
 */
async function logsOf(actorId: string, action: string) {
  for (let i = 0; i < 30; i++) {
    const rows = await db.adminLog.findMany({ where: { adminId: actorId, action }, select: { actorType: true, role: true } });
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

describe('AUD-01 — অডিট-actor', () => {
  it('গ্রাহকের 2FA চালু/বন্ধ → CUSTOMER', async () => {
    const { user, client } = await signedInUser(db);
    await enableThenDisable(client);
    expect(await logsOf(user.id, 'TWO_FACTOR_ENABLE')).toEqual([{ actorType: 'CUSTOMER', role: 'USER' }]);
    expect(await logsOf(user.id, 'TWO_FACTOR_DISABLE')).toEqual([{ actorType: 'CUSTOMER', role: 'USER' }]);
  });

  it('গ্রাহকের সব-ডিভাইস-সাইন-আউট → CUSTOMER', async () => {
    const { user, client } = await signedInUser(db);
    expect((await client.post('/api/account/sessions/revoke-all', {})).status).toBe(200);
    expect(await logsOf(user.id, 'SESSION_REVOKE_ALL')).toEqual([{ actorType: 'CUSTOMER', role: 'USER' }]);
  });

  it('অ্যাডমিন নিজের জন্য করলে → ADMIN', async () => {
    const { admin, client } = await signedInAdmin(db);
    await enableThenDisable(client);
    expect(await logsOf(admin.id, 'TWO_FACTOR_ENABLE')).toEqual([{ actorType: 'ADMIN', role: 'ADMIN' }]);
  });
});
