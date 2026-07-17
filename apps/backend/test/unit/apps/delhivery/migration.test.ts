import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture raw `sql\`ALTER TABLE ...\`` statements the migration executes.
const rawStatements = vi.hoisted(() => [] as string[]);
vi.mock('kysely', () => ({
  sql: (strings: TemplateStringsArray, ..._vals: unknown[]) => ({
    execute: async () => {
      rawStatements.push(strings.join('?'));
    },
  }),
}));

import type { Kysely } from 'kysely';
import { down, up } from '../../../../src/modules/delhivery/db/migrations/0004_carrier_model';
import {
  down as down0005,
  up as up0005,
} from '../../../../src/modules/delhivery/db/migrations/0005_pickup_address';

interface TableSpec {
  columns: Array<{ name: string; type: string }>;
  uniques: Array<{ name: string; columns: string[] }>;
  foreignKeys: string[];
}

/** Recorder fake for the `db.schema` builder chains the migration uses. */
function fakeDb() {
  const tables: Record<string, TableSpec> = {};
  const indexes: Record<string, { table?: string; columns?: string[] }> = {};
  const dropped: string[] = [];

  const createTable = (name: string) => {
    const spec: TableSpec = { columns: [], uniques: [], foreignKeys: [] };
    tables[name] = spec;
    const chain = {
      addColumn: (col: string, type: string, _cb?: unknown) => {
        spec.columns.push({ name: col, type });
        return chain;
      },
      addUniqueConstraint: (cname: string, cols: string[]) => {
        spec.uniques.push({ name: cname, columns: cols });
        return chain;
      },
      addForeignKeyConstraint: (fkName: string) => {
        spec.foreignKeys.push(fkName);
        return chain;
      },
      execute: async () => undefined,
    };
    return chain;
  };

  const createIndex = (name: string) => {
    const spec: { table?: string; columns?: string[] } = {};
    indexes[name] = spec;
    const chain = {
      on: (table: string) => {
        spec.table = table;
        return chain;
      },
      columns: (cols: string[]) => {
        spec.columns = cols;
        return chain;
      },
      execute: async () => undefined,
    };
    return chain;
  };

  const dropTable = (name: string) => ({
    ifExists: () => ({ execute: async () => dropped.push(name) }),
  });

  // biome-ignore lint/suspicious/noExplicitAny: migration API uses Kysely<any>
  const db = { schema: { createTable, createIndex, dropTable } } as unknown as Kysely<any>;
  return { db, tables, indexes, dropped };
}

describe('0004_carrier_model migration (migration.createsTables)', () => {
  beforeEach(() => {
    rawStatements.length = 0;
  });

  it('reshapes delhivery_configs to the carrier config columns', async () => {
    const { db } = fakeDb();
    await up(db);

    const alter = rawStatements.find((s) => s.includes('ALTER TABLE delhivery_configs'));
    expect(alter).toBeTruthy();
    for (const dropped of ['api_key', 'host', 'debug', 'events']) {
      expect(alter).toContain(`DROP COLUMN ${dropped}`);
    }
    for (const added of [
      'api_token_enc',
      'pickup_location_name',
      'gstin',
      'pickup_cutoff',
      'awb_trigger',
      'default_box_lcm',
      'default_box_bcm',
      'default_box_hcm',
      'enabled',
    ]) {
      expect(alter).toContain(added);
    }
    expect(alter).toContain("DEFAULT '10:00'");
  });

  it('creates delhivery_shipments with the merchant FK + unique order_number per merchant', async () => {
    const { db, tables, indexes } = fakeDb();
    await up(db);

    const shipments = tables.delhivery_shipments;
    expect(shipments).toBeTruthy();
    const colNames = shipments.columns.map((c) => c.name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        'id',
        'merchant_id',
        'order_id',
        'order_number',
        'awb',
        'carrier',
        'status',
        'payment_mode',
        'cod_amount',
        'weight_grams',
        'label_url',
        'estimated_delivery',
        'active',
        'pickup_requested_at',
        'created_at',
        'updated_at',
      ]),
    );
    expect(shipments.uniques).toContainEqual({
      name: 'uq_delhivery_shipments_order_number',
      columns: ['merchant_id', 'order_number'],
    });
    expect(shipments.foreignKeys).toContain('fk_delhivery_shipments_merchant');
    expect(indexes.idx_delhivery_shipments_awb).toEqual({
      table: 'delhivery_shipments',
      columns: ['awb'],
    });
  });

  it('creates delhivery_tracking_events with the (awb, unified_status) dedupe unique', async () => {
    const { db, tables, indexes } = fakeDb();
    await up(db);

    const events = tables.delhivery_tracking_events;
    expect(events).toBeTruthy();
    expect(events.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'awb', 'raw_status', 'unified_status', 'location', 'event_ts']),
    );
    expect(events.uniques).toContainEqual({
      name: 'uq_delhivery_tracking_awb_status',
      columns: ['awb', 'unified_status'],
    });
    expect(indexes.idx_delhivery_tracking_awb).toEqual({
      table: 'delhivery_tracking_events',
      columns: ['awb'],
    });
  });

  it('down() drops both carrier tables and restores the template config columns', async () => {
    const { db, dropped } = fakeDb();
    await down(db);

    expect(dropped).toEqual(['delhivery_tracking_events', 'delhivery_shipments']);
    const alter = rawStatements.find((s) => s.includes('ALTER TABLE delhivery_configs'));
    expect(alter).toContain('DROP COLUMN api_token_enc');
    expect(alter).toContain('ADD COLUMN api_key');
  });
});

describe('0005_pickup_address migration', () => {
  beforeEach(() => {
    rawStatements.length = 0;
  });

  it('adds the pickup address columns with the snake_case names Kysely maps to', async () => {
    const { db } = fakeDb();
    await up0005(db);

    const alter = rawStatements.find((s) => s.includes('ALTER TABLE delhivery_configs'));
    expect(alter).toBeTruthy();
    // Column names MUST match CamelCasePlugin mapping (pickupPincode → pickup_pincode).
    for (const col of ['pickup_pincode', 'pickup_phone', 'pickup_address', 'pickup_city']) {
      expect(alter).toContain(`ADD COLUMN ${col}`);
    }
  });

  it('down() drops the pickup address columns', async () => {
    const { db } = fakeDb();
    await down0005(db);

    const alter = rawStatements.find((s) => s.includes('ALTER TABLE delhivery_configs'));
    for (const col of ['pickup_pincode', 'pickup_phone', 'pickup_address', 'pickup_city']) {
      expect(alter).toContain(`DROP COLUMN ${col}`);
    }
  });
});
