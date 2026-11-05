/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ OPS-03 — শিডিউলড জবের ব্যর্থতা আর নীরব নয়
 *
 *   readiness আগে কেবল "বাসি" (সময়মতো চলেনি) জবে সতর্কতা দিত। একটি জব সময়মতো
 *   চলছে কিন্তু প্রতিবার ব্যর্থ হচ্ছে (`ok:false`) — তখন কোনো সতর্কতাই উঠত না।
 *   দাবি (আসল HTTP, অ্যাডমিন readiness):
 *     · সাম্প্রতিক ব্যর্থ রান → সতর্কতা (কারণসহ)
 *     · সাম্প্রতিক সফল রান → সেই জবের কোনো সতর্কতা নয়
 *     · বাসি রান → আগের মতোই "বাসি" সতর্কতা
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin } from './helpers/app';

const setRun = (job: string, run: { at: string; ok: boolean; ms: number; detail?: string }) =>
  db.setting.upsert({
    where: { key: `job_lastrun_${job}` },
    create: { key: `job_lastrun_${job}`, value: JSON.stringify(run) },
    update: { value: JSON.stringify(run) },
  });

async function warnings() {
  const { client } = await signedInAdmin(db);
  const r = await client.get<{ warnings: string[] }>('/api/admin/readiness');
  expect(r.status).toBe(200);
  return r.body.warnings.filter((w) => w.includes('SLA'));
}

describe('OPS-03 — জব-ব্যর্থতার দৃশ্যমানতা', () => {
  it('সাম্প্রতিক ব্যর্থ রান → সতর্কতা, কারণসহ', async () => {
    await setRun('sla-breach', { at: new Date().toISOString(), ok: false, ms: 12, detail: 'DB timeout (test)' });
    const w = await warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('শেষ রান ব্যর্থ');
    expect(w[0]).toContain('DB timeout (test)');
  });

  it('সাম্প্রতিক সফল রান → সেই জবের কোনো সতর্কতা নয়', async () => {
    await setRun('sla-breach', { at: new Date().toISOString(), ok: true, ms: 12 });
    expect(await warnings()).toEqual([]);
  });

  it('বাসি রান → আগের মতোই বাসি-সতর্কতা (একটিই)', async () => {
    await setRun('sla-breach', { at: new Date(Date.now() - 6 * 60 * 60_000).toISOString(), ok: false, ms: 1 });
    const w = await warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).not.toContain('শেষ রান ব্যর্থ');
  });
});
