/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ঢাকার দিন-সীমা — সার্ভারের টাইমজোন যা-ই হোক, ফল একই
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   Vercel-এ সার্ভার UTC; লোকাল মেশিন ঢাকা। আগে `setHours(0,0,0,0)` ও
 *   `new Date('YYYY-MM-DD')` দুই জায়গায় দুই রকম ফল দিত। এখানে প্রতিটি
 *   দাবি তিনটি TZ-এ (UTC, ঢাকা, নিউ ইয়র্ক — DST সহ) চালানো হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  dhakaDayStart, dhakaDayKey, dhakaDateBounds, dhakaRangeFrom, dhakaRangeTo, parseDhakaDateTime,
} from '../src/lib/date';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });

const ZONES = ['UTC', 'Asia/Dhaka', 'America/New_York'];
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe.each(ZONES)('সার্ভার TZ = %s', (tz) => {
  it('dhakaDayStart — ঢাকার মধ্যরাতের দুই পাশে', () => {
    process.env.TZ = tz;
    // ঢাকা ২০২৬-০৯-১৮ ০২:৩০ → দিনের শুরু ঢাকা ০০:০০ = ১৭ তারিখ ১৮:০০Z
    expect(iso(dhakaDayStart(new Date('2026-09-17T20:30:00Z')))).toBe('2026-09-17T18:00:00.000Z');
    // ঢাকা ২০২৬-০৯-১৭ ২৩:৫৯:৫৯ → এখনো ১৭ তারিখ
    expect(iso(dhakaDayStart(new Date('2026-09-17T17:59:59Z')))).toBe('2026-09-16T18:00:00.000Z');
    // ঠিক ঢাকার মধ্যরাত
    expect(iso(dhakaDayStart(new Date('2026-09-17T18:00:00Z')))).toBe('2026-09-17T18:00:00.000Z');
    // −৭ দিন ও মাস-বদল
    expect(iso(dhakaDayStart(new Date('2026-10-02T01:00:00Z'), -7))).toBe('2026-09-24T18:00:00.000Z');
    expect(iso(dhakaDayStart(new Date('2026-09-17T20:30:00Z'), 1))).toBe('2026-09-18T18:00:00.000Z');
  });

  it('dhakaDayKey', () => {
    process.env.TZ = tz;
    expect(dhakaDayKey(new Date('2026-09-17T18:30:00Z'))).toBe('2026-09-18');
    expect(dhakaDayKey(new Date('2026-09-17T17:30:00Z'))).toBe('2026-09-17');
  });

  it('dhakaDateBounds — পুরো ঢাকা-দিন, অস্তিত্বহীন দিন নয়', () => {
    process.env.TZ = tz;
    const b = dhakaDateBounds('2026-09-14')!;
    expect(iso(b.start)).toBe('2026-09-13T18:00:00.000Z');
    expect(iso(b.end)).toBe('2026-09-14T17:59:59.999Z');
    expect(dhakaDateBounds('2026-02-31')).toBeNull();
    expect(dhakaDateBounds('2026-13-01')).toBeNull();
    expect(dhakaDateBounds('abc')).toBeNull();
  });

  it('রেঞ্জ-ফিল্টার: তারিখ = ঢাকার দিন; অঞ্চলসহ টাইমস্ট্যাম্প হুবহু; আজেবাজে null', () => {
    process.env.TZ = tz;
    expect(iso(dhakaRangeFrom('2026-09-14'))).toBe('2026-09-13T18:00:00.000Z');
    expect(iso(dhakaRangeTo('2026-09-14'))).toBe('2026-09-14T17:59:59.999Z');
    expect(iso(dhakaRangeFrom('2026-09-14T10:00:00Z'))).toBe('2026-09-14T10:00:00.000Z');
    expect(dhakaRangeFrom('not-a-date')).toBeNull();
    expect(dhakaRangeTo('')).toBeNull();
  });

  it('parseDhakaDateTime — datetime-local মান ঢাকার ঘড়ি-সময়', () => {
    process.env.TZ = tz;
    expect(iso(parseDhakaDateTime('2026-09-17T20:00'))).toBe('2026-09-17T14:00:00.000Z');
    expect(iso(parseDhakaDateTime('2026-09-17T00:15:30'))).toBe('2026-09-16T18:15:30.000Z');
    expect(iso(parseDhakaDateTime('2026-09-17T20:00:00.000Z'))).toBe('2026-09-17T20:00:00.000Z');
    expect(iso(parseDhakaDateTime('2026-09-17T20:00:00+06:00'))).toBe('2026-09-17T14:00:00.000Z');
    expect(parseDhakaDateTime('garbage')).toBeNull();
  });
});
