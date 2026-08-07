/**
 * ═══════════════════════════════════════════════════════════
 * ★ Storage abstraction — ড্রাইভার-অজ্ঞ ফাইল সংরক্ষণ।
 *
 *   কেন: আগে `upload.ts` সরাসরি Vercel Blob এ বাঁধা ছিল। ভবিষ্যতে
 *   S3 / Cloudflare R2 / লোকাল ডিস্কে যেতে হলে পুরো কোড বদলাতে হতো।
 *   এখন প্রতিটি ব্যাকএন্ড একটি `StorageDriver` — উপরের কোড শুধু
 *   ইন্টারফেসটাই জানে, `STORAGE_DRIVER` env দিয়ে ড্রাইভার বদলায়।
 * ═══════════════════════════════════════════════════════════
 */

export type PutInput = {
  /** ফোল্ডার-সহ কী, যেমন `products/1699-ab12.webp` */
  key: string;
  bytes: Uint8Array;
  contentType: string;
};

export type PutResult = { url: string; key: string };

export interface StorageDriver {
  /** ড্রাইভারের নাম (লগ/ডায়াগনস্টিকসের জন্য) */
  readonly name: string;
  /** env সঠিকভাবে সেট আছে কিনা */
  readonly configured: boolean;
  /** কনফিগার না থাকলে ব্যবহারকারী-বান্ধব কারণ */
  readonly reason?: string;
  put(input: PutInput): Promise<PutResult>;
  del(url: string): Promise<void>;
  /** এই url এই ড্রাইভারের কিনা (নিরাপদ delete-এর জন্য) */
  owns(url: string): boolean;
}
