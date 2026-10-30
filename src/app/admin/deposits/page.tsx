import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import DepositTable from '@/components/admin/DepositTable';
import DepositQueue from '@/components/admin/DepositQueue';
import { assessDeposits } from '@/lib/riskSignals';
import { requireAdminPage } from '@/lib/pageGuard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ডিপোজিট' };

const VALID = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type S = (typeof VALID)[number];

const TABS: Array<{ key: string; label: string; href: string }> = [
  { key: 'PENDING', label: 'যাচাই বাকি', href: '/admin/deposits' },
  { key: 'ALL', label: 'সব', href: '/admin/deposits?status=ALL' },
  { key: 'APPROVED', label: 'অনুমোদিত', href: '/admin/deposits?status=APPROVED' },
  { key: 'REJECTED', label: 'বাতিল', href: '/admin/deposits?status=REJECTED' },
];

export default async function AdminDeposits({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  // ★ SEC-01 — পাতার নিজস্ব DB-গার্ড (সফট-নেভিগেশনে লেআউট চলে না)
  await requireAdminPage();
  const s = searchParams.status;
  const status = s && (VALID as readonly string[]).includes(s) ? (s as S) : undefined;

  // ★ ডিফল্ট = অপেক্ষমান কাজের কিউ (MANUAL_WORKFLOW.md B1)।
  //   অ্যাডমিন এখানে আসে **কাজ করতে**, ইতিহাস ঘাঁটতে নয়।
  const isQueue = !s || s === 'PENDING';

  const deposits = await prisma.deposit.findMany({
    where: isQueue ? { status: 'PENDING' } : status ? { status } : {},
    // ★ কিউতে পুরনোটাই আগে — যে সবচেয়ে বেশি অপেক্ষা করছে
    orderBy: isQueue ? { createdAt: 'asc' } : [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    include: {
      user: {
        // ★ createdAt — নতুন অ্যাকাউন্টে বড় দাবির সংকেতের জন্য (3.5)
        select: { id: true, name: true, phone: true, balance: true, createdAt: true },
      },
    },
  });

  // ★ ঝুঁকির সংকেত — বিদ্যমান তথ্য থেকে হিসাব (3.5)।
  //   কোনো CustomerRisk টেবিল নেই — সিদ্ধান্ত অনুযায়ী derived।
  //   assessDeposits() ভেতরে সব গ্রাহকের ইতিহাস একবারেই আনে (N+1 নয়)।
  const risks = isQueue
    ? await assessDeposits(
        deposits.map((d) => ({
          id: d.id,
          userId: d.userId,
          amount: Number(d.amount),
          senderNo: d.senderNo,
          createdAt: d.createdAt,
        })),
        new Map(
          deposits.map((d) => [
            d.userId,
            { phone: d.user.phone, createdAt: d.user.createdAt },
          ])
        )
      )
    : new Map();

  const EMPTY_RISK = {
    level: 'normal' as const,
    signals: [],
    approvedCount: 0,
    rejectedCount: 0,
  };

  const pendingCount = await prisma.deposit.count({ where: { status: 'PENDING' } });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">ডিপোজিট রিকোয়েস্ট</h1>
        {pendingCount > 0 && (
          <span
            className="rounded-lg px-3 py-1.5 text-sm font-bold"
            style={{ background: 'rgba(var(--gold-glow),.12)', color: 'var(--gold)' }}
          >
            {pendingCount} টি যাচাই বাকি
          </span>
        )}
      </div>

      {/* ★ ফিল্টার — কিউ ও ইতিহাসের মধ্যে স্পষ্ট বিভাজন */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = t.key === 'PENDING' ? isQueue : s === t.key;
          return (
            <Link
              key={t.key}
              href={t.href}
              className="inline-flex min-h-[40px] items-center px-4 text-xs font-bold transition"
              style={{
                background: active ? 'rgba(var(--gold-glow),.12)' : 'var(--glass)',
                // ★ সক্রিয় বর্ডারটি **নিরেট** `--gold`, আভা নয় — এটি
                //   "কোন ট্যাবে আছি" বোঝানোর সীমানা, তাই WCAG 1.4.11
                //   অনুযায়ী পৃষ্ঠতলের বিপরীতে ≥৩:১ লাগে। মাপা: .45
                //   আভায় লাইটে ছিল **১.২৪:১** (কার্যত অদৃশ্য), নিরেটে
                //   ৪.১৪:১; ডার্কে ৩.৬৯ → ১৩.৪:১।
                border: `1px solid ${active ? 'var(--gold)' : 'var(--hair)'}`,
                color: active ? 'var(--gold)' : 'var(--mut)',
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {isQueue ? (
        <DepositQueue
          deposits={deposits.map((d) => {
            const r = risks.get(d.id) ?? EMPTY_RISK;
            return {
              id: d.id,
              depositNo: d.depositNo,
              method: d.method,
              amount: Number(d.amount),
              trxId: d.trxId,
              senderNo: d.senderNo,
              screenshot: d.screenshot,
              createdAt: d.createdAt.toISOString(),
              user: {
                id: d.user.id,
                name: d.user.name,
                phone: d.user.phone,
                balance: Number(d.user.balance),
                approvedCount: r.approvedCount,
                rejectedCount: r.rejectedCount,
              },
              risk: { level: r.level, signals: r.signals },
            };
          })}
        />
      ) : (
        <DepositTable
          current={status ?? 'ALL'}
          deposits={deposits.map((d) => ({
            id: d.id,
            depositNo: d.depositNo,
            method: d.method,
            amount: Number(d.amount),
            trxId: d.trxId,
            senderNo: d.senderNo,
            screenshot: d.screenshot,
            status: d.status,
            adminNote: d.adminNote,
            createdAt: d.createdAt.toISOString(),
            user: {
              name: d.user.name,
              phone: d.user.phone,
              balance: Number(d.user.balance),
            },
          }))}
        />
      )}
    </div>
  );
}
