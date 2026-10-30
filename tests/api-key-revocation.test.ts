/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-01 — অ্যাকাউন্ট সুরক্ষিত করলে API কী-ও বাতিল
 *
 *   আগে পাসওয়ার্ড রিসেট / "সব ডিভাইস থেকে সাইন-আউট" / অ্যাডমিন-রিকভারি কেবল
 *   `sessionEpoch` বাড়াত; সেশন-নিরপেক্ষ API কী দিয়ে তখনো ওয়ালেট থেকে অর্ডার
 *   দেওয়া যেত। এখানকার দাবি:
 *     · প্রতিটি পথের পরে পুরনো কী সাথে সাথে ৪০১, কোনো অর্ডার/টাকা নড়ে না
 *     · অন্য ব্যবহারকারীর কী অক্ষত
 *     · ব্যর্থ রিসেট (অবৈধ টোকেন) কোনো কী প্রত্যাহার করে না
 *     · কী মোছা হয় না — `revokedAt` বসে (ইতিহাস অক্ষত)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, client, signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, balanceOf } from './helpers/factories';
import { generateApiKey } from '../src/lib/apiKey';

/** ★ কুকি ছাড়া কাঁচা `fetch` — কী-ই একমাত্র শংসাপত্র */
async function bulk(key: string, variantId: number) {
  const res = await fetch(`${baseUrl()}/api/reseller/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ items: [{ variantId, playerUid: '123456789' }] }),
  });
  return res.status;
}

async function reseller() {
  const signed = await signedInUser(db, { balance: 1000 });
  await db.user.update({ where: { id: signed.user.id }, data: { tier: 'RESELLER' } });
  const { plain, hash, prefix } = generateApiKey();
  const key = await db.apiKey.create({ data: { userId: signed.user.id, label: 'k', prefix, hash } });
  return { ...signed, plainKey: plain, keyId: key.id };
}

describe('AUTH-01 — API কী প্রত্যাহার', () => {
  it('"সব ডিভাইস থেকে সাইন-আউট" → কী সাথে সাথে ৪০১, টাকা নড়ে না', async () => {
    const v = await createVariant(db, { price: 100 });
    const r = await reseller();
    expect(await bulk(r.plainKey, v.id)).toBe(200); // ইতিবাচক নিয়ন্ত্রণ: কী কাজ করছিল

    expect((await r.client.post('/api/account/sessions/revoke-all', {})).status).toBe(200);

    const before = await balanceOf(db, r.user.id);
    const orders = await db.order.count({ where: { userId: r.user.id } });
    expect(await bulk(r.plainKey, v.id)).toBe(401);
    expect(await balanceOf(db, r.user.id)).toBe(before);
    expect(await db.order.count({ where: { userId: r.user.id } })).toBe(orders);

    const row = await db.apiKey.findUnique({ where: { id: r.keyId } });
    expect(row).not.toBeNull(); // মোছা হয়নি
    expect(row!.revokedAt).not.toBeNull();
  });

  it('অ্যাডমিন-রিকভারি লিংকে পাসওয়ার্ড রিসেট → কী ৪০১ (রিসেট রুটের পথ)', async () => {
    const v = await createVariant(db, { price: 100 });
    const r = await reseller();
    expect(await bulk(r.plainKey, v.id)).toBe(200);

    const { client: adm } = await signedInAdmin(db);
    const link = await adm.post<{ url: string }>('/api/admin/user/recovery', { userId: r.user.id });
    expect(link.status).toBe(200);
    const token = new URL(link.body.url).searchParams.get('token')!;
    expect((await client().post('/api/auth/reset', { token, password: 'Recovered2026x' })).status).toBe(200);

    expect(await bulk(r.plainKey, v.id)).toBe(401);
  });

  it('অন্য ব্যবহারকারীর কী অক্ষত থাকে', async () => {
    const v = await createVariant(db, { price: 100 });
    const a = await reseller();
    const b = await reseller();
    await a.client.post('/api/account/sessions/revoke-all', {});

    expect(await bulk(a.plainKey, v.id)).toBe(401);
    expect(await bulk(b.plainKey, v.id)).toBe(200);
    expect((await db.apiKey.findUnique({ where: { id: b.keyId } }))!.revokedAt).toBeNull();
  });

  it('অবৈধ টোকেনে ব্যর্থ রিসেট কোনো কী প্রত্যাহার করে না', async () => {
    const v = await createVariant(db, { price: 100 });
    const r = await reseller();
    const bad = await client().post('/api/auth/reset', { token: 'not-a-valid-token.xyz', password: 'Whatever2026x' });
    expect(bad.status).toBe(400);
    expect(await bulk(r.plainKey, v.id)).toBe(200);
    expect((await db.apiKey.findUnique({ where: { id: r.keyId } }))!.revokedAt).toBeNull();
  });
});
