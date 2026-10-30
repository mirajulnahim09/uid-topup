import { randomBytes } from 'crypto';
import { getStorage, driverForUrl } from './storage';
import { logger } from './logger';

/**
 * ★ File upload security + storage-অজ্ঞ আপলোড:
 *   • Extension/MIME spoof আটকাতে magic-byte (signature) চেক
 *   • SVG নিষিদ্ধ (SVG-তে script embed করে XSS হয়)
 *   • প্রকৃত সংরক্ষণ `lib/storage` ড্রাইভার করে (Blob/Local/S3/R2)
 *   • ছবির প্রস্থ/উচ্চতা হেডার থেকে পড়া হয় (Media মেটাডেটার জন্য)
 */
export const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

export const ALLOWED = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
} as const;

export type AllowedMime = keyof typeof ALLOWED;

export function detectMime(b: Uint8Array): AllowedMime | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';
  return null;
}

/** ★ হেডার থেকে ছবির মাপ (PNG/JPEG/GIF/WebP) — না পারলে null। */
export function imageSize(b: Uint8Array, mime: AllowedMime): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') {
      return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
    }
    if (mime === 'image/gif') {
      return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
        }
        const len = (b[i + 2] << 8) | b[i + 3];
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp') {
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === 'VP8X') {
        return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      }
      if (fourcc === 'VP8L') {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
      if (fourcc === 'VP8 ') {
        return { width: ((b[26] | (b[27] << 8)) & 0x3fff), height: ((b[28] | (b[29] << 8)) & 0x3fff) };
      }
    }
  } catch { /* ignore */ }
  return null;
}

export class UploadError extends Error {}

/** কোনো storage ড্রাইভার তৈরি করা আছে কিনা */
export function storageReady(): boolean {
  return getStorage().configured;
}
export function storageName(): string {
  return getStorage().name;
}
export function storageReason(): string | undefined {
  return getStorage().reason;
}
/** পুরনো নাম — call-site অক্ষত রাখতে alias */
export function isBlobConfigured(): boolean {
  return storageReady();
}

export type UploadResult = {
  url: string;
  key: string;
  size: number;
  mime: AllowedMime;
  width: number | null;
  height: number | null;
};

export async function uploadImage(file: File, folder: string): Promise<UploadResult> {
  const store = getStorage();
  if (!store.configured) {
    throw new UploadError(store.reason || 'ছবি আপলোড চালু নেই — storage কনফিগার করুন।');
  }
  if (!(file instanceof File) || file.size === 0) throw new UploadError('কোনো ফাইল পাওয়া যায়নি');
  if (file.size > MAX_SIZE) {
    throw new UploadError(`ফাইল খুব বড় (${(file.size / 1048576).toFixed(1)} MB)। সর্বোচ্চ ৮ MB।`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const real = detectMime(bytes);
  if (!real) throw new UploadError('শুধু JPG, PNG, WebP বা GIF ছবি চলবে। (SVG অনুমোদিত নয়)');

  const ext = ALLOWED[real][0];
  /**
   * ★★★ UPL-02 — ফাইলের নামই একমাত্র গোপনীয়তা (Blob `public`; ডিপোজিট-স্ক্রিনশটে
   *   গ্রাহকের bKash নম্বর থাকে)। আগে `Math.random()`-এর ৮ অক্ষর — CSPRNG নয়,
   *   V8-এর PRNG-অবস্থা নিজের আপলোডের নাম দেখে অনুমেয়। এখন ১২৮-বিট
   *   `crypto.randomBytes` hex (৩২ অক্ষর, a-f0-9 — `UPLOAD_KEY_PATH`-এর বিদ্যমান
   *   `[a-z0-9]*` নিয়মেই মেলে, তাই পুরনো ও নতুন দুই ধরনের URL-ই বৈধ থাকে)।
   */
  const key = `${folder}/${Date.now()}-${randomBytes(16).toString('hex')}.${ext}`;
  const dims = imageSize(bytes, real);

  const { url } = await store.put({ key, bytes, contentType: real });

  return { url, key, size: file.size, mime: real, width: dims?.width ?? null, height: dims?.height ?? null };
}

export async function deleteImage(url: string): Promise<void> {
  const driver = driverForUrl(url);
  if (!driver) return;
  try {
    await driver.del(url);
  } catch (e) {
    logger.error('upload', 'storage delete failed', { url, err: e });
  }
}
