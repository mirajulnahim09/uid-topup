import { prisma } from '../prisma';
import { cleanText } from '../sanitize';
import type { TicketKind, TicketStatus } from '@prisma/client';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৪) — টিকিট ও বিরোধ-থ্রেড (সার্ভিস স্তর)
 *
 *   ⚠️ সব নিয়ম **এখানে**, রুট-হ্যান্ডলারে নয় — কারণ একই কাজ তিন
 *   জায়গা থেকে হয়: গ্রাহকের পাতা, অ্যাডমিন প্যানেল, আর অর্ডারের
 *   "পাইনি" বোতাম। নিয়ম ছড়িয়ে গেলে একদিন একটিতে যাচাই বাদ পড়ত।
 *
 *   ── মালিকানা ──
 *   ⚠️ প্রতিটি পাঠ/লেখায় `userId` মিলিয়ে দেখা হয়। টিকিটে গ্রাহকের
 *   অভিযোগ, অর্ডার নং ও কখনো কখনো Player UID থাকে — অন্যের থ্রেড
 *   পড়তে পারা সরাসরি তথ্য ফাঁস।
 *
 *   ── কী **নেই**, ইচ্ছাকৃতভাবে ──
 *   টাকা ফেরত দেওয়া বা অর্ডারের অবস্থা বদলানোর কোনো ক্ষমতা এখানে
 *   নেই। একটি টিকিট **কথোপকথন**, আর্থিক লেনদেন নয়। রিফান্ড আগের
 *   মতোই `wallet.ts` ও অ্যাডমিনের রিফান্ড-পথ দিয়েই হবে — নাহলে
 *   টাকার পথ দুটি হয়ে যেত, আর দুটি পথ মানে একদিন একটিতে লক ভুল।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ বার্তার সর্বোচ্চ দৈর্ঘ্য — DB নয়, ব্যবহারিক সীমা */
export const TICKET_BODY_MAX = 4000;
export const TICKET_SUBJECT_MAX = 120;

export type NewTicket = {
  userId: string;
  subject: string;
  body: string;
  kind?: TicketKind;
  orderId?: string | null;
};

/**
 * ★ নতুন টিকিট + প্রথম বার্তা — **এক ট্রানজেকশনে**।
 *
 *   ⚠️ আলাদা করলে বার্তাহীন খালি টিকিট তৈরি হতে পারত, আর অ্যাডমিন
 *   সারিতে সেটি দেখে বুঝতেনই না গ্রাহক কী চেয়েছিলেন।
 *
 *   ⚠️ `orderId` দেওয়া হলে সেটি **এই গ্রাহকেরই** কি না যাচাই করা হয়।
 *   নাহলে যে কেউ অন্যের অর্ডার নম্বর দিয়ে টিকিট খুলে সেই অর্ডারের
 *   অস্তিত্ব নিশ্চিত করে ফেলতে পারত।
 */
export async function createTicket(input: NewTicket) {
  const subject = cleanText(input.subject, TICKET_SUBJECT_MAX);
  const body = cleanText(input.body, TICKET_BODY_MAX);
  if (!subject) throw new Error('বিষয় লিখুন');
  if (!body) throw new Error('বার্তা লিখুন');

  return prisma.$transaction(async (tx) => {
    let orderId: string | null = null;
    if (input.orderId) {
      const order = await tx.order.findFirst({
        where: { id: input.orderId, userId: input.userId },
        select: { id: true },
      });
      // ⚠️ নিজের অর্ডার না হলে **নীরবে বাদ**, ত্রুটি নয় — ত্রুটি দিলে
      //    সেটিই বলে দিত অর্ডারটি সত্যিই আছে কি না
      orderId = order?.id ?? null;
    }

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { name: true },
    });

    const ticket = await tx.ticket.create({
      data: {
        userId: input.userId,
        orderId,
        kind: input.kind ?? 'GENERAL',
        subject,
        status: 'OPEN',
        lastMessageAt: new Date(),
        messages: {
          create: {
            authorId: input.userId,
            authorName: user?.name ?? 'গ্রাহক',
            isStaff: false,
            body,
          },
        },
      },
      select: { id: true, subject: true, status: true, kind: true, createdAt: true },
    });

    return ticket;
  });
}

/** ★ গ্রাহকের নিজের টিকিট — নতুনতম আগে */
export async function listUserTickets(userId: string) {
  return prisma.ticket.findMany({
    where: { userId },
    orderBy: { lastMessageAt: 'desc' },
    select: {
      id: true, subject: true, status: true, kind: true,
      lastMessageAt: true, createdAt: true,
      order: { select: { orderNo: true } },
      _count: { select: { messages: true } },
    },
  });
}

/**
 * ★ একটি থ্রেড। `userId` দিলে মালিকানা যাচাই হয়; `null` মানে অ্যাডমিন।
 *
 *   ⚠️ অ্যাডমিনের জন্য `null` পাঠানো একটি **স্পষ্ট** সিদ্ধান্ত হতে হবে —
 *   তাই প্যারামিটারটি ঐচ্ছিক নয়, বাধ্যতামূলক। ভুলে বাদ দেওয়া যায় না।
 */
export async function getThread(ticketId: string, userId: string | null) {
  return prisma.ticket.findFirst({
    where: { id: ticketId, ...(userId ? { userId } : {}) },
    select: {
      id: true, subject: true, status: true, kind: true,
      createdAt: true, closedAt: true,
      order: { select: { id: true, orderNo: true, status: true } },
      user: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, authorName: true, isStaff: true, body: true, createdAt: true },
      },
    },
  });
}

/**
 * ★ থ্রেডে উত্তর।
 *
 *   ⚠️ স্ট্যাটাস স্বয়ংক্রিয়ভাবে বদলায়: অ্যাডমিন লিখলে `ANSWERED`,
 *   গ্রাহক লিখলে `OPEN`। ফলে অ্যাডমিনের সারিতে "কার পালা" সবসময়
 *   সঠিক থাকে, কাউকে হাতে মার্ক করতে হয় না — আর হাতে করতে হলে
 *   একদিন কেউ ভুলে যেত ও গ্রাহক উত্তরহীন থেকে যেতেন।
 *
 *   ⚠️ বন্ধ টিকিটে লেখা যায় না; গ্রাহককে নতুন টিকিট খুলতে হবে।
 *   একটি "সমাধান হয়েছে" থ্রেড পরে আবার খুলে গেলে ইতিহাস বিভ্রান্তিকর হতো।
 */
export async function replyToTicket(opts: {
  ticketId: string;
  /** ★ গ্রাহক হলে তার id; অ্যাডমিন হলে অ্যাডমিনের id */
  authorId: string;
  authorName: string;
  isStaff: boolean;
  body: string;
  /** ★ গ্রাহকের ক্ষেত্রে মালিকানা যাচাইয়ের জন্য */
  ownerId: string | null;
}) {
  const body = cleanText(opts.body, TICKET_BODY_MAX);
  if (!body) throw new Error('বার্তা লিখুন');

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: opts.ticketId, ...(opts.ownerId ? { userId: opts.ownerId } : {}) },
      select: { id: true, status: true },
    });
    if (!ticket) return null;
    if (ticket.status === 'CLOSED') throw new Error('টিকিটটি বন্ধ — নতুন টিকিট খুলুন');

    const now = new Date();
    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: opts.authorId,
        authorName: opts.authorName,
        isStaff: opts.isStaff,
        body,
      },
    });
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: opts.isStaff ? 'ANSWERED' : 'OPEN', lastMessageAt: now },
    });

    return { ok: true as const };
  });
}

/**
 * ★ টিকিট বন্ধ করা। গ্রাহক নিজেরটি বন্ধ করতে পারেন, অ্যাডমিন যেকোনোটি।
 *
 *   ⚠️ সিস্টেম-বার্তা লেখা হয় (`authorId: null`) — কে কখন বন্ধ করল
 *   তা থ্রেডেই দেখা যায়, আলাদা অডিট টেবিল লাগে না।
 */
export async function closeTicket(opts: {
  ticketId: string;
  byName: string;
  ownerId: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: opts.ticketId, ...(opts.ownerId ? { userId: opts.ownerId } : {}) },
      select: { id: true, status: true },
    });
    if (!ticket) return null;
    if (ticket.status === 'CLOSED') return { ok: true as const };

    const now = new Date();
    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: null,
        authorName: opts.byName,
        isStaff: false,
        body: `— টিকিটটি বন্ধ করা হয়েছে (${opts.byName})`,
      },
    });
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: 'CLOSED', closedAt: now, lastMessageAt: now },
    });
    return { ok: true as const };
  });
}

/** ★ অ্যাডমিনের সারি — খোলা ও উত্তর-প্রতীক্ষিত আগে */
export async function listAdminTickets(status?: TicketStatus) {
  return prisma.ticket.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
    take: 100,
    select: {
      id: true, subject: true, status: true, kind: true, lastMessageAt: true,
      user: { select: { id: true, name: true, email: true } },
      order: { select: { orderNo: true } },
      _count: { select: { messages: true } },
    },
  });
}
