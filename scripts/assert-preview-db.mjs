#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ O-15 — a Vercel **Preview** build may only reach the preview database
 *
 *   Found 2026-11-02: Vercel had ONE `DATABASE_URL` entry scoped
 *   "Production and Preview", so every preview build (any branch, unmerged
 *   code) prerendered against the production database. scripts/assert-local-db.mjs
 *   skips inside Vercel by design, so nothing stopped it.
 *
 *   This script runs first in `npm run build`. Outside a Vercel preview build
 *   it does nothing. Inside one it is fail-closed:
 *     1. DATABASE_URL must be set, and DATABASE_URL and DIRECT_URL (when set)
 *        must name the database `uidtopup_preview`. The production database
 *        is `neondb`, so a production URL fails here, BEFORE any connection.
 *     2. It connects and requires `current_database()` = `uidtopup_preview`
 *        (a URL can lie through a pooler; the server cannot).
 *     3. Only with PREVIEW_DB_BOOTSTRAP=1: `prisma migrate deploy` on that
 *        preview database, then the synthetic seed if it has no users yet.
 *
 *   Never prints a URL, user, password or host — only the database name.
 * ═══════════════════════════════════════════════════════════
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PREVIEW_DATABASE_NAME = 'uidtopup_preview';

/** True only for a Vercel preview build (same container rules as assert-local-db). */
export function isVercelPreviewBuild(env = process.env, platform = process.platform) {
  return env.VERCEL === '1' && Boolean(env.CI) && env.VERCEL_ENV === 'preview' && platform === 'linux';
}

/** Database name from a postgres URL, or null when it cannot be parsed. Never throws. */
export function databaseName(url) {
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    return decodeURIComponent(u.pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

/** Problems with the preview env (empty = OK). Messages never contain a URL. */
export function checkPreviewDb(env = process.env) {
  const problems = [];
  const db = env.DATABASE_URL?.trim();
  if (!db) {
    problems.push('DATABASE_URL is not set for the Preview environment');
  } else if (databaseName(db) !== PREVIEW_DATABASE_NAME) {
    problems.push(`DATABASE_URL does not point at the "${PREVIEW_DATABASE_NAME}" database`);
  }
  const direct = env.DIRECT_URL?.trim();
  if (direct && databaseName(direct) !== PREVIEW_DATABASE_NAME) {
    problems.push(`DIRECT_URL does not point at the "${PREVIEW_DATABASE_NAME}" database`);
  }
  return problems;
}

function fail(lines) {
  console.error(
    `\n✗ [assert-preview-db] preview build stopped (O-15).\n` +
      lines.map((l) => `    · ${l}`).join('\n') +
      `\n\n  A preview build may only use the isolated preview database "${PREVIEW_DATABASE_NAME}".\n` +
      `  Set Preview-scoped DATABASE_URL / DIRECT_URL in Vercel. Nothing was built.\n`,
  );
  process.exit(1);
}

async function serverDatabaseName(url) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const r = await client.query('SELECT current_database() AS db');
    return r.rows[0]?.db ?? null;
  } finally {
    await client.end();
  }
}

async function userCount(url) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const r = await client.query('SELECT count(*)::int AS n FROM "User"');
    return r.rows[0]?.n ?? 0;
  } finally {
    await client.end();
  }
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
  if (r.status !== 0) fail([`${cmd} ${args.join(' ')} failed (exit ${r.status})`]);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (!isVercelPreviewBuild()) {
    console.log('[assert-preview-db] not a Vercel preview build — nothing to check');
    process.exit(0);
  }
  const problems = checkPreviewDb();
  if (problems.length) fail(problems);

  const url = (process.env.DIRECT_URL || process.env.DATABASE_URL).trim();
  let actual;
  try {
    actual = await serverDatabaseName(url);
  } catch (e) {
    fail([`could not connect to the preview database (${e?.code || e?.name || 'error'})`]);
  }
  if (actual !== PREVIEW_DATABASE_NAME) fail([`server reports database "${actual}", expected "${PREVIEW_DATABASE_NAME}"`]);
  console.log(`[assert-preview-db] preview build uses the isolated "${PREVIEW_DATABASE_NAME}" database (connected)`);

  if (process.env.PREVIEW_DB_BOOTSTRAP === '1') {
    run('npx', ['prisma', 'migrate', 'deploy']);
    if ((await userCount(url)) === 0) {
      if (!process.env.ADMIN_PASSWORD) fail(['ADMIN_PASSWORD (Preview-scoped) is required to seed the preview database']);
      run('npx', ['prisma', 'db', 'seed']);
      console.log('[assert-preview-db] preview database seeded with synthetic data');
    }
  }
}
