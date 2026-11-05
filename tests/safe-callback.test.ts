/**
 * Post-login destination (src/lib/safeCallback.ts).
 *   - only our own origin (open-redirect regression: `/\evil`, `/<TAB>/evil`)
 *   - never an auth page: `/login?callbackUrl=/login` used to leave the login
 *     button on "please wait" forever after a successful sign-in.
 */
import { describe, it, expect } from 'vitest';
import { safeCallbackPath } from '../src/lib/safeCallback';

const O = 'https://uidtopup.test';

describe('safeCallbackPath', () => {
  it('keeps a normal own-origin path with query and hash', () => {
    expect(safeCallbackPath('/account/orders?page=2#x', O)).toBe('/account/orders?page=2#x');
    expect(safeCallbackPath('/admin', O)).toBe('/admin');
  });

  it('rejects other origins and parser tricks', () => {
    for (const raw of ['//evil.example/x', String.raw`/\evil.example/x`,'/\t/evil.example/x', 'https://evil.example', 'javascript:alert(1)', '']) {
      expect(safeCallbackPath(raw, O)).toBeNull();
    }
    expect(safeCallbackPath(null, O)).toBeNull();
  });

  it('rejects auth pages as a destination (stuck-loading regression)', () => {
    for (const raw of ['/login', '/login?callbackUrl=/login', '/register', '/forgot-password', '/reset-password?token=a', '/login/']) {
      expect(safeCallbackPath(raw, O)).toBeNull();
    }
  });

  it('does not over-match paths that only start with an auth word', () => {
    expect(safeCallbackPath('/loginhelp', O)).toBe('/loginhelp');
    expect(safeCallbackPath('/account/register-device', O)).toBe('/account/register-device');
  });
});
