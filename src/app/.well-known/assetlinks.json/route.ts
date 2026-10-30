import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * Digital Asset Links for the Android app (Trusted Web Activity).
 * Lets the Play Store app open this site full-screen without a URL bar.
 * Values come from admin settings `twa_package` and `twa_sha256`;
 * without them this returns an empty list (valid, links nothing).
 */
export async function GET() {
  let pkg = '';
  let fps: string[] = [];
  try {
    const s = await getSettings();
    pkg = (s.twa_package || '').trim();
    fps = (s.twa_sha256 || '')
      .split(',')
      .map((f) => f.trim().toUpperCase())
      .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  } catch {
    /* empty list */
  }

  const body = pkg && /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg) && fps.length
    ? [{
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fps },
      }]
    : [];

  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
}
