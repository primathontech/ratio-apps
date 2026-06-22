import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { MetaDatabase } from '../db/types';
import { META_DB_TOKEN } from '../kysely.module';

@Injectable()
export class ShardLeaseRepository {
  constructor(@Inject(META_DB_TOKEN) private readonly handle: KyselyClient<MetaDatabase>) {}

  /** Claim a shard if unowned or the lease expired. Returns true on success. */
  async tryAcquire(stream: string, shardId: string, owner: string, ttlMs: number): Promise<boolean> {
    const res = await sql`
      INSERT INTO meta_capi_shard_leases (stream, shard_id, owner, leased_until)
      VALUES (${stream}, ${shardId}, ${owner}, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${ttlMs / 1000} SECOND))
      ON DUPLICATE KEY UPDATE
        owner = IF(leased_until IS NULL OR leased_until < CURRENT_TIMESTAMP(3) OR owner = VALUES(owner), VALUES(owner), owner),
        leased_until = IF(owner = VALUES(owner), VALUES(leased_until), leased_until)
    `.execute(this.handle.db);
    const row = await this.handle.db.selectFrom('meta_capi_shard_leases')
      .select(['owner']).where('stream', '=', stream).where('shardId', '=', shardId).executeTakeFirst();
    void res;
    return row?.owner === owner;
  }

  async checkpoint(stream: string, shardId: string, owner: string, seq: string): Promise<void> {
    await this.handle.db.updateTable('meta_capi_shard_leases')
      .set({ checkpointSeq: seq, leasedUntil: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND)` } as never)
      .where('stream', '=', stream).where('shardId', '=', shardId).where('owner', '=', owner).execute();
  }

  async lastCheckpoint(stream: string, shardId: string): Promise<string | null> {
    const row = await this.handle.db.selectFrom('meta_capi_shard_leases')
      .select(['checkpointSeq']).where('stream', '=', stream).where('shardId', '=', shardId).executeTakeFirst();
    return row?.checkpointSeq ?? null;
  }

  async release(stream: string, shardId: string, owner: string): Promise<void> {
    await this.handle.db.updateTable('meta_capi_shard_leases')
      .set({ owner: null, leasedUntil: null } as never)
      .where('stream', '=', stream).where('shardId', '=', shardId).where('owner', '=', owner).execute();
  }
}
