const MAP: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'পেন্ডিং', cls: 'bg-amber-100 text-amber-800 border border-amber-200' },
  PROCESSING: { label: 'প্রসেসিং', cls: 'bg-blue-100 text-blue-800 border border-blue-200' },
  COMPLETED: { label: 'সম্পন্ন', cls: 'bg-emerald-100 text-emerald-800 border border-emerald-200' },
  APPROVED: { label: 'অনুমোদিত', cls: 'bg-emerald-100 text-emerald-800 border border-emerald-200' },
  FAILED: { label: 'ব্যর্থ', cls: 'bg-red-100 text-red-800 border border-red-200' },
  REJECTED: { label: 'বাতিল', cls: 'bg-red-100 text-red-800 border border-red-200' },
  REFUNDED: { label: 'ফেরত', cls: 'bg-purple-100 text-purple-800 border border-purple-200' },
};

export default function Badge({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border border-slate-200' };
  return <span className={`badge whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}
