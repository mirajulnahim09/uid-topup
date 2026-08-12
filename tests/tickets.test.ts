/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৪) — টিকিট ও বিরোধ-থ্রেড
 *
 *   ── মূল দাবি: **কেউ অন্যের থ্রেড ছুঁতে পারে না** ──
 *   টিকিটে অভিযোগ, অর্ডার নং ও Player UID থাকে। পড়া, লেখা, বন্ধ
 *   করা — তিনটিতেই মালিকানা যাচাই হতে হবে, আর "নেই" ও "আপনার নয়"
 *   একই উত্তর দিতে হবে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin } from './helpers/app';
import { createVariant } from './helpers/factories';

async function openTicket(
  c: Awaited<ReturnType<typeof signedInUser>>['client'],
  over: Record<string, unknown> = {},
) {
  const res = await c.post<{ ticket: { id: string } }>('/api/tickets', {
    subject: 'ডায়মন্ড পাইনি',
    body: 'অর্ডার সম্পন্ন দেখাচ্ছে কিন্তু গেমে কিছু আসেনি।',
    ...over,
  });
  return res;
}

describe('টিকিট — তৈরি', () => {
  it('গ্রাহক টিকিট খুলতে পারেন, প্রথম বার্তাসহ', async () => {
    const { client: c } = await signedInUser(db, {});
    const res = await openTicket(c);

    expect(res.status).toBe(200);
    const t = await db.ticket.findUnique({
      where: { id: res.body.ticket.id },
      select: { status: true, kind: true, _count: { select: { messages: true } } },
    });
    expect(t?.status).toBe('OPEN');
    expect(t?.kind).toBe('GENERAL');
    // ★ খালি টিকিট কখনো তৈরি হয় না — প্রথম বার্তা একই ট্রানজেকশনে
    expect(t?._count.messages).toBe(1);
  });

  it('লগইন ছাড়া টিকিট খোলা যায় না', async () => {
    const res = await client().post('/api/tickets', { subject: 'হ্যালো', body: 'কিছু একটা' });
    expect(res.status).toBe(401);
  });

  it('খুব ছোট বার্তা প্রত্যাখ্যাত', async () => {
    const { client: c } = await signedInUser(db, {});
    expect((await openTicket(c, { body: 'হাই' })).status).toBe(400);
  });

  it('DISPUTE-এ অর্ডার বাধ্যতামূলক', async () => {
    const { client: c } = await signedInUser(db, {});
    const res = await openTicket(c, { kind: 'DISPUTE' });
    expect(res.status).toBe(400);
  });

  /** ★★★ অন্যের অর্ডার জুড়ে দেওয়া যাবে না */
  it('অন্যের অর্ডার আইডি দিলে সেটি নীরবে বাদ যায়', async () => {
    const variant = await createVariant(db, { price: 100, stock: 5 });
    const { client: victimC } = await signedInUser(db, { balance: 500 });
    const ord = await victimC.post<{ orderNo: number }>('/api/order', {
      variantId: variant.id, playerUid: '111222333',
    });
    const victimOrder = (await db.order.findFirst({ where: { orderNo: ord.body.orderNo } }))!;

    const { client: attackerC } = await signedInUser(db, {});
    const res = await openTicket(attackerC, { kind: 'DISPUTE', orderId: victimOrder.id });

    // ★ orderId বাদ পড়ে বলে DISPUTE-এর শর্ত ভাঙে না (রুট আগেই দেখে
    //   orderId দেওয়া হয়েছে), কিন্তু টিকিটে অর্ডারটি যুক্ত হয় না
    if (res.status === 200) {
      const t = await db.ticket.findUnique({
        where: { id: res.body.ticket.id },
        select: { orderId: true },
      });
      expect(t?.orderId).toBeNull();
    }
  });
});

describe('টিকিট — পাতা', () => {
  it('তালিকা সার্ভার-রেন্ডার হয় ও নিজের টিকিট দেখায়', async () => {
    const { client: c } = await signedInUser(db, {});
    await openTicket(c, { subject: 'আমার নিজের টিকিট' });

    const html = await (await c.raw('/account/tickets')).text();
    expect(html).toContain('আমার নিজের টিকিট');
  });

  it('থ্রেড পাতায় অন্যের টিকিট খোলা যায় না', async () => {
    const { client: ownerC } = await signedInUser(db, {});
    const id = (await openTicket(ownerC, { subject: 'গোপন থ্রেড ABC' })).body.ticket.id;

    const { client: otherC } = await signedInUser(db, {});
    const html = await (await otherC.raw(`/account/tickets/${id}`)).text();
    expect(html).not.toContain('গোপন থ্রেড ABC');
  });

  /** ★ `?order=` — অর্ডার পাতার "সমস্যা জানান" এই পথেই আসে */
  it('অর্ডার-preset সহ পাতা খোলে', async () => {
    const variant = await createVariant(db, { price: 100, stock: 5 });
    const { client: c } = await signedInUser(db, { balance: 500 });
    const ord = await c.post<{ orderNo: number }>('/api/order', {
      variantId: variant.id, playerUid: '999888777',
    });
    const order = (await db.order.findFirst({ where: { orderNo: ord.body.orderNo } }))!;

    const res = await c.raw(`/account/tickets?order=${order.id}`);
    expect(res.status).toBe(200);
    // ★ ড্রপডাউনে অর্ডারটি থাকতে হবে, নাহলে বিরোধ খোলাই যেত না
    expect(await res.text()).toContain(String(order.orderNo));
  });
});

describe('টিকিট — কে পড়তে ও লিখতে পারে', () => {
  it('অন্যের থ্রেড পড়া যায় না (৪০৪, ফাঁস নেই)', async () => {
    const { client: ownerC } = await signedInUser(db, {});
    const made = await openTicket(ownerC, { subject: 'গোপন বিষয় XYZ' });
    const id = made.body.ticket.id;

    const { client: otherC } = await signedInUser(db, {});
    const res = await otherC.get(`/api/tickets/${id}`);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('গোপন বিষয় XYZ');
  });

  it('অন্যের থ্রেডে উত্তর দেওয়া যায় না', async () => {
    const { client: ownerC } = await signedInUser(db, {});
    const id = (await openTicket(ownerC)).body.ticket.id;

    const { client: otherC } = await signedInUser(db, {});
    expect((await otherC.post(`/api/tickets/${id}`, { body: 'ঢুকে পড়লাম' })).status).toBe(404);
    expect(await db.ticketMessage.count({ where: { ticketId: id } })).toBe(1);
  });

  it('অন্যের থ্রেড বন্ধ করা যায় না', async () => {
    const { client: ownerC } = await signedInUser(db, {});
    const id = (await openTicket(ownerC)).body.ticket.id;

    const { client: otherC } = await signedInUser(db, {});
    expect((await otherC.patch(`/api/tickets/${id}`, {})).status).toBe(404);

    const t = await db.ticket.findUnique({ where: { id }, select: { status: true } });
    expect(t?.status).toBe('OPEN');
  });

  it('নিজের থ্রেড পড়া ও উত্তর দেওয়া যায়', async () => {
    const { client: c } = await signedInUser(db, {});
    const id = (await openTicket(c)).body.ticket.id;

    expect((await c.get(`/api/tickets/${id}`)).status).toBe(200);
    expect((await c.post(`/api/tickets/${id}`, { body: 'আরেকটি কথা' })).status).toBe(200);
    expect(await db.ticketMessage.count({ where: { ticketId: id } })).toBe(2);
  });
});

describe('টিকিট — স্ট্যাটাসের প্রবাহ', () => {
  it('অ্যাডমিন উত্তর দিলে ANSWERED, গ্রাহক লিখলে আবার OPEN', async () => {
    const { client: c } = await signedInUser(db, {});
    const id = (await openTicket(c)).body.ticket.id;

    const { client: ac } = await signedInAdmin(db);
    expect((await ac.post('/api/admin/tickets', { id, body: 'দেখছি' })).status).toBe(200);
    expect((await db.ticket.findUnique({ where: { id } }))!.status).toBe('ANSWERED');

    await c.post(`/api/tickets/${id}`, { body: 'ধন্যবাদ, কিন্তু এখনো পাইনি' });
    expect((await db.ticket.findUnique({ where: { id } }))!.status).toBe('OPEN');
  });

  it('বন্ধ টিকিটে আর লেখা যায় না', async () => {
    const { client: c } = await signedInUser(db, {});
    const id = (await openTicket(c)).body.ticket.id;

    expect((await c.patch(`/api/tickets/${id}`, {})).status).toBe(200);
    expect((await db.ticket.findUnique({ where: { id } }))!.status).toBe('CLOSED');

    expect((await c.post(`/api/tickets/${id}`, { body: 'আরও কিছু' })).status).toBe(400);
  });

  it('বন্ধ করলে থ্রেডে সিস্টেম-বার্তা থাকে', async () => {
    const { client: c } = await signedInUser(db, {});
    const id = (await openTicket(c)).body.ticket.id;
    await c.patch(`/api/tickets/${id}`, {});

    const last = await db.ticketMessage.findFirst({
      where: { ticketId: id },
      orderBy: { createdAt: 'desc' },
    });
    expect(last?.authorId).toBeNull();
    expect(last?.body).toContain('বন্ধ করা হয়েছে');
  });
});

describe('টিকিট — অ্যাডমিন সারি', () => {
  it('সাধারণ ইউজার অ্যাডমিন সারিতে ঢুকতে পারে না', async () => {
    const { client: c } = await signedInUser(db, {});
    expect((await c.get('/api/admin/tickets')).status).toBe(403);
  });

  it('অ্যাডমিন সব টিকিট দেখেন ও যেকোনোটিতে উত্তর দিতে পারেন', async () => {
    const { client: c } = await signedInUser(db, {});
    const id = (await openTicket(c, { subject: 'অ্যাডমিন দেখবেন' })).body.ticket.id;

    const { client: ac } = await signedInAdmin(db);
    const list = await ac.get<{ tickets: { id: string }[] }>('/api/admin/tickets');
    expect(list.status).toBe(200);
    expect(list.body.tickets.some((t) => t.id === id)).toBe(true);

    const thread = await ac.get(`/api/admin/tickets?id=${id}`);
    expect(thread.status).toBe(200);
  });

  /** ★ API নয়, **পাতা** — গার্ড দুই জায়গাতেই থাকতে হবে */
  it('অ্যাডমিন পাতা সাধারণ ইউজারের কাছে টিকিট দেখায় না', async () => {
    const { client: c } = await signedInUser(db, {});
    await openTicket(c, { subject: 'অ্যাডমিন-পাতা ফাঁস পরীক্ষা' });

    const html = await (await c.raw('/admin/tickets')).text();
    expect(html).not.toContain('অ্যাডমিন-পাতা ফাঁস পরীক্ষা');
  });

  it('অ্যাডমিন পাতা সারিতে টিকিট দেখায়', async () => {
    const { client: c } = await signedInUser(db, {});
    await openTicket(c, { subject: 'সারিতে দেখা যাবে' });

    const { client: ac } = await signedInAdmin(db);
    const html = await (await ac.raw('/admin/tickets')).text();
    expect(html).toContain('সারিতে দেখা যাবে');
  });

  it('অ্যাডমিনের বার্তা isStaff = true হিসেবে লেখা হয়', async () => {
    const { client: c } = await signedInUser(db, {});
    const id = (await openTicket(c)).body.ticket.id;

    const { client: ac } = await signedInAdmin(db);
    await ac.post('/api/admin/tickets', { id, body: 'আমরা দেখছি' });

    const staff = await db.ticketMessage.findFirst({ where: { ticketId: id, isStaff: true } });
    expect(staff?.body).toBe('আমরা দেখছি');
  });
});
