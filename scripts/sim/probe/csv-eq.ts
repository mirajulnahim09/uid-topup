// ★ স্ট্রিম-CSV বনাম পুরনো (পুরো-মেমরি) অ্যালগরিদম — বাইট-সমান? আর কত সময়?
import { db, call, mintCookie } from '../_lib';
import { dhakaDayStart } from '../../../src/lib/date';
function cell(v: unknown): string { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; }
const toCsv = (h: string[], rows: unknown[][]) => '﻿' + [h.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const t = Date.now();
  const r = await call('csv', A, 'GET', '/api/admin/reports?type=orders', undefined, { timeoutMs: 300_000 });
  const ms = Date.now() - t;
  const from = new Date(Date.now() - 30 * 864e5); const to = new Date(dhakaDayStart(new Date(), 1).getTime() - 1);
  const rows = await db.order.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { user: { select: { name: true, phone: true } } } });
  const exp = toCsv(['অর্ডার নং', 'নাম', 'ফোন', 'প্রোডাক্ট', 'প্যাকেজ', 'UID', 'মূল্য', 'ছাড়', 'স্ট্যাটাস', 'তারিখ'],
    rows.map((o) => [o.orderNo, o.user.name, o.user.phone, o.productName, o.variantName, o.playerUid, Number(o.price), Number(o.discount), o.status, o.createdAt.toISOString()]));
  // ⚠️ from = "এখন − ৩০ দিন" দুই জায়গায় কয়েক সেকেন্ড আলাদা — সীমান্তের সারি বাদে তুলনা
  // ⚠️ fetch().text() BOM কেটে ফেলে (TextDecoder-এর ডিফল্ট) — দুদিক থেকেই বাদ
  const got = r.text.replace(/^﻿/, '').split('\r\n'); const want = exp.replace(/^﻿/, '').split('\r\n');
  const n = Math.min(got.length, want.length) - 20;
  console.log('BOM উত্তরের বাইটে আছে?', r.headers ? 'দেখুন নিচে' : '', Buffer.from(r.text.slice(0, 1)).toString('hex'));
  const same = got.slice(0, n).every((l, i) => l === want[i]);
  console.log(`HTTP ${r.status} · ${ms}ms · ${Math.round(r.text.length / 1024)}KB · সারি ${got.length - 1} (প্রত্যাশিত ${want.length - 1}) · হুবহু-সমান ${same}`);
  if (!same) { for (let i = 0; i < n; i++) if (got[i] !== want[i]) { console.log('প্রথম অমিল', i, JSON.stringify(got[i])?.slice(0, 120), '|', JSON.stringify(want[i])?.slice(0, 120)); break; } }
})().finally(() => db.$disconnect());
