/**
 * ═══════════════════════════════════════════════════════════
 * ★ বহুভাষা অভিধান (ফিচার ১০) — বাংলা (ডিফল্ট) ও English
 *
 *   এই অ্যাপের মূল ভাষা বাংলা এবং থাকবে। এখানে গ্রাহক-মুখী
 *   সাধারণ UI স্ট্রিং দুই ভাষায় রাখা হলো, যাতে টগল দিয়ে
 *   English-ভাষী গ্রাহকও সাইট চালাতে ও অর্ডার করতে পারে।
 *
 *   ⚠️ পরিসর: nav, footer, সাধারণ বোতাম, হোমপেজ/প্রোডাক্ট/অর্ডার
 *   প্রবাহের মূল লেবেল। অ্যাডমিন প্যানেল বাংলাই থাকে (অপারেটর
 *   স্থানীয়)। DB থেকে আসা লেখা (প্রোডাক্টের নাম, নোটিশ) অনূদিত
 *   হয় না — সেগুলো অ্যাডমিন যা লেখেন তা-ই।
 *
 *   ব্যবহার:  const t = useT();  t('nav.catalog')
 *   অনুপস্থিত key হলে key-টিই ফেরে (কখনো ভাঙে না)।
 * ═══════════════════════════════════════════════════════════
 */

export type Locale = 'bn' | 'en';
export const LOCALES: Locale[] = ['bn', 'en'];
export const DEFAULT_LOCALE: Locale = 'bn';
export const LOCALE_COOKIE = 'lang';

export const LOCALE_LABEL: Record<Locale, string> = {
  bn: 'বাংলা',
  en: 'English',
};

type Dict = Record<string, string>;

export const translations: Record<Locale, Dict> = {
  bn: {
    // ── Nav ──
    'nav.catalog': 'ক্যাটালগ',
    'nav.how': 'যেভাবে কাজ করে',
    'nav.track': 'অর্ডার ট্র্যাক',
    'nav.faq': 'প্রশ্ন',
    'nav.contact': 'যোগাযোগ',
    'nav.wallet': 'ওয়ালেট',
    'nav.login': 'লগইন',
    'nav.register': 'রেজিস্টার',
    'nav.logout': 'লগআউট',
    'nav.account': 'অ্যাকাউন্ট',
    'nav.orders': 'আমার অর্ডার',
    'nav.admin': 'অ্যাডমিন',
    'nav.search': 'প্যাকেজ, গেম বা সার্ভিস খুঁজুন…',

    // ── সাধারণ বোতাম/লেবেল ──
    'common.topup': 'টপ-আপ করুন',
    'common.buyNow': 'অর্ডার করুন',
    'common.viewAll': 'সব দেখুন',
    'common.loading': 'লোড হচ্ছে…',
    'common.startingAt': 'শুরু',
    'common.soldOut': 'স্টক নেই',
    'common.popular': 'জনপ্রিয়',
    'common.new': 'নতুন',
    'common.discount': 'ছাড়',
    'common.all': 'সব',
    'common.category': 'ক্যাটাগরি',
    'common.needHelp': 'সাহায্য দরকার?',
    'common.contactUs': 'যোগাযোগ করুন',
    'common.close': 'বন্ধ করুন',
    'common.liveOrders': 'লাইভ অর্ডার',
    'common.addMoney': 'টাকা যোগ',

    // ── বৈশ্বিক লোডিং ওভারলে (LoadingProvider) ──
    //    কেবল সেইসব কাজের নাম, যেখানে "কী হচ্ছে" জানানোটা জরুরি।
    //    প্রমাণীকরণ ও পাতা-বদল নামহীন — সেখানে ঘূর্ণায়মান বার্তা চলে।
    'load.saving': 'সেভ হচ্ছে…',
    'load.uploading': 'আপলোড হচ্ছে…',
    'load.order': 'অর্ডার প্রসেস হচ্ছে…',
    'load.payment': 'পেমেন্ট প্রসেস হচ্ছে…',

    // ── লোডিং পর্দার ঘূর্ণায়মান বার্তা ──
    'load.rotate1': 'নিরাপদে সংযুক্ত হচ্ছে…',
    'load.rotate2': 'আপনার গেমিং অভিজ্ঞতা প্রস্তুত হচ্ছে…',
    'load.rotate3': 'ড্যাশবোর্ড লোড হচ্ছে…',

    'pwa.title': 'অ্যাপ ইনস্টল করুন',
    'pwa.subtitle': 'হোম স্ক্রিন থেকে এক ট্যাপে টপ-আপ',
    'pwa.install': 'ইনস্টল',
    'theme.label': 'থিম',
    'theme.light': 'লাইট',
    'theme.dark': 'ডার্ক',
    'theme.system': 'সিস্টেম',

    // ── হোমপেজ ──
    'home.popular': 'জনপ্রিয় প্রোডাক্ট',
    'home.allProducts': 'সব প্রোডাক্ট',
    'home.latestOrders': 'সদ্য সম্পন্ন অর্ডার',
    'home.completed': 'সম্পন্ন',
    'home.ourService': 'আমাদের সার্ভিস',
    'home.payMethods': 'পেমেন্ট মাধ্যম',
    'home.fastDelivery': 'দ্রুত ডেলিভারি',
    'home.securePay': 'নিরাপদ পেমেন্ট',
    'home.support247': '২৪/৭ সাপোর্ট',

    // ── প্রোডাক্ট/অর্ডার ──
    'order.selectRecharge': 'প্যাকেজ বাছুন',
    'order.accountInfo': 'অ্যাকাউন্ট তথ্য',
    'order.payment': 'পেমেন্ট',
    'order.uid': 'Player ID / UID',
    'order.confirmUid': 'UID আবার লিখে নিশ্চিত করুন',
    'order.wallet': 'ওয়ালেট দিয়ে',
    'order.direct': 'সরাসরি পেমেন্ট',
    'order.total': 'মোট',
    'order.howToOrder': 'কিভাবে অর্ডার করবেন',
    'order.deliveryTime': 'ডেলিভারি: সাধারণত ২০ মিনিট, সর্বোচ্চ ১ ঘণ্টা',

    // ── Footer ──
    'footer.product': 'পণ্য',
    'footer.support': 'সহায়তা',
    'footer.info': 'তথ্য',
    'footer.terms': 'শর্তাবলী',
    'footer.privacy': 'প্রাইভেসি পলিসি',
    'footer.refund': 'রিফান্ড পলিসি',
    'footer.about': 'আমাদের সম্পর্কে',
    'footer.rights': 'সর্বস্বত্ব সংরক্ষিত',
  },

  en: {
    // ── Nav ──
    'nav.catalog': 'Catalog',
    'nav.how': 'How It Works',
    'nav.track': 'Track Order',
    'nav.faq': 'FAQ',
    'nav.contact': 'Contact',
    'nav.wallet': 'Wallet',
    'nav.login': 'Login',
    'nav.register': 'Register',
    'nav.logout': 'Logout',
    'nav.account': 'Account',
    'nav.orders': 'My Orders',
    'nav.admin': 'Admin',
    'nav.search': 'Search packages, games or services…',

    // ── Common buttons/labels ──
    'common.topup': 'Top Up',
    'common.buyNow': 'Place Order',
    'common.viewAll': 'View All',
    'common.loading': 'Loading…',
    'common.startingAt': 'From',
    'common.soldOut': 'Sold Out',
    'common.popular': 'Popular',
    'common.new': 'New',
    'common.discount': 'OFF',
    'common.all': 'All',
    'common.category': 'Category',
    'common.needHelp': 'Need help?',
    'common.contactUs': 'Contact Us',
    'common.close': 'Close',
    'common.liveOrders': 'Live orders',
    'common.addMoney': 'Add money',

    // ── Global loading overlay (LoadingProvider) ──
    //    Only jobs whose identity matters. Auth and navigation are
    //    deliberately unlabelled so the rotating messages show there.
    'load.saving': 'Saving…',
    'load.uploading': 'Uploading…',
    'load.order': 'Processing your order…',
    'load.payment': 'Processing payment…',

    // ── Rotating loading messages ──
    'load.rotate1': 'Connecting securely…',
    'load.rotate2': 'Preparing your gaming experience…',
    'load.rotate3': 'Loading your dashboard…',

    'pwa.title': 'Install the app',
    'pwa.subtitle': 'One-tap top-ups from your home screen',
    'pwa.install': 'Install',
    'theme.label': 'Theme',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.system': 'System',

    // ── Homepage ──
    'home.popular': 'Popular Products',
    'home.allProducts': 'All Products',
    'home.latestOrders': 'Latest Orders',
    'home.completed': 'Completed',
    'home.ourService': 'Our Service',
    'home.payMethods': 'Payment Methods',
    'home.fastDelivery': 'Fast Delivery',
    'home.securePay': 'Secure Payment',
    'home.support247': '24/7 Support',

    // ── Product/Order ──
    'order.selectRecharge': 'Select Recharge',
    'order.accountInfo': 'Account Info',
    'order.payment': 'Payment',
    'order.uid': 'Player ID / UID',
    'order.confirmUid': 'Re-enter UID to confirm',
    'order.wallet': 'Pay with Wallet',
    'order.direct': 'Direct Payment',
    'order.total': 'Total',
    'order.howToOrder': 'How to Order',
    'order.deliveryTime': 'Delivery: usually 20 min, max 1 hour',

    // ── Footer ──
    'footer.product': 'Products',
    'footer.support': 'Support',
    'footer.info': 'Information',
    'footer.terms': 'Terms & Conditions',
    'footer.privacy': 'Privacy Policy',
    'footer.refund': 'Refund Policy',
    'footer.about': 'About Us',
    'footer.rights': 'All rights reserved',
  },
};

/** নিরাপদ locale — অজানা মান হলে ডিফল্ট বাংলা */
export function normalizeLocale(v: string | undefined | null): Locale {
  return v === 'en' ? 'en' : 'bn';
}

/** সরাসরি অনুবাদ (context ছাড়া, সার্ভার-সাইডেও ব্যবহার্য) */
export function translate(locale: Locale, key: string): string {
  return translations[locale]?.[key] ?? translations[DEFAULT_LOCALE][key] ?? key;
}
