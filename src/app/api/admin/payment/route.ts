import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { cleanText } from '@/lib/sanitize';

const METHODS = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY'];

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { method, accountNo, accountType, instruction } = await req.json();

    const m = String(method || '').toUpperCase();
    if (!METHODS.includes(m)) throw new ApiError('অবৈধ পেমেন্ট মাধ্যম', 400);

    const no = String(accountNo || '').trim();
    if (!/^01[3-9]\d{8}$/.test(no)) throw new ApiError('সঠিক মোবাইল নাম্বার দিন', 400);

    const count = await prisma.paymentChannel.count();
    const c = await prisma.paymentChannel.create({
      data: {
        method: m as 'BKASH' | 'NAGAD' | 'ROCKET' | 'UPAY',
        accountNo: no,
        accountType: cleanText(String(accountType || 'Personal'), 20),
        instruction: instruction ? cleanText(String(instruction), 400) : null,
        sortOrder: count,
      },
    });

    return Response.json({ success: true, id: c.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const { id, accountNo, accountType, instruction, isActive } = await req.json();
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    const data: Record<string, unknown> = {};

    if (accountNo !== undefined) {
      const no = String(accountNo).trim();
      if (!/^01[3-9]\d{8}$/.test(no)) throw new ApiError('সঠিক মোবাইল নাম্বার দিন', 400);
      data.accountNo = no;
    }
    if (accountType !== undefined) data.accountType = cleanText(String(accountType), 20);
    if (instruction !== undefined) {
      data.instruction = instruction ? cleanText(String(instruction), 400) : null;
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    await prisma.paymentChannel.update({ where: { id: Number(id) }, data });
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const { id } = await req.json();
    if (!id) throw new ApiError('id প্রয়োজন', 400);
    await prisma.paymentChannel.delete({ where: { id: Number(id) } });
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
