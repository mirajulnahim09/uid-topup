/**
 * NEXTAUTH_URL format validation (src/lib/env.ts → nextAuthUrlProblem).
 * Presence used to be the only check; a malformed value broke every sign-in
 * and /api/auth/session while /api/admin/readiness still reported "ready".
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { nextAuthUrlProblem, validateEnv } from '../src/lib/env';

afterEach(() => vi.unstubAllEnvs());

describe('nextAuthUrlProblem', () => {
  it('accepts a bare origin (with or without trailing slash) and the /api/auth base', () => {
    for (const v of ['https://uidtopup.test', 'https://uidtopup.test/', 'https://uidtopup.test/api/auth', 'http://localhost:3000']) {
      expect(nextAuthUrlProblem(v, true)).toBeNull();
    }
    expect(nextAuthUrlProblem('http://preview.uidtopup.test', false)).toBeNull();
  });

  it('flags the real-world mistakes', () => {
    expect(nextAuthUrlProblem('"https://uidtopup.test"', true)).not.toBeNull();   // copied with quotes
    expect(nextAuthUrlProblem('uidtopup.test', true)).not.toBeNull();             // no scheme
    expect(nextAuthUrlProblem('ftp://uidtopup.test', true)).not.toBeNull();
    expect(nextAuthUrlProblem('http://uidtopup.test', true)).not.toBeNull();      // http on a public host in prod
    expect(nextAuthUrlProblem('https://uidtopup.test/login', true)).not.toBeNull(); // page path
    expect(nextAuthUrlProblem('https://uidtopup.test/?x=1', true)).not.toBeNull();
  });

  it('never echoes the value back', () => {
    const msg = nextAuthUrlProblem('https://secret-host.example/login', true) || '';
    expect(msg).not.toContain('secret-host');
  });

  it('validateEnv reports a malformed NEXTAUTH_URL as a readiness problem', () => {
    vi.stubEnv('NEXTAUTH_URL', 'uidtopup.test');
    const r = validateEnv();
    const row = r.required.find((x) => x.key === 'NEXTAUTH_URL');
    expect(row?.problem).toBeTruthy();
    expect(r.ok).toBe(false);
  });
});
