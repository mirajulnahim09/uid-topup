import type { Metadata } from 'next';
import FulfillmentSettings from '@/components/admin/FulfillmentSettings';
import PaymentProviders from '@/components/admin/PaymentProviders';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { getFulfillmentConfig } from '@/lib/fulfillment/policy';
import { providerInfos } from '@/lib/payments/config';

export const metadata: Metadata = { title: 'পেমেন্ট ও ফুলফিলমেন্ট' };
export const dynamic = 'force-dynamic';

/**
 * ★ /admin/payments — প্রোভাইডার-ভিত্তিক পেমেন্ট আর্কিটেকচার কনফিগ।
 *   ফুলফিলমেন্ট মোড (manual/automatic/hybrid), প্রোভাইডার ক্রেডেনশিয়াল
 *   (কী/সিক্রেট/টেস্ট-লাইভ মোড/health), ও চালু/বন্ধ।
 *   ভবিষ্যতে গেটওয়ে যোগ করতে কোড বদলাতে হয় না — একটি প্রোভাইডার ক্লাস +
 *   registry-তে এক লাইন, তারপর অ্যাডমিন থেকে কী বসিয়ে চালু করা।
 */
export default async function AdminPaymentsPage() {
  const [cfg, providers] = await Promise.all([getFulfillmentConfig(), providerInfos()]);
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="পেমেন্ট ও ফুলফিলমেন্ট"
        subtitle="প্রোভাইডার-ভিত্তিক আর্কিটেকচার। বর্তমান মডেল ম্যানুয়াল; ভবিষ্যতে গেটওয়ে যোগ করতে কী বসিয়ে চালু করলেই হবে — কোড বদলাতে হবে না।"
      />
      <PaymentProviders initialProviders={providers} />
      <FulfillmentSettings
        initialModes={{
          pay_mode: cfg.paymentMode,
          deposit_approval: cfg.depositApproval,
          order_approval: cfg.orderApproval,
          refund_mode: cfg.refundMode,
        }}
        initialProviders={providers}
      />
    </div>
  );
}
