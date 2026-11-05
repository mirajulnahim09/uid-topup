import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { invalidateSettings } from '@/lib/settings';
import { cleanText, safeUrl } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';

const METHODS = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY', 'BANGLA_QR'];

/** Bangla QR: the "number" is a merchant name/ID and a QR image is mandatory. */
function checkAccount(method: string, raw: unknown): string {
  const v = String(raw || '').trim();
  if (method === 'BANGLA_QR') {
    const name = cleanText(v, 60);
    if (name.length < 2) throw new ApiError('মার্চেন্টের নাম/আইডি দিন', 400);
    return name;
  }
  if (!/^01[3-9]\d{8}$/.test(v)) throw new ApiError('সঠিক মোবাইল নাম্বার দিন', 400);
  return v;
}

/**
 * ★★★ পেমেন্ট চ্যানেল — সবচেয়ে ঝুঁকিপূর্ণ অ্যাডমিন রুট (3.3)
 *
 *   এখানে নাম্বার বদলালে **সব গ্রাহকের টাকা সেই নতুন নাম্বারে**
 *   যাবে। কোনো টাকা সরাসরি নড়ে না, কিন্তু ভবিষ্যতের সব টাকার
 *   গন্তব্য বদলে যায় — তাই এটি লগ না করাটা গুরুতর ফাঁক ছিল
 *   (AUDIT_REPORT.md M2)।
 *
 *   ⚠️ পুরনো ও নতুন নাম্বার — দুটোই লগে রাখা হয়, নাহলে
 *      বিরোধের সময় "আগে কী ছিল" জানা যেত না।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { method, accountNo, accountType, instruction, qrImage } = await readJson(req);

    const m = String(method || '').toUpperCase();
    if (!METHODS.includes(m)) throw new ApiError('অবৈধ পেমেন্ট মাধ্যম', 400);

    const no = checkAccount(m, accountNo);
    const qr = qrImage ? safeUrl(String(qrImage)) : null;
    if (m === 'BANGLA_QR' && !qr) throw new ApiError('Bangla QR-এর ছবি আপলোড করুন', 400);

    const count = await prisma.paymentChannel.count();
    const c = await prisma.paymentChannel.create({
      data: {
        method: m as 'BKASH' | 'NAGAD' | 'ROCKET' | 'UPAY' | 'BANGLA_QR',
        accountNo: no,
        accountType: cleanText(String(accountType || 'Personal'), 20),
        instruction: instruction ? cleanText(String(instruction), 400) : null,
        qrImage: qr,
        sortOrder: count,
      },
    });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'PAYMENT_CREATE',
      targetId: String(c.id),
      detail: `${m} — ${no} যোগ করা হয়েছে`,
      ip: getIp(req),
    }).catch(() => {});

    // ★ ক্যাশ বাতিল (4.6) — পরিবর্তন যেন সাথে সাথেই কার্যকর হয়
    invalidateSettings();
    return Response.json({ success: true, id: c.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const { id, accountNo, accountType, instruction, isActive, qrImage } = await readJson(req);
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    // ★ আগের অবস্থা পড়ে রাখি — লগে "কী থেকে কী" দেখাতে
    const before = await prisma.paymentChannel.findUnique({
      where: { id: Number(id) },
      select: { method: true, accountNo: true, isActive: true },
    });
    if (!before) throw new ApiError('পেমেন্ট চ্যানেল পাওয়া যায়নি', 404);

    const data: Record<string, unknown> = {};

    if (accountNo !== undefined) data.accountNo = checkAccount(before.method, accountNo);
    if (qrImage !== undefined) {
      const qr = qrImage ? safeUrl(String(qrImage)) : null;
      if (before.method === 'BANGLA_QR' && !qr) throw new ApiError('Bangla QR-এর ছবি লাগবে', 400);
      data.qrImage = qr;
    }
    if (accountType !== undefined) data.accountType = cleanText(String(accountType), 20);
    if (instruction !== undefined) {
      data.instruction = instruction ? cleanText(String(instruction), 400) : null;
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    await prisma.paymentChannel.update({ where: { id: Number(id) }, data });

    // ★ কী বদলাল তা স্পষ্ট করে লিখি — বিশেষত নাম্বার
    const changes: string[] = [];
    if (data.accountNo && data.accountNo !== before.accountNo) {
      changes.push(`নাম্বার ${before.accountNo} → ${data.accountNo}`);
    }
    if (data.isActive !== undefined && data.isActive !== before.isActive) {
      changes.push(data.isActive ? 'চালু করা হয়েছে' : 'বন্ধ করা হয়েছে');
    }
    if (changes.length === 0) changes.push('তথ্য হালনাগাদ');

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'PAYMENT_UPDATE',
      targetId: String(id),
      detail: `${before.method} — ${changes.join(', ')}`,
      ip: getIp(req),
    }).catch(() => {});

    // ★ ক্যাশ বাতিল (4.6) — পরিবর্তন যেন সাথে সাথেই কার্যকর হয়
    invalidateSettings();
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const { id } = await readJson(req);
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    const before = await prisma.paymentChannel.findUnique({
      where: { id: Number(id) },
      select: { method: true, accountNo: true },
    });

    await prisma.paymentChannel.delete({ where: { id: Number(id) } });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'PAYMENT_DELETE',
      targetId: String(id),
      detail: before ? `${before.method} — ${before.accountNo} মুছে ফেলা হয়েছে` : `#${id} মুছে ফেলা হয়েছে`,
      ip: getIp(req),
    }).catch(() => {});

    // ★ ক্যাশ বাতিল (4.6) — পরিবর্তন যেন সাথে সাথেই কার্যকর হয়
    invalidateSettings();
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
