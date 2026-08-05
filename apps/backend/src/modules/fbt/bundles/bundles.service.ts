import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  FbtBundleInput,
  FbtBundleModeValue,
  FbtBundleOutput,
  FbtBundleStatusValue,
} from '@ratio-app/shared/schemas/fbt-bundle';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FbtBundleRow, FbtDatabase } from '../db/types';
import { FBT_DB_TOKEN } from '../kysely.module';

const MAX_PAGE_SIZE = 100;

/** Row → API shape. Exported because the lookup service returns bundles too. */
export function toBundleOutput(row: FbtBundleRow): FbtBundleOutput {
  return {
    id: row.id,
    merchantId: row.merchantId,
    name: row.name,
    status: row.status,
    scopeType: row.scopeType,
    scopeProductIds: row.scopeProductIds,
    scopeCollectionIds: row.scopeCollectionIds,
    startDate: row.startDate ? new Date(row.startDate).toISOString() : null,
    endDate: row.endDate ? new Date(row.endDate).toISOString() : null,
    recommendationCount: row.recommendationCount,
    recommendationProductList: row.recommendationProductList,
    uiConfig: row.uiConfig,
    perCardConfig: row.perCardConfig,
    mode: row.mode,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** `null` stays SQL NULL; anything else is JSON text (mysql2 won't stringify). */
function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export interface ListBundlesOptions {
  status?: FbtBundleStatusValue;
  mode?: FbtBundleModeValue;
  page: number;
  limit: number;
}

/**
 * The fields `create` and `duplicate` both write. Structural, so it accepts both
 * `FbtBundleInput` (create) and `FbtBundleOutput` (duplicate's source row) —
 * their shared field names and types line up.
 */
type BundleWritableFields = Pick<
  FbtBundleInput,
  | 'scopeType'
  | 'scopeProductIds'
  | 'scopeCollectionIds'
  | 'startDate'
  | 'endDate'
  | 'recommendationCount'
  | 'uiConfig'
  | 'perCardConfig'
>;

/**
 * Bundle CRUD over `fbt_bundles`.
 *
 * Tenancy rule: `merchantId` comes from the guard-populated `@CurrentMerchant()`
 * and EVERY query filters on it — including `getById`, where it is the only
 * thing stopping a cross-tenant read by UUID.
 */
@Injectable()
export class FbtBundlesService {
  constructor(@Inject(FBT_DB_TOKEN) private readonly handle: KyselyClient<FbtDatabase>) {}

  /**
   * Builds the insert row shared by `create` and `duplicate`.
   *
   * `mode` is hardcoded 'manual' here and never read from the caller's data: the
   * admin creates manual bundles only, and Plan 3's sweep is the sole writer of
   * mode 'auto'. `recommendationProductList` is deliberately absent for the same
   * reason — the sweep owns it.
   */
  private buildInsertRow(
    id: string,
    merchantId: string,
    name: string,
    status: FbtBundleStatusValue,
    data: BundleWritableFields,
  ) {
    return {
      id,
      merchantId,
      name,
      status,
      ...this.buildWritableColumns(data),
      mode: 'manual' as const,
    };
  }

  /**
   * The eight columns an INSERT and an UPDATE both write, with the JSON and date
   * coercions applied once. Shared so `create`, `duplicate`, and `update` cannot
   * drift — a JSON column that gets stringified in one path and not another
   * inserts the literal text `[object Object]`.
   */
  private buildWritableColumns(data: BundleWritableFields) {
    return {
      scopeType: data.scopeType,
      scopeProductIds: jsonOrNull(data.scopeProductIds),
      scopeCollectionIds: jsonOrNull(data.scopeCollectionIds),
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      recommendationCount: data.recommendationCount,
      uiConfig: JSON.stringify(data.uiConfig),
      perCardConfig: jsonOrNull(data.perCardConfig),
    };
  }

  async create(merchantId: string, input: FbtBundleInput): Promise<FbtBundleOutput> {
    const id = randomUUID();
    await this.handle.db
      .insertInto('fbt_bundles')
      .values(this.buildInsertRow(id, merchantId, input.name, input.status, input))
      .execute();

    return this.getById(merchantId, id);
  }

  async list(
    merchantId: string,
    opts: ListBundlesOptions,
  ): Promise<{ items: FbtBundleOutput[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, opts.page);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.limit));

    let q = this.handle.db.selectFrom('fbt_bundles').where('merchantId', '=', merchantId);
    if (opts.status) q = q.where('status', '=', opts.status);
    if (opts.mode) q = q.where('mode', '=', opts.mode);

    const rows = await q
      .selectAll()
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();

    const counted = await q
      .select((eb) => eb.fn.count<number>('id').as('total'))
      .executeTakeFirstOrThrow();

    return {
      items: rows.map(toBundleOutput),
      total: Number(counted.total),
      page,
      limit,
    };
  }

  async getById(merchantId: string, id: string): Promise<FbtBundleOutput> {
    const row = await this.handle.db
      .selectFrom('fbt_bundles')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        message: 'bundle not found',
        error_code: 'BUNDLE_NOT_FOUND',
      });
    }
    return toBundleOutput(row);
  }

  async update(merchantId: string, id: string, input: FbtBundleInput): Promise<FbtBundleOutput> {
    await this.getById(merchantId, id);

    await this.handle.db
      .updateTable('fbt_bundles')
      // No `mode` and no `recommendationProductList`: an admin edit must never
      // relabel an auto bundle or overwrite the sweep's output.
      .set({
        name: input.name,
        status: input.status,
        ...this.buildWritableColumns(input),
      })
      .where('merchantId', '=', merchantId)
      .where('id', '=', id)
      .execute();

    return this.getById(merchantId, id);
  }

  async remove(merchantId: string, id: string): Promise<void> {
    await this.handle.db
      .deleteFrom('fbt_bundles')
      .where('merchantId', '=', merchantId)
      .where('id', '=', id)
      .execute();
  }

  async duplicate(merchantId: string, id: string, name?: string): Promise<FbtBundleOutput> {
    const source = await this.getById(merchantId, id);
    const newId = randomUUID();

    await this.handle.db
      .insertInto('fbt_bundles')
      // Always 'draft', whatever the source's status: a duplicate must never
      // land in front of shoppers without the merchant reviewing it first.
      // `buildInsertRow` also forces mode 'manual'. `recommendationProductList`
      // is zeroed explicitly (unlike `create`, whose `FbtBundleInput` can never
      // carry the field at all): `source` is an `FbtBundleOutput` and DOES carry
      // it, so an auto bundle's sweep-generated list needs a runtime guard here
      // to avoid making the copy look auto-managed when nothing manages it.
      .values({
        ...this.buildInsertRow(newId, merchantId, name ?? `${source.name} (copy)`, 'draft', source),
        recommendationProductList: null,
      })
      .execute();

    return this.getById(merchantId, newId);
  }

  async setStatus(
    merchantId: string,
    id: string,
    status: FbtBundleStatusValue,
  ): Promise<FbtBundleOutput> {
    await this.getById(merchantId, id);

    await this.handle.db
      .updateTable('fbt_bundles')
      .set({ status })
      .where('merchantId', '=', merchantId)
      .where('id', '=', id)
      .execute();

    return this.getById(merchantId, id);
  }
}
