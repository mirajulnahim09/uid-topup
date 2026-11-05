/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ O-15 — Preview never reaches Production; credentials stay on main
 *
 *   1. scripts/assert-preview-db.mjs — a preview build is refused unless both
 *      DB URLs name the isolated `uidtopup_preview` database. A production
 *      URL (`neondb`) fails before any connection; messages never echo a URL.
 *   2. scripts/assert-local-db.mjs — local runs still refuse remote hosts and
 *      the Vercel skip still needs every container condition.
 *   3. src/lib/deploymentEnv.ts — with VERCEL_ENV=preview no email, Telegram,
 *      game-API fulfilment or live payment host is ever used.
 *   4. .github/workflows — production DB secrets only in environment-gated,
 *      main-only jobs, only in step env, never during `npm ci`; migration
 *      only in the manual workflow.
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { checkPreviewDb, databaseName, isVercelPreviewBuild, PREVIEW_DATABASE_NAME } from '../scripts/assert-preview-db.mjs';
import { checkLocalDb, isVercelBuild } from '../scripts/assert-local-db.mjs';

/** plain env object → ProcessEnv (the .mjs guards take any string map) */
const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

const PROD_LIKE = 'postgresql://neondb_owner:S3cretPw@ep-prod-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
const PREVIEW = 'postgresql://preview_owner:Pv9pw@ep-prev-456-pooler.us-east-1.aws.neon.tech/uidtopup_preview?sslmode=require';
const PREVIEW_DIRECT = 'postgresql://preview_owner:Pv9pw@ep-prev-456.us-east-1.aws.neon.tech/uidtopup_preview?sslmode=require';

describe('O-15 · assert-preview-db', () => {
  it('a production URL is refused, and the message leaks nothing', () => {
    const p: string[] = checkPreviewDb(E({ DATABASE_URL: PROD_LIKE, DIRECT_URL: PROD_LIKE }));
    expect(p).toHaveLength(2);
    const text = p.join('\n');
    for (const leak of ['S3cretPw', 'neondb_owner', 'ep-prod-123', 'neon.tech', 'postgresql://']) {
      expect(text).not.toContain(leak);
    }
  });

  it('only the isolated preview database passes', () => {
    expect(PREVIEW_DATABASE_NAME).toBe('uidtopup_preview');
    expect(checkPreviewDb(E({ DATABASE_URL: PREVIEW, DIRECT_URL: PREVIEW_DIRECT }))).toEqual([]);
    expect(checkPreviewDb(E({ DATABASE_URL: PREVIEW }))).toEqual([]);
  });

  it('missing, mixed or unparsable URLs fail closed', () => {
    expect(checkPreviewDb(E({}))).toHaveLength(1);
    expect(checkPreviewDb(E({ DATABASE_URL: '  ' }))).toHaveLength(1);
    expect(checkPreviewDb(E({ DATABASE_URL: PREVIEW, DIRECT_URL: PROD_LIKE }))).toHaveLength(1);
    expect(checkPreviewDb(E({ DATABASE_URL: PROD_LIKE, DIRECT_URL: PREVIEW_DIRECT }))).toHaveLength(1);
    expect(checkPreviewDb(E({ DATABASE_URL: 'not a url' }))).toHaveLength(1);
    expect(checkPreviewDb(E({ DATABASE_URL: 'mysql://u:p@h/uidtopup_preview' }))).toHaveLength(1);
    expect(databaseName('postgresql://u:p@h/uidtopup_preview_old')).toBe('uidtopup_preview_old');
    expect(checkPreviewDb(E({ DATABASE_URL: 'postgresql://u:p@h/uidtopup_preview_old' }))).toHaveLength(1);
  });

  it('applies only to a real Vercel preview build container', () => {
    const base = { VERCEL: '1', CI: '1', VERCEL_ENV: 'preview' };
    expect(isVercelPreviewBuild(E(base), 'linux')).toBe(true);
    expect(isVercelPreviewBuild(E({ ...base, VERCEL_ENV: 'production' }), 'linux')).toBe(false);
    expect(isVercelPreviewBuild(E({ ...base, VERCEL: '' }), 'linux')).toBe(false);
    expect(isVercelPreviewBuild(E({ ...base, CI: '' }), 'linux')).toBe(false);
    expect(isVercelPreviewBuild(E(base), 'win32')).toBe(false);
  });

  it('runs first in `npm run build`, before prisma generate and next build', () => {
    const build: string = JSON.parse(readFileSync('package.json', 'utf8')).scripts.build;
    const order = ['assert-local-db.mjs', 'assert-preview-db.mjs', 'prisma generate', 'next build'].map((s) => build.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('outside a preview build the script is a no-op that never touches a database', () => {
    const r = spawnSync(process.execPath, ['scripts/assert-preview-db.mjs'], {
      encoding: 'utf8',
      env: E({ ...(process.env as Record<string, string>), DATABASE_URL: PROD_LIKE, VERCEL: '', VERCEL_ENV: '' }),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('not a Vercel preview build');
    expect(r.stdout + r.stderr).not.toContain('S3cretPw');
  });
});

describe('O-15 · assert-local-db is unchanged in strength', () => {
  it('rejects a remote host in the process env without echoing it', () => {
    const problems: string[] = checkLocalDb(E({ DATABASE_URL: PROD_LIKE }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).not.toContain('S3cretPw');
  });

  it('accepts localhost', () => {
    expect(checkLocalDb(E({ DATABASE_URL: 'postgresql://test:test@localhost:5433/uidtopup_test' }))).toEqual([]);
  });

  it('the Vercel skip needs every container condition', () => {
    const base = { VERCEL: '1', CI: '1', VERCEL_ENV: 'preview' };
    expect(isVercelBuild(E(base), 'linux')).toBe(true);
    expect(isVercelBuild(E(base), 'win32')).toBe(false);
    expect(isVercelBuild(E({ ...base, VERCEL_ENV: 'staging' }), 'linux')).toBe(false);
    expect(isVercelBuild(E({ ...base, CI: '' }), 'linux')).toBe(false);
  });
});

describe('O-15 · Preview blocks outbound side effects', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });
  const preview = () => { process.env.VERCEL_ENV = 'preview'; };
  const fetchSpy = () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));

  it('Telegram: no request is made', async () => {
    preview();
    const f = fetchSpy();
    const { callTelegram } = await import('../src/lib/telegram/api');
    const r = await callTelegram('123:fake', 'sendMessage', { chat_id: '1', text: 'x' });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('game-API fulfilment: falls back to MANUAL without a request, even when configured', async () => {
    preview();
    process.env.GAME_API_URL = 'https://provider.invalid/topup';
    process.env.GAME_API_KEY = 'fake-key';
    const f = fetchSpy();
    const { httpFulfillment } = await import('../src/lib/fulfillment/httpProvider');
    const d = await httpFulfillment.deliver({
      orderId: 'o1', productName: 'p', variantName: 'v', playerUid: '123456789', quantity: 1,
    } as Parameters<typeof httpFulfillment.deliver>[0]);
    expect(d.status).toBe('MANUAL');
    expect(f).not.toHaveBeenCalled();
  });

  it('email: OTP reports not-sent and generic mail is suppressed', async () => {
    preview();
    const f = fetchSpy();
    const { emailOtpCode, sendEmail } = await import('../src/lib/email');
    expect(await emailOtpCode('someone@example.com', '123456', 10)).toBe(false);
    await sendEmail('someone@example.com', 'subject', '<p>x</p>');
    expect(f).not.toHaveBeenCalled();
  });

  it('SSLCommerz: always the sandbox host, even with an override set', async () => {
    preview();
    process.env.SSLCZ_BASE_URL = 'https://securepay.sslcommerz.com';
    await import('../src/lib/payments/registry'); // app load order (registry ⇄ provider cycle)
    const { sslcommerzBaseUrl } = await import('../src/lib/payments/providers/sslcommerz');
    expect(await sslcommerzBaseUrl()).toBe('https://sandbox.sslcommerz.com');
  });

  it('outside preview the override still applies (tests and mocks unchanged)', async () => {
    delete process.env.VERCEL_ENV;
    process.env.SSLCZ_BASE_URL = 'http://127.0.0.1:9/mock/';
    await import('../src/lib/payments/registry'); // app load order (registry ⇄ provider cycle)
    const { sslcommerzBaseUrl } = await import('../src/lib/payments/providers/sslcommerz');
    expect(await sslcommerzBaseUrl()).toBe('http://127.0.0.1:9/mock');
  });
});

// ─────────────────────────── workflows ───────────────────────────
type Step = { run?: string; env?: Record<string, string>; uses?: string; with?: Record<string, unknown> };
type Job = { if?: string; environment?: string | { name: string }; env?: Record<string, string>; steps: Step[] };
type Workflow = { on: unknown; permissions?: Record<string, string>; jobs: Record<string, Job> };

const yaml = createRequire(import.meta.url)('js-yaml') as { load: (s: string) => unknown };
const WF_DIR = '.github/workflows';
const workflows = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, raw: readFileSync(path.join(WF_DIR, f), 'utf8'), wf: yaml.load(readFileSync(path.join(WF_DIR, f), 'utf8')) as Workflow }));
const PROD_SECRET = /secrets\.PRODUCTION_[A-Z_]+/;
const envName = (j: Job) => (typeof j.environment === 'string' ? j.environment : j.environment?.name);
const jobsUsingProdSecrets = workflows.flatMap(({ file, wf }) =>
  Object.entries(wf.jobs).filter(([, j]) => PROD_SECRET.test(JSON.stringify(j)))
    .map(([name, job]) => ({ file, name, job })));

describe('O-15 · GitHub workflows', () => {
  it('finds the two production-DB jobs', () => {
    expect(jobsUsingProdSecrets.map((j) => `${j.file}:${j.name}`).sort())
      .toEqual(['ci.yml:migrate-guard', 'migrate-production.yml:migrate']);
  });

  it('every production-DB job is environment-gated and main-only', () => {
    for (const { file, name, job } of jobsUsingProdSecrets) {
      expect(['production-db', 'production-db-readonly'], `${file}:${name}`).toContain(envName(job));
      expect(job.if ?? '', `${file}:${name}`).toContain("github.ref == 'refs/heads/main'");
    }
  });

  it('secrets only in step env — never job env, never during npm ci', () => {
    for (const { file, name, job } of jobsUsingProdSecrets) {
      expect(JSON.stringify(job.env ?? {}), `${file}:${name} job env`).not.toMatch(/secrets\./);
      for (const s of job.steps) {
        if (s.run && /\bnpm (ci|install)\b/.test(s.run)) {
          expect(s.run, `${file}:${name}`).toContain('--ignore-scripts');
          expect(JSON.stringify(s.env ?? {})).not.toMatch(/secrets\./);
        }
      }
    }
  });

  it('the daily check uses read-only credentials only', () => {
    const guard = jobsUsingProdSecrets.find((j) => j.name === 'migrate-guard')!;
    const refs = JSON.stringify(guard.job).match(/secrets\.[A-Z_]+/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r).toMatch(/_READONLY$/);
    expect(envName(guard.job)).toBe('production-db-readonly');
  });

  it('the migration job uses production-db and keeps the main + confirm precheck', () => {
    const m = workflows.find((w) => w.file === 'migrate-production.yml')!;
    expect(Object.keys(m.wf.on as object)).toEqual(['workflow_dispatch']);
    expect(envName(m.wf.jobs.migrate)).toBe('production-db');
    expect(m.raw).toContain('refs/heads/main');
    expect(m.raw).toContain('MIGRATE-PRODUCTION');
    expect((m.wf.jobs.migrate as Job & { needs?: string }).needs).toBe('precheck');
  });

  it('only the manual workflow migrates; nothing resets or pushes a schema', () => {
    for (const { file, raw } of workflows) {
      const code = raw.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
      if (file !== 'migrate-production.yml') expect(code, file).not.toMatch(/migrate deploy/);
      expect(code, file).not.toMatch(/migrate reset|migrate dev|db push|--accept-data-loss|--force-reset/);
    }
  });

  it('workflow token stays read-only and checkouts do not persist it in secret jobs', () => {
    for (const { file, wf } of workflows) expect(wf.permissions, file).toEqual({ contents: 'read' });
    for (const { file, name, job } of jobsUsingProdSecrets) {
      const co = job.steps.find((s) => s.uses?.startsWith('actions/checkout'));
      expect(co?.with?.['persist-credentials'], `${file}:${name}`).toBe(false);
    }
  });
});
