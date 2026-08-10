import { getSetting } from '../settings';
import { isEmailConfigured, sendEmail } from '../email';
import { providerInfos as paymentInfos } from '../payments/config';
import { httpFulfillment } from '../fulfillment/httpProvider';
import type {
  BaseProvider, IntegrationCategory, ProviderInfo, ProviderKind,
  FulfillmentProvider, Delivery, SmsProvider, EmailProvider,
  PushProvider, WebhookProvider, AiProvider, AnalyticsProvider, SendResult,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Integration Hub — সব ক্যাটাগরির প্রোভাইডার এখানে তালিকাভুক্ত।
 *   নতুন প্রোভাইডার যোগ = নিচের তালিকায় এক লাইন (Open/Closed)।
 *   ব্যবসায়িক যুক্তি accessor (email()/sms()/fulfillment()…) দিয়ে
 *   **active** প্রোভাইডার পায় — কোনো concrete সার্ভিসের নাম জানে না।
 * ═══════════════════════════════════════════════════════════
 */

const envOk = (keys: string[]) => () => keys.length > 0 && keys.every((k) => Boolean(process.env[k]));
const always = () => true;
function notReady(label: string): never {
  throw new Error(`${label}: ইন্টিগ্রেশন প্রস্তুত কিন্তু নিষ্ক্রিয় — SDK ও API-কী যোগ করে বাস্তবায়ন করুন।`);
}

// ─────────── Fulfillment ───────────
const manualFulfillment: FulfillmentProvider = {
  id: 'manual', label: 'ম্যানুয়াল ডেলিভারি', category: 'fulfillment', kind: 'MANUAL',
  isConfigured: always,
  async deliver(): Promise<Delivery> { return { status: 'MANUAL' }; }, // মানুষ গেমে ডেলিভার করে
};
const fulfillmentStub = (id: string, label: string, keys: string[]): FulfillmentProvider => ({
  id, label, category: 'fulfillment', kind: 'GATEWAY', isConfigured: envOk(keys),
  async deliver(): Promise<Delivery> { return notReady(label); },
});
const FULFILLMENT: FulfillmentProvider[] = [
  manualFulfillment,
  // ★ Group G — এটি আর স্টাব নয়, আসল HTTP অ্যাডাপ্টার (retry/timeout/
  //   idempotency সহ)। env দুটি না থাকলে `isConfigured()` false, তাই
  //   hub একে কখনো active করে না — আচরণ আগের মতোই ম্যানুয়াল।
  httpFulfillment,
  fulfillmentStub('third-party', 'থার্ড-পার্টি API', ['THIRDPARTY_FULFILL_URL', 'THIRDPARTY_FULFILL_KEY']),
  fulfillmentStub('internal-auto', 'ইন্টারনাল অটোমেশন', ['INTERNAL_AUTOMATION_URL']),
  fulfillmentStub('hybrid', 'হাইব্রিড (ম্যানুয়াল + অটো)', ['HYBRID_FULFILL_ENABLED']),
];

// ─────────── Email ───────────
const resendEmail: EmailProvider = {
  id: 'resend', label: 'Resend', category: 'email', kind: 'BUILTIN',
  isConfigured: isEmailConfigured,
  async send(m): Promise<SendResult> {
    if (!isEmailConfigured()) return { status: 'SKIPPED', reason: 'RESEND_API_KEY নেই' };
    await sendEmail(m.to, m.subject, m.html);
    return { status: 'SENT' };
  },
};
const emailStub = (id: string, label: string, keys: string[]): EmailProvider => ({
  id, label, category: 'email', kind: 'GATEWAY', isConfigured: envOk(keys),
  async send(): Promise<SendResult> { return notReady(label); },
});
const EMAIL: EmailProvider[] = [
  resendEmail,
  emailStub('smtp', 'SMTP', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']),
  emailStub('sendgrid', 'SendGrid', ['SENDGRID_API_KEY']),
  emailStub('mailgun', 'Mailgun', ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN']),
  emailStub('ses', 'Amazon SES', ['AWS_SES_ACCESS_KEY', 'AWS_SES_SECRET_KEY', 'AWS_SES_REGION']),
];

// ─────────── SMS ───────────
const smsStub = (id: string, label: string, keys: string[]): SmsProvider => ({
  id, label, category: 'sms', kind: 'GATEWAY', isConfigured: envOk(keys),
  async send(): Promise<SendResult> { return notReady(label); },
});
const SMS: SmsProvider[] = [
  smsStub('twilio', 'Twilio', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']),
  smsStub('bkash-sms', 'bKash SMS', ['BKASH_SMS_URL', 'BKASH_SMS_KEY']),
  smsStub('custom', 'Custom SMS Gateway', ['SMS_GATEWAY_URL', 'SMS_GATEWAY_KEY']),
];

// ─────────── Push ───────────
const pushStub = (id: string, label: string, keys: string[]): PushProvider => ({
  id, label, category: 'push', kind: 'GATEWAY', isConfigured: envOk(keys),
  async send(): Promise<SendResult> { return notReady(label); },
});
const PUSH: PushProvider[] = [
  pushStub('fcm', 'Firebase Cloud Messaging', ['FCM_SERVER_KEY']),
  pushStub('onesignal', 'OneSignal', ['ONESIGNAL_APP_ID', 'ONESIGNAL_API_KEY']),
];

// ─────────── Webhook ───────────
const webhookStub = (id: string, label: string, keys: string[]): WebhookProvider => ({
  id, label, category: 'webhook', kind: 'GATEWAY', isConfigured: envOk(keys),
  async dispatch(): Promise<SendResult> { return notReady(label); },
});
const WEBHOOK: WebhookProvider[] = [
  webhookStub('outgoing', 'Outgoing Webhooks', ['WEBHOOK_OUT_URL']),
  webhookStub('incoming', 'Incoming Webhooks', ['WEBHOOK_IN_SECRET']),
];

// ─────────── AI ───────────
const aiStub = (id: string, label: string, keys: string[]): AiProvider => ({
  id, label, category: 'ai', kind: 'GATEWAY', isConfigured: envOk(keys),
  async complete(): Promise<{ text: string }> { return notReady(label); },
});
const AI: AiProvider[] = [
  aiStub('anthropic', 'Anthropic Claude', ['ANTHROPIC_API_KEY']),
  aiStub('openai', 'OpenAI', ['OPENAI_API_KEY']),
];

// ─────────── Analytics ───────────
const analyticsStub = (id: string, label: string, keys: string[]): AnalyticsProvider => ({
  id, label, category: 'analytics', kind: 'GATEWAY', isConfigured: envOk(keys),
  async track(): Promise<void> { /* stub — no-op until wired */ },
});
const ANALYTICS: AnalyticsProvider[] = [
  analyticsStub('plausible', 'Plausible', ['PLAUSIBLE_DOMAIN']),
  analyticsStub('ga', 'Google Analytics', ['GA_MEASUREMENT_ID']),
  analyticsStub('posthog', 'PostHog', ['POSTHOG_KEY']),
];

// ─────────── registry map (hub-managed categories) ───────────
const REGISTRY: Record<string, BaseProvider[]> = {
  fulfillment: FULFILLMENT, email: EMAIL, sms: SMS,
  push: PUSH, webhook: WEBHOOK, ai: AI, analytics: ANALYTICS,
};

/** ক্যাটাগরির ডিফল্ট (active) builtin — না থাকলে '' */
const BUILTIN: Partial<Record<IntegrationCategory, string>> = { fulfillment: 'manual', email: 'resend' };

async function isEnabled(cat: string, id: string): Promise<boolean> {
  const def = BUILTIN[cat as IntegrationCategory] === id ? '1' : '0';
  return (await getSetting(`integration_${cat}_${id}_enabled`, def)) === '1';
}
async function activeId(cat: string): Promise<string> {
  return getSetting(`integration_${cat}_active`, BUILTIN[cat as IntegrationCategory] || '');
}

/** ★ accessor — active প্রোভাইডার (enabled + configured), নাহলে builtin fallback, নাহলে null।
 *  ব্যবসায়িক যুক্তি এটিই ব্যবহার করবে — concrete provider জানার দরকার নেই (DIP)। */
async function resolve<T extends BaseProvider>(cat: string): Promise<T | null> {
  const list = REGISTRY[cat] as T[] | undefined;
  if (!list) return null;
  const active = await activeId(cat);
  const chosen = list.find((p) => p.id === active);
  if (chosen && (await isEnabled(cat, chosen.id)) && chosen.isConfigured()) return chosen;
  const builtinId = BUILTIN[cat as IntegrationCategory];
  const builtin = builtinId ? list.find((p) => p.id === builtinId) : undefined;
  if (builtin && (await isEnabled(cat, builtin.id)) && builtin.isConfigured()) return builtin;
  return null;
}

// ── typed accessors (business logic uses these) ──
export const hub = {
  fulfillment: () => resolve<FulfillmentProvider>('fulfillment'),
  email: () => resolve<EmailProvider>('email'),
  sms: () => resolve<SmsProvider>('sms'),
  push: () => resolve<PushProvider>('push'),
  webhookOut: () => resolve<WebhookProvider>('webhook'),
  ai: () => resolve<AiProvider>('ai'),
  analytics: () => resolve<AnalyticsProvider>('analytics'),
};

// ── admin catalog (all categories, serializable) ──
async function catInfos(cat: string, list: BaseProvider[]): Promise<ProviderInfo[]> {
  const active = await activeId(cat);
  const out: ProviderInfo[] = [];
  for (const p of list) {
    out.push({
      category: cat as IntegrationCategory, id: p.id, label: p.label, kind: p.kind,
      configured: p.isConfigured(), enabled: await isEnabled(cat, p.id), active: active === p.id,
    });
  }
  return out;
}

/** payment (payments registry) → unified ProviderInfo (managed at /admin/payments) */
async function paymentCatalog(): Promise<ProviderInfo[]> {
  const infos = await paymentInfos();
  return infos.map((p) => ({
    category: 'payment' as const, id: p.id, label: p.label,
    kind: (p.kind === 'MANUAL' ? 'MANUAL' : 'GATEWAY') as ProviderKind,
    configured: p.configured, enabled: p.enabled, active: false, note: '/admin/payments-এ পরিচালিত',
  }));
}

/** storage (lib/storage) → unified ProviderInfo (STORAGE_DRIVER env দিয়ে সেট) */
function storageCatalog(): ProviderInfo[] {
  const driver = (process.env.STORAGE_DRIVER || (process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local')).toLowerCase();
  const s3ok = Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
  const items = [
    { id: 'local', label: 'Local Disk', configured: true },
    { id: 'blob', label: 'Vercel Blob', configured: Boolean(process.env.BLOB_READ_WRITE_TOKEN) },
    { id: 's3', label: 'Amazon S3', configured: s3ok },
    { id: 'r2', label: 'Cloudflare R2', configured: s3ok },
  ];
  return items.map((s) => ({
    category: 'storage' as const, id: s.id, label: s.label, kind: 'GATEWAY' as ProviderKind,
    configured: s.configured, enabled: driver === s.id, active: driver === s.id, note: 'STORAGE_DRIVER env',
  }));
}

/** পুরো প্ল্যাটফর্মের সব ইন্টিগ্রেশন — অ্যাডমিন UI-এর জন্য */
export async function allProviderInfos(): Promise<ProviderInfo[]> {
  const managed = await Promise.all(Object.entries(REGISTRY).map(([cat, list]) => catInfos(cat, list)));
  const [pay] = await Promise.all([paymentCatalog()]);
  return [...pay, ...managed.flat(), ...storageCatalog()];
}

/** hub পরিচালিত ক্যাটাগরিগুলো (payment/storage আলাদা জায়গায় পরিচালিত) */
export const MANAGED_CATEGORIES: IntegrationCategory[] = ['fulfillment', 'email', 'sms', 'push', 'webhook', 'ai', 'analytics'];
