/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ env লোড — **সবচেয়ে আগে, একা**
 *
 *   ⚠️ এই ফাইলে `@next/env` ছাড়া আর **কোনো import রাখা যাবে না**।
 *
 *   কারণ: ESM এ সব `import` তার মডিউলের যেকোনো statement এর **আগে**
 *   চলে। `_db.ts` এ `loadEnvConfig()` এর উপরে `@prisma/client` ইম্পোর্ট
 *   করা ছিল, আর `@prisma/client` লোড হওয়ার সময়েই নিজে `.env` পড়ে
 *   `process.env.DATABASE_URL` বসিয়ে দেয় — অর্থাৎ **লাইভ Neon**।
 *   `loadEnvConfig` আগে থেকে বসানো মান কখনো override করে না, তাই
 *   `.env.development` এর ডেভ URL আর কখনো কার্যকর হতো না।
 *   (ধরা পড়েছিল `_db.ts` এর নিজের গার্ডেই — স্ক্রিপ্ট চলতে অস্বীকার করে।)
 *
 *   এখন ক্রমটি এমন: consumer → `_db` → **`_env`** → `@prisma/client`।
 *   `_env` পুরোপুরি চলার পরেই Prisma লোড হয়, তাই সে ততক্ষণে ঠিক
 *   DATABASE_URL দেখতে পায়।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';

// ⚠️ `dev = true` — `.env.development` কে `.env` এর উপরে বসানোর একমাত্র উপায়
loadEnvConfig(process.cwd(), true);

export {};
