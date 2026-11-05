/**
 * ★ zod-এর ডিফল্ট বার্তা বাংলায় (EXTREME অডিট, ২০২৬-০৯-১৮)
 *   দাবি: বার্তাহীন ভ্যালিডেশনেও গ্রাহক বাংলা দেখেন, আর যেখানে কাস্টম
 *   বার্তা লেখা আছে সেটিই অপরিবর্তিত থাকে।
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import '../src/lib/zodBangla';
import { orderSchema, registerSchema } from '../src/lib/validation';

const msg = (r: z.SafeParseReturnType<unknown, unknown>) =>
  r.success ? '' : r.error.errors[0].message;

describe('zod বাংলা error-map', () => {
  it('লম্বা লেখায় বাংলা বার্তা (আগে: "String must contain at most 80 character(s)")', () => {
    const r = orderSchema.safeParse({ variantId: 1, playerUid: '1234567890', playerName: 'ক'.repeat(500) });
    expect(msg(r)).toBe('সর্বোচ্চ ৮০ অক্ষর দেওয়া যাবে');
  });

  it('অনুপস্থিত ঘর → বাংলা', () => {
    expect(msg(z.object({ a: z.string() }).safeParse({}))).toBe('এই ঘরটি পূরণ করুন');
  });

  it('ভুল ধরন → বাংলা', () => {
    expect(msg(z.object({ a: z.string() }).safeParse({ a: 42 }))).toBe('লেখা দিন');
    expect(msg(z.object({ a: z.number() }).safeParse({ a: 'x' }))).toBe('সংখ্যা দিন');
  });

  it('সংখ্যার সীমা → বাংলা', () => {
    expect(msg(z.object({ n: z.number().max(5) }).safeParse({ n: 9 }))).toBe('মান সর্বোচ্চ ৫ হতে পারে');
    expect(msg(z.object({ n: z.number().min(3) }).safeParse({ n: 1 }))).toBe('মান অন্তত ৩ হতে হবে');
  });

  it('খালি স্ট্রিং (min 1) → "এই ঘরটি পূরণ করুন"', () => {
    expect(msg(z.object({ s: z.string().min(1) }).safeParse({ s: '' }))).toBe('এই ঘরটি পূরণ করুন');
  });

  it('অবৈধ enum → বাংলা', () => {
    expect(msg(z.object({ e: z.enum(['A', 'B']) }).safeParse({ e: 'C' }))).toBe('অনুমোদিত মানগুলোর একটি বেছে নিন');
  });

  it('★ ফিল্ডের নিজের বার্তা আগের মতোই জেতে', () => {
    const r = registerSchema.safeParse({ name: 'রহিম উদ্দিন', email: 'not-an-email', phone: '01712345678', password: 'ValidPass2026' });
    expect(msg(r)).toBe('সঠিক ইমেইল দিন');
    const uid = orderSchema.safeParse({ variantId: 1, playerUid: 'ab' });
    expect(msg(uid)).toBe('সঠিক UID দিন');
  });
});
