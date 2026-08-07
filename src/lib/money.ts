/** Prisma Decimal | number | string — সব হ্যান্ডেল করে */
export type Money = { toString(): string } | number | string;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** ৳1,234.50 ফরম্যাটে */
export function bdt(v: Money): string {
  const n = Number(v.toString());
  return `৳${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
