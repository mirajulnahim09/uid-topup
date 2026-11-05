/**
 * Local storage driver must not delete files outside public/uploads
 * (audit 2026-10-31, F-04).
 *
 * Admin image fields (product, banner, branding) pass through `safeUrl`,
 * which accepts any path starting with "/" — including "/uploads/../../x".
 * Replacing or deleting that image later calls `deleteImage(oldUrl)`, which
 * the local driver resolved with `path.join(root, rel)`: a `..` walked out
 * of public/uploads and unlinked an arbitrary project file. Vercel's file
 * system is read-only, so this bites self-hosted and dev installs.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { localDriver } from '../src/lib/storage/local';

const canaryDir = path.join(process.cwd(), 'public');
const canary = path.join(canaryDir, `audit-canary-${process.pid}.txt`);

afterEach(() => rmSync(canary, { force: true }));

describe('localDriver().del — path containment', () => {
  it('refuses to delete a file outside public/uploads via ..', async () => {
    writeFileSync(canary, 'keep me');
    await localDriver().del(`/uploads/../${path.basename(canary)}`);
    expect(existsSync(canary)).toBe(true);
  });

  it('refuses encoded and backslash traversal too', async () => {
    writeFileSync(canary, 'keep me');
    await localDriver().del(`/uploads/..\\${path.basename(canary)}`);
    await localDriver().del(`/uploads/sub/../../${path.basename(canary)}`);
    expect(existsSync(canary)).toBe(true);
  });

  it('still deletes a real file inside public/uploads', async () => {
    const dir = path.join(canaryDir, 'uploads', 'audit-test');
    mkdirSync(dir, { recursive: true });
    const inside = path.join(dir, `f-${process.pid}.png`);
    writeFileSync(inside, 'x');
    await localDriver().del(`/uploads/audit-test/${path.basename(inside)}`);
    expect(existsSync(inside)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
