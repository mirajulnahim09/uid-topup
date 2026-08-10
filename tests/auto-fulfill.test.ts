/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অটো-ডেলিভারি (Group G)
 *
 *   RUN.md-এর অলঙ্ঘনীয় নিয়ম: প্রোভাইডার ত্রুটি বা টাইমআউট করলে
 *   অর্ডার delivered চিহ্নিত হবে না, **এবং** ওয়ালেট দুবার কাটবে না।
 *   প্রতিটি টেস্ট তাই শেষে খতিয়ান ও ব্যালেন্স মিলিয়ে দেখে।
 *
 *   ── HARD CONSTRAINT, সবার আগে ──
 *   ডিফল্ট কনফিগে (order_approval = manual) প্রোভাইডারকে **ডাকাই হয় না**
 *   এবং অর্ডার-প্রবাহ হুবহু আগের মতোই থাকে। অটো-ডেলিভারি একটি
 *   সুইচ, নীরব আচরণ-পরিবর্তন নয়।
 *
 *   ── mock প্রোভাইডার ──
 *   একটি আসল HTTP সার্ভার (`GAME_API_URL` সেটিকেই দেখায়), তাই
 *   fetch/টাইমআউট/হেডার/JSON-পার্সিং — পুরো নেটওয়ার্ক পথ পরীক্ষিত,
 *   ফাংশন stub করে নয়। প্রতিটি কলের `Idempotency-Key` রেকর্ড হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { db } from '../vitest.setup';
import { fulfillMockPort, signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, balanceOf, ledgerSum } from './helpers/factories';
import type { Client } from './helpers/http';

/** ★ প্রতিটি টেস্ট নিজের মতো করে mock-এর আচরণ ঠিক করে */
type Behaviour =
  | { kind: 'delivered'; ref?: string }
  | { kind: 'failed'; reason: string; retryable: boolean }
  | { kind: 'http'; status: number; body: unknown }
  /** ★ কখনো উত্তর দেয় না — টাইমআউট (GAME_API_TIMEOUT_MS = 3s) */
  | { kind: 'hang' }
  /** ★ প্রথম n বার ব্যর্থ (retryable), তারপর সফল */
  | { kind: 'flaky'; failFirst: number };

let behaviour: Behaviour = { kind: 'delivered' };
let calls: Array<{ idem: string; auth: string; orderId: string }> = [];
let server: http.Server;
/** ★ hang-এর খোলা সংযোগ — afterAll-এ ছাড়তে হয়, নাহলে server.close ঝুলে থাকে */
let hung: http.ServerResponse[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: { orderId?: string; idempotencyKey?: string } = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* খালি থাক */
      }

      calls.push({
        idem: String(req.headers['idempotency-key'] ?? ''),
        auth: String(req.headers.authorization ?? ''),
        orderId: String(body.orderId ?? ''),
      });

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      switch (behaviour.kind) {
        case 'delivered':
          return send(200, { status: 'delivered', ref: behaviour.ref ?? 'prov-1' });
        case 'failed':
          return send(200, {
            status: 'failed', reason: behaviour.reason, retryable: behaviour.retryable,
          });
        case 'http':
          return send(behaviour.status, behaviour.body);
        case 'flaky':
          return calls.length <= behaviour.failFirst
            ? send(503, { status: 'failed', reason: 'সাময়িক' })
            : send(200, { status: 'delivered', ref: 'prov-after-retry' });
        case 'hang':
          // ★ ইচ্ছাকৃতভাবে কোনো উত্তর নয়
          hung.push(res);
          return;
      }
    });
  });

  await new Promise<void>((r) => server.listen(fulfillMockPort(), '127.0.0.1', r));
});

afterAll(async () => {
  for (const r of hung) r.destroy();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  calls = [];
  behaviour = { kind: 'delivered' };
});

/**
 * ★★★ অটো-ডেলিভারি চালু করা — **অ্যাপের নিজের লেখার পথ দিয়ে**।
 *
 *   ⚠️ সরাসরি `db.setting.create()` করলে Next-এর ৩০ সেকেন্ডের
 *   in-process settings ক্যাশ সেটি দেখত না, আর টেস্ট নীরবে "অটো
 *   চালু হয়নি" অবস্থায় পাস করত (settings-leak.test.ts-এ ঠিক এই
 *   ফাঁদটিই ধরা পড়েছিল)। সেভ-রুট শেষে ক্যাশ invalidate করে।
 */
async function enableAutoFulfill(admin: Client): Promise<void> {
  const res = await admin.post('/api/admin/settings', {
    order_approval: 'automatic',
    integration_fulfillment_active: 'game-api',
    'integration_fulfillment_game-api_enabled': '1',
  });
  expect(res.status, 'অটো-ডেলিভারি চালু করা যায়নি').toBe(200);
}

async function orderOnce(opts: { balance?: number; price?: number } = {}) {
  const variant = await createVariant(db, { price: opts.price ?? 100 });
  const { user, client: c } = await signedInUser(db, { balance: opts.balance ?? 500 });
  const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });
  expect(res.status).toBe(200);
  const order = await db.order.findFirstOrThrow({ where: { userId: user.id } });
  return { user, order, variant };
}

/** ★ প্রতিটি টেস্টের শেষে: টাকা ঠিক একবারই কাটা হয়েছে */
async function expectChargedOnce(userId: string, start: number, price: number) {
  expect(await balanceOf(db, userId)).toBe(start - price);
  expect(await ledgerSum(db, userId)).toBe(-price);
  expect(await db.ledgerEntry.count({ where: { userId } })).toBe(1);
}

describe('ডিফল্ট আচরণ — অটো বন্ধ', () => {
  /** ★★★ RUN.md এর HARD CONSTRAINT */
  it('order_approval = manual হলে প্রোভাইডারকে ডাকাই হয় না', async () => {
    const { user, order } = await orderOnce();

    expect(calls).toHaveLength(0);
    expect(order.status).toBe('PENDING');
    expect(order.claimedById).toBeNull();
    await expectChargedOnce(user.id, 500, 100);
  });
});

describe('অটো-ডেলিভারি চালু', () => {
  it('সফল ডেলিভারি — অর্ডার COMPLETED, টাকা একবারই কাটা', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);

    const { user, order } = await orderOnce();

    expect(calls).toHaveLength(1);
    // ★ ক্রেডেনশিয়াল সত্যিই যাচ্ছে — নাহলে আসল প্রোভাইডার ৪০১ দিত
    expect(calls[0].auth).toBe('Bearer test-fulfill-key');
    expect(calls[0].idem).toBe(`ord_${order.id}`);

    const after = await db.order.findFirstOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('COMPLETED');
    expect(after.completedAt).not.toBeNull();
    // ★ কাজ শেষ — claim ছেড়ে দেওয়া হয়েছে
    expect(after.claimedById).toBeNull();
    expect(after.internalNote).toContain('prov-1');

    await expectChargedOnce(user.id, 500, 100);

    // ★ ঘটনাপঞ্জি: PENDING → PROCESSING → COMPLETED
    const events = await db.orderEvent.findMany({
      where: { orderId: order.id }, orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.status)).toEqual(['PENDING', 'PROCESSING', 'COMPLETED']);
  });

  /** ★★★ এই স্যুটের সবচেয়ে গুরুত্বপূর্ণ টেস্ট */
  it('টাইমআউট — DELIVERED নয়, retry নয়, ম্যানুয়াল কিউতে ফেরত', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);
    behaviour = { kind: 'hang' };

    const { user, order } = await orderOnce();

    // ★★★ টাইমআউট = অনিশ্চয়তা। ঠিক **একবারই** ডাকা হয়েছে — আবার
    //     ডাকলে গেমে দুবার ডেলিভারি যাওয়ার ঝুঁকি ছিল।
    expect(calls).toHaveLength(1);

    const after = await db.order.findFirstOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');          // কখনো COMPLETED নয়
    expect(after.completedAt).toBeNull();
    expect(after.claimedById).toBeNull();          // অ্যাডমিন ধরতে পারবেন
    // ★ অ্যাডমিন যেন যাচাই করে তবেই ডেলিভার করেন
    expect(after.internalNote).toContain('অজানা');

    await expectChargedOnce(user.id, 500, 100);
  }, 30_000);

  it('retryable ব্যর্থতা — ব্যাক-অফ দিয়ে আবার চেষ্টা, একই idempotency key', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);
    behaviour = { kind: 'flaky', failFirst: 2 };

    const { user, order } = await orderOnce();

    expect(calls).toHaveLength(3);
    // ★★★ তিনটি চেষ্টাতেই **হুবহু একই** কী — প্রোভাইডার এটি মানলে
    //     তার দিকেও ডুপ্লিকেট ডেলিভারি হবে না
    expect(new Set(calls.map((c) => c.idem)).size).toBe(1);
    expect(calls[0].idem).toBe(`ord_${order.id}`);

    const after = await db.order.findFirstOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('COMPLETED');
    await expectChargedOnce(user.id, 500, 100);
  }, 30_000);

  it('স্থায়ী ব্যর্থতা — retry হয় না, PENDING-এ ফেরে', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);
    behaviour = { kind: 'failed', reason: 'UID সঠিক নয়', retryable: false };

    const { user, order } = await orderOnce();

    // ★ প্রোভাইডার স্পষ্ট বলেছে আবার চেষ্টা করে লাভ নেই
    expect(calls).toHaveLength(1);

    const after = await db.order.findFirstOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');
    expect(after.internalNote).toContain('UID সঠিক নয়');
    await expectChargedOnce(user.id, 500, 100);
  });

  it('৪xx (ভুল কী/payload) — retryable নয়', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);
    behaviour = { kind: 'http', status: 401, body: { reason: 'invalid key' } };

    const { user, order } = await orderOnce();

    expect(calls).toHaveLength(1);
    expect((await db.order.findFirstOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
    await expectChargedOnce(user.id, 500, 100);
  });

  it('৫xx — retry হয়, সব চেষ্টা ব্যর্থ হলে PENDING', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);
    behaviour = { kind: 'http', status: 500, body: { reason: 'boom' } };

    const { user, order } = await orderOnce();

    expect(calls).toHaveLength(3);           // MAX_ATTEMPTS
    const after = await db.order.findFirstOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');
    expect(after.claimedById).toBeNull();
    await expectChargedOnce(user.id, 500, 100);
  }, 30_000);

  it('বিকৃত উত্তর — অনিশ্চিত ধরা হয়, সফল নয়', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);
    behaviour = { kind: 'http', status: 200, body: { status: 'কিছু-একটা' } };

    const { user, order } = await orderOnce();

    expect(calls).toHaveLength(1);
    expect((await db.order.findFirstOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
    await expectChargedOnce(user.id, 500, 100);
  });

  /**
   * ★★★ ডুপ্লিকেট কল — claim-ই আসল রক্ষা।
   *   দ্বিতীয় চেষ্টা অর্ডারটিকে আর PENDING দেখে না, তাই প্রোভাইডারকে
   *   ডাকেই না। এটিই গেমের ভেতরে ডাবল-ডেলিভারি ঠেকায়।
   */
  it('একই অর্ডারে দ্বিতীয় চেষ্টা প্রোভাইডারকে আর ডাকে না', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);

    const { user, order } = await orderOnce();
    expect(calls).toHaveLength(1);

    const { autoFulfillOrder } = await import('../src/lib/fulfillment/autoFulfill');
    const again = await autoFulfillOrder(order.id);

    expect(again.status).toBe('MANUAL');     // ইতিমধ্যে সম্পন্ন
    expect(calls).toHaveLength(1);           // দ্বিতীয় কল হয়নি
    expect(await db.orderEvent.count({ where: { orderId: order.id, status: 'COMPLETED' } })).toBe(1);
    await expectChargedOnce(user.id, 500, 100);
  });

  it('অ্যাডমিন ইতিমধ্যে ধরে থাকলে অটো-ডেলিভারি সরে দাঁড়ায়', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);
    behaviour = { kind: 'failed', reason: 'x', retryable: false };

    const { order } = await orderOnce();
    // ★ অটো ব্যর্থ হয়ে PENDING-এ ফিরেছে; এবার অ্যাডমিন ধরলেন
    await db.order.update({
      where: { id: order.id },
      data: { claimedById: 'admin-1', claimedByName: 'অ্যাডমিন', claimedAt: new Date() },
    });

    const before = calls.length;
    const { autoFulfillOrder } = await import('../src/lib/fulfillment/autoFulfill');
    const again = await autoFulfillOrder(order.id);

    expect(again.status).toBe('MANUAL');
    expect(calls).toHaveLength(before);      // প্রোভাইডারকে ডাকা হয়নি
    // ★ অ্যাডমিনের claim অক্ষত — অটো সেটি কেড়ে নেয়নি
    expect((await db.order.findFirstOrThrow({ where: { id: order.id } })).claimedById).toBe('admin-1');
  });

  it('ডেলিভারি সফল হলেও ওয়ালেটে কোনো নতুন এন্ট্রি লেখে না', async () => {
    const { client: ac } = await signedInAdmin(db);
    await enableAutoFulfill(ac);

    const { user } = await orderOnce({ balance: 500, price: 100 });

    // ★★★ অটো-ডেলিভারি টাকার মডেলে কোনো নতুন পথ যোগ করে না —
    //     ঠিক একটি ORDER এন্ট্রি, আর কিছু নয়
    const entries = await db.ledgerEntry.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('ORDER');
    expect(await balanceOf(db, user.id)).toBe(400);
  });
});
