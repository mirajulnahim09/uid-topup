/**
 * Where to go after login: only a path on our own origin, and never an auth
 * page.
 *
 * Origin: the old check was `startsWith('/') && !startsWith('//')`, but the
 * browser's URL parser turns `\` into `/` and strips TAB/newline, so
 * `/\evil.com` and `/<TAB>/evil.com` became `//evil.com` (another site). We ask
 * the parser itself and return only path+query+hash as it resolved them
 * (scripts/verify/security-probes.ts).
 *
 * Auth pages: `/login?callbackUrl=/login` kept the login form mounted after a
 * successful sign-in with `loading` still true, so the button stayed on
 * "please wait" indefinitely. Those destinations fall back to the role default.
 */
const AUTH_PAGES = /^\/(login|register|forgot-password|reset-password)(\/|$)/;

export function safeCallbackPath(raw: string | null | undefined, origin: string): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return null;
    if (AUTH_PAGES.test(u.pathname)) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}
