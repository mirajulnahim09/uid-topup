import type { PaymentProvider, ProviderId, ProviderCapabilities } from '../types';

/**
 * ★ ভবিষ্যৎ গেটওয়ে — কাঠামোগতভাবে প্রস্তুত স্টাব।
 *
 *   env-কী উপস্থিত থাকলে `isConfigured()` true হয়। প্রকৃত ইন্টিগ্রেশন
 *   করতে হলে শুধু `verify()`/`refund()` এর ভেতরটা SDK দিয়ে পূরণ করুন —
 *   বাকি অ্যাপের কোনো কোড বদলাবে না (Open/Closed)।
 *
 *   ⚠️ কনফিগার্ড না হওয়া পর্যন্ত (বা বাস্তবায়নের আগে) verify/refund
 *   ডাকলে পরিষ্কার বার্তায় থামে — তাই ভুলবশত অসম্পূর্ণ গেটওয়ে চালু
 *   হয়ে টাকা নড়ার কোনো পথ নেই। fulfillment policy এগুলোকে কেবল
 *   তখনই বেছে নেয় যখন capability + configured দুটোই সত্য।
 */
export function gatewayStub(opts: {
  id: ProviderId;
  label: string;
  caps: ProviderCapabilities;
  envKeys: string[];
}): PaymentProvider {
  const notReady = (): never => {
    throw new Error(`${opts.label}: গেটওয়ে ড্রাইভার প্রস্তুত কিন্তু নিষ্ক্রিয় — SDK ও API-কী যোগ করে verify()/refund() বাস্তবায়ন করুন।`);
  };
  return {
    id: opts.id,
    label: opts.label,
    kind: 'GATEWAY',
    capabilities: opts.caps,
    keyFields: opts.envKeys,
    // ★ sync env-চেক (backward-compat)। DB-স্টোরড কী config.ts এর
    //   `configuredAsync()` যাচাই করে — অ্যাডমিন env ছাড়াই কী বসাতে পারে।
    isConfigured: () => opts.envKeys.length > 0 && opts.envKeys.every((k) => Boolean(process.env[k])),
    async verify() { return notReady(); },
    async refund() { return notReady(); },
  };
}
