/**
 * `/login?error=<code>` (NextAuth pages.signIn / pages.error → /login).
 * The login page used to ignore the code, so a refused Google sign-in showed
 * nothing; every NextAuth code now maps to a Bangla message.
 */
import { describe, it, expect } from 'vitest';
import { authErrorMessage } from '../src/lib/authErrors';

describe('authErrorMessage', () => {
  it('no code → no message', () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage('')).toBeNull();
  });
  it('AccessDenied (2FA account / banned via Google) explains the credentials+code path', () => {
    expect(authErrorMessage('AccessDenied')).toContain('2FA');
  });
  it('every documented code and unknown codes get a message', () => {
    for (const c of ['OAuthSignin', 'OAuthCallback', 'OAuthCreateAccount', 'Callback', 'OAuthAccountNotLinked',
      'SessionRequired', 'Configuration', 'CredentialsSignin', 'Verification', 'Default', 'x<script>']) {
      const m = authErrorMessage(c);
      expect(m).toBeTruthy();
      expect(m).not.toContain('<script>'); // the raw code is never echoed into the page
    }
  });
});
