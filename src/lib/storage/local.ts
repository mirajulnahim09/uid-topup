import { writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { StorageDriver, PutInput, PutResult } from './types';

/**
 * ★ লোকাল-ডিস্ক ড্রাইভার — সেল্ফ-হোস্ট / ডেভের জন্য।
 *   `public/uploads/**` এ লেখে, `/uploads/**` URL ফেরায় (next/image
 *   এগুলো অপ্টিমাইজ করতে পারে)।
 *   ⚠️ Vercel serverless-এ ফাইল-সিস্টেম read-only/ephemeral — তাই
 *   ওখানে Blob/S3/R2 ব্যবহার করুন। এখানে `configured` তবু true, কারণ
 *   সেল্ফ-হোস্টে এটিই প্রাথমিক পছন্দ।
 */
export function localDriver(): StorageDriver {
  const root = path.join(process.cwd(), 'public', 'uploads');
  return {
    name: 'local',
    configured: true,
    async put({ key, bytes }: PutInput): Promise<PutResult> {
      const full = path.join(root, key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, Buffer.from(bytes));
      return { url: '/uploads/' + key.replace(/\\/g, '/'), key };
    },
    async del(url: string): Promise<void> {
      if (!url.startsWith('/uploads/')) return;
      const rel = url.slice('/uploads/'.length);
      // Admin image fields accept any "/..." path, so "/uploads/../x" can
      // reach here; never unlink anything that resolves outside the root.
      const full = path.resolve(root, rel);
      if (!full.startsWith(root + path.sep)) return;
      await unlink(full).catch(() => {});
    },
    owns(url: string): boolean {
      return url.startsWith('/uploads/');
    },
  };
}
