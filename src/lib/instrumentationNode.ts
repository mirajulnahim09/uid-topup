/**
 * ★ `src/instrumentation.ts`-এর Node-কেবল অংশ — আলাদা ফাইলে কারণ Next
 *   instrumentation-কে Edge-এর জন্যও কম্পাইল করে, আর সেখানে `v8`/`process.on`
 *   নেই (মাপা: `node:v8` import-এ edge বিল্ড ভেঙে পুরো সার্ভার ৫০০ দিয়েছিল)।
 *   কেবল `NEXT_RUNTIME === 'nodejs'` শাখা থেকে dynamic import হয়।
 */
import v8 from 'v8';
import { logger } from './logger';

export function registerNodeProcessHooks(): void {
  process.on('unhandledRejection', (reason) => {
    logger.error('process', 'unhandled promise rejection', {
      err: reason instanceof Error ? reason : new Error(String(reason)),
    });
  });

  process.on('uncaughtExceptionMonitor', (err, origin) => {
    logger.error('process', 'uncaught exception', { err, origin });
  });

  // ★ heap-চাপের আগাম সংকেত — ৩০s অন্তর, প্রতি প্রসেসে সর্বোচ্চ একবার বার্তা।
  //   `unref()` — এই টাইমার কখনো প্রসেসকে জীবিত রাখে না (serverless freeze নিরাপদ)।
  const limit = v8.getHeapStatistics().heap_size_limit;
  let warned = false;
  setInterval(() => {
    if (warned) return;
    const used = process.memoryUsage().heapUsed;
    if (used / limit >= 0.85) {
      warned = true;
      logger.error('process', 'heap above 85% of limit — OOM risk', {
        heapMB: Math.round(used / 1048576), limitMB: Math.round(limit / 1048576),
      });
    }
  }, 30_000).unref();
}
