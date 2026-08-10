/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Integration Hub — সব বাহ্যিক ইন্টিগ্রেশনের একক আর্কিটেকচার।
 *
 *   Payment provider-এর মতো একই নীতি প্রতিটি ক্যাটাগরিতে: ব্যবসায়িক
 *   যুক্তি কেবল **ইন্টারফেসের** উপর নির্ভর করে (DIP), কোনো নির্দিষ্ট
 *   সার্ভিস নয়। নতুন প্রোভাইডার যোগ করা = একটি ক্লাস + registry-তে
 *   এক লাইন (Open/Closed); অ্যাডমিন থেকে চালু/বন্ধ/নির্বাচন করা যায়।
 *
 *   ⚠️ কোনো লাইভ ইন্টিগ্রেশন এখানে বাস্তবায়িত নয় — শুধু কাঠামো।
 *   builtin (email=Resend, storage, payment) বিদ্যমান কোড পুনঃব্যবহার
 *   করে; বাকিরা কাঠামোগত স্টাব যা কী/SDK যোগ করলে সক্রিয় হয়।
 * ═══════════════════════════════════════════════════════════
 */

export type IntegrationCategory =
  | 'payment' | 'fulfillment' | 'sms' | 'email'
  | 'push' | 'webhook' | 'storage' | 'ai' | 'analytics';

export type ProviderKind = 'BUILTIN' | 'MANUAL' | 'GATEWAY';

/** সব প্রোভাইডারের সাধারণ ভিত্তি */
export interface BaseProvider {
  readonly id: string;
  readonly label: string;
  readonly category: IntegrationCategory;
  readonly kind: ProviderKind;
  /** env/কী উপস্থিত — অর্থাৎ আসলেই চালানো যাবে */
  isConfigured(): boolean;
}

/** সাধারণ ফলাফল — send-জাতীয় কাজের জন্য */
export type SendResult = { status: 'SENT' | 'SKIPPED' | 'FAILED'; ref?: string; reason?: string };

// ── Fulfillment ──
/**
 * ★★★ Group G — ডেলিভারির ফলাফল।
 *
 *   ⚠️ `UNKNOWN` কেন আলাদা, `FAILED`-এর ভেতরে নয়:
 *   অনুরোধ টাইমআউট হলে আমরা জানি না প্রোভাইডার ডেলিভারি করেছে কি না।
 *   সেটিকে "ব্যর্থ" ধরে আবার চেষ্টা করলে গেমে **দুবার** ডায়মন্ড চলে
 *   যেতে পারে — আর সেই খরচ ডাটাবেস কখনো দেখতেই পায় না, ফেরতও আসে না।
 *   তাই অনিশ্চয়তা একটি **আলাদা** অবস্থা: retry নয়, মানুষের কাছে।
 *
 *   `retryable` কেবল `FAILED`-এ অর্থবহ — প্রোভাইডার স্পষ্টভাবে
 *   "হয়নি" বলেছে, তাই আবার চেষ্টা করা নিরাপদ।
 */
export type Delivery = {
  status: 'MANUAL' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';
  ref?: string;
  reason?: string;
  retryable?: boolean;
};
export type FulfillmentJob = {
  orderId: string; productName: string; variantName: string; playerUid: string; quantity: number;
};
export interface FulfillmentProvider extends BaseProvider {
  category: 'fulfillment';
  /** অর্ডার ডেলিভার করার চেষ্টা। ম্যানুয়াল → MANUAL (মানুষ ডেলিভার করবে)। */
  deliver(job: FulfillmentJob): Promise<Delivery>;
}

// ── Communication ──
export interface SmsProvider extends BaseProvider {
  category: 'sms';
  send(msg: { to: string; text: string }): Promise<SendResult>;
}
export interface EmailProvider extends BaseProvider {
  category: 'email';
  send(msg: { to: string; subject: string; html: string; text?: string }): Promise<SendResult>;
}
export interface PushProvider extends BaseProvider {
  category: 'push';
  send(msg: { to: string; title: string; body: string; link?: string }): Promise<SendResult>;
}
export interface WebhookProvider extends BaseProvider {
  category: 'webhook';
  /** বাইরের সিস্টেমে ইভেন্ট পাঠানো (outgoing) */
  dispatch(event: string, payload: unknown): Promise<SendResult>;
}

// ── AI / Analytics ──
export interface AiProvider extends BaseProvider {
  category: 'ai';
  complete(prompt: string): Promise<{ text: string }>;
}
export interface AnalyticsProvider extends BaseProvider {
  category: 'analytics';
  track(event: string, props?: Record<string, unknown>): Promise<void>;
}

/** Storage ও Payment-এর নিজস্ব বিস্তারিত ইন্টারফেস আছে (lib/storage, lib/payments);
 *  এখানে সেগুলো ক্যাটালগে দেখানোর জন্য BaseProvider হিসেবেই ধরা হয়। */

/** অ্যাডমিন-UI / সার্ভার→ক্লায়েন্ট: serializable রূপ */
export type ProviderInfo = {
  category: IntegrationCategory;
  id: string;
  label: string;
  kind: ProviderKind;
  configured: boolean;
  enabled: boolean;
  active: boolean;
  note?: string;
};
