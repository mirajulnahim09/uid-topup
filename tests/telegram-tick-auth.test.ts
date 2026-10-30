/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SEC-05 — `/api/admin/telegram/scheduler/tick`-এর প্রবেশাধিকার
 *
 *   আগে: GET → POST (কুকিসহ cross-site লিংকে জব চলত — CSRF), আর কুকি-পথে কেবল
 *   DB-role দেখা হতো (বাতিল/ব্যান সেশনও চলত)। দাবি (আসল HTTP):
 *     · কুকি দিয়ে GET → ৪০৫; Bearer-secret দিয়ে GET → চলে
 *     · POST: অ্যাডমিন ২০০, গ্রাহক ৪০৩, অননুমোদিত ৪০১
 *     · বাতিল (epoch) বা ব্যান করা অ্যাডমিন-সেশন → প্রত্যাখ্যাত
 *   ⚠️ টেস্টে টেলিগ্রাম-কী খালি — কোনো আসল বার্তা যায় না (test-env-isolation)।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, client, signedInAdmin, signedInUser } from './helpers/app';
import { TEST_CRON_SECRET } from './helpers/testEnv';

const PATH = '/api/admin/telegram/scheduler/tick';

describe('SEC-05 — টেলিগ্রাম টিক', () => {
  it('কুকিসহ GET → ৪০৫ (CSRF পথ বন্ধ); কুকিসহ POST → ২০০', async () => {
    const { client: adm } = await signedInAdmin(db);
    const g = await adm.raw(PATH);
    expect(g.status).toBe(405);
    expect(g.headers.get('allow')).toBe('POST');
    expect((await adm.post(PATH, {})).status).toBe(200);
  });

  it('Bearer-secret দিয়ে GET ও POST চলে; ভুল secret → ৪০৫/৪০১', async () => {
    const ok = (m: string, token: string) => fetch(`${baseUrl()}${PATH}`, { method: m, headers: { authorization: `Bearer ${token}` } });
    expect((await ok('GET', TEST_CRON_SECRET)).status).toBe(200);
    expect((await ok('POST', TEST_CRON_SECRET)).status).toBe(200);
    expect((await ok('GET', 'wrong-secret')).status).toBe(405);
    expect((await ok('POST', 'wrong-secret')).status).toBe(401);
  });

  it('গ্রাহক → ৪০৩; অননুমোদিত → ৪০১', async () => {
    const { client: c } = await signedInUser(db);
    expect((await c.post(PATH, {})).status).toBe(403);
    expect((await client().post(PATH, {})).status).toBe(401);
  });

  it('বাতিল (sessionEpoch) ও ব্যান করা অ্যাডমিন-সেশন প্রত্যাখ্যাত', async () => {
    const a = await signedInAdmin(db);
    await db.user.update({ where: { id: a.admin.id }, data: { sessionEpoch: { increment: 1 } } });
    expect((await a.client.post(PATH, {})).status).toBe(401);

    const b = await signedInAdmin(db);
    await db.user.update({ where: { id: b.admin.id }, data: { isBanned: true } });
    expect([401, 403]).toContain((await b.client.post(PATH, {})).status);
  });
});
