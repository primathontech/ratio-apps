import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../../src/core/webhooks/webhook-log.types';
import type {
  ClevertapUploadInput,
  ClevertapUploadResult,
} from '../../../../../src/modules/clevertap/events/clevertap-events.client';

export type WebhookTrx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

export interface ForwardedEventRow extends Record<string, unknown> {
  merchantId: string;
  idempotencyKey: string;
  topic: string;
  clevertapEvent: string;
  status: string;
  error: string | null;
}

export interface ClevertapConfigRowFake {
  merchantId: string;
  accountId: string;
  passcodeEnc: string | null;
  region: string;
  serverEventsEnabled: boolean;
  clevertapEnabled?: boolean;
  disabledTopics?: string[] | null;
  chargedSource?: string;
}

export interface FakeTrx {
  trx: WebhookTrx;
  ops: string[];
  rows: ForwardedEventRow[];
  failNextUpdate: () => void;
}

export function makeFakeTrx(opts: {
  config?: ClevertapConfigRowFake;
  existingRows?: ForwardedEventRow[];
}): FakeTrx {
  const ops: string[] = [];
  const rows: ForwardedEventRow[] = [...(opts.existingRows ?? [])];
  let updateShouldThrow = false;

  const trx = {
    selectFrom(table: string) {
      const chain = {
        selectAll: () => chain,
        select: () => chain,
        where: () => chain,
        limit: () => chain,
        executeTakeFirst: async () => {
          ops.push(`select:${table}`);
          if (table !== 'clevertap_configs') return undefined;
          if (!opts.config) return undefined;
          return { clevertapEnabled: true, ...opts.config };
        },
      };
      return chain;
    },

    insertInto(table: string) {
      let values: ForwardedEventRow | undefined;
      let ignore = false;
      const run = () => {
        if (!values) throw new Error('fake trx: insert without values');
        const duplicate = rows.some(
          (r) => r.merchantId === values?.merchantId && r.idempotencyKey === values?.idempotencyKey,
        );
        if (duplicate) {
          ops.push(`insert:${table}:duplicate`);
          if (!ignore) throw new Error(`fake trx: duplicate key in ${table}`);
          return { numInsertedOrUpdatedRows: 0n };
        }
        rows.push({ ...values });
        ops.push(`insert:${table}:${values.status}`);
        return { numInsertedOrUpdatedRows: 1n };
      };
      const chain = {
        ignore: () => {
          ignore = true;
          return chain;
        },
        values: (v: ForwardedEventRow) => {
          values = v;
          return chain;
        },
        execute: async () => [run()],
        executeTakeFirst: async () => run(),
      };
      return chain;
    },

    updateTable(table: string) {
      let patch: Record<string, unknown> = {};
      const wheres: [string, string, unknown][] = [];
      const chain = {
        set: (p: Record<string, unknown>) => {
          patch = p;
          return chain;
        },
        where: (field: string, op: string, value: unknown) => {
          wheres.push([field, op, value]);
          return chain;
        },
        execute: async () => {
          if (updateShouldThrow) {
            ops.push(`update:${table}:threw`);
            throw new Error('fake trx: connection lost mid-update');
          }
          const key = wheres.find(([f]) => f === 'idempotencyKey')?.[2];
          const merchantId = wheres.find(([f]) => f === 'merchantId')?.[2];
          for (const row of rows) {
            if (row.idempotencyKey === key && row.merchantId === merchantId) {
              Object.assign(row, patch);
            }
          }
          ops.push(`update:${table}:${String(patch.status)}`);
          return [];
        },
      };
      return chain;
    },
  } as unknown as WebhookTrx;

  return {
    trx,
    ops,
    rows,
    failNextUpdate: () => {
      updateShouldThrow = true;
    },
  };
}

export interface FakeUploader {
  upload(input: ClevertapUploadInput): Promise<ClevertapUploadResult>;
  calls: ClevertapUploadInput[];
}

export function makeFakeUploader(
  result: ClevertapUploadResult = { ok: true, status: 200 },
): FakeUploader {
  const calls: ClevertapUploadInput[] = [];
  return {
    calls,
    async upload(input) {
      calls.push(input);
      return result;
    },
  };
}

export function makeFakeCrypto(): {
  encrypt: (s: string) => string;
  decrypt: (s: string) => string;
} {
  return {
    encrypt: (s) => `enc:${s}`,
    decrypt: (s) => {
      if (!s.startsWith('enc:')) throw new Error('fake crypto: not a ciphertext');
      return s.slice('enc:'.length);
    },
  };
}
