import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { getProvider } from '@/lib/payments/registry';
import { saveProviderConfig, providerHealth, providerInfos, recordTestResult } from '@/lib/payments/config';
import type { ProviderId } from '@/lib/payments/types';

/**
 * ★★★ প্রোভাইডার ক্রেডেনশিয়াল/কনফিগ ব্যবস্থাপনা (অ্যাডমিন-only)
 *
 *   POST  — কী/সিক্রেট (merge), টেস্ট/লাইভ মোড, চালু/বন্ধ সেভ করে,
 *           তারপর health যাচাই করে হালনাগাদ তালিকা ফেরত দেয়।
 *   ⚠️ সিক্রেট মান **কখনো** response-এ ফেরত যায় না (শুধু masked keysSet)।
 *   ⚠️ কী পরিবর্তন লগে যায় — কিন্তু মান নয়, শুধু কোন ফিল্ড বদলাল।
 *
 *   ★ "insert keys → enable → save → active" — কোনো কোড/ডিপ্লয় বদল ছাড়াই।
 *     (লাইভ প্রসেসিং এখনো স্টাব — health = CONFIGURED_PENDING।)
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new ApiError('অবৈধ ডেটা', 400);

    const id = String((body as { id?: string }).id || '') as ProviderId;
    const provider = getProvider(id);
    if (!provider) throw new ApiError('অজানা প্রোভাইডার', 400);
    if (provider.kind === 'MANUAL') {
      throw new ApiError('ম্যানুয়াল প্রোভাইডারে কী কনফিগ লাগে না', 400);
    }

    const b = body as {
      id: string;
      keys?: Record<string, unknown>;
      mode?: string;
      enabled?: boolean;
    };

    // ★ শুধু provider.keyFields গ্রহণযোগ্য — arbitrary key নয়
    let keys: Record<string, string> | undefined;
    if (b.keys && typeof b.keys === 'object') {
      keys = {};
      for (const field of provider.keyFields) {
        if (field in b.keys) {
          const v = b.keys[field];
          // ★ masked placeholder ('••••') এলে সেটি "অপরিবর্তিত" — উপেক্ষা
          const s = typeof v === 'string' ? v : '';
          if (s.startsWith('••')) continue;
          keys[field] = s.slice(0, 500); // দৈর্ঘ্য সীমা
        }
      }
    }

    const mode = b.mode === 'live' ? 'live' : b.mode === 'test' ? 'test' : undefined;
    const enabled = typeof b.enabled === 'boolean' ? b.enabled : undefined;

    // ★ কে বদলাল তা কনফিগেই সংরক্ষিত — টাকার পথের কনফিগে
    //   "কে কখন বদলাল" না থাকাটা অডিটের ফাঁক (adminLog আলাদা, কিন্তু
    //   কনফিগ দেখেই সাথে সাথে বোঝা যাওয়া উচিত)
    await saveProviderConfig(id, { keys, mode, enabled }, { id: admin.id, name: admin.name });

    const health = await providerHealth(id);

    // ★ enable করা হয়েছে কিন্তু কী সম্পূর্ণ নয় → সতর্ক করি (কিন্তু ব্লক নয়,
    //   কারণ policy নিজেই configured না হলে auto-পথ বেছে নেয় না)
    const changedFields = keys ? Object.keys(keys).filter((k) => keys![k] !== '') : [];
    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'PAYMENT_PROVIDER_CONFIG',
      targetId: id,
      detail: [
        mode ? `mode=${mode}` : '',
        enabled !== undefined ? `enabled=${enabled ? '1' : '0'}` : '',
        changedFields.length ? `keys:[${changedFields.join(',')}]` : '',
        `health=${health.status}`,
      ].filter(Boolean).join(' · '),
      ip: getIp(req),
    }).catch(() => {});

    // ★ হালনাগাদ তালিকা (masked) — UI সাথে সাথে রিফ্রেশ হয়
    const providers = await providerInfos();
    return Response.json({ success: true, health, providers });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * ★ "Test connection" — ফল `PaymentGatewayConfig`-এ সংরক্ষিত হয়
 *   (`lastTestedAt` / `lastError`), তাই অ্যাডমিন পরে ফিরে এসেও দেখতে
 *   পান শেষবার কী হয়েছিল।
 *
 *   ⚠️ **সততা:** এটি এখনো *কাঠামোগত* পরীক্ষা — সব কী উপস্থিত কি না।
 *   কোনো লাইভ ড্রাইভার এখনো নেই, তাই বাস্তব নেটওয়ার্ক কল করার কিছু
 *   নেই। প্রোভাইডার বাস্তবায়নের সময় এখানেই আসল কল বসবে; ততদিন
 *   "সফল" মানে কেবল "কনফিগ সম্পূর্ণ", "গেটওয়ে সাড়া দিয়েছে" নয় —
 *   health বার্তাটিও ঠিক সেটিই বলে।
 */
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    const provider = getProvider(String(id || ''));
    if (!provider) throw new ApiError('অজানা প্রোভাইডার', 400);

    const health = await providerHealth(provider.id);

    if (provider.kind !== 'MANUAL') {
      // ★ ok=false হলেই ত্রুটি নয় — CONFIGURED_PENDING মানে কনফিগ
      //   ঠিক আছে, শুধু ড্রাইভার বাকি। সেটিকে "ব্যর্থ" হিসেবে
      //   সংরক্ষণ করলে অ্যাডমিন ভুল বুঝত।
      const configOk = health.status === 'CONFIGURED_PENDING';
      await recordTestResult(provider.id, {
        ok: configOk,
        error: configOk ? undefined : health.message,
      });
    }

    return Response.json({ success: true, health });
  } catch (e) {
    return apiError(e);
  }
}
