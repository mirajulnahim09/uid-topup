/**
 * Numeric settings must be finite (audit 2026-10-31, F-03).
 *
 * `normalizeSettingValue` accepted any value with `!isNaN(n) && n >= 0`,
 * so "Infinity" (or "1e999") was stored for money settings. With
 * `referral_bonus = Infinity`, `payReferralBonus` calls `creditWallet`
 * with a non-finite amount, which throws inside the deposit-approval
 * transaction: every first deposit of a referred customer then fails to
 * approve until someone finds the bad setting.
 */
import { describe, it, expect } from 'vitest';
import { normalizeSettingValue } from '../src/lib/settingsPolicy';

const MONEY_KEYS = [
  'referral_bonus', 'referral_min_deposit', 'min_deposit', 'max_deposit',
  'withdrawal_min', 'withdrawal_daily_cap', 'withdrawal_hold_hours',
];

describe('normalizeSettingValue — numeric keys', () => {
  for (const key of MONEY_KEYS) {
    it(`${key}: rejects non-finite values`, () => {
      for (const bad of ['Infinity', '1e999', '-Infinity']) {
        expect(() => normalizeSettingValue(key, bad), `${key}=${bad}`).toThrow();
      }
    });

    it(`${key}: still accepts ordinary values`, () => {
      expect(normalizeSettingValue(key, '20')).toBe('20');
      expect(normalizeSettingValue(key, '0')).toBe('0');
      expect(normalizeSettingValue(key, '12.5')).toBe('12.5');
    });
  }

  it('still rejects negatives and garbage', () => {
    expect(() => normalizeSettingValue('referral_bonus', '-1')).toThrow();
    expect(() => normalizeSettingValue('referral_bonus', 'abc')).toThrow();
  });
});
