import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireUserPage } from '@/lib/pageGuard';
import { fmtDate } from '@/lib/date';
import Icon from '@/components/fx/Icon';
import CodeReveal from '@/components/account/CodeReveal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'আমার কোড' };

/**
 * "My Codes" — every voucher code delivered to this customer.
 * Codes are read only through the customer's own orders, so one
 * customer can never see another's code.
 */
export default async function MyCodesPage() {
  const me = await requireUserPage();

  const codes = await prisma.voucherCode.findMany({
    where: { status: 'ASSIGNED', order: { userId: me.id } },
    orderBy: { assignedAt: 'desc' },
    take: 100,
    select: {
      id: true, code: true, assignedAt: true,
      order: { select: { id: true, orderNo: true, productName: true, variantName: true } },
    },
  });

  const waiting = await prisma.order.count({
    where: { userId: me.id, status: 'PENDING', variant: { product: { deliveryType: 'CODE' } } },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">আমার কোড</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">
          গিফট কার্ড, ভাউচার ও সাবস্ক্রিপশনের কোড — অর্ডার সম্পন্ন হলেই এখানে চলে আসে।
        </p>
      </div>

      {waiting > 0 && (
        <div className="card flex items-center gap-3 p-4 text-sm" style={{ color: 'var(--v-ink)' }}>
          <span className="v-blink inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--sem-warning)' }} aria-hidden />
          {waiting}টি অর্ডারের কোড প্রস্তুত হচ্ছে — স্টকে এলেই এখানে দেখাবে, নোটিফিকেশনও পাবেন।
        </div>
      )}

      {codes.length === 0 ? (
        <div className="card py-16 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl" style={{ border: '1px solid var(--v-edge)', color: 'var(--v-ice)' }}>
            <Icon name="gift" size={26} />
          </span>
          <p className="mt-3 text-slate-400">এখনো কোনো কোড নেই</p>
          <Link href="/" className="btn-primary mt-5">প্রোডাক্ট দেখুন</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {codes.map((c) => (
            <li key={c.id} className="card p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>{c.order?.productName}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--v-mut)' }}>{c.order?.variantName}</p>
                </div>
                <div className="text-right text-xs" style={{ color: 'var(--v-mut)' }}>
                  {c.order && (
                    <Link href={`/account/orders/${c.order.id}`} className="font-mono font-bold hover:underline" style={{ color: 'var(--v-ice)' }}>
                      #{c.order.orderNo}
                    </Link>
                  )}
                  {c.assignedAt && <p className="mt-0.5">{fmtDate(c.assignedAt)}</p>}
                </div>
              </div>
              <CodeReveal code={c.code} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-relaxed" style={{ color: 'var(--v-dim)' }}>
        ⚠️ কোড কাউকে দেখাবেন না। কোড কাজ না করলে অর্ডার পাতা থেকে সাপোর্ট টিকিট খুলুন।
      </p>
    </div>
  );
}
