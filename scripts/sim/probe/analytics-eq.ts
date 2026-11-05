// ★ revenueTrend/customerInsights: পুরনো JS-অ্যালগরিদম বনাম নতুন SQL — একই ফল?
import { db } from '../_lib';
import { revenueTrend, customerInsights } from '../../../src/lib/analytics';
(async () => {
  const days = 30; const OFF = 6 * 3600_000;
  const nowBd = new Date(Date.now() + OFF); const s0 = new Date(nowBd); s0.setUTCHours(0, 0, 0, 0); s0.setUTCDate(s0.getUTCDate() - (days - 1));
  const since = new Date(s0.getTime() - OFF);
  const orders = await db.order.findMany({ where: { status: 'COMPLETED', completedAt: { gte: since } }, select: { completedAt: true, price: true, costPrice: true, refundedAmount: true } });
  const b = new Map<string, any>();
  for (let i = 0; i < days; i++) { const d = new Date(s0); d.setUTCDate(s0.getUTCDate() + i); const k = d.toISOString().slice(0, 10); b.set(k, { date: k, revenue: 0, cost: 0, profit: 0, orders: 0 }); }
  for (const o of orders) { const k = new Date(o.completedAt!.getTime() + OFF).toISOString().slice(0, 10); const x = b.get(k); if (!x) continue; const r = Number(o.price), c = Number(o.costPrice), f = Number(o.refundedAmount); x.revenue += r; x.cost += c; x.profit += r - c - f; x.orders++; }
  const old = [...b.values()].map((x) => ({ ...x, revenue: Math.round(x.revenue * 100) / 100, cost: Math.round(x.cost * 100) / 100, profit: Math.round(x.profit * 100) / 100 }));
  const neu = await revenueTrend(days);
  let diff = 0; for (let i = 0; i < days; i++) if (JSON.stringify(old[i]) !== JSON.stringify(neu[i])) { diff++; if (diff < 4) console.log('DIFF', JSON.stringify(old[i]), JSON.stringify(neu[i])); }
  const groups = await db.order.groupBy({ by: ['userId'], where: { status: 'COMPLETED' }, _count: { userId: true }, having: { userId: { _count: { gt: 1 } } } });
  const ci = await customerInsights();
  console.log(`revenueTrend: ${days} দিন, অমিল ${diff} · নমুনা`, JSON.stringify(neu.filter((x) => x.orders).slice(-2)));
  console.log(`repeatCustomers পুরনো ${groups.length} · নতুন ${ci.repeatCustomers}`);
})().finally(() => db.$disconnect());
