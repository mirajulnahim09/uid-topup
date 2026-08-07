import type { PaymentProvider, VerifyOutcome, RefundOutcome } from '../types';

/**
 * ★ ম্যানুয়াল প্রোভাইডার — বর্তমান (ও ডিফল্ট) মডেল।
 *
 *   কোনো API নেই: গ্রাহক bKash/Nagad/Rocket/Upay দিয়ে Send Money করে
 *   TrxID জমা দেন; অ্যাডমিন নিজের ব্যাংক-অ্যাপে মিলিয়ে অনুমোদন করেন।
 *   তাই `verify()` সর্বদা PENDING_MANUAL, `refund()` সর্বদা MANUAL —
 *   অর্থাৎ বিদ্যমান হাতে-চালানো প্রবাহই এখানে আনুষ্ঠানিক।
 *
 *   ⚠️ এই প্রোভাইডার সবসময় "configured" — এটিই প্ল্যাটফর্মের ভিত্তি।
 */
export function manualProvider(): PaymentProvider {
  return {
    id: 'manual',
    label: 'ম্যানুয়াল (bKash / Nagad / Rocket / Upay)',
    kind: 'MANUAL',
    capabilities: { autoVerify: false, autoRefund: false, hostedCheckout: false },
    keyFields: [], // ম্যানুয়ালে কোনো API-কী লাগে না
    isConfigured: () => true,
    async verify(): Promise<VerifyOutcome> {
      return { status: 'PENDING_MANUAL' };
    },
    async refund(): Promise<RefundOutcome> {
      return { status: 'MANUAL' };
    },
  };
}
