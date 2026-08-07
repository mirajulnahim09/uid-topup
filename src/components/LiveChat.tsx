'use client';

import { useEffect } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ লাইভ চ্যাট (Tawk.to) — বিনামূল্যের লাইভ সাপোর্ট উইজেট
 *
 *   অ্যাডমিন Setting-এ `tawk_property_id` ও `tawk_widget_id`
 *   দিলে তবেই লোড হয় — নাহলে কিছুই রেন্ডার হয় না (কোনো খরচ নেই)।
 *
 *   কীভাবে আইডি পাবেন:
 *     tawk.to → Admin → Property → Channels → Chat Widget
 *     স্ক্রিপ্টে থাকে: embed.tawk.to/<PROPERTY_ID>/<WIDGET_ID>
 *
 *   ⚠️ তৃতীয়-পক্ষ স্ক্রিপ্ট বাইরের origin থেকে আসে, তাই CSP-তে
 *   *.tawk.to অনুমোদন থাকতে হবে (নাহলে ব্লক হবে)।
 * ═══════════════════════════════════════════════════════════
 */
export default function LiveChat({
  propertyId,
  widgetId,
}: {
  propertyId?: string;
  widgetId?: string;
}) {
  useEffect(() => {
    if (!propertyId || !widgetId) return;
    // ★ একবারের বেশি ইনজেক্ট নয়
    if (document.getElementById('tawk-script')) return;

    const s = document.createElement('script');
    s.id = 'tawk-script';
    s.async = true;
    s.src = `https://embed.tawk.to/${propertyId}/${widgetId}`;
    s.charset = 'UTF-8';
    s.setAttribute('crossorigin', '*');
    document.body.appendChild(s);

    return () => {
      // রুট বদলালেও উইজেট থেকে যায় (Tawk নিজেই persist করে);
      // এখানে কেবল আমাদের ট্যাগটি রেখে দিই, বারবার লোড ঠেকাতে।
    };
  }, [propertyId, widgetId]);

  return null;
}
