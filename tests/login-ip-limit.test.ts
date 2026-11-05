/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ লগইন IP-সীমা — কেবল ব্যর্থ চেষ্টা গোনা (চূড়ান্ত মাস্টার অডিট,
 *     ২০২৬-০৯-১৭ · মালিকের সিদ্ধান্ত)
 *
 *   টেস্টের সব অনুরোধ একই IP থেকে — ঠিক একটি carrier-NAT-এর পেছনের
 *   অনেক গ্রাহকের মতো। দাবি:
 *     ১. একই IP থেকে ১৫ জনের সফল লগইন — সবাই ঢোকেন (আগে ১১তম আটকাত)
 *     ২. ব্যর্থ চেষ্টা এখনো গোনা হয় — ১০টি ভুলের পর সঠিক পাসওয়ার্ডেও নয়
 *     ৩. নিজের অ্যাকাউন্টে সফল লগইন দিয়ে গণনা **রিসেট** করা যায় না
 *        (৯ ভুল → ১ সফল → ১ ভুল → এবার আটকায়)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client } from './helpers/app';
import { createUser, DEFAULT_PASSWORD } from './helpers/factories';

const ipCount = async () => {
  const rows = await db.rateLimitBucket.findMany({ where: { key: { startsWith: 'login:ip:' } } });
  return rows.reduce((s, r) => s + Number(r.count), 0);
};

describe('লগইন IP-সীমা', () => {
  it('একই IP থেকে ১৫টি সফল লগইন — সবাই ঢোকেন, গণনা বাড়ে না', async () => {
    const users = [];
    for (let i = 0; i < 15; i++) users.push(await createUser(db, {}));
    for (const u of users) {
      expect(await client().login(u.email, DEFAULT_PASSWORD)).toBe(true);
    }
    expect(await ipCount()).toBe(0);
  });

  it('১০টি ব্যর্থ চেষ্টার পর সঠিক পাসওয়ার্ডেও ঢোকা যায় না', async () => {
    const victims = [];
    for (let i = 0; i < 5; i++) victims.push(await createUser(db, {}));
    // ইমেইল-সীমা (৫) এড়াতে ৫ জনে ভাগ — প্রত্যেকে ২টি ভুল
    for (const v of victims) {
      expect(await client().login(v.email, 'WrongPass2026x')).toBe(false);
      expect(await client().login(v.email, 'WrongPass2026y')).toBe(false);
    }
    const fresh = await createUser(db, {});
    expect(await client().login(fresh.email, DEFAULT_PASSWORD)).toBe(false);
  });

  it('নিজের সফল লগইন দিয়ে ব্যর্থ-গণনা মুছে ফেলা যায় না', async () => {
    const attacker = await createUser(db, {});
    const targets = [];
    for (let i = 0; i < 5; i++) targets.push(await createUser(db, {}));
    let fails = 0;
    for (const t of targets) {
      for (const pw of ['Guess2026a', 'Guess2026b']) {
        if (fails === 9) break;
        expect(await client().login(t.email, pw)).toBe(false);
        fails++;
      }
    }
    expect(fails).toBe(9);
    expect(await client().login(attacker.email, DEFAULT_PASSWORD)).toBe(true);
    expect(await ipCount()).toBe(9);
    // দশম ব্যর্থ চেষ্টা — এখনো সীমার ভেতরে
    const extra = await createUser(db, {});
    expect(await client().login(extra.email, 'Guess2026c')).toBe(false);
    // এবার সঠিক পাসওয়ার্ডও আটকায় (১১তম চেষ্টা)
    expect(await client().login(attacker.email, DEFAULT_PASSWORD)).toBe(false);
  });
});
