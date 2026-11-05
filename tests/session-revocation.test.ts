/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ সেশন-বাতিলকরণ **তাৎক্ষণিক** — EXTREME অডিট (২০২৬-০৯-১৮)
 *
 *   আগে: `requireUser()` কেবল `isBanned` দেখত; `sessionEpoch` যাচাই হতো
 *   NextAuth-এর jwt callback-এ ৫ মিনিটে একবার। মাপা: "সব ডিভাইস থেকে
 *   সাইন-আউট"-এর পরেও পুরনো সেশন **৩০১ সেকেন্ড** API চালাতে পারত।
 *
 *   এখানকার দাবি (সবগুলোই এক অনুরোধের মধ্যে, অপেক্ষা ছাড়া):
 *     · revoke-all-এর পরে পুরনো সেশন সাথে সাথে ৪০১
 *     · পাসওয়ার্ড রিসেটের পরে অন্য ডিভাইসের সেশন সাথে সাথে ৪০১
 *     · অ্যাডমিন-রিকভারি লিংক ব্যবহারের পরেও একই
 *     · টাকা-সংক্রান্ত রুটেও (অর্ডার) বাতিল সেশন ঢুকতে পারে না
 *     · বৈধ সেশন অক্ষত থাকে (ভুল করে কাউকে বের করে দেয় না)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin } from './helpers/app';
import { DEFAULT_PASSWORD } from './helpers/factories';

describe('সেশন-বাতিলকরণ — তাৎক্ষণিক', () => {
  it('revoke-all-এর পরে পুরনো সেশন সাথে সাথেই ৪০১', async () => {
    const { user, client: a } = await signedInUser(db, {});
    const b = client();
    expect(await b.login(user.email, DEFAULT_PASSWORD)).toBe(true);

    expect((await a.get('/api/me')).status).toBe(200);
    expect((await b.get('/api/me')).status).toBe(200);

    expect((await b.post('/api/account/sessions/revoke-all', {})).status).toBe(200);

    // ★ কোনো অপেক্ষা নয় — পরের অনুরোধেই বাতিল
    expect((await a.get('/api/me')).status).toBe(401);
  });

  it('বাতিল সেশন টাকা-সংক্রান্ত রুটেও ঢুকতে পারে না', async () => {
    const { user, client: a } = await signedInUser(db, {});
    const b = client();
    await b.login(user.email, DEFAULT_PASSWORD);
    await b.post('/api/account/sessions/revoke-all', {});

    const order = await a.post('/api/order', { variantId: 1, playerUid: '1234567890' });
    expect(order.status).toBe(401);
    const withdraw = await a.get('/api/account/withdraw');
    expect(withdraw.status).toBe(401);
  });

  /**
   * ★ যেকোনো উৎস থেকে `sessionEpoch` বাড়লেই সাথে সাথে বাতিল — রিসেট,
   *   রিকভারি, revoke-all সবই এই একই কাউন্টার বাড়ায়।
   *   ⚠️ এখানে টোকেন হাতে বানানো হয় না: রিসেট-টোকেন সার্ভারের
   *   `NEXTAUTH_SECRET` দিয়ে সই হয়, আর টেস্ট-প্রসেসে সেটি ভিন্ন —
   *   তাই দাবিটি DB-র epoch সরাসরি বাড়িয়ে মাপা হয় (একই প্রভাব)।
   */
  it('DB-তে sessionEpoch বাড়লে চলমান সেশন সাথে সাথেই ৪০১', async () => {
    const { user, client: a } = await signedInUser(db, {});
    expect((await a.get('/api/me')).status).toBe(200);

    await db.user.update({ where: { id: user.id }, data: { sessionEpoch: { increment: 1 } } });

    expect((await a.get('/api/me')).status).toBe(401);
    expect((await a.get('/api/notifications')).status).toBe(401);
  });

  it('অ্যাডমিনের রিকভারি-লিংক ব্যবহারের পরেও পুরনো সেশন ৪০১', async () => {
    const { client: adm } = await signedInAdmin(db);
    const { user, client: victim } = await signedInUser(db, {});
    const res = await adm.post<{ url: string }>('/api/admin/user/recovery', { userId: user.id });
    expect(res.status).toBe(200);
    const token = new URL(res.body.url).searchParams.get('token')!;

    expect((await client().post('/api/auth/reset', { token, password: 'Recovered2026x' })).status).toBe(200);
    expect((await victim.get('/api/me')).status).toBe(401);
  });

  it('বৈধ সেশন অক্ষত — অকারণে কেউ বেরিয়ে যায় না', async () => {
    const { client: a } = await signedInUser(db, {});
    for (let i = 0; i < 3; i++) expect((await a.get('/api/me')).status).toBe(200);
    const { client: adm } = await signedInAdmin(db);
    expect((await adm.get('/api/admin/readiness')).status).toBe(200);
  });
});
