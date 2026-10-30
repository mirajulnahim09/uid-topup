/**
 * i18n dictionary parity (audit 2026-10-31, category 20).
 *
 * `translate()` silently falls back to Bangla and then to the raw key, so a
 * key missing from one locale never errors — it just shows the wrong
 * language or a dotted key on screen. This pins both dictionaries to the
 * same key set and to non-empty values, and checks every key used in
 * source code exists.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { translations } from '../src/lib/i18n';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe('i18n', () => {
  it('bn and en have exactly the same keys', () => {
    const bn = Object.keys(translations.bn).sort();
    const en = Object.keys(translations.en).sort();
    expect(bn.filter((k) => !en.includes(k)), 'missing in en').toEqual([]);
    expect(en.filter((k) => !bn.includes(k)), 'missing in bn').toEqual([]);
  });

  it('no empty translations', () => {
    for (const loc of ['bn', 'en'] as const) {
      const empty = Object.entries(translations[loc]).filter(([, v]) => !v.trim()).map(([k]) => k);
      expect(empty, loc).toEqual([]);
    }
  });

  it('every t("…") key used in src exists in the dictionary', () => {
    const used = new Set<string>();
    for (const file of walk(path.resolve(__dirname, '../src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*['"]([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)['"]\s*\)/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in translations.bn));
    expect(missing).toEqual([]);
  });
});
