import type { PaymentProvider, ProviderId } from './types';
import { manualProvider } from './providers/manual';
import { gatewayStub } from './providers/gatewayStub';
import { getSetting } from '../settings';
import { prisma } from '../prisma';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ Provider registry — একমাত্র জায়গা যেখানে concrete প্রোভাইডার
 *   তালিকাভুক্ত হয়। নতুন গেটওয়ে যোগ করা = এখানে এক লাইন (Open/Closed);
 *   অ্যাডমিন থেকে চালু/বন্ধ করা যায় (`provider_<id>_enabled` সেটিং)।
 *
 *   ⚠️ ম্যানুয়াল ছাড়া সব গেটওয়ে এখন স্টাব — configured=false (env নেই),
 *   তাই enable করলেও fulfillment policy এগুলোকে অটো-পথে বেছে নেবে না।
 * ═══════════════════════════════════════════════════════════
 */
const PROVIDERS: PaymentProvider[] = [
  manualProvider(),
  gatewayStub({ id: 'bkash', label: 'bKash API', caps: { autoVerify: true, autoRefund: true, hostedCheckout: true }, envKeys: ['BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_USERNAME', 'BKASH_PASSWORD'] }),
  gatewayStub({ id: 'nagad', label: 'Nagad API', caps: { autoVerify: true, autoRefund: false, hostedCheckout: true }, envKeys: ['NAGAD_MERCHANT_ID', 'NAGAD_PRIVATE_KEY'] }),
  gatewayStub({ id: 'rocket', label: 'Rocket API', caps: { autoVerify: true, autoRefund: false, hostedCheckout: true }, envKeys: ['ROCKET_MERCHANT_ID', 'ROCKET_API_KEY'] }),
  gatewayStub({ id: 'sslcommerz', label: 'SSLCommerz', caps: { autoVerify: true, autoRefund: true, hostedCheckout: true }, envKeys: ['SSLCZ_STORE_ID', 'SSLCZ_STORE_PASSWD'] }),
  gatewayStub({ id: 'stripe', label: 'Stripe', caps: { autoVerify: true, autoRefund: true, hostedCheckout: true }, envKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] }),
  gatewayStub({ id: 'paypal', label: 'PayPal', caps: { autoVerify: true, autoRefund: true, hostedCheckout: true }, envKeys: ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET'] }),
  gatewayStub({ id: 'razorpay', label: 'Razorpay', caps: { autoVerify: true, autoRefund: true, hostedCheckout: true }, envKeys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] }),
];

export const DEFAULT_PROVIDER: ProviderId = 'manual';

export function allProviders(): PaymentProvider[] {
  return PROVIDERS;
}

export function getProvider(id: ProviderId | string | undefined): PaymentProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * ★ manual ডিফল্টে চালু; বাকিরা ডিফল্টে বন্ধ।
 *
 *   উৎস: `PaymentGatewayConfig` → না থাকলে পুরনো
 *   `provider_<id>_enabled` সেটিং (পিছন-সঙ্গতি)।
 *
 *   ⚠️ `config.ts` ইচ্ছাকৃতভাবে import করা হয়নি — `config.ts` নিজে
 *   এই ফাইল থেকে import করে, তাই circular হতো। টেবিলটি সরাসরি পড়া
 *   সস্তা ও নির্ভরতাটি একমুখী রাখে।
 */
async function isEnabled(id: ProviderId): Promise<boolean> {
  const row = await prisma.paymentGatewayConfig.findUnique({
    where: { provider: id },
    select: { isEnabled: true },
  });
  if (row) return row.isEnabled;
  return (await getSetting(`provider_${id}_enabled`, id === 'manual' ? '1' : '0')) === '1';
}

export async function isProviderEnabled(id: ProviderId | string): Promise<boolean> {
  return isEnabled(id as ProviderId);
}

/** অ্যাডমিন-চালু প্রোভাইডারগুলো */
export async function enabledProviders(): Promise<PaymentProvider[]> {
  // ★ এক কোয়েরিতে সব সারি — আগে প্রোভাইডার-প্রতি একটি করে যেত
  const rows = await prisma.paymentGatewayConfig.findMany({
    select: { provider: true, isEnabled: true },
  });
  const byId = new Map(rows.map((r) => [r.provider, r.isEnabled]));

  const flags = await Promise.all(
    PROVIDERS.map(async (p) => (byId.has(p.id) ? byId.get(p.id)! : isEnabled(p.id))),
  );
  return PROVIDERS.filter((_, i) => flags[i]);
}

// ★ serializable `providerInfos()` (কী/মোড/health সহ) `config.ts`-এ আছে —
//   সেটি DB-কনফিগ পড়ে, তাই একমুখী নির্ভরতা (config → registry) রাখতে
//   এখান থেকে সরানো হয়েছে (circular import এড়াতে)।
