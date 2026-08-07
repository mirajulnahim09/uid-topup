/**
 * ★★★ কাস্টমার ৩৬০ টাইমলাইন (3.13)
 *
 *   পেজে আগে থেকেই তিনটি আলাদা তালিকা আছে — অর্ডার, ডিপোজিট,
 *   খতিয়ান। প্রতিটি নিজের জায়গায় ঠিক, কিন্তু বিরোধ মেটানোর সময়
 *   প্রশ্নটা হয় **ক্রম** নিয়ে: "টাকা ঢুকেছিল আগে না অর্ডার হয়েছিল
 *   আগে?", "রিফান্ডটা কি অভিযোগের পরে হয়েছিল?"
 *
 *   তিন টেবিলের টাইমস্ট্যাম্প মাথায় মিলিয়ে সেই ক্রম বানানো
 *   কষ্টকর ও ভুলপ্রবণ। এখানে সব ঘটনা এক ধারায় মিশিয়ে দেওয়া হয়।
 *
 *   ⚠️ পুরনো তালিকাগুলো সরানো হয়নি — সেগুলোতে যে বিস্তারিত কলাম
 *   আছে তা এখানে নেই। টাইমলাইন "কখন কী হলো", তালিকা "পুরো বিবরণ"।
 *   দুটো আলাদা প্রশ্নের উত্তর (§18 — কাজের জিনিস সরানো হয় না)।
 */

export type TimelineKind =
  | 'ACCOUNT' | 'DEPOSIT' | 'ORDER' | 'LEDGER' | 'ADMIN';

export type TimelineEvent = {
  at: Date;
  kind: TimelineKind;
  icon: string;
  title: string;
  detail?: string;
  /** টাকার অঙ্ক — থাকলে ডানপাশে দেখানো হয় */
  amount?: number;
  /** ধনাত্মক = ব্যালেন্স বেড়েছে */
  positive?: boolean;
  tone?: 'good' | 'bad' | 'warn';
};

type DepositRow = {
  depositNo: number; method: string; amount: unknown; trxId: string;
  status: string; createdAt: Date; reviewedAt: Date | null; adminNote: string | null;
};
type OrderRow = {
  orderNo: number; productName: string; variantName: string; playerUid: string;
  price: unknown; status: string; createdAt: Date; completedAt: Date | null;
  adminNote: string | null;
};
type LedgerRow = {
  type: string; amount: unknown; balanceAfter: unknown; note: string | null; createdAt: Date;
};
type AdminRow = {
  action: string; adminName: string; detail: string | null; createdAt: Date;
};

const n = (v: unknown) => Number(v);

export function buildTimeline(args: {
  createdAt: Date;
  deposits: DepositRow[];
  orders: OrderRow[];
  ledger: LedgerRow[];
  adminActions: AdminRow[];
}): TimelineEvent[] {
  const ev: TimelineEvent[] = [];

  ev.push({
    at: args.createdAt,
    kind: 'ACCOUNT',
    icon: '👤',
    title: 'অ্যাকাউন্ট খোলা হয়েছে',
  });

  for (const d of args.deposits) {
    ev.push({
      at: d.createdAt,
      kind: 'DEPOSIT',
      icon: '📥',
      title: `ডিপোজিট #${d.depositNo} জমা — ${d.method}`,
      detail: `TrxID: ${d.trxId}`,
      amount: n(d.amount),
    });
    // ★ যাচাইয়ের ঘটনাটি আলাদা — জমা আর অনুমোদনের **মধ্যের সময়**
    //   বিরোধে সবচেয়ে বেশি কাজে লাগে
    if (d.reviewedAt) {
      const approved = d.status === 'APPROVED';
      ev.push({
        at: d.reviewedAt,
        kind: 'DEPOSIT',
        icon: approved ? '✅' : '❌',
        title: `ডিপোজিট #${d.depositNo} ${approved ? 'অনুমোদিত' : 'বাতিল'}`,
        detail: d.adminNote ?? undefined,
        amount: approved ? n(d.amount) : undefined,
        positive: approved,
        tone: approved ? 'good' : 'bad',
      });
    }
  }

  for (const o of args.orders) {
    ev.push({
      at: o.createdAt,
      kind: 'ORDER',
      icon: '🛒',
      title: `অর্ডার #${o.orderNo} — ${o.variantName}`,
      detail: `${o.productName} · UID ${o.playerUid}`,
      amount: n(o.price),
      positive: false,
    });
    if (o.completedAt) {
      const done = o.status === 'COMPLETED';
      ev.push({
        at: o.completedAt,
        kind: 'ORDER',
        icon: done ? '🎉' : '↩️',
        title: `অর্ডার #${o.orderNo} ${done ? 'ডেলিভারি সম্পন্ন' : o.status === 'REFUNDED' ? 'বাতিল — রিফান্ড' : 'ব্যর্থ'}`,
        detail: o.adminNote ?? undefined,
        tone: done ? 'good' : 'bad',
      });
    }
  }

  for (const l of args.ledger) {
    // ★ শুধু সেই খতিয়ান যেগুলোর নিজস্ব ঘটনা উপরে নেই — নইলে
    //   একই ঘটনা দুবার দেখাত (ডিপোজিট অনুমোদন = DEPOSIT entry)
    if (l.type === 'DEPOSIT' || l.type === 'ORDER' || l.type === 'REFUND') continue;
    ev.push({
      at: l.createdAt,
      kind: 'LEDGER',
      icon: l.type === 'REFERRAL_BONUS' ? '🎁' : '⚖️',
      title: l.type === 'REFERRAL_BONUS' ? 'রেফারেল বোনাস' : 'অ্যাডমিন ব্যালেন্স সমন্বয়',
      detail: l.note ?? undefined,
      amount: Math.abs(n(l.amount)),
      positive: n(l.amount) > 0,
      tone: 'warn',
    });
  }

  for (const a of args.adminActions) {
    ev.push({
      at: a.createdAt,
      kind: 'ADMIN',
      icon: a.action.includes('BAN') ? '🚫' : '🛠️',
      title: `অ্যাডমিন: ${a.action}`,
      detail: [a.adminName, a.detail].filter(Boolean).join(' — '),
      tone: 'warn',
    });
  }

  // ★ নতুন আগে — বিরোধ প্রায় সবসময় সাম্প্রতিক ঘটনা নিয়ে
  return ev.sort((x, y) => y.at.getTime() - x.at.getTime());
}
