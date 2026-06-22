// apps/backend/test/unit/apps/meta/shard-lease.repository.test.ts
// Gated: only runs when RUN_DB_ITESTS=1 OR RATIO_META_DATABASE_URL is set.
// Skips cleanly in the default suite.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKyselyClient } from '../../../../src/core/db/kysely-factory';
import { ShardLeaseRepository } from '../../../../src/modules/meta/capi/shard-lease.repository';
import type { MetaDatabase } from '../../../../src/modules/meta/db/types';

const RUN = process.env.RUN_DB_ITESTS === '1' || !!process.env.RATIO_META_DATABASE_URL;

(RUN ? describe : describe.skip)('ShardLeaseRepository (meta_app DB)', () => {
  const dbUrl = process.env.RATIO_META_DATABASE_URL ?? 'mysql://app:app@localhost:3306/meta_app';
  const handle = RUN ? createKyselyClient<MetaDatabase>(dbUrl, { poolSize: 2 }) : (null as never);
  const repo = RUN ? new ShardLeaseRepository(handle) : (null as never);

  const stream = 'test-stream';
  const shardId = 'shardId-test-001';
  const owner = 'worker-test-01';
  const owner2 = 'worker-test-02';

  beforeAll(async () => {
    if (!RUN) return;
    // Clean up any leftover row from a previous test run
    await handle.db
      .deleteFrom('meta_capi_shard_leases')
      .where('stream', '=', stream)
      .where('shardId', '=', shardId)
      .execute();
  });

  afterAll(async () => {
    if (!RUN) return;
    await handle.db
      .deleteFrom('meta_capi_shard_leases')
      .where('stream', '=', stream)
      .where('shardId', '=', shardId)
      .execute();
    await handle.close();
  });

  it('tryAcquire returns true for first claimant', async () => {
    const ok = await repo.tryAcquire(stream, shardId, owner, 60_000);
    expect(ok).toBe(true);
  });

  it('tryAcquire returns false for a competing owner while lease is live', async () => {
    const ok = await repo.tryAcquire(stream, shardId, owner2, 60_000);
    expect(ok).toBe(false);
  });

  it('tryAcquire returns true for the same owner (re-acquire / renew)', async () => {
    const ok = await repo.tryAcquire(stream, shardId, owner, 60_000);
    expect(ok).toBe(true);
  });

  it('lastCheckpoint returns null before any checkpoint', async () => {
    const seq = await repo.lastCheckpoint(stream, shardId);
    expect(seq).toBeNull();
  });

  it('checkpoint sets the sequence number', async () => {
    await repo.checkpoint(stream, shardId, owner, '49600000000000000000000000000000000000000000001');
    const seq = await repo.lastCheckpoint(stream, shardId);
    expect(seq).toBe('49600000000000000000000000000000000000000000001');
  });

  it('lastCheckpoint reflects the latest checkpointed sequence', async () => {
    await repo.checkpoint(stream, shardId, owner, '49600000000000000000000000000000000000000000099');
    const seq = await repo.lastCheckpoint(stream, shardId);
    expect(seq).toBe('49600000000000000000000000000000000000000000099');
  });

  it('release clears the owner so another worker can acquire', async () => {
    await repo.release(stream, shardId, owner);
    const ok = await repo.tryAcquire(stream, shardId, owner2, 60_000);
    expect(ok).toBe(true);
  });
});
