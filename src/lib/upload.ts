import { put, del } from '@vercel/blob';

/**
 * ★ File upload security:
 *   Extension / MIME spoof করা যায় — তাই magic bytes (file signature) চেক করা হয়।
 *   SVG অনুমোদিত নয় (SVG এ script embed করে XSS করা যায়)।
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
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'image/png';

  // GIF: "GIF"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';

  // WEBP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';

  return null;
}

export class UploadError extends Error {}

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function uploadImage(
  file: File,
  folder: string
): Promise<{ url: string; size: number; mime: string }> {
  if (!isBlobConfigured()) {
    throw new UploadError(
      'ছবি আপলোড চালু নেই। Vercel → Storage → Blob তৈরি করে BLOB_READ_WRITE_TOKEN বসান।'
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    throw new UploadError('কোনো ফাইল পাওয়া যায়নি');
  }

  if (file.size > MAX_SIZE) {
    throw new UploadError(
      `ফাইল খুব বড় (${(file.size / 1048576).toFixed(1)} MB)। সর্বোচ্চ ৮ MB।`
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // ★ আসল টাইপ — client এর বলা mime বিশ্বাস করি না
  const real = detectMime(bytes);
  if (!real) {
    throw new UploadError('শুধু JPG, PNG, WebP বা GIF ছবি চলবে। (SVG অনুমোদিত নয়)');
  }

  const ext = ALLOWED[real][0];
  const name = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  // ★ Vercel Blob এর put() Buffer চায় — Uint8Array নয়
  const blob = await put(name, Buffer.from(bytes), {
    access: 'public',
    contentType: real,
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  });

  return { url: blob.url, size: file.size, mime: real };
}

export async function deleteImage(url: string): Promise<void> {
  if (!isBlobConfigured()) return;
  if (!url.includes('.public.blob.vercel-storage.com')) return;
  try {
    await del(url);
  } catch {
    // মুছতে না পারলেও অ্যাপ ভাঙবে না
  }
}
