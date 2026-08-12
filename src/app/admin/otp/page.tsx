import type { Metadata } from 'next';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import OtpSettings, { type OtpSnapshot } from '@/components/admin/OtpSettings';
import { getOtpConfig } from '@/lib/otp/settings';
import { SMS_PROVIDERS, readSmsCredentials } from '@/lib/sms';
import { isEmailConfigured } from '@/lib/email';

export const metadata: Metadata = { title: 'যাচাই কোড (OTP)' };
export const dynamic = 'force-dynamic';

/**
 * ★ /admin/otp — Group I (৩)
 *
 *   ⚠️ প্রাথমিক অবস্থা সার্ভারেই তৈরি হয় (API রাউন্ড-ট্রিপ ছাড়া), কিন্তু
 *   **ক্রেডেনশিয়ালের মান কখনো ক্লায়েন্টে যায় না** — কেবল "সেট আছে
 *   কি না"। এটি `/api/admin/otp` এর GET-এর হুবহু একই আকার।
 */
export default async function AdminOtpPage() {
  const [cfg, creds] = await Promise.all([getOtpConfig(), readSmsCredentials()]);
  const meta = SMS_PROVIDERS.find((p) => p.id === cfg.smsProvider);

  const initial: OtpSnapshot = {
    config: cfg,
    channels: {
      email: { enabled: cfg.emailEnabled, configured: isEmailConfigured() },
      sms: {
        enabled: cfg.smsEnabled,
        provider: cfg.smsProvider,
        implemented: meta?.implemented ?? false,
        keysSet: (meta?.fields ?? []).map((f) => ({ key: f.key, set: Boolean(creds[f.key]) })),
      },
    },
    providers: SMS_PROVIDERS,
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="যাচাই কোড (OTP)"
        subtitle="একই কোড-ব্যবস্থা, দুটি মাধ্যম — ইমেইল ও SMS। নতুন গেটওয়ে যোগ করতে কোড বদলাতে হয় না; প্রোভাইডার বেছে কী বসিয়ে চালু করলেই হবে।"
      />
      <OtpSettings initial={initial} />
    </div>
  );
}
