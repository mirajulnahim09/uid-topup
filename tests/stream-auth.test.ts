/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ RT-01 — SSE-স্ট্রিম: প্রতি টিকে সেশন-যাচাই ও প্রতি-ব্যবহারকারী সীমা
 *
 *   ⚠️ প্রেক্ষাপট (সৎভাবে): কোনো ক্লায়েন্ট এখনো `/api/stream` ব্যবহার করে না
 *   (`EventSource` কোথাও নেই) আর প্রোডাকশনে ডিফল্টে বন্ধ — বাস্তব আপডেট পোলিং
 *   দিয়ে আসে (Navbar ১২০s, অর্ডার-পাতা ৩০s)। এখানে কেবল চালু করলে যেন নিরাপদ হয়:
 *     · সব-ডিভাইস-সাইন-আউটের পর খোলা স্ট্রিম `revoked` পাঠিয়ে বন্ধ হয়
 *     · এই সেশনের লগআউটের পরও তাই (AUTH-05)
 *     · একজন ব্যবহারকারীর ৪র্থ স্ট্রিম ৪২৯; একটি বন্ধ হলে আবার খোলা যায়
 *   (টিক প্রতি ২০s — তাই টেস্টগুলো ধীর)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, signedInUser } from './helpers/app';
import type { Client } from './helpers/http';

const jarOf = (c: unknown) => (c as { jar: Map<string, string> }).jar;
const cookie = (c: Client) => [...jarOf(c)].map(([k, v]) => `${k}=${v}`).join('; ');

async function openStream(c: Client) {
  const ac = new AbortController();
  const res = await fetch(`${baseUrl()}/api/stream`, { headers: { cookie: cookie(c) }, signal: ac.signal });
  return { res, ac };
}

/** ★ প্রতি স্ট্রিমে একটিই reader ও buffer — নির্দিষ্ট event এলে বা স্ট্রিম শেষ হলে ফেরে */
function streamReader(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ended = false;
  // ★ ঝুলে থাকা read() একটিই — timeout-এ হারালে পরের বার সেটিই ব্যবহার হয়
  //   (নাহলে পরিত্যক্ত read() পরের খণ্ডটি গিলে ফেলত)
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  const next = async (ms: number) => {
    pending ??= reader.read();
    const r = await Promise.race([
      pending,
      new Promise<'timeout'>((ok) => setTimeout(() => ok('timeout'), Math.max(0, ms))),
    ]);
    if (r !== 'timeout') pending = null;
    return r;
  };
  return async function until(event: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (!ended && !buf.includes(`event: ${event}`) && Date.now() < deadline) {
      const r = await next(deadline - Date.now());
      if (r === 'timeout') break;
      if (r.done) { ended = true; break; }
      buf += dec.decode(r.value);
    }
    const found = buf.includes(`event: ${event}`);
    if (found && !ended) {
      // স্ট্রিম সত্যিই বন্ধ হয় কি না — আরও ৩s দেখি
      const r = await next(3000);
      if (r !== 'timeout' && r.done) ended = true;
    }
    return { found, ended };
  };
}

describe('RT-01 — স্ট্রিম', () => {
  it('সব-ডিভাইস-সাইন-আউটের পর খোলা স্ট্রিম revoked পাঠিয়ে বন্ধ হয়', async () => {
    const { user, client: c } = await signedInUser(db);
    const { res } = await openStream(c);
    expect(res.status).toBe(200);
    const until = streamReader(res);
    expect((await until('update', 5000)).found).toBe(true);
    // অন্য পথে epoch বাড়াই (যেন অন্য ডিভাইস থেকে "সব ডিভাইস")
    await db.user.update({ where: { id: user.id }, data: { sessionEpoch: { increment: 1 } } });
    const r = await until('revoked', 26_000);
    expect(r.found).toBe(true);
    expect(r.ended).toBe(true);
  }, 40_000);

  it('এই সেশনের লগআউটের (sid বাতিল) পর স্ট্রিম revoked পাঠিয়ে বন্ধ হয়', async () => {
    const { user, client: c } = await signedInUser(db);
    const { res } = await openStream(c);
    const until = streamReader(res);
    expect((await until('update', 5000)).found).toBe(true);
    const csrf = (await c.get<{ csrfToken: string }>('/api/auth/csrf')).body.csrfToken;
    await c.raw('/api/auth/signout', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken: csrf, json: 'true' }),
    });
    expect(await db.revokedSession.count({ where: { userId: user.id } })).toBe(1);
    const r = await until('revoked', 26_000);
    expect(r.found).toBe(true);
    expect(r.ended).toBe(true);
  }, 40_000);

  it('প্রতি ব্যবহারকারী ৩টি স্ট্রিম; ৪র্থটি ৪২৯; একটি বন্ধ হলে আবার খোলা যায়', async () => {
    const { client: c } = await signedInUser(db);
    const open = [await openStream(c), await openStream(c), await openStream(c)];
    for (const o of open) expect(o.res.status).toBe(200);
    const fourth = await openStream(c);
    expect(fourth.res.status).toBe(429);

    open[0].ac.abort();
    let again = 0;
    for (let i = 0; i < 20 && again !== 200; i++) {
      await new Promise((ok) => setTimeout(ok, 250));
      const o = await openStream(c);
      again = o.res.status;
      if (again === 200) o.ac.abort();
    }
    expect(again).toBe(200);
    for (const o of open.slice(1)) o.ac.abort();
  }, 30_000);
});
