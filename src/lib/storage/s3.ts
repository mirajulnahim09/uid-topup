import type { StorageDriver, PutInput, PutResult } from './types';

/**
 * ★ S3-সঙ্গতিপূর্ণ ড্রাইভার (Amazon S3 / Cloudflare R2 / MinIO)।
 *
 *   কাঠামোগতভাবে প্রস্তুত — env থাকলে সক্রিয়। প্রকৃত আপলোড চালাতে
 *   `@aws-sdk/client-s3` ইনস্টল করে নিচের চিহ্নিত অংশটি চালু করুন।
 *   এটি সেই "future-ready" স্তর: বাকি অ্যাপের কোনো কোড বদলাবে না —
 *   শুধু এই ফাইলটির ভেতরটা পূর্ণ হবে ও `STORAGE_DRIVER=s3` সেট হবে।
 *
 *   প্রত্যাশিত env: S3_ENDPOINT, S3_REGION, S3_BUCKET,
 *   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL
 */
export function s3Driver(): StorageDriver {
  const env = process.env;
  const ready = Boolean(
    env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_PUBLIC_URL,
  );
  const publicBase = (env.S3_PUBLIC_URL || '').replace(/\/$/, '');

  return {
    name: env.STORAGE_DRIVER === 'r2' ? 'cloudflare-r2' : 's3',
    configured: ready,
    reason: ready ? undefined : 'S3/R2 env সম্পূর্ণ নয় (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL)।',
    async put(input: PutInput): Promise<PutResult> {
      void input;
      // ── এখানে @aws-sdk/client-s3 দিয়ে PutObjectCommand চালান ──
      //   const s3 = new S3Client({ endpoint, region, credentials });
      //   await s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType, ACL:'public-read' }));
      //   return { url: `${publicBase}/${key}`, key };
      throw new Error(
        'S3/R2 ড্রাইভার প্রস্তুত কিন্তু নিষ্ক্রিয় — `@aws-sdk/client-s3` ইনস্টল করে s3.ts এর put() চালু করুন।',
      );
    },
    async del(url: string): Promise<void> {
      void url; // DeleteObjectCommand — SDK যোগ করলে চালু হবে
    },
    owns(url: string): boolean {
      return Boolean(publicBase) && url.startsWith(publicBase);
    },
  };
}
