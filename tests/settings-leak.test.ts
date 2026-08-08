/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ সেটিংস-ফাঁসের সাধারণ প্রতিরক্ষা (Group E-র ধারাবাহিকতা)
 *
 *   পেমেন্ট-কী ফাঁসের তদন্তে বেরিয়ে এসেছে যে সমস্যাটা একটিমাত্র
 *   কী-তে সীমাবদ্ধ ছিল না, বরং **কাঠামোগত**: একাধিক অ্যাডমিন পাতা
 *   পুরো settings মানচিত্র ক্লায়েন্ট কম্পোনেন্টে props হিসেবে পাঠায়,
 *   আর redaction হাতে লেখা — `site/page.tsx` দুটি টেলিগ্রাম কী
 *   বাদ দিত, `homepage/page.tsx` **কিছুই** বাদ দিত না।
 *
 *   হাতে-লেখা redaction মানে প্রতিটি নতুন গোপন সেটিং যোগ করার সময়
 *   প্রতিটি পাতায় মনে রাখতে হবে। এই টেস্ট সেই ভরসাটা সরিয়ে দেয়:
 *   গোপন কী যোগ হলে টেস্ট ফেল করবে, মানুষ ভুললেও।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin } from './helpers/app';
import type { Client } from './helpers/http';

/**
 * ★★★ সেটিংস-ক্যাশ ফ্লাশ — এই ফাইলের টেস্টগুলোর জন্য অপরিহার্য।
 *
 *   ⚠️ Next সার্ভারে `getSettings()`-এর ৩০ সেকেন্ডের in-process ক্যাশ
 *   আছে। টেস্ট DB-তে সরাসরি সারি বসালে সার্ভার সেটি **দেখতেই পায় না**
 *   যতক্ষণ ক্যাশ বাসি না হয়।
 *
 *   এটি নিছক অসুবিধা নয়, **বিপজ্জনক**: বাসি ক্যাশে আমাদের বসানো
 *   সিক্রেট থাকত না, তাই "HTML-এ সিক্রেট নেই" দাবিটি ফাঁস থাকা
 *   সত্ত্বেও পাস করত — একটি নিরাপত্তা-টেস্ট ভুল কারণে সবুজ।
 *   (একা চালালে পাস করত, পুরো স্যুটে ফেল — ঠিক এই কারণেই।)
 *
 *   সমাধান: অ্যাপের **নিজের** লেখার পথ দিয়ে একটি নিরীহ সেটিং সেভ
 *   করি; সেই রুট শেষে `invalidateSettings()` ডাকে, ফলে সরাসরি বসানো
 *   সারিগুলোসহ পুরো মানচিত্র নতুন করে পড়া হয়।
 */
async function flushSettingsCache(admin: Client, siteName: string): Promise<void> {
  const res = await admin.post('/api/admin/settings', { site_name: siteName });
  expect(res.status, 'সেটিংস ক্যাশ ফ্লাশ করা যায়নি').toBe(200);
}

/** ★ প্রতিটি মান আলাদা ও চেনা — HTML-এ খুঁজে পাওয়া নিশ্চিত */
const SECRETS: Record<string, string> = {
  telegram_bot_token: 'TG-8899123456:AAH-leaked-bot-token-xyz',
  telegram_chat_id: 'TG-CHATID-556677889',
  pp_stripe_keys: 'sk_live_LEAKEDSTRIPEKEY0099',
};

/** ★ অ্যাডমিন পাতা যেগুলো settings ক্লায়েন্টে পাঠায় */
const PAGES = ['/admin/site', '/admin/homepage'];

describe('অ্যাডমিন পাতা — গোপন সেটিং HTML-এ যায় না', () => {
  it('টেলিগ্রাম টোকেন ও পেমেন্ট-কী কোনো পাতায় ফাঁস হয় না', async () => {
    const { client: adminClient } = await signedInAdmin(db);

    await db.setting.createMany({
      data: [
        { key: 'telegram_bot_token', value: SECRETS.telegram_bot_token },
        { key: 'telegram_chat_id', value: SECRETS.telegram_chat_id },
        {
          key: 'pp_stripe_keys',
          value: JSON.stringify({ STRIPE_SECRET_KEY: SECRETS.pp_stripe_keys }),
        },
      ],
    });

    // ★ ক্যাশ ফ্লাশ + নিয়ন্ত্রণ-মান একসাথে। এটি ছাড়া সার্ভার উপরের
    //   সারিগুলো দেখত না এবং টেস্টটি ভুল কারণে পাস করত।
    await flushSettingsCache(adminClient, 'UID TopUp Storefront');

    for (const path of PAGES) {
      const res = await adminClient.raw(path);
      expect(res.status, `${path} লোড হয়নি`).toBe(200);
      const html = await res.text();

      for (const [key, value] of Object.entries(SECRETS)) {
        expect(
          html.includes(value),
          `${path} — "${key}" এর মান HTML-এ ফাঁস হয়েছে!`,
        ).toBe(false);
      }
    }

    // ★★★ একই রানে প্রমাণ করি টেস্টটি vacuous নয়: allowlist-এ থাকা
    //   সেটিং সত্যিই পৌঁছেছে। এটি একই পাতা, একই ক্যাশ-অবস্থা থেকে
    //   দেখা — তাই "সার্ভার আসলে কিছুই পড়েনি" ব্যাখ্যাটি বাদ যায়।
    const siteHtml = await (await adminClient.raw('/admin/site')).text();
    expect(
      siteHtml.includes('UID TopUp Storefront'),
      'allowlist-এ থাকা সেটিংও পৌঁছায়নি — টেস্টটি অর্থহীন হতো',
    ).toBe(true);
  });
});
