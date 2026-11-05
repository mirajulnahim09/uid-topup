// ★ verify-স্যুটগুলোর প্রত্যাশিত `customer@uidtopup.local` — সিম DB-তে, ব্যালেন্স আসল ডিপোজিট-পথে (খতিয়ান-সঙ্গত)
import { db, call, mintCookie } from '../_lib';
import bcrypt from 'bcryptjs';
(async () => {
  const password = await bcrypt.hash('Customer@2026Secure', 12);
  const u = await db.user.upsert({
    where: { email: 'customer@uidtopup.local' },
    update: { password, isBanned: false, emailVerified: true },
    create: { email: 'customer@uidtopup.local', name: 'টেস্ট গ্রাহক', phone: '01700000009', password, emailVerified: true, referralCode: 'DEVCUST1' },
  });
  if (Number(u.balance) < 5000) {
    const c = await mintCookie(u); const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
    const trxId = `DEVCUST${Date.now().toString(36).toUpperCase()}`;
    await db.rateLimitBucket.deleteMany({});
    const r = await call('d', c, 'POST', '/api/deposit', { method: 'BKASH', amount: 5000, trxId, senderNo: '01700000009' });
    const d = await db.deposit.findUniqueOrThrow({ where: { trxId } });
    const a = await call('a', A, 'POST', '/api/admin/deposit', { depositId: d.id, action: 'APPROVE' });
    console.log('deposit', r.status, 'approve', a.status);
  }
  console.log('balance', (await db.user.findUniqueOrThrow({ where: { id: u.id } })).balance.toString());
})().finally(() => db.$disconnect());
