import { put, del } from '@vercel/blob';
import type { StorageDriver, PutInput, PutResult } from './types';

/** ★ Vercel Blob ড্রাইভার — প্রোডাকশন ডিফল্ট (টোকেন থাকলে)। */
export function blobDriver(): StorageDriver {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return {
    name: 'vercel-blob',
    configured: Boolean(token),
    reason: token ? undefined : 'BLOB_READ_WRITE_TOKEN সেট করা নেই (Vercel → Storage → Blob)।',
    async put({ key, bytes, contentType }: PutInput): Promise<PutResult> {
      const blob = await put(key, Buffer.from(bytes), {
        access: 'public',
        contentType,
        addRandomSuffix: false,
        cacheControlMaxAge: 31536000,
      });
      return { url: blob.url, key };
    },
    async del(url: string): Promise<void> {
      await del(url);
    },
    owns(url: string): boolean {
      return url.includes('.public.blob.vercel-storage.com');
    },
  };
}
