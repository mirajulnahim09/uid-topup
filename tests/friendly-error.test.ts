/**
 * ★ ব্রাউজারের কারিগরি ত্রুটি → বাংলা (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *   তিন ইঞ্জিনের আসল বার্তা; সার্ভারের বাংলা বার্তা অপরিবর্তিত থাকা জরুরি।
 */
import { describe, it, expect } from 'vitest';
import { friendlyError, NETWORK_MSG, SERVER_BUSY_MSG } from '../src/lib/friendlyError';

describe('friendlyError', () => {
  it.each([
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'The network connection was lost.',
  ])('নেটওয়ার্ক: %s', (m) => {
    expect(friendlyError(m)).toBe(NETWORK_MSG);
  });

  it.each([
    `Unexpected token '<', "<html><bod"... is not valid JSON`,
    'Unexpected end of JSON input',
    'JSON.parse: unexpected character at line 1 column 1 of the JSON data',
    "JSON Parse error: Unrecognized token '<'",
    'The string did not match the expected pattern.',
  ])('অ-JSON উত্তর: %s', (m) => {
    expect(friendlyError(m)).toBe(SERVER_BUSY_MSG);
  });

  it.each([
    'এই প্যাকেজটি এখন পাওয়া যাচ্ছে না',
    'দাম বদলেছে — এখন ৳60.00। নতুন দাম দেখে আবার নিশ্চিত করুন।',
    'অর্ডার করা যায়নি',
    'Invalid coupon', // অজানা ইংরেজিও অপরিবর্তিত — কেবল জানা ছাঁচ
  ])('সার্ভারের বার্তা অপরিবর্তিত: %s', (m) => {
    expect(friendlyError(m)).toBe(m);
  });
});
