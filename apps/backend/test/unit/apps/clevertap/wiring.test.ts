import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPS } from '../../../../src/config/apps';
import { envSchema } from '../../../../src/config/env.schema';
import { MODULE_REGISTRY } from '../../../../src/module-registry';

const REPO_ROOT = join(__dirname, '../../../../../..');
const MODULE_DIR = join(REPO_ROOT, 'apps/backend/src/modules/clevertap');
const ADMIN_DIR = join(REPO_ROOT, 'apps/admin-clevertap/src');
const PIXEL_FILE = join(REPO_ROOT, 'apps/backend/pixel/clevertap-pixel.ts');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'routeTree.gen.ts') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('clevertap wiring (A1)', () => {
  it('APPS contains clevertap', () => {
    expect(APPS).toContain('clevertap');
  });

  it('MODULE_REGISTRY has a clevertap entry', () => {
    expect(MODULE_REGISTRY.has('clevertap')).toBe(true);
  });

  it('env.schema derives the RATIO_CLEVERTAP_* keys from APPS', () => {
    const keys = Object.keys(envSchema.shape);
    for (const suffix of [
      'DATABASE_URL',
      'DATA_ENCRYPTION_KEY',
      'CLIENT_ID',
      'CLIENT_SECRET',
      'CALLBACK_URL',
      'ADMIN_BASE_URL',
    ]) {
      expect(keys).toContain(`RATIO_CLEVERTAP_${suffix}`);
    }
  });

  it('.env.example ships a placeholder for every derived key', () => {
    const envExample = read(join(REPO_ROOT, '.env.example'));
    for (const suffix of [
      'DATABASE_URL',
      'DATA_ENCRYPTION_KEY',
      'CLIENT_ID',
      'CLIENT_SECRET',
      'CALLBACK_URL',
      'ADMIN_BASE_URL',
    ]) {
      expect(envExample).toContain(`RATIO_CLEVERTAP_${suffix}=`);
    }
    expect(envExample).toContain('RATIO_CLEVERTAP_CLIENT_SECRET=\n');
    expect(envExample).toContain('RATIO_CLEVERTAP_DATA_ENCRYPTION_KEY=\n');
  });

  it('01-database.sql creates and grants clevertap_app', () => {
    const sql = read(join(REPO_ROOT, 'docker/mysql/init/01-database.sql'));
    expect(sql).toContain('CREATE DATABASE IF NOT EXISTS clevertap_app;');
    expect(sql).toContain('CREATE DATABASE IF NOT EXISTS clevertap_app_test;');
    expect(sql).toMatch(/GRANT ALL ON `clevertap_app`\.\*\s+TO 'app'@'%';/);
    expect(sql).toMatch(/GRANT ALL ON `clevertap_app_test`\.\*\s+TO 'app'@'%';/);
  });
});

describe('clevertap deployment contract (TDD §7)', () => {
  const state = JSON.parse(read(join(REPO_ROOT, 'docs/agent/apps/clevertap/STATE.json'))) as {
    deployment: { apiPlacement: string; workerPlacement: string };
  };

  it('placement agrees across PRD, TRD and STATE', () => {
    expect(state.deployment).toEqual({ apiPlacement: 'shared', workerPlacement: 'none' });

    const trd = read(join(REPO_ROOT, 'docs/agent/apps/clevertap/TRD.md'));
    expect(trd).toContain('**API placement:** `shared`');
    expect(trd).toContain('**Worker placement:** `none`');
  });

  it('introduces no worker flag, queue, or *_WORKER_ENABLED env key', () => {
    const envExample = read(join(REPO_ROOT, '.env.example'));
    expect(envExample).not.toMatch(/CLEVERTAP_[A-Z_]*WORKER_ENABLED/);
    expect(envExample).not.toMatch(/CLEVERTAP_[A-Z_]*QUEUE_URL/);

    const sources = walk(MODULE_DIR).map(read).join('\n');
    expect(sources).not.toMatch(/QueueService|sendBatch\(|@Cron\(/);
  });

  it('adds no repository-local Kubernetes manifests', () => {
    const files = walk(join(REPO_ROOT, 'apps/backend/src')).map((f) => relative(REPO_ROOT, f));
    expect(files.filter((f) => /k8s|manifest|deployment\.ya?ml/i.test(f))).toEqual([]);
  });
});

describe('no TEMPLATE markers remain (A14)', () => {
  function markerFiles(files: string[]): string[] {
    return files.filter((f) => read(f).includes('// TEMPLATE:')).map((f) => relative(REPO_ROOT, f));
  }

  it('has none in the backend module', () => {
    expect(markerFiles(walk(MODULE_DIR))).toEqual([]);
  });

  it('has none in the admin SPA', () => {
    expect(markerFiles(walk(ADMIN_DIR))).toEqual([]);
  });

  it('has none in the storefront pixel', () => {
    expect(read(PIXEL_FILE)).not.toContain('// TEMPLATE:');
  });
});

describe('clevertap module handler wiring', () => {
  const moduleSrc = read(join(MODULE_DIR, 'clevertap.module.ts'));
  const HANDLERS = [
    'ClevertapAppUninstalledHandler',
    'ClevertapOrderPaidHandler',
    'ClevertapOrderCreatedHandler',
    'ClevertapOrderCancelledHandler',
    'ClevertapOrderFulfilledHandler',
    'ClevertapOrderPartiallyFulfilledHandler',
    'ClevertapOrderUpdatedHandler',
    'ClevertapCustomerCreatedHandler',
    'ClevertapCustomerUpdatedHandler',
    'ClevertapLoyaltyPointsCreditedHandler',
    'ClevertapLoyaltyPointsDebitedHandler',
    'ClevertapReviewCreatedHandler',
    'ClevertapProductCreatedHandler',
    'ClevertapProductUpdatedHandler',
    'ClevertapProductDeletedHandler',
  ] as const;

  const handlerClassesBlock = moduleSrc.match(/handlerClasses:\s*\[([^\]]*)\]/)?.[1] ?? '';
  const providersBlock = moduleSrc.slice(
    moduleSrc.indexOf('providers: ['),
    moduleSrc.indexOf('...createAppProviders'),
  );

  it('uses the plural handlerClasses form (singular handlerClass registers only one)', () => {
    expect(handlerClassesBlock).not.toBe('');
    expect(moduleSrc).not.toMatch(/handlerClass:\s/);
  });

  it.each(HANDLERS)('registers %s in BOTH providers and handlerClasses', (handler) => {
    expect(providersBlock).toContain(handler);
    expect(handlerClassesBlock).toContain(handler);
  });

  it('registers exactly one handler per webhook topic', async () => {
    const { CLEVERTAP_WEBHOOK_TOPICS } = await import(
      '../../../../src/modules/clevertap/webhooks/topics'
    );
    const listed = handlerClassesBlock
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(listed).toHaveLength(Object.keys(CLEVERTAP_WEBHOOK_TOPICS).length);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('provides the per-merchant events-client factory the forwarding service injects', () => {
    expect(providersBlock).toContain('CLEVERTAP_EVENTS_CLIENT_FACTORY');
    expect(providersBlock).toContain('ClevertapForwardingService');
  });
});
