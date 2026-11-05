import type { StorageDriver } from './types';
import { blobDriver } from './blob';
import { localDriver } from './local';
import { s3Driver } from './s3';

export type { StorageDriver } from './types';

/**
 * ★ ড্রাইভার নির্বাচন — `STORAGE_DRIVER` env দিয়ে।
 *
 *   ⚠️⚠️ **প্রোডাকশনে ফাইল-সিস্টেমে কখনো লেখা হয় না।**
 *
 *   আগে auto-নির্বাচন ছিল `token ? blob : local` — অর্থাৎ টোকেন ভুল/
 *   ফাঁকা থাকলে আপলোড **নীরবে লোকাল ডিস্কে** চলে যেত। Vercel-এর মতো
 *   serverless-এ ফাইল-সিস্টেম ephemeral, তাই ওই ফাইলগুলো পরের
 *   ডিপ্লয়/কোল্ড-স্টার্টে **নিঃশব্দে হারিয়ে যেত** — ব্যানার ও পেমেন্ট
 *   স্ক্রিনশট ভাঙা লিঙ্ক হয়ে থাকত, অথচ কোনো ত্রুটি দেখা যেত না।
 *   (এই কোডবেসে ঠিক তাই ঘটছিল: `BLOB_READ_WRITE_TOKEN=""` থাকায়
 *   প্রতিটি আপলোড লোকাল ডিস্কে যাচ্ছিল।)
 *
 *   এখন নিয়ম:
 *     · `STORAGE_DRIVER=local` — **স্পষ্ট** opt-in, কেবল ডেভ/সেল্ফ-হোস্টে।
 *       প্রোডাকশনে এটি দিলে সতর্কবার্তা লগ হয়।
 *     · auto (ডিফল্ট): Blob কনফিগার্ড থাকলে Blob। না থাকলে —
 *       প্রোডাকশনে **fail-closed** (আপলোড স্পষ্টভাবে ব্যর্থ হয়,
 *       ডিস্কে পড়ে না); ডেভে সুবিধার জন্য লোকাল।
 */
let cached: StorageDriver | null = null;

const isProd = () => process.env.NODE_ENV === 'production';

/** কনফিগার না থাকা একটি ড্রাইভার — put() ডাকলেই স্পষ্ট ত্রুটি */
function unconfiguredDriver(reason: string): StorageDriver {
  return {
    name: 'unconfigured',
    configured: false,
    reason,
    async put() { throw new Error(reason); },
    async del() { /* কিছু সংরক্ষিত হয়নি, তাই মোছারও কিছু নেই */ },
    owns() { return false; },
  };
}

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const choice = (process.env.STORAGE_DRIVER || '').toLowerCase();
  let d: StorageDriver;

  if (choice === 'local') {
    // স্পষ্ট opt-in — প্রোডাকশনে প্রায় নিশ্চিতভাবেই ভুল
    if (isProd()) {
      console.warn(
        '[storage] STORAGE_DRIVER=local প্রোডাকশনে — আপলোড করা ফাইল **সাথে সাথেই ৪০৪** দেবে: ' +
        'Next প্রোডাকশন বিল্ডের পরে `public/`-এ লেখা ফাইল পরিবেশন করে না (মাপা, চূড়ান্ত মাস্টার ' +
        'অডিট ২০২৬-০৯-১৭); serverless-এ ফাইল-সিস্টেম ephemeral-ও। Blob/S3/R2 ব্যবহার করুন।',
      );
    }
    d = localDriver();
  } else if (choice === 's3' || choice === 'r2') {
    d = s3Driver();
  } else if (choice === 'blob') {
    // স্পষ্টভাবে Blob চাওয়া হয়েছে — কনফিগার না থাকলে লোকালে পড়া নয়
    d = blobDriver();
  } else {
    const b = blobDriver();
    if (b.configured) d = b;
    else if (isProd()) {
      d = unconfiguredDriver(
        'ছবি আপলোড চালু নেই — BLOB_READ_WRITE_TOKEN সেট করা নেই। ' +
        '(প্রোডাকশনে লোকাল ডিস্কে লেখা হয় না, কারণ সেই ফাইল পরের ডিপ্লয়ে হারিয়ে যেত।)',
      );
    } else {
      d = localDriver();
    }
  }

  cached = d;
  return d;
}

/** ⚠️ কেবল টেস্ট/স্ক্রিপ্টের জন্য — env বদলের পর নির্বাচন আবার করাতে */
export function resetStorageCache(): void {
  cached = null;
}

/** পুরনো url কোন ড্রাইভারের — delete-এর সময় সঠিক ব্যাকএন্ডে পাঠাতে */
export function driverForUrl(url: string): StorageDriver | null {
  for (const make of [blobDriver, localDriver, s3Driver]) {
    const d = make();
    if (d.owns(url)) return d;
  }
  return null;
}
