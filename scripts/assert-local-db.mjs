/**
 * ═══════════════════════════════════════════════════════════
 * O-15 — fail-closed local database guard
 *
 *   A plain local `npm run build` once prerendered pages against the live
 *   Neon database, because `.env` held the production URL and Next/Prisma
 *   read it silently. This script runs BEFORE every local build, dev
 *   server, start and local-DB Prisma script, and stops the command unless
 *   every database URL it can resolve points at this machine.
 *
 *   Checked, in this order:
 *     1. every postgres-like value already in the process environment
 *        (a shell `export DATABASE_URL=...` beats every .env file);
 *     2. every postgres-like value in every `.env*` file in the project root
 *        and in `prisma/` (except `.env.example`), whichever mode would load
 *        it — a production URL parked in an unused file is still rejected.
 *   DATABASE_URL must resolve to something; a missing value is an error,
 *   never a fallback.
 *
 *   ⚠️ Never prints a URL, user or password — only the key name, the file
 *   it came from and, for rejected hosts, the last two DNS labels.
 *
 *   Vercel: there the production URL is expected, so the guard steps aside —
 *   but only when ALL of these hold (see `isVercelBuild`): VERCEL=1, CI set,
 *   VERCEL_ENV one of production/preview/development, and a Linux host.
 *   Vercel's build container sets VERCEL/VERCEL_ENV when "Automatically expose
 *   System Environment Variables" is on, and CI=1 at build time. A Windows
 *   working copy can never match, whatever is exported in the shell; a local
 *   `vercel build` on Windows is blocked too (it would read pulled prod env).
 * ═══════════════════════════════════════════════════════════
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const DB_URL = /^(postgres(ql)?|prisma(\+postgres)?):\/\//i;

/** Only the tail of a hostname — enough to recognise it, nothing more. */
function maskHost(host) {
  const parts = host.split('.');
  return parts.length > 2 ? `*.${parts.slice(-2).join('.')}` : host;
}

function parseEnvFile(file) {
  const out = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out.push([m[1], v]);
  }
  return out;
}

function envFiles() {
  const files = [];
  for (const dir of [ROOT, path.join(ROOT, 'prisma')]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.env') && name !== '.env.example') files.push(path.join(dir, name));
    }
  }
  return files;
}

/** Returns a list of problems; empty means every DB URL is local. */
export function checkLocalDb(env = process.env) {
  const problems = [];
  const check = (key, value, where) => {
    let u;
    try {
      u = new URL(value);
    } catch {
      problems.push(`${key} (${where}) is not a parsable URL`);
      return;
    }
    if (!LOCAL_DB_HOSTS.has(u.hostname)) {
      problems.push(`${key} (${where}) points to a non-local host ${maskHost(u.hostname)}`);
    }
  };

  for (const [k, v] of Object.entries(env)) {
    if (v && DB_URL.test(v)) check(k, v, 'process environment');
  }
  let fileHasDbUrl = false;
  for (const file of envFiles()) {
    for (const [k, v] of parseEnvFile(file)) {
      if (!DB_URL.test(v)) continue;
      if (k === 'DATABASE_URL') fileHasDbUrl = true;
      check(k, v, path.relative(ROOT, file));
    }
  }
  if (!env.DATABASE_URL && !fileHasDbUrl) {
    problems.push('DATABASE_URL is not set anywhere — refusing to guess a database');
  }
  return problems;
}

const VERCEL_ENVS = new Set(['production', 'preview', 'development']);

/** True only inside a Vercel build container; every condition is required. */
export function isVercelBuild(env = process.env, platform = process.platform) {
  return env.VERCEL === '1' && Boolean(env.CI) && VERCEL_ENVS.has(env.VERCEL_ENV ?? '') && platform === 'linux';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const mode = process.argv[2] || 'local';
  if (isVercelBuild()) {
    console.log(`[assert-local-db] ${mode}: Vercel build environment (${process.env.VERCEL_ENV}) — local guard not applicable`);
    process.exit(0);
  }
  const problems = checkLocalDb();
  if (problems.length) {
    console.error(
      `\n✗ [assert-local-db] ${mode} stopped — a database URL is not local (O-15).\n` +
        problems.map((p) => `    · ${p}`).join('\n') +
        `\n\n  Local builds, dev servers and tests may only use a database on this machine\n` +
        `  (docker: localhost:5433 test, localhost:5434 dev). Production credentials\n` +
        `  belong in the Vercel environment only. Nothing was run.\n`,
    );
    process.exit(1);
  }
  console.log(`[assert-local-db] ${mode}: every database URL is local`);
}
