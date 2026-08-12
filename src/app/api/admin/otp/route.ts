import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { invalidateSettings } from '@/lib/settings';
import { encryptSecret } from '@/lib/secretbox';
import { OTP_KEYS, getOtpConfig, type SignupChannel } from '@/lib/otp/settings';
import { SMS_PROVIDERS, readSmsCredentials, getSmsProvider } from '@/lib/sms';
import { isEmailConfigured } from '@/lib/email';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — OTP চ্যানেল ব্যবস্থাপনা (অ্যাডমিন-only)
 *
 *   GET   — বর্তমান কনফিগ + প্রতিটি চ্যানেলের স্বাস্থ্য
 *   POST  — টগল, সাইনআপ-চ্যানেল, SMS প্রোভাইডার ও ক্রেডেনশিয়াল
 *   PUT   — "Test connection" (আসল কল, ফল সংরক্ষিত)
 *
 *   Group E এর গেটওয়ে-প্যাটার্ন হুবহু অনুসরণ করা হয়েছে:
 *   ⚠️ ক্রেডেনশিয়াল **কখনো** উত্তরে ফেরত যায় না — কেবল "সেট আছে কি না"
 *   ⚠️ masked placeholder (`••`) এলে সেটি "অপরিবর্তিত", উপেক্ষিত
 *   ⚠️ at rest এনক্রিপ্টেড — বিদ্যমান `secretbox` স্কিম, নতুন কী নয়
 *   ⚠️ অ্যাডমিন-লগে **কোন ফিল্ড** বদলাল তা যায়, মান কখনো নয়
 * ═══════════════════════════════════════════════════════════
 */

/** ★ শুধু জানা কী — arbitrary নয় */
async function writeSettings(pairs: Record<string, string>) {
  await prisma.$transaction(
    Object.entries(pairs).map(([key, value]) =>
      prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } }),
    ),
  );
  invalidateSettings();
}

async function snapshot() {
  const cfg = await getOtpConfig();
  const creds = await readSmsCredentials();
  const meta = SMS_PROVIDERS.find((p) => p.id === cfg.smsProvider);

  return {
    config: cfg,
    channels: {
      email: {
        enabled: cfg.emailEnabled,
        // ★ চালু থাকা আর **পাঠাতে পারা** এক নয় — দুটোই দেখাই
        configured: isEmailConfigured(),
      },
      sms: {
        enabled: cfg.smsEnabled,
        provider: cfg.smsProvider,
        implemented: meta?.implemented ?? false,
        // ⚠️ কেবল কোন ফিল্ড সেট আছে — মান নয়
        keysSet: (meta?.fields ?? []).map((f) => ({ key: f.key, set: Boolean(creds[f.key]) })),
      },
    },
    providers: SMS_PROVIDERS,
  };
}

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await snapshot());
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await req.json().catch(() => null)) as {
      emailEnabled?: boolean;
      smsEnabled?: boolean;
      signupChannel?: string;
      requireAtSignup?: boolean;
      requireAtDeposit?: boolean;
      requireAtOrder?: boolean;
      smsProvider?: string;
      credentials?: Record<string, unknown>;
    } | null;
    if (!body || typeof body !== 'object') throw new ApiError('অবৈধ ডেটা', 400);

    const pairs: Record<string, string> = {};
    const changed: string[] = [];

    const bool = (k: keyof typeof body, setting: string) => {
      if (typeof body[k] === 'boolean') {
        pairs[setting] = body[k] ? '1' : '0';
        changed.push(String(k));
      }
    };
    bool('emailEnabled', OTP_KEYS.emailEnabled);
    bool('smsEnabled', OTP_KEYS.smsEnabled);
    bool('requireAtSignup', OTP_KEYS.requireAtSignup);
    bool('requireAtDeposit', OTP_KEYS.requireAtDeposit);
    bool('requireAtOrder', OTP_KEYS.requireAtOrder);

    if (typeof body.signupChannel === 'string') {
      const v = body.signupChannel.toLowerCase() as SignupChannel;
      if (!['email', 'sms', 'either', 'both'].includes(v)) {
        throw new ApiError('অজানা চ্যানেল', 400);
      }
      pairs[OTP_KEYS.signupChannel] = v;
      changed.push('signupChannel');
    }

    if (typeof body.smsProvider === 'string') {
      const id = body.smsProvider;
      if (id && !SMS_PROVIDERS.some((p) => p.id === id)) {
        throw new ApiError('অজানা SMS প্রোভাইডার', 400);
      }
      pairs[OTP_KEYS.smsProvider] = id;
      changed.push('smsProvider');
    }

    // ── ক্রেডেনশিয়াল — merge, তারপর এনক্রিপ্ট ──
    if (body.credentials && typeof body.credentials === 'object') {
      const providerId = body.smsProvider ?? (await getOtpConfig()).smsProvider;
      const meta = SMS_PROVIDERS.find((p) => p.id === providerId);
      if (!meta) throw new ApiError('আগে একটি SMS প্রোভাইডার বেছে নিন', 400);

      const current = await readSmsCredentials();
      const next: Record<string, string> = { ...current };
      const touched: string[] = [];

      for (const field of meta.fields) {
        if (!(field.key in body.credentials)) continue;
        const raw = body.credentials[field.key];
        const s = typeof raw === 'string' ? raw : '';
        // ★ masked placeholder = "অপরিবর্তিত"
        if (s.startsWith('••')) continue;
        next[field.key] = s.slice(0, 500);
        touched.push(field.key);
      }

      if (touched.length) {
        // ⚠️ at rest এনক্রিপ্টেড — প্লেইনটেক্সট কখনো Setting-এ নয়
        pairs[OTP_KEYS.smsCredentials] = encryptSecret(JSON.stringify(next));
        changed.push(`credentials(${touched.join(',')})`);
      }
    }

    if (Object.keys(pairs).length === 0) throw new ApiError('কিছুই বদলানো হয়নি', 400);
    await writeSettings(pairs);

    // ⚠️ কোন ফিল্ড বদলাল তা লগে যায় — **মান কখনো নয়**
    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      // ★ নতুন AdminAction যোগ করিনি — এটি প্রকৃতপক্ষেই সেটিংস-পরিবর্তন,
      //   আর `detail`-এ উপসর্গ থাকায় ফিল্টার করাও সহজ
      action: 'SETTINGS_CHANGE',
      detail: `OTP: ${changed.join(' · ')}`,
    }).catch(() => {});

    return Response.json(await snapshot());
  } catch (e) {
    return apiError(e);
  }
}

/**
 * ★ "Test connection" — আসল কল করে, ফল সংরক্ষণ করে।
 *
 *   ⚠️ বাস্তবায়িত নয় এমন প্রোভাইডারে এটি **স্পষ্ট ব্যর্থতা** ফেরে।
 *   "কাজ করছে" বলে ভুল আশ্বাস দেওয়ার চেয়ে সেটি ভালো।
 */
export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as { to?: string } | null;
    const to = (body?.to || '').trim();
    if (!/^(?:\+?880)?01[3-9]\d{8}$/.test(to.replace(/[\s-]/g, ''))) {
      throw new ApiError('পরীক্ষার জন্য একটি বৈধ মোবাইল নাম্বার দিন', 400);
    }

    const provider = await getSmsProvider();
    if (!provider) {
      throw new ApiError('SMS চ্যানেল চালু নেই — আগে চালু করে সেভ করুন', 400);
    }

    const r = await provider.send({ to, text: 'UID TopUp — সংযোগ পরীক্ষা।' });
    await writeSettings({
      [`${OTP_KEYS.smsProvider}_last_test`]: JSON.stringify({
        at: new Date().toISOString(),
        status: r.status,
        reason: r.reason ?? null,
      }),
    });

    return Response.json({ status: r.status, reason: r.reason ?? null });
  } catch (e) {
    return apiError(e);
  }
}
