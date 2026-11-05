import { z } from 'zod';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ zod-এর ডিফল্ট ইংরেজি বার্তা → বাংলা (EXTREME অডিট, ২০২৬-০৯-১৮)
 *
 *   ⚠️ কোন সমস্যাটি এটি সারায় (মাপা): `/api/order`-এ ৫০০ অক্ষরের
 *   `playerName` পাঠালে গ্রাহক দেখতেন —
 *     `String must contain at most 80 character(s)`
 *   অথচ পুরো অ্যাপ বাংলায়। `validation.ts`-এ **৬৬টি** ভ্যালিডেশন-কলে
 *   কোনো কাস্টম বার্তা নেই, তাই প্রতিটির জন্য আলাদা বার্তা লেখা মানে
 *   ৬৬ জায়গায় হাত দেওয়া — আর ভবিষ্যতে নতুন ফিল্ডে আবার একই ফাঁক।
 *
 *   এখানে একটিই গ্লোবাল error-map বসানো হলো:
 *     · ফিল্ডে কাস্টম বার্তা থাকলে **সেটিই জেতে** (zod-এর নিয়ম)
 *     · না থাকলে বাংলা সাধারণ বার্তা
 *     · অজানা কোডে zod-এর নিজের বার্তাই (`ctx.defaultError`)
 *
 *   ⚠️ import করা হয় `guard.ts` থেকে — প্রতিটি API রুট guard ব্যবহার করে,
 *   তাই সার্ভারের যেকোনো পথে মানচিত্রটি বসে যায় (side-effect import)।
 * ═══════════════════════════════════════════════════════════
 */

/** অঙ্ক বাংলায় — বার্তায় ৮০ নয়, ৮০-ই দেখানো হয় (বাংলা সংখ্যা) */
const bn = (n: number | bigint): string =>
  String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'এই ঘরটি পূরণ করুন' };
      }
      if (issue.expected === 'number') return { message: 'সংখ্যা দিন' };
      if (issue.expected === 'string') return { message: 'লেখা দিন' };
      if (issue.expected === 'boolean') return { message: 'হ্যাঁ/না মান দিন' };
      return { message: 'এই তথ্যটি সঠিক নয়' };
    }

    case z.ZodIssueCode.too_small: {
      if (issue.type === 'string') {
        return issue.minimum === 1
          ? { message: 'এই ঘরটি পূরণ করুন' }
          : { message: `অন্তত ${bn(issue.minimum)} অক্ষর দিন` };
      }
      if (issue.type === 'number') {
        return { message: `মান অন্তত ${bn(issue.minimum)} হতে হবে` };
      }
      if (issue.type === 'array') return { message: `অন্তত ${bn(issue.minimum)}টি দিন` };
      return { message: 'মান খুব ছোট' };
    }

    case z.ZodIssueCode.too_big: {
      if (issue.type === 'string') return { message: `সর্বোচ্চ ${bn(issue.maximum)} অক্ষর দেওয়া যাবে` };
      if (issue.type === 'number') return { message: `মান সর্বোচ্চ ${bn(issue.maximum)} হতে পারে` };
      if (issue.type === 'array') return { message: `সর্বোচ্চ ${bn(issue.maximum)}টি দেওয়া যাবে` };
      return { message: 'মান খুব বড়' };
    }

    case z.ZodIssueCode.invalid_string: {
      if (issue.validation === 'email') return { message: 'সঠিক ইমেইল দিন' };
      if (issue.validation === 'url') return { message: 'সঠিক লিংক দিন' };
      if (issue.validation === 'uuid') return { message: 'সঠিক আইডি দিন' };
      return { message: 'লেখাটি সঠিক ফরম্যাটে নেই' };
    }

    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'অনুমোদিত মানগুলোর একটি বেছে নিন' };

    /**
     * ★ union/literal — `.optional().or(z.literal(''))` ধরনের ফিল্ডে zod
     *   ডিফল্টে ইংরেজি `"Invalid input"` দেয়। ইনপুট-ফাজে মাপা: এই একটি
     *   বার্তাই ৬০ বার গ্রাহকের সামনে যেত (২০২৬-০৯-১৮)।
     */
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_arguments:
    case z.ZodIssueCode.invalid_return_type:
      return { message: 'এই তথ্যটি সঠিক নয়' };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: 'অপ্রত্যাশিত তথ্য পাঠানো হয়েছে' };

    case z.ZodIssueCode.not_multiple_of:
      return { message: 'মানটি অনুমোদিত ধাপে নেই' };

    case z.ZodIssueCode.invalid_date:
      return { message: 'সঠিক তারিখ দিন' };

    default:
      // ★ অজানা কোড — zod-এর নিজের বার্তা (ইংরেজি) ফিরিয়ে দিই, নীরবে ভুল নয়
      return { message: ctx.defaultError };
  }
});

/** ★ import-এর পার্শ্বপ্রতিক্রিয়াই আসল কাজ; এই রপ্তানিটি কেবল "লোড হয়েছে" প্রমাণ */
export const ZOD_BANGLA_ERRORS = true;
