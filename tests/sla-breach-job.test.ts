/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ OPS-02 — SLA-ভঙ্গ cron: একটিই রান, আর সীমিত কোয়েরি
 *
 *   আগে: কোনো lock নেই (একসাথে দুটো রান = দ্বিগুণ সতর্কতা) ও প্রতি ১৫ মিনিটে সব
 *   খোলা অর্ডার মেমরিতে। দাবি (আসল HTTP, টেস্ট-কেবল CRON_SECRET):
 *     · গণনা আগের in-memory হিসাবের (`breachInfo`) হুবহু সমান — সীমানাসহ
 *     · একসাথে ৪টি রান → অ্যাডমিন **একটিই** সতর্কতা পান
 *     · নাম ধরে সর্বোচ্চ ১৫টি, বাকিগুলো "আরও N টি"
 *     · সক্রিয় lease থাকলে রান বাদ (কিছু লেখে না); মেয়াদোত্তীর্ণ lease আটকায় না
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl } from './helpers/app';
import { createAdmin, createUser, createVariant } from './helpers/factories';
import { TEST_CRON_SECRET } from './helpers/testEnv';
import { breachInfo } from '../src/lib/slaBreach';

const MIN = 60_000;
const run = async () => {
  const r = await fetch(`${baseUrl()}/api/cron/sla-breach`, {
    method: 'POST', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

async function seed(dueOffsetsMs: number[], status: 'PENDING' | 'PROCESSING' | 'COMPLETED' = 'PENDING') {
  const u = await createUser(db);
  const v = await createVariant(db);
  const now = Date.now();
  for (const off of dueOffsetsMs) {
    await db.order.create({
      data: {
        userId: u.id, variantId: v.id, playerUid: '123456789', subtotal: 100, discount: 0, price: 100,
        productName: 'P', variantName: 'V', status, slaDueAt: new Date(now + off),
      },
    });
  }
}
const slaNotes = (adminId: string) =>
  db.notification.findMany({ where: { userId: adminId, title: { startsWith: '⏰ SLA ভঙ্গ' } } });

describe('OPS-02 — SLA cron', () => {
  it('গণনা আগের breachInfo-হিসাবের হুবহু (সীমানাসহ); নতুন ভঙ্গই কেবল জানানো হয়', async () => {
    const admin = await createAdmin(db);
    // দেরি (নতুন) · দেরি (২৪ঘ-এর আগের, "পুরনো") · সীমানা (−২০s = পেরিয়েছে কিন্তু <৩০s, তাই এখনো
    //   শীঘ্রই; −২৯s দিলে পুরো স্যুটের চাপে seed→হিসাবের ১s-এর বেশি দেরিতে সীমা পার হতো — মাপা) ·
    //   শীঘ্রই · ঠিক আছে · বন্ধ অর্ডার
    await seed([-10 * MIN, -30 * 60 * MIN, -20_000, 20 * MIN, 3 * 60 * MIN]);
    await seed([-5 * MIN], 'COMPLETED');

    const open = await db.order.findMany({ where: { status: { in: ['PENDING', 'PROCESSING'] } } });
    const now = new Date();
    const expected = { breached: 0, soon: 0 };
    for (const o of open) {
      const l = breachInfo(o, now).level;
      if (l === 'breached') expected.breached++;
      if (l === 'soon') expected.soon++;
    }

    const r = await run();
    expect(r.status).toBe(200);
    expect({ breached: r.body.breached, soon: r.body.soon }).toEqual(expected);
    expect(expected).toEqual({ breached: 2, soon: 2 });
    expect(r.body.notified).toBe(1); // ৩০ ঘণ্টা আগেরটি প্রথম রানের ২৪ঘ জানালার বাইরে
    expect(await slaNotes(admin.id)).toHaveLength(1);
  });

  it('একসাথে ৪টি রান → অ্যাডমিন একটিই সতর্কতা পান', async () => {
    const admin = await createAdmin(db);
    await seed([-10 * MIN, -8 * MIN]);
    const rs = await Promise.all([run(), run(), run(), run()]);
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await slaNotes(admin.id)).toHaveLength(1);
    // পরের রানে নতুন কিছু নেই → আর সতর্কতা নয়
    expect((await run()).body.notified).toBe(0);
    expect(await slaNotes(admin.id)).toHaveLength(1);
  });

  it('নাম ধরে সর্বোচ্চ ১৫টি, বাকি "আরও N টি"', async () => {
    const admin = await createAdmin(db);
    await seed(Array.from({ length: 20 }, (_, i) => -(i + 2) * MIN));
    const r = await run();
    expect(r.body.notified).toBe(20);
    const [n] = await slaNotes(admin.id);
    expect(n.title).toContain('20 টি নতুন');
    expect((n.body.match(/• #/g) || []).length).toBe(15);
    expect(n.body).toContain('আরও 5 টি');
  });

  it('সক্রিয় lease → রান বাদ, কিছু লেখে না; মেয়াদোত্তীর্ণ lease আটকায় না', async () => {
    const admin = await createAdmin(db);
    await seed([-10 * MIN]);
    await db.setting.create({ data: { key: 'job-lease:sla-breach', value: `other|${Date.now() + 60_000}` } });
    const skipped = await run();
    expect(skipped.body.skipped).toBe(true);
    expect(await slaNotes(admin.id)).toHaveLength(0);
    expect(await db.setting.findUnique({ where: { key: 'job_lastrun_sla-breach' } })).toBeNull();

    await db.setting.update({ where: { key: 'job-lease:sla-breach' }, data: { value: `other|${Date.now() - 1}` } });
    const ran = await run();
    expect(ran.body.skipped).toBeUndefined();
    expect(await slaNotes(admin.id)).toHaveLength(1);
    // নিজের lease ছেড়ে দেয়
    expect(await db.setting.findUnique({ where: { key: 'job-lease:sla-breach' } })).toBeNull();
  });
});
