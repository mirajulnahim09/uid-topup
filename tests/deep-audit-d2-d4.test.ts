/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ গভীর অডিট — Domain 2 (অবস্থা), 3 (লক), 4 (অধিকার ও ইনপুট)
 *
 *   D2-1 — ব্যাকআপ restore ফাইলের **পুরনো স্টক** লাইভ ভ্যারিয়েন্টে লিখত
 *          (BKP-01 কুপন `usageCount`-এর হুবহু একই শ্রেণির বাগ, স্টকে বাকি ছিল)
 *   D3   — সব টাকার পথ একসাথে, একই গ্রাহক/প্যাকেজ/কুপনে — Postgres-এর নিজের
 *          `pg_stat_database.deadlocks` কাউন্টার দিয়ে মাপা: শূন্য থাকতে হবে
 *   D4   — IDOR (অন্যের অর্ডার/টিকিট), সেশন-মাঝে ব্যান, চরম TrxID-ফাজ
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin, baseUrl } from './helpers/app';
import {
  createVariant, createCoupon, createDeposit, createCompletedOrder, balanceOf, ledgerSum,
} from './helpers/factories';
import { creditWallet } from '../src/lib/services/wallet';
import { TEST_CRON_SECRET } from './helpers/testEnv';
import type { Client } from './helpers/http';

let seq = 0;
const rid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;
const fund = (userId: string, amount: number) =>
  db.$transaction((tx) => creditWallet({ tx, userId, amount, type: 'DEPOSIT', note: 'অডিট তহবিল' }));
const drift = async (userId: string) =>
  Math.round((Number(await balanceOf(db, userId)) - Number(await ledgerSum(db, userId))) * 100);

// ───────────────────────────── D2 ─────────────────────────────
describe('D2-1 — restore লাইভ স্টক পুরনো মানে ফেরায় না', () => {
  async function takeBackup(adm: Client) {
    const res = await adm.raw('/api/admin/backup');
    expect(res.status).toBe(200);
    return JSON.parse(await res.text());
  }

  it('ব্যাকআপ স্টক ১০০ → বিক্রি হয়ে ৪০ → restore → স্টক ৪০-ই থাকে (অতিবিক্রি নয়)', async () => {
    const { client: adm } = await signedInAdmin(db);
    const v = await createVariant(db, { price: 50, stock: 100 });
    const backup = await takeBackup(adm);
    await db.variant.update({ where: { id: v.id }, data: { stock: 40 } }); // ৬০টি বিক্রি

    const r = await adm.post('/api/admin/restore', { confirm: 'RESTORE', data: backup });
    expect(r.status).toBe(200);
    const after = (await db.variant.findUniqueOrThrow({ where: { id: v.id } })).stock;
    console.log(`[D2-1] backup=100 live=40 → after restore=${after}`);
    expect(after).toBe(40);
  });

  it('ব্যাকআপে আছে কিন্তু DB-তে নেই এমন ভ্যারিয়েন্ট — ফাইলের স্টক নিয়েই তৈরি হয়', async () => {
    const { client: adm } = await signedInAdmin(db);
    const v = await createVariant(db, { price: 50, stock: 7 });
    const backup = await takeBackup(adm);
    await db.variant.delete({ where: { id: v.id } });
    expect((await adm.post('/api/admin/restore', { confirm: 'RESTORE', data: backup })).status).toBe(200);
    expect((await db.variant.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(7);
  });
});

// ───────────────────────────── D3 ─────────────────────────────
describe('D3 — লক-ঝড়: সব টাকার পথ একসাথে, deadlock শূন্য', () => {
  const deadlocks = async () =>
    Number((await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT deadlocks AS n FROM pg_stat_database WHERE datname = current_database()`)[0].n);

  it('৮ রাউন্ড × ১০টি ভিন্ন লেনদেন একই গ্রাহক/প্যাকেজ/কুপনে → কোনো ৫০০ নেই, deadlocks Δ = ০, খতিয়ান অটুট', async () => {
    const { client: admin } = await signedInAdmin(db);
    const variant = await createVariant(db, { price: 100, stock: 500 });
    const d0 = await deadlocks();
    const codes: number[] = [];

    for (let r = 0; r < 8; r++) {
      const { user, client: cust } = await signedInUser(db, {});
      await fund(user.id, 1000);
      const before = await drift(user.id);
      const coupon = await createCoupon(db, { type: 'FIXED', value: 5, usageLimit: 3, perUserLimit: 5 });
      // পূর্বপ্রস্তুতি: একটি চলমান অর্ডার (বাতিলের জন্য), একটি সম্পন্ন (আংশিক ফেরতের জন্য),
      // একটি ডিপোজিট (অনুমোদনের জন্য), একটি মেয়াদোত্তীর্ণ ডাইরেক্ট-পে
      const pending = await cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('p') });
      const done = await createCompletedOrder(db, { userId: user.id, variantId: variant.id, price: 100 });
      const dep = await createDeposit(db, user.id, { amount: 200 });
      const direct = await cust.post('/api/order/direct', {
        variantId: variant.id, playerUid: '123456789', method: 'BKASH', amount: 100,
        senderNo: '01712345678', trxId: `LS${Date.now().toString(36).toUpperCase()}${r}`,
      });
      const directId = direct.body.orderId as string;
      if (directId) {
        await db.order.update({ where: { id: directId }, data: { createdAt: new Date(Date.now() - 5 * 3600_000) } });
      }

      const res = await Promise.all([
        cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('a'), couponCode: coupon.code }),
        cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('b'), couponCode: coupon.code }),
        cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('c') }),
        admin.post('/api/admin/order', { orderId: pending.body.orderId, action: 'FAIL', failReason: 'OUT_OF_STOCK', takeover: true }),
        admin.post('/api/admin/order/refund', { orderId: done.id, amount: 30, reason: 'লক-ঝড়', requestId: rid('rf') }),
        admin.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }),
        admin.post('/api/admin/user', { userId: user.id, amount: -50, note: 'লক-ঝড়', requestId: rid('adj') }),
        admin.post('/api/admin/user', { userId: user.id, amount: 25, note: 'লক-ঝড়', requestId: rid('adj') }),
        fetch(`${baseUrl()}/api/cron/sla-breach`, { method: 'POST', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } })
          .then((x) => ({ status: x.status })),
        cust.get('/api/me'),
      ]);
      res.forEach((x) => codes.push(x.status));
      expect(Number(await balanceOf(db, user.id))).toBeGreaterThanOrEqual(0);
      expect(await drift(user.id)).toBe(before);
    }

    const d1 = await deadlocks();
    const bad = codes.filter((c) => c >= 500);
    console.log(`[D3] requests=${codes.length} 5xx=${bad.length} (${[...new Set(bad)].join(',')}) deadlocksΔ=${d1 - d0}`);
    expect(d1 - d0).toBe(0);
    expect(bad).toEqual([]);
  });
});

// ───────────────────────────── D4 ─────────────────────────────
describe('D4 — IDOR: অন্যের অর্ডার ও টিকিট', () => {
  it('B, A-র আইডি দিয়ে — পাতা, রসিদ, নিশ্চিতকরণ, রিভিউ, টিকিট: সব ৪০৪, কিছুই বদলায় না', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { user: a, client: ca } = await signedInUser(db, {});
    const { client: cb } = await signedInUser(db, {});
    const order = await createCompletedOrder(db, { userId: a.id, variantId: variant.id });
    // ★ A-র গোপন চিহ্ন — B-র উত্তরে এটি দেখা গেলেই আসল তথ্য-ফাঁস
    const SECRET_UID = `SECRETUID${Date.now()}`;
    await db.order.update({ where: { id: order.id }, data: { playerUid: SECRET_UID, playerName: 'A-গোপন-নাম' } });
    const t = await ca.post('/api/tickets', { subject: 'A-র প্রশ্ন', body: 'গোপন বিবরণ', kind: 'GENERAL' });
    const ticketId = t.body.ticket?.id as string;
    expect(ticketId).toBeTruthy();

    const page = await cb.raw(`/account/orders/${order.id}`);
    const invoice = await cb.raw(`/account/orders/${order.id}/invoice`);
    const confirm = await cb.post('/api/order/confirm', { orderId: order.id, arrived: false });
    const review = await cb.post('/api/review', { orderId: order.id, rating: 1, body: 'IDOR' });
    const readT = await cb.get(`/api/tickets/${ticketId}`);
    const replyT = await cb.post(`/api/tickets/${ticketId}`, { body: 'IDOR উত্তর' });
    const dispute = await cb.post('/api/tickets', { subject: 'বিরোধ', body: 'অন্যের অর্ডার', kind: 'DISPUTE', orderId: order.id });

    console.log(`[D4 IDOR] page=${page.status} invoice=${invoice.status} confirm=${confirm.status} review=${review.status} ticketGET=${readT.status} ticketPOST=${replyT.status} dispute=${dispute.status}`);
    // ★ পাতা দুটি streaming (account/loading.tsx) — `notFound()` shell পাঠানোর পরে আসে,
    //   তাই Next status ২০০ দিতে পারে। আসল প্রশ্ন status নয়: **A-র তথ্য দেখা যায় কি না।**
    const pageBody = await page.text();
    const invBody = await invoice.text();
    console.log(`[D4 IDOR] leak? page=${pageBody.includes(SECRET_UID)} invoice=${invBody.includes(SECRET_UID)}`);
    expect(pageBody).not.toContain(SECRET_UID);
    expect(pageBody).not.toContain('A-গোপন-নাম');
    expect(invBody).not.toContain(SECRET_UID);
    expect(invBody).not.toContain('A-গোপন-নাম');
    expect([200, 404]).toContain(page.status);
    expect([200, 404]).toContain(invoice.status);
    expect(confirm.status).toBe(404);
    expect(review.status).toBe(404);
    expect(readT.status).toBe(404);
    expect(replyT.status).toBe(404);
    // বিরোধ-টিকিট তৈরি হলেও অন্যের অর্ডারে **সংযুক্ত হয় না**
    if (dispute.status === 200) expect(dispute.body.ticket?.orderId ?? null).toBeNull();

    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.deliveryDisputedAt).toBeNull();
    expect(await db.review.count({ where: { orderId: order.id } })).toBe(0);
    expect(await db.ticketMessage.count({ where: { ticketId, body: 'IDOR উত্তর' } })).toBe(0);
  });
});

describe('D4 — সেশন-মাঝে ব্যান: পুরনো কুকি দিয়ে টাকার কাজ', () => {
  it('অ্যাডমিন ব্যান করার **পরের মুহূর্তেই** অর্ডার ব্যর্থ, ব্যালেন্স অক্ষত', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { user, client: cust } = await signedInUser(db, {});
    await fund(user.id, 500);
    const { client: admin } = await signedInAdmin(db);
    const ban = await admin.raw('/api/admin/user', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, status: 'BLOCKED' }),
    });
    expect(ban.status).toBe(200);

    const o = await cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('ban') });
    console.log(`[D4 ban] order after ban=${o.status}`);
    expect([401, 403]).toContain(o.status);
    expect(Number(await balanceOf(db, user.id))).toBe(500);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('D4 — চরম TrxID-ফাজ', () => {
  const post = (c: Client, trxId: unknown) =>
    c.post('/api/deposit', { method: 'BKASH', amount: 100, senderNo: '01712345678', trxId });

  it('ইউনিকোড-রূপান্তর (ß→SS, ﬀ→FF, ı→I): ক্যানোনিকাল রূপের সাথেই ডুপ্লিকেট ধরা পড়ে', async () => {
    const base = `UNI${Date.now().toString(36).toUpperCase()}`;
    const { client: c1 } = await signedInUser(db, {});
    const { client: c2 } = await signedInUser(db, {});
    expect((await post(c1, `${base}SS`)).status).toBe(200);
    const r = await post(c2, `${base}ß`);
    // ★ ß.toUpperCase() === 'SS' — হয় ৪০৯ (একই ক্যানোনিকাল), নয় ৪০০; কখনো নতুন সারি নয়
    expect([400, 409]).toContain(r.status);
    expect(await db.deposit.count({ where: { trxId: `${base}SS` } })).toBe(1);
  });

  it('৩০টি বিষাক্ত মান → কখনো ৫০০ নয়, কখনো ক্যানোনিকালের দ্বিতীয় সারি নয়', async () => {
    const id = `FZX${Date.now().toString(36).toUpperCase()}`;
    const { user, client: c } = await signedInUser(db, {});
    expect((await post(c, id)).status).toBe(200);
    const nasty: unknown[] = [
      `${id}​`, `‍${id}`, `${id}﻿`, `${id}⁠`, `${id}­`, // zero-width/BOM/soft-hyphen
      `${id}\u0000`, `${id}\u0000X`, `${id}%00`, `${id}\\0`,                       // null-byte রূপ
      id.replace(/[A-Z0-9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)), // full-width
      id.replace('A', 'А').replace('X', 'Х'),                              // সিরিলিক হোমোগ্লিফ
      `‮${id}`, `${id}́`,                                                  // RTL-override, combining
      `${id.slice(0, -1)}১`, `${id.slice(0, -1)}١`,                        // বাংলা/আরবি অঙ্ক
      ` ${id} `, `\t${id}\n`, `${id}\r\n`, id.toLowerCase(),                        // ফাঁকা/ছোট হাত
      `${id}' OR '1'='1`, `${id};--`, `${id}"}`,                                    // ইনজেকশন-ধাঁচ
      `${id}${'9'.repeat(40)}`, 'A'.repeat(31),                                      // দৈর্ঘ্য
      12345678, [id], { $ne: null }, null, true, '',                                 // ভুল টাইপ
    ];
    const codes: number[] = [];
    for (const v of nasty) {
      await db.rateLimitBucket.deleteMany({}); // রেট-লিমিট নয়, ইনপুট-বৈধতা মাপছি
      const r = await post(c, v);
      // ★ স্বাভাবিকীকরণে একই দাবি (ফাঁকা/ছোট হাত) → replay; তাকে আলাদা করে গুনি
      codes.push(r.status === 200 && r.body.duplicate === true ? 208 : r.status);
    }
    console.log(`[D4 fuzz] ${codes.join(',')}  (208 = একই গ্রাহকের replay, নতুন সারি নয়)`);
    expect(codes.every((s) => s === 400 || s === 409 || s === 208)).toBe(true);
    expect(await db.deposit.count({ where: { userId: user.id } })).toBe(1);
  });
});
