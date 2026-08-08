/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Payment Provider abstraction (SOLID)
 *
 *   ব্যবসায়িক যুক্তি (ডিপোজিট/অর্ডার/রিফান্ড) কোনো নির্দিষ্ট গেটওয়ের
 *   উপর নির্ভর করবে না — শুধু এই `PaymentProvider` ইন্টারফেসের উপর
 *   (Dependency Inversion)। নতুন গেটওয়ে যোগ করা মানে একটি প্রোভাইডার
 *   ক্লাস লেখা + registry-তে এক লাইন — মূল কোড অপরিবর্তিত (Open/Closed)।
 *
 *   ⚠️ বর্তমান মডেল সম্পূর্ণ ম্যানুয়াল (মানুষ ব্যাংক-অ্যাপে মিলিয়ে
 *   অনুমোদন করেন)। এই স্তর সেই বাস্তবতাকেই **আনুষ্ঠানিক রূপ** দেয়;
 *   অটোমেটিক গেটওয়ে এখনো বাস্তবায়িত নয় (কেবল কাঠামো প্রস্তুত)।
 * ═══════════════════════════════════════════════════════════
 */

export type ProviderId =
  | 'manual'
  | 'bkash' | 'nagad' | 'rocket'
  | 'sslcommerz' | 'stripe' | 'paypal' | 'razorpay';

/** ইন্টারফেস-সেগ্রিগেশন: প্রোভাইডার শুধু যা পারে তা-ই ঘোষণা করে */
export type ProviderCapabilities = {
  /** সার্ভার-সাইড স্বয়ংক্রিয় পেমেন্ট যাচাই (API/webhook) */
  autoVerify: boolean;
  /** প্রোগ্রাম্যাটিক রিফান্ড (API) */
  autoRefund: boolean;
  /** প্রোভাইডার-হোস্টেড চেকআউট পেজে রিডাইরেক্ট */
  hostedCheckout: boolean;
};

export type PaymentIntent = {
  userId: string;
  /** ডিপোজিট নং / অর্ডার নং — idempotency ও reconciliation-এর জন্য */
  reference: string;
  amount: number;
  currency: 'BDT';
  /** ম্যানুয়াল সাব-মেথড (BKASH/NAGAD/ROCKET/UPAY) */
  method?: string;
  /** ম্যানুয়াল: গ্রাহকের দেওয়া TrxID ও সেন্ডার নম্বর */
  customerTrxId?: string;
  senderNo?: string;
};

export type VerifyOutcome =
  | { status: 'PENDING_MANUAL' }                                   // মানুষের যাচাই দরকার
  | { status: 'VERIFIED'; providerRef: string; amount: number }    // গেটওয়ে নিশ্চিত করেছে
  | { status: 'FAILED'; reason: string };

export type RefundOutcome =
  | { status: 'MANUAL' }                                           // হাতে ফেরত দিতে হবে
  | { status: 'REFUNDED'; providerRef: string }
  | { status: 'FAILED'; reason: string };

/**
 * ★★★ Webhook ইভেন্ট (Phase 4 — webhook-ready design)
 *
 *   গেটওয়ে (Stripe/SSLCommerz/bKash) পেমেন্ট নিশ্চিত হলে সার্ভারে
 *   একটি POST পাঠায়। প্রতিটি প্রোভাইডার নিজের raw payload পার্স করে
 *   এই সাধারণ রূপে আনে — তারপর একটিই receiver সব প্রোভাইডার সামলায়।
 *
 *   ⚠️ সততা: এখনো কোনো লাইভ গেটওয়ে নেই, তাই `parseWebhook` ঐচ্ছিক ও
 *      সব provider-এ এখন unimplemented (verify()/refund() এর মতোই)।
 *      কাঠামো প্রস্তুত — গেটওয়ে যোগ করার সময় শুধু এই method পূরণ।
 */
export type WebhookEvent =
  /** পেমেন্ট সফল — reference (deposit/order নং) ও providerRef সহ */
  | { type: 'PAYMENT_SUCCEEDED'; reference: string; providerRef: string; amount: number }
  /** পেমেন্ট ব্যর্থ/বাতিল */
  | { type: 'PAYMENT_FAILED'; reference: string; reason: string }
  /** রিফান্ড নিশ্চিত */
  | { type: 'REFUND_SUCCEEDED'; reference: string; providerRef: string; amount: number }
  /** অপ্রাসঙ্গিক/উপেক্ষণীয় ইভেন্ট (গেটওয়ে অনেক ধরনের পাঠায়) */
  | { type: 'IGNORED' };

/** webhook পার্স/যাচাইয়ের ফল */
export type WebhookParseResult =
  | { ok: true; event: WebhookEvent; /** idempotency key — একই ইভেন্ট দুবার এলে ধরার জন্য */ eventId: string }
  | { ok: false; reason: string; /** signature ভুল হলে 401, নাহলে 400 */ unauthorized?: boolean };

/** webhook receiver যা প্রোভাইডারকে দেয় */
export type WebhookRequest = {
  rawBody: string;
  headers: Record<string, string>;
};

/**
 * ★ একমাত্র চুক্তি যার উপর ব্যবসায়িক যুক্তি নির্ভর করে।
 *   ম্যানুয়াল হোক বা ভবিষ্যতের bKash/Stripe — সবাই এটি বাস্তবায়ন করে।
 */
export interface PaymentProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: 'MANUAL' | 'GATEWAY';
  readonly capabilities: ProviderCapabilities;
  /** এই গেটওয়ে চালাতে যে কী/সিক্রেটগুলো লাগে (অ্যাডমিন-UI এগুলোর ফর্ম বানায়) */
  readonly keyFields: readonly string[];
  /** env-কী উপস্থিত (sync, backward-compat)। DB-স্টোরড কী যাচাইয়ের জন্য
   *  `configuredAsync()` (config.ts) ব্যবহার করুন। */
  isConfigured(): boolean;
  /** পেমেন্ট যাচাই/রেকর্ড। ম্যানুয়াল → PENDING_MANUAL। */
  verify(intent: PaymentIntent): Promise<VerifyOutcome>;
  /** রিফান্ড। ম্যানুয়াল → MANUAL (বিদ্যমান হাতে-ফেরত প্রবাহ)। */
  refund(args: { providerRef: string; amount: number; reason: string }): Promise<RefundOutcome>;
  /**
   * ★ Webhook পার্স ও signature যাচাই (ঐচ্ছিক — শুধু autoVerify গেটওয়ে দেয়)।
   *   প্রোভাইডার raw payload যাচাই করে সাধারণ WebhookEvent-এ রূপান্তর করে।
   *   না থাকলে receiver 501 (Not Implemented) ফেরত দেয়।
   *   ⚠️ অবশ্যই signature যাচাই করতে হবে — নাহলে যে কেউ ভুয়া "payment
   *      succeeded" পাঠিয়ে ফ্রি টপ-আপ নিতে পারবে।
   */
  parseWebhook?(req: WebhookRequest): Promise<WebhookParseResult>;
}

/** টেস্ট বনাম লাইভ পরিবেশ */
export type ProviderMode = 'test' | 'live';

/**
 * ★ প্রোভাইডারের স্বাস্থ্য/সংযোগ অবস্থা — অ্যাডমিন এক নজরে বোঝে
 *   প্রোভাইডারটি এখন কী অবস্থায় আছে।
 *
 *   ⚠️ সততা: লাইভ পেমেন্ট প্রসেসিং এখনো বাস্তবায়িত নয়। কী সংরক্ষণ করা
 *   থাকলেও `live` সবসময় false — কারণ verify()/refund() এখনো স্টাব।
 *   তাই কনফিগ সম্পূর্ণ হলেও অবস্থা "CONFIGURED_PENDING": কাঠামো প্রস্তুত,
 *   ড্রাইভার বাকি। এটি ভুলবশত টাকা নড়া ঠেকায়।
 */
export type ProviderHealth = {
  status: 'MANUAL_READY' | 'NO_KEYS' | 'PARTIAL_KEYS' | 'CONFIGURED_PENDING';
  /** এখনই বাস্তব পেমেন্ট নিতে ব্যবহারযোগ্য? (ম্যানুয়াল ছাড়া সব false) */
  ok: boolean;
  /** লাইভ ড্রাইভার বাস্তবায়িত? (সব গেটওয়ে স্টাব → false) */
  live: boolean;
  message: string;
};

/** ক্লায়েন্ট/অ্যাডমিন-UI তে পাঠানোর জন্য serializable রূপ (ফাংশন ছাড়া) */
export type ProviderInfo = {
  id: ProviderId;
  label: string;
  kind: 'MANUAL' | 'GATEWAY';
  capabilities: ProviderCapabilities;
  /** env বা DB — যেকোনোভাবে কী সম্পূর্ণ উপস্থিত */
  configured: boolean;
  enabled: boolean;
  mode: ProviderMode;
  keyFields: readonly string[];
  /** প্রতিটি কী সেট করা আছে কি না — মান কখনো ক্লায়েন্টে যায় না (masked) */
  keysSet: Record<string, boolean>;
  /** env থেকে আসা কী (DB-তে ওভাররাইড করা যায় না, শুধু তথ্য) */
  envKeys: string[];
  health: ProviderHealth;
  /** শেষ "Test connection" — ISO string (serializable), কখনো না চললে null */
  lastTestedAt: string | null;
  /** শেষ ত্রুটি — ক্রেডেনশিয়াল মুছে (masked) সংরক্ষিত */
  lastError: string | null;
  /** কে শেষবার কনফিগ বদলেছে (অডিট) */
  updatedByName: string | null;
};
