import { prisma } from '../prisma';
import { registerJobHandler, type RunResult } from './scheduler';
import { renderTemplate } from './templates';
import { sendToEvent } from './dispatch';
import { APP_TIME_ZONE } from '../date';

/**
 * ★ টেলিগ্রাম বার্তার তারিখ/সময় — **ঢাকার** ঘড়িতে।
 *   আগে `toLocaleDateString('bn-BD')` সার্ভারের ঘড়ি ধরত; Vercel UTC-তে চলে,
 *   তাই মাপা (TZ=UTC): ঢাকার ২২/৯ রাত ৩:৩০ দেখাত "২১/৯ ৯:৩০ PM" — দৈনিক
 *   সারাংশের সময় ৬ ঘণ্টা ভুল, আর কুপনের মেয়াদ-তারিখ এক দিন আগের।
 */
const bnDay = (d: Date) => d.toLocaleDateString('bn-BD', { timeZone: APP_TIME_ZONE });
const bnTime = (d: Date) => d.toLocaleTimeString('bn-BD', { timeZone: APP_TIME_ZONE });

/**
 * ═══════════════════════════════════════════════════════════
 * ★ শিডিউলার জব হ্যান্ডলার — প্রতিটি **সত্যিকারের ডেটা** পড়ে।
 *
 *   নীতি: কোনো হ্যান্ডলার বানানো সংখ্যা পাঠায় না। ডেটা না থাকলে
 *   হয় কিছুই পাঠায় না (`skipped`), নয়তো শূন্য বলেই জানায়। "রিপোর্ট
 *   এসেছে কিন্তু সংখ্যাগুলো ভুয়া" — এর চেয়ে খারাপ কিছু নেই।
 *
 *   প্রতিটি হ্যান্ডলার `sendToEvent()` ব্যবহার করে, অর্থাৎ বহু-বট
 *   রাউটিং, ইভেন্ট সুইচ ও লগিং সবই বিদ্যমান পথেই যায় — নকল যুক্তি নেই।
 * ═══════════════════════════════════════════════════════════
 */

const bdt = (n: number) => `৳${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function windowStats(since: Date) {
  const [orders, revenue, deposits, pendingOrders, pendingDeposits] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: since } } }),
    prisma.order.aggregate({ _sum: { price: true }, where: { createdAt: { gte: since }, status: 'COMPLETED' } }),
    prisma.deposit.count({ where: { createdAt: { gte: since }, status: 'APPROVED' } }),
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.deposit.count({ where: { status: 'PENDING' } }),
  ]);
  return {
    orders,
    revenue: Number(revenue._sum.price ?? 0),
    deposits,
    pendingOrders,
    pendingDeposits,
  };
}

async function summaryJob(key: 'daily_summary' | 'weekly_summary', since: Date, title: string): Promise<RunResult> {
  const s = await windowStats(since);
  const body = await renderTemplate(key, {
    orders: s.orders,
    revenue: s.revenue.toFixed(2),
    deposits: s.deposits,
    pending: s.pendingOrders + s.pendingDeposits,
    date: bnDay(new Date()),
    time: bnTime(new Date()),
    site_name: 'SS UID TOPUP',
  });

  const text = body ?? `${title}\nঅর্ডার: ${s.orders}\nআয়: ${bdt(s.revenue)}\nডিপোজিট: ${s.deposits}`;
  const sent = await sendToEvent(key === 'daily_summary' ? 'daily_summary' : 'weekly_summary', title, text);
  return sent.ok
    ? { ok: true, detail: `${s.orders} অর্ডার, ${bdt(s.revenue)} আয় — ${sent.delivered} বটে পাঠানো` }
    : { ok: false, error: sent.error || 'পাঠানো যায়নি' };
}

registerJobHandler('daily_summary', () =>
  summaryJob('daily_summary', new Date(Date.now() - 86400_000), '📊 দৈনিক সারসংক্ষেপ'));

registerJobHandler('weekly_report', () =>
  summaryJob('weekly_summary', new Date(Date.now() - 7 * 86400_000), '📈 সাপ্তাহিক রিপোর্ট'));

registerJobHandler('monthly_report', async () => {
  const s = await windowStats(new Date(Date.now() - 30 * 86400_000));
  const sent = await sendToEvent('weekly_summary', '🗓️ মাসিক রিপোর্ট',
    `অর্ডার: ${s.orders}\nআয়: ${bdt(s.revenue)}\nডিপোজিট: ${s.deposits}\nপেন্ডিং: ${s.pendingOrders + s.pendingDeposits}`);
  return sent.ok ? { ok: true, detail: `${s.orders} অর্ডার` } : { ok: false, error: sent.error };
});

// ── রিমাইন্ডার: কিছু বকেয়া না থাকলে **কিছুই পাঠায় না** ──
registerJobHandler('pending_orders', async () => {
  const n = await prisma.order.count({ where: { status: 'PENDING' } });
  if (n === 0) return { ok: true, detail: 'কোনো পেন্ডিং অর্ডার নেই — পাঠানো হয়নি' };
  const body = await renderTemplate('reminder', { count: n, subject: 'পেন্ডিং অর্ডার' });
  const sent = await sendToEvent('order_new', '⏰ পেন্ডিং অর্ডার', body ?? `${n}টি অর্ডার অপেক্ষা করছে।`, '/admin/orders');
  return sent.ok ? { ok: true, detail: `${n}টি পেন্ডিং` } : { ok: false, error: sent.error };
});

registerJobHandler('pending_deposits', async () => {
  const n = await prisma.deposit.count({ where: { status: 'PENDING' } });
  if (n === 0) return { ok: true, detail: 'কোনো পেন্ডিং ডিপোজিট নেই — পাঠানো হয়নি' };
  const body = await renderTemplate('reminder', { count: n, subject: 'পেন্ডিং ডিপোজিট' });
  const sent = await sendToEvent('deposit_new', '⏰ পেন্ডিং ডিপোজিট', body ?? `${n}টি ডিপোজিট অপেক্ষা করছে।`, '/admin/deposits');
  return sent.ok ? { ok: true, detail: `${n}টি পেন্ডিং` } : { ok: false, error: sent.error };
});

registerJobHandler('low_stock_scan', async () => {
  const rows = await prisma.variant.findMany({
    where: { stock: { gte: 0, lte: 3 }, isActive: true },
    select: { label: true, stock: true, product: { select: { name: true } } },
    take: 20,
  });
  if (rows.length === 0) return { ok: true, detail: 'সব স্টক ঠিক আছে — পাঠানো হয়নি' };
  const list = rows.map((v) => `• ${v.product?.name ?? '—'} — ${v.label}: ${v.stock}`).join('\n');
  const sent = await sendToEvent('low_stock', '⚠️ স্টক কম', list, '/admin/products');
  return sent.ok ? { ok: true, detail: `${rows.length}টি ভ্যারিয়েন্ট` } : { ok: false, error: sent.error };
});

registerJobHandler('maintenance_reminder', async () => {
  const row = await prisma.setting.findUnique({ where: { key: 'maintenance_mode' } });
  if (row?.value !== '1') return { ok: true, detail: 'মেইনটেন্যান্স বন্ধ — পাঠানো হয়নি' };
  const sent = await sendToEvent('maintenance', '🚧 মেইনটেন্যান্স চালু আছে',
    'সাইট এখনো রক্ষণাবেক্ষণ মোডে — গ্রাহক অর্ডার করতে পারছে না।', '/admin/site');
  return sent.ok ? { ok: true, detail: 'মনে করিয়ে দেওয়া হয়েছে' } : { ok: false, error: sent.error };
});

async function campaignEdge(kind: 'start' | 'end'): Promise<RunResult> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3600_000);
  const rows = await prisma.campaign.findMany({
    where: kind === 'start'
      ? { isActive: true, startsAt: { gte: hourAgo, lte: now } }
      : { endsAt: { gte: hourAgo, lte: now } },
    select: { title: true, placement: true, kind: true },
    take: 10,
  });
  if (rows.length === 0) return { ok: true, detail: 'কিছু নেই — পাঠানো হয়নি' };
  const list = rows.map((c) => `• ${c.title || c.kind} (${c.placement})`).join('\n');
  const sent = await sendToEvent('campaign',
    kind === 'start' ? '📣 ক্যাম্পেইন শুরু হয়েছে' : '🏁 ক্যাম্পেইন শেষ হয়েছে', list, '/admin/homepage');
  return sent.ok ? { ok: true, detail: `${rows.length}টি` } : { ok: false, error: sent.error };
}
registerJobHandler('campaign_start', () => campaignEdge('start'));
registerJobHandler('campaign_end', () => campaignEdge('end'));

registerJobHandler('coupon_expiry', async () => {
  const soon = new Date(Date.now() + 3 * 86400_000);
  const rows = await prisma.coupon.findMany({
    where: { isActive: true, expiresAt: { gte: new Date(), lte: soon } },
    select: { code: true, expiresAt: true }, take: 20,
  });
  if (rows.length === 0) return { ok: true, detail: 'মেয়াদ শেষ হওয়ার মতো কুপন নেই' };
  const list = rows.map((c) => `• ${c.code} — ${c.expiresAt ? bnDay(c.expiresAt) : ''}`).join('\n');
  const sent = await sendToEvent('coupon', '🎟️ কুপনের মেয়াদ শেষ হচ্ছে', list, '/admin/coupons');
  return sent.ok ? { ok: true, detail: `${rows.length}টি কুপন` } : { ok: false, error: sent.error };
});

registerJobHandler('server_health', async () => {
  const t0 = Date.now();
  let dbOk = true;
  try { await prisma.$queryRaw`SELECT 1`; } catch { dbOk = false; }
  const dbMs = Date.now() - t0;
  const [logs24, fails24] = await Promise.all([
    prisma.telegramMessageLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86400_000) } } }),
    prisma.telegramMessageLog.count({ where: { ok: false, createdAt: { gte: new Date(Date.now() - 86400_000) } } }),
  ]);
  const up = Math.round(process.uptime() / 60);
  const text = `ডাটাবেস: ${dbOk ? `✅ ${dbMs}ms` : '❌ পৌঁছানো যায়নি'}\nআপটাইম: ${up} মিনিট\nটেলিগ্রাম বার্তা (২৪ঘ): ${logs24}, ব্যর্থ: ${fails24}`;
  const sent = await sendToEvent('server_warning', '🩺 সার্ভার হেলথ', text, '/admin/logs');
  return sent.ok ? { ok: true, detail: `db=${dbMs}ms` } : { ok: false, error: sent.error };
});

registerJobHandler('backup_status', async () => {
  // ★ এই অ্যাপে স্বয়ংক্রিয় ব্যাকআপ **চলে না** (`/api/admin/backup` ম্যানুয়াল)।
  //   তাই "সফল" বলে ভান না করে সত্যিটা জানানো হয়।
  const sent = await sendToEvent('server_warning', '💾 ব্যাকআপ অবস্থা',
    'স্বয়ংক্রিয় ব্যাকআপ কনফিগার করা নেই — অ্যাডমিন প্যানেল থেকে ম্যানুয়াল ব্যাকআপ নিন।', '/admin/tools');
  return sent.ok ? { ok: true, detail: 'অবস্থা জানানো হয়েছে' } : { ok: false, error: sent.error };
});

registerJobHandler('restart_notice', async () => {
  const up = Math.round(process.uptime() / 60);
  const sent = await sendToEvent('server_warning', '🔄 সিস্টেম চালু',
    `অ্যাপ চালু আছে — আপটাইম ${up} মিনিট।`, '/admin');
  return sent.ok ? { ok: true, detail: `uptime ${up}m` } : { ok: false, error: sent.error };
});

async function auditDigest(actions: string[], title: string, emptyMsg: string): Promise<RunResult> {
  const since = new Date(Date.now() - 86400_000);
  const rows = await prisma.adminLog.findMany({
    where: { action: { in: actions }, createdAt: { gte: since } },
    select: { action: true, detail: true, createdAt: true }, take: 20,
    orderBy: { createdAt: 'desc' },
  });
  if (rows.length === 0) return { ok: true, detail: emptyMsg };
  const list = rows.slice(0, 10).map((r) => `• ${r.action} — ${(r.detail ?? '').slice(0, 60)}`).join('\n');
  const sent = await sendToEvent('security_alert', title, `${rows.length}টি ঘটনা:\n${list}`, '/admin/logs');
  return sent.ok ? { ok: true, detail: `${rows.length}টি` } : { ok: false, error: sent.error };
}

registerJobHandler('security_digest', () =>
  auditDigest(['LOGIN_FAIL', 'BALANCE_ADJUST', 'SETTINGS_CHANGE'], '🛡️ নিরাপত্তা সারাংশ', 'কোনো ঘটনা নেই'));
registerJobHandler('failed_logins', () =>
  auditDigest(['LOGIN_FAIL'], '🔐 ব্যর্থ লগইন সারাংশ', 'কোনো ব্যর্থ লগইন নেই'));
registerJobHandler('fraud_report', async () => {
  // সন্দেহজনক: একই ইউজারের বহু পেন্ডিং ডিপোজিট
  const rows = await prisma.deposit.groupBy({
    by: ['userId'], where: { status: 'PENDING' },
    _count: { _all: true }, having: { userId: { _count: { gte: 3 } } },
  });
  if (rows.length === 0) return { ok: true, detail: 'সন্দেহজনক কিছু নেই' };
  const sent = await sendToEvent('security_alert', '🚨 সন্দেহজনক কার্যকলাপ',
    `${rows.length} জন ইউজারের ৩+ পেন্ডিং ডিপোজিট আছে — যাচাই করুন।`, '/admin/deposits');
  return sent.ok ? { ok: true, detail: `${rows.length} জন` } : { ok: false, error: sent.error };
});
