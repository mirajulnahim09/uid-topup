/**
 * Telegram template preview must be inert HTML (audit 2026-10-31, F-05).
 *
 * The admin panel renders `preview()` with dangerouslySetInnerHTML. The
 * template body is admin-written and was returned raw, so one admin could
 * store `<img src=x onerror=…>` and it would be injected into every other
 * admin's panel. The nonce CSP blocks inline handlers today; this removes the
 * dependency on CSP: only Telegram's attribute-free formatting tags survive.
 */
import { describe, it, expect } from 'vitest';
import { preview, TEMPLATES } from '../src/lib/telegram/templates';

const KEY = TEMPLATES[0].key;

describe('telegram template preview', () => {
  it('neutralises markup that is not a Telegram formatting tag', () => {
    const out = preview('<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:x">l</a>', KEY);
    expect(out).not.toMatch(/<img|<script|<a\s/i);
    expect(out).toContain('&lt;img');
  });

  it('keeps Telegram formatting tags and substitutes variables', () => {
    const out = preview('<b>bold</b> <i>it</i> <code>c</code> {{customer_name}}', KEY);
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>it</i>');
    expect(out).toContain('<code>c</code>');
    expect(out).not.toContain("{{customer_name}}");
  });

  it('every built-in default still renders its tags', () => {
    for (const t of TEMPLATES) {
      const out = preview(t.body, t.key);
      expect(out, t.key).not.toContain('&lt;b&gt;');
    }
  });
});
