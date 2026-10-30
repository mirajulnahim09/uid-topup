/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-02 — `otp/send`-এর সময়-ফাঁস কমানো (timing floor)
 *
 *   আগে (মাপা, নকল চ্যানেলে): নিবন্ধিত ইমেইলে মধ্যমা ~৩ms, নতুন ইমেইলে ~৩৮ms
 *   (আসল প্রদানকারীর দেরি এর উপরে — NV)। এখন দুই পথেই "পাঠানো হয়েছে" অন্তত
 *   ১৫০০ms পরে। দাবি: দুই পথই floor-এর নিচে ফেরে না, মধ্যমার পার্থক্য সামান্য,
 *   উত্তর হুবহু এক, আর নিবন্ধিত ইমেইলে কোনো মেইল/কোড যায় না।
 *   ⚠️ সম্পূর্ণ constant-time দাবি নয় — প্রদানকারী floor-এর বেশি দেরি করলে পার্থক্য থাকে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { db } from '../vitest.setup';
import { createUser } from './helpers/factories';

const FLOOR_MS = 1500; // রুটের OTP_SEND_MIN_MS-এর সাথে মিল রাখুন
const delivered = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/otp/channels', async (orig) => ({
  ...(await orig<typeof import('../src/lib/otp/channels')>()),
  signupChannels: vi.fn(async () => [{
    id: 'EMAIL',
    normalize: (v: string) => v.trim().toLowerCase(),
    deliver: vi.fn(async (to: string) => { delivered.push(to); return { ok: true }; }),
  }]),
}));

async function timed(email: string, ip: string) {
  const { POST } = await import('../src/app/api/auth/otp/send/route');
  const t0 = performance.now();
  const res = await POST(new Request('http://t/api/auth/otp/send', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ email }),
  }));
  return { ms: performance.now() - t0, status: res.status, body: await res.json() };
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe('AUTH-02 — otp/send timing floor', () => {
  it('নিবন্ধিত ও নতুন ইমেইল: দুটোই floor-এর নিচে নয়, মধ্যমার পার্থক্য < ১০০ms, উত্তর এক', async () => {
    const u = await createUser(db);
    await timed(`warm-${Date.now()}@test.local`, '198.51.100.9'); // module warm-up
    delivered.length = 0;
    const ex: number[] = []; const nw: number[] = []; const bodies: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const a = await timed(u.email, `198.51.100.${10 + i}`);
      const b = await timed(`fresh${i}-${Date.now()}@test.local`, `198.51.100.${20 + i}`);
      ex.push(a.ms); nw.push(b.ms); bodies.push(a.body, b.body);
      expect(a.status).toBe(200); expect(b.status).toBe(200);
    }
    console.log(`AUTH-02 measured: existing median=${med(ex).toFixed(1)}ms, new median=${med(nw).toFixed(1)}ms`);
    for (const t of [...ex, ...nw]) expect(t).toBeGreaterThanOrEqual(FLOOR_MS - 5);
    expect(Math.abs(med(ex) - med(nw))).toBeLessThan(100);
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    // নিবন্ধিত ইমেইলে কোনো মেইল বা কোড নয় (নকল মেইল পাঠানো হয় না)
    expect(delivered).not.toContain(u.email);
    expect(await db.otp.count({ where: { destination: u.email } })).toBe(0);
    expect(delivered).toHaveLength(3);
  }, 30_000);

  it('অবৈধ ইমেইল (৪০০) floor-এ আটকায় না — কেবল "পাঠানো হয়েছে" পথে floor', async () => {
    const r = await timed('not-an-email', '198.51.100.40');
    expect(r.status).toBe(400);
    expect(r.ms).toBeLessThan(FLOOR_MS);
  });
});
