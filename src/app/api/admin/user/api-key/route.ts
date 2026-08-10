import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { generateApiKey } from '@/lib/apiKey';
import { notify } from '@/lib/notify';
import { cleanText } from '@/lib/sanitize';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রিসেলার API কী ব্যবস্থাপনা (Group F ৩)
 *
 *   `GET    ?userId=…`  → ঐ ব্যবহারকারীর কীগুলোর তালিকা
 *   `POST   { userId, label }` → নতুন কী (কাঁচা মান **একবারই** ফেরে)
 *   `DELETE { keyId }`  → প্রত্যাহার (সারি মোছে না)
 *
 *   ⚠️ এটি ছাড়া ফিচারটি মালিকের কাছে অব্যবহার্য থাকত — কী বসানোর
 *   একমাত্র উপায় হতো কাঁচা SQL, ঠিক যেমনটি Group F (২)-এর আগে
 *   `tier` ও `resellerPrice`-এর ক্ষেত্রে ছিল।
 * ═══════════════════════════════════════════════════════════
 */

/**
 * ★ একজন রিসেলারের সর্বোচ্চ সক্রিয় কী।
 *   কেন সীমা: কী ঘোরানোর (rotation) সময় অল্প সময়ের জন্য দুটি কী
 *   লাগে — তাই ১টি যথেষ্ট নয়। কিন্তু সীমাহীন হলে বছরের পর বছর
 *   ভুলে-যাওয়া সক্রিয় কী জমত, আর প্রতিটিই ওয়ালেটে হাত দেওয়ার
 *   একেকটি দরজা।
 */
const MAX_ACTIVE_KEYS = 5;

export async function GET(req: Request) {
  try {
    await requireAdmin();

    const userId = new URL(req.url).searchParams.get('userId');
    if (!userId) throw new ApiError('userId প্রয়োজন', 400);

    const keys = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      // ⚠️ `hash` কখনো নয় — সেটি গোপন মানের সমতুল্য নয় ঠিকই, তবু
      //   এটি ক্লায়েন্টে পাঠানোর কোনো কারণ নেই (§2.3)।
      select: {
        id: true, label: true, prefix: true, createdAt: true,
        lastUsedAt: true, revokedAt: true, createdByName: true,
      },
    });

    return Response.json({ keys });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { userId, label } = await readJson(req);

    if (!userId || typeof userId !== 'string') throw new ApiError('userId প্রয়োজন', 400);

    const cleanLabel = cleanText(String(label ?? ''), 40).trim();
    if (cleanLabel.length < 2) {
      throw new ApiError('কীটির একটি নাম দিন (যেমন: "নিজের প্যানেল")', 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, tier: true, isBanned: true },
    });
    if (!target) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

    // ★ স্তর ছাড়া কী কাজই করবে না (`requireApiKey` ৪০৩ দেয়)। তাই
    //   এখানেই আটকাই — নাহলে মালিক একটি মৃত কী তৈরি করে ভাবতেন
    //   অ্যাক্সেস দেওয়া হয়ে গেছে, আর রিসেলার ৪০৩ দেখে বিভ্রান্ত হতেন।
    if (target.tier !== 'RESELLER') {
      throw new ApiError('আগে ব্যবহারকারীকে রিসেলার স্তরে নিন, তারপর কী তৈরি করুন', 400);
    }
    if (target.isBanned) throw new ApiError('বন্ধ অ্যাকাউন্টে কী দেওয়া যাবে না', 400);

    const active = await prisma.apiKey.count({ where: { userId, revokedAt: null } });
    if (active >= MAX_ACTIVE_KEYS) {
      throw new ApiError(
        `সর্বোচ্চ ${MAX_ACTIVE_KEYS}টি সক্রিয় কী রাখা যায় — পুরনো একটি প্রত্যাহার করুন`,
        400,
      );
    }

    const { plain, hash, prefix } = generateApiKey();

    const created = await prisma.apiKey.create({
      data: {
        userId,
        label: cleanLabel,
        prefix,
        hash,
        createdById: admin.id,
        createdByName: admin.name,
      },
      select: { id: true, label: true, prefix: true, createdAt: true },
    });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'API_KEY_CREATE',
      targetId: userId,
      // ⚠️ লগে কেবল উপসর্গ — কাঁচা কী কোথাও লেখা হয় না, লগেও নয়।
      detail: `${target.name}: "${cleanLabel}" (${prefix}…)`,
      ip: getIp(req),
    }).catch(() => {});

    notify(
      userId,
      'নতুন API কী তৈরি হয়েছে',
      `"${cleanLabel}" — আপনি না চাইলে সাথে সাথে জানান।`,
      '/account',
    ).catch(() => {});

    return Response.json({
      success: true,
      key: created,
      // ★★★ কাঁচা মান — **এই একবারই**। DB-তে কেবল হ্যাশ আছে, তাই
      //   এটি হারালে পুনরুদ্ধারের কোনো পথ নেই, নতুন কী বানাতে হবে।
      plainKey: plain,
      warning: 'এই কীটি এখনই সংরক্ষণ করুন — পরে আর দেখানো সম্ভব নয়।',
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const { keyId } = await readJson(req);
    if (!keyId || typeof keyId !== 'string') throw new ApiError('keyId প্রয়োজন', 400);

    const key = await prisma.apiKey.findUnique({
      where: { id: keyId },
      select: { id: true, label: true, prefix: true, revokedAt: true, userId: true },
    });
    if (!key) throw new ApiError('কী পাওয়া যায়নি', 404);

    // ★ আগেই প্রত্যাহৃত — নীরবে সফল, কিন্তু অডিট লগ দূষিত করি না
    if (key.revokedAt) {
      return Response.json({ success: true, unchanged: true });
    }

    // ⚠️ সারি **মোছা হয় না**। কোন কী কবে পর্যন্ত সক্রিয় ছিল, সেই
    //   প্রশ্নের উত্তর একটি অর্ডার নিয়ে বিতর্ক হলে সবার আগে লাগে।
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'API_KEY_REVOKE',
      targetId: key.userId,
      detail: `"${key.label}" (${key.prefix}…) প্রত্যাহার`,
      ip: getIp(req),
    }).catch(() => {});

    notify(
      key.userId,
      'API কী প্রত্যাহার করা হয়েছে',
      `"${key.label}" আর কাজ করবে না।`,
      '/account',
    ).catch(() => {});

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
