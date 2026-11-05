import { prisma } from './prisma';
import { isEmailConfigured, isSandboxSender } from './email';
import { getStorage } from './storage';
import { isErrorReportingConfigured } from './errorReporter';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ সিস্টেম হেলথ — একটাই সত্যের উৎস (single source of truth)
 *
 *   কেন আলাদা module: হেলথ-তথ্য দুই জায়গায় লাগে —
 *     1. পাবলিক `/api/health` (আপটাইম মনিটর পিং করে)
 *     2. অ্যাডমিন Health Dashboard (মালিক এক নজরে দেখে)
 *   একই যুক্তি দুবার লিখলে একদিন একটা আপডেট হতো, অন্যটা বাসি
 *   থেকে যেত। তাই সব সাবসিস্টেমের অবস্থা এখান থেকেই আসে।
 *
 *   ⚠️ কোনো সংবেদনশীল মান (টোকেন/কী/সংযোগ-স্ট্রিং) কখনো ফেরত
 *      দেওয়া হয় না — শুধু "configured / up / down" ধরনের অবস্থা।
 *
 *   ⚠️ প্রতিটি check নিজের ভেতরে try/catch করা — একটা সাবসিস্টেম
 *      ভাঙা থাকলেও পুরো হেলথ-রিপোর্ট যেন ৫০০ না হয়।
 * ═══════════════════════════════════════════════════════════
 */

export type CheckState = 'up' | 'down' | 'not_configured' | 'unknown';

export type SubsystemHealth = {
  key: string;
  label: string;
  /** সার্ভিস চালু থাকা **আবশ্যক** কিনা। false হলে not_configured → degraded নয়। */
  critical: boolean;
  state: CheckState;
  latencyMs?: number;
  detail?: string;
};

export type SystemHealth = {
  status: 'ok' | 'degraded';
  checkedAt: string;
  totalMs: number;
  subsystems: SubsystemHealth[];
};

/** ডাটাবেস — একমাত্র সত্যিকারের critical সাবসিস্টেম */
async function checkDatabase(): Promise<SubsystemHealth> {
  const t = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { key: 'database', label: 'Database', critical: true, state: 'up', latencyMs: Date.now() - t };
  } catch (e) {
    return {
      key: 'database', label: 'Database', critical: true, state: 'down',
      latencyMs: Date.now() - t,
      detail: e instanceof Error ? e.message.slice(0, 120) : 'সংযোগ ব্যর্থ',
    };
  }
}

/** ইমেইল (Resend) — কনফিগার করা আছে কিনা (আসল পাঠানো টেস্ট করি না, কোটা নষ্ট হবে) */
function checkEmail(): SubsystemHealth {
  const base = { key: 'email', label: 'Email (Resend)', critical: false } as const;

  if (!isEmailConfigured()) {
    return { ...base, state: 'not_configured',
      detail: 'RESEND_API_KEY সেট নেই — পাসওয়ার্ড রিসেট/ইমেইল বন্ধ' };
  }

  /**
   * ⚠️⚠️ কী থাকলেই ইমেইল কাজ করে না। `EMAIL_FROM` ডিফল্টে Resend-এর
   *   স্যান্ডবক্স প্রেরক, যা দিয়ে কেবল অ্যাকাউন্টের নিজের ঠিকানায় মেইল
   *   যায় — অর্থাৎ **নতুন কোনো গ্রাহক OTP পাবেন না**, রেজিস্ট্রেশনই
   *   অসম্ভব। আগে এই অবস্থাতেও এখানে `up` দেখাত, তাই ভাঙা ফানেলটি
   *   কোনো ড্যাশবোর্ডে ধরা পড়ত না। এখন পড়ে।
   */
  if (isSandboxSender()) {
    return { ...base, state: 'down',
      detail: 'EMAIL_FROM এখনো Resend স্যান্ডবক্স (@resend.dev) — মালিক ছাড়া কেউ OTP বা রিসেট মেইল পাবেন না। ডোমেইন verify করে EMAIL_FROM বদলান।' };
  }

  return { ...base, state: 'up' };
}

/** স্টোরেজ ড্রাইভার — কোন ড্রাইভার সক্রিয় ও কনফিগার করা কিনা */
function checkStorage(): SubsystemHealth {
  try {
    const drv = getStorage();
    return {
      key: 'storage', label: `Storage (${drv.name})`, critical: false,
      state: drv.configured ? 'up' : 'not_configured',
      detail: drv.configured ? undefined : drv.reason,
    };
  } catch (e) {
    return {
      key: 'storage', label: 'Storage', critical: false, state: 'unknown',
      detail: e instanceof Error ? e.message.slice(0, 120) : undefined,
    };
  }
}

/** টেলিগ্রাম — অন্তত একটি বট কনফিগার করা আছে কিনা (dynamic import, telegram স্তর ভারী) */
async function checkTelegram(): Promise<SubsystemHealth> {
  try {
    const { getPrimaryBot } = await import('./telegram/store');
    const bot = await getPrimaryBot();
    return {
      key: 'telegram', label: 'Telegram', critical: false,
      state: bot ? 'up' : 'not_configured',
      detail: bot ? undefined : 'কোনো অ্যাডমিন-বট কনফিগার করা নেই',
    };
  } catch (e) {
    return {
      key: 'telegram', label: 'Telegram', critical: false, state: 'unknown',
      detail: e instanceof Error ? e.message.slice(0, 120) : undefined,
    };
  }
}

/** এরর মনিটরিং (Sentry-সামঞ্জস্যপূর্ণ) — DSN কনফিগার করা কিনা */
function checkErrorReporting(): SubsystemHealth {
  return {
    key: 'monitoring', label: 'Error Monitoring', critical: false,
    state: isErrorReportingConfigured() ? 'up' : 'not_configured',
    detail: isErrorReportingConfigured() ? undefined : 'SENTRY_DSN সেট নেই — production exception অদৃশ্য',
  };
}

/**
 * ★ পূর্ণ হেলথ রিপোর্ট। সব check সমান্তরালে চলে (দ্রুত)।
 *   status = 'degraded' কেবল তখনই যখন কোনো **critical** সাবসিস্টেম down।
 *   not_configured (ঐচ্ছিক ফিচার) কখনো degraded বানায় না।
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  const started = Date.now();

  const [database, telegram] = await Promise.all([checkDatabase(), checkTelegram()]);
  const email = checkEmail();
  const storage = checkStorage();
  const monitoring = checkErrorReporting();

  const subsystems: SubsystemHealth[] = [database, email, storage, telegram, monitoring];

  const degraded = subsystems.some((s) => s.critical && s.state === 'down');

  return {
    status: degraded ? 'degraded' : 'ok',
    checkedAt: new Date().toISOString(),
    totalMs: Date.now() - started,
    subsystems,
  };
}
