import type { ReactNode } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ DataTable — প্ল্যাটফর্মের একক টেবিল-লেআউট ইঞ্জিন
 *
 *   **একটি কলাম = একটি সংজ্ঞা।** হেডার, প্রস্থ ও alignment একই
 *   অবজেক্ট থেকে আসে, আর কম্পোনেন্টটিই `<th>` ও `<td>` দুটো তৈরি
 *   করে। ফলে "হেডারে এক alignment, সেলে আরেক" — এই শ্রেণির বাগ
 *   **অসম্ভব**, নিয়মশৃঙ্খলার প্রশ্ন নয়।
 *
 *   কেন এটি দরকার হলো: হাতে-লেখা টেবিলে হেডার ও সেল আলাদা জায়গায়
 *   লেখা হয়, তাই একটির alignment বদলে অন্যটি ভুলে যাওয়া যায়। এই
 *   কোডবেসে ঠিক তাই ঘটেছিল — `<th className="text-right">` নীরবে
 *   ব্যর্থ হচ্ছিল (নির্দিষ্টতা দ্বন্দ্ব, `globals.css` §কলাম-কর্তৃপক্ষ
 *   দেখুন), অথচ `<td>` ঠিকই ডানে যাচ্ছিল।
 *
 *   ⚠️ প্রস্থ **কেবল** `width` প্রপ দিয়ে — `<colgroup>` এ একবার বসে
 *   ও পুরো কলামে প্রযোজ্য হয়। কখনো `th` আর `td` তে আলাদা প্রস্থ নয়।
 *
 *   ⚠️ এটি একটি server component (কোনো hook নেই), তাই server ও
 *   client দুই জায়গাতেই ব্যবহার করা যায়।
 * ═══════════════════════════════════════════════════════════
 */

export type Align = 'left' | 'right' | 'center';

export type Column<T> = {
  /** React key ও ডিবাগিং-এর জন্য */
  key: string;
  /** হেডারে যা দেখাবে */
  header: ReactNode;
  /** সারির জন্য সেলের বিষয়বস্তু */
  cell: (row: T, index: number) => ReactNode;
  /** হেডার **ও** সেল — দুটোতেই একই alignment বসে */
  align?: Align;
  /** `<colgroup>` এ একবার; হেডার/সেলে আলাদা প্রস্থ কখনো নয় */
  width?: string;
  /** হেডার **ও** সেল — দুটোতেই একই বাড়তি ক্লাস */
  className?: string;
  /** কেবল সেলে (যেমন `font-mono`) — alignment এখানে দেওয়া নিষিদ্ধ */
  cellClassName?: string;
  /** চেকবক্স-কলামের মতো, যেখানে হেডার-লেখা শুধু স্ক্রিন-রিডারের জন্য */
  srOnlyHeader?: boolean;
};

/** alignment → সিস্টেমের শব্দভাণ্ডার (Tailwind ইউটিলিটি **নয়**) */
const ALIGN_CLASS: Record<Align, string> = { left: '', right: 'num', center: 'ctr' };

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'কোনো তথ্য নেই',
  rowClassName,
  minWidth,
  className = '',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  rowClassName?: (row: T, index: number) => string | undefined;
  /** ডিফল্ট `.tbl` এর ৬৪০px; চওড়া টেবিলে বাড়ানো যায় */
  minWidth?: number;
  className?: string;
}) {
  const cls = (c: Column<T>, extra?: string) =>
    [ALIGN_CLASS[c.align ?? 'left'], c.className, extra].filter(Boolean).join(' ') || undefined;

  return (
    <div className="table-wrap">
      <table
        className={`tbl ${className}`.trim()}
        style={minWidth ? { minWidth } : undefined}
      >
        {/* ★ প্রস্থের একক উৎস — হেডার ও সেল দুজনেই এখান থেকেই পায় */}
        {columns.some((c) => c.width) && (
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
        )}

        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cls(c)}>
                {c.srOnlyHeader ? <span className="sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              {/* ★ colSpan সবসময় সংজ্ঞার সাথে মেলে — হাতে গোনা সংখ্যা
                  বসালে কলাম যোগ/বাদ দেওয়ার দিন সেটি ভুল হয়ে যেত */}
              <td colSpan={columns.length} className="ctr py-14" style={{ color: 'var(--v-mut)' }}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={rowKey(row, i)} className={rowClassName?.(row, i)}>
                {columns.map((c) => (
                  <td key={c.key} className={cls(c, c.cellClassName)}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
