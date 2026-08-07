/**
 * ★★★ তৈরি করা সাপোর্ট বার্তা (3.15)
 *
 *   ── কেন, এবং rejectReasons.ts এর সাথে পার্থক্য কী ──
 *
 *   2.5 এ `rejectReasons.ts` বানানো হয়েছিল **কাঠামোবদ্ধ বাতিলের
 *   কারণ** এর জন্য — সেগুলো enum, ডাটাবেসে সংরক্ষিত হয় (`failReason`),
 *   আর সিস্টেম নিজেই গ্রাহকের বার্তা বানায়। সেটি এখানে নকল করা
 *   হয়নি — বাতিল/ব্যর্থতার কপি এখনো ওখান থেকেই আসে।
 *
 *   এখানে আছে সেই বার্তাগুলো যেগুলোর কোনো enum নেই: সাধারণ
 *   সাপোর্ট উত্তর — দেরি, রক্ষণাবেক্ষণ, UID ভুল, ধন্যবাদ। এগুলো
 *   অ্যাডমিন এতদিন প্রতিবার হাতে লিখত, তাই একই পরিস্থিতিতে
 *   একেকবার একেক রকম (ও প্রায়ই তাড়াহুড়োর) বার্তা যেত।
 *
 *   ⚠️ এগুলো **শুরুর খসড়া**, চূড়ান্ত নয়। ঢোকানোর পর অ্যাডমিন
 *   সম্পাদনা করতে পারে — গ্রাহকভেদে পরিস্থিতি আলাদা হয়, আর
 *   অপরিবর্তনীয় টেমপ্লেট রোবটের মতো শোনায়।
 */

export type CannedCategory = 'DELAY' | 'INFO' | 'ISSUE' | 'GOODWILL';

export type CannedResponse = {
  id: string;
  category: CannedCategory;
  /** পিকারে দেখানো ছোট নাম */
  label: string;
  /** যে লেখাটি ঢুকবে */
  text: string;
};

export const CANNED_CATEGORY_LABEL: Record<CannedCategory, string> = {
  DELAY: 'দেরি',
  INFO: 'তথ্য',
  ISSUE: 'সমস্যা',
  GOODWILL: 'সৌজন্য',
};

export const CANNED_RESPONSES: CannedResponse[] = [
  {
    id: 'delay-short',
    category: 'DELAY',
    label: 'অল্প দেরি হচ্ছে',
    text: 'আপনার অর্ডারটি প্রক্রিয়াধীন আছে। একটু বেশি সময় লাগছে, তবে আমরা কাজ করছি — খুব শিগগিরই পৌঁছে যাবে।',
  },
  {
    id: 'delay-server',
    category: 'DELAY',
    label: 'গেম সার্ভারে সমস্যা',
    text: 'গেমের সার্ভারে সাময়িক সমস্যার কারণে টপ-আপ দিতে দেরি হচ্ছে। সার্ভার ঠিক হলেই আপনার অর্ডার সম্পন্ন করা হবে। আপনার টাকা নিরাপদ আছে।',
  },
  {
    id: 'delay-rush',
    category: 'DELAY',
    label: 'অনেক অর্ডারের চাপ',
    text: 'এই মুহূর্তে অর্ডারের চাপ বেশি থাকায় কিছুটা সময় লাগছে। ধারাবাহিকভাবে সব অর্ডার সম্পন্ন করা হচ্ছে — আপনারটিও সারিতে আছে।',
  },
  {
    id: 'info-hours',
    category: 'INFO',
    label: 'সাপোর্ট সময়',
    text: 'আমাদের সাপোর্ট নির্দিষ্ট সময়ে চালু থাকে। এই সময়ের বাইরে করা অর্ডার পরদিন শুরুতেই প্রক্রিয়া করা হয়।',
  },
  {
    id: 'info-deposit-time',
    category: 'INFO',
    label: 'ডিপোজিট যাচাইয়ে সময়',
    text: 'আপনার পাঠানো টাকা আমরা ব্যাংকিং অ্যাপে মিলিয়ে দেখি — এতে কিছুটা সময় লাগে। যাচাই হলেই ওয়ালেটে টাকা যোগ হয়ে যাবে।',
  },
  {
    id: 'issue-uid',
    category: 'ISSUE',
    label: 'UID মিলছে না',
    text: 'আপনার দেওয়া Player UID টি গেমে খুঁজে পাওয়া যায়নি। অনুগ্রহ করে গেমে ঢুকে প্রোফাইল থেকে UID টি আবার মিলিয়ে দেখুন এবং সঠিক UID জানান।',
  },
  {
    id: 'issue-trx',
    category: 'ISSUE',
    label: 'TrxID মিলছে না',
    text: 'আপনার দেওয়া ট্রানজেকশন আইডিটি আমাদের স্টেটমেন্টে পাওয়া যায়নি। অনুগ্রহ করে আপনার bKash/Nagad অ্যাপ থেকে সঠিক TrxID টি দেখে জানান।',
  },
  {
    id: 'issue-amount',
    category: 'ISSUE',
    label: 'অঙ্ক মিলছে না',
    text: 'আপনি যে অঙ্ক লিখেছেন আর যে টাকা পাঠিয়েছেন তা মিলছে না। সঠিক অঙ্কটি জানালে আমরা দ্রুত ঠিক করে দিচ্ছি।',
  },
  {
    id: 'goodwill-sorry',
    category: 'GOODWILL',
    label: 'দুঃখ প্রকাশ',
    text: 'অসুবিধার জন্য আন্তরিকভাবে দুঃখিত। বিষয়টি আমরা গুরুত্ব দিয়ে দেখছি এবং দ্রুত সমাধান করছি।',
  },
  {
    id: 'goodwill-thanks',
    category: 'GOODWILL',
    label: 'ধন্যবাদ',
    text: 'ধৈর্য ধরে অপেক্ষা করার জন্য ধন্যবাদ। আমাদের সাথে থাকার জন্য কৃতজ্ঞ।',
  },
];

/** ক্যাটাগরি অনুযায়ী সাজানো — পিকারে গুছিয়ে দেখানোর জন্য */
export function cannedByCategory(): Array<{ category: CannedCategory; label: string; items: CannedResponse[] }> {
  const order: CannedCategory[] = ['DELAY', 'ISSUE', 'INFO', 'GOODWILL'];
  return order.map((c) => ({
    category: c,
    label: CANNED_CATEGORY_LABEL[c],
    items: CANNED_RESPONSES.filter((r) => r.category === c),
  }));
}
