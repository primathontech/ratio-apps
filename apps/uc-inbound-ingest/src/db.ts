import { createHash, randomUUID } from 'node:crypto';
import { createPool, type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

export type InboundJobType = 'status_notify' | 'inventory_update';

export interface Db {
  /** sha256-hex token lookup + expiry check — mirror of UcAuthService.validateToken. */
  validateApiKey(apiKey: string): Promise<string | null>;
  /** Mirror of UcCredentialsService.getStatus — drives the paused/uninstalled kill-switch. */
  getCredentialStatus(merchantId: string): Promise<'active' | 'paused' | 'uninstalled' | null>;
  /** Best-effort `last_inbound_call_at` stamp — mirror of UcCredentialsService.touchInboundCall. */
  touchInboundCall(merchantId: string): Promise<void>;
  /** Local per-item existence check for status notifications (uc_order_item_map). */
  resolveOrderItem(orderItemId: string): Promise<{ merchantId: string } | null>;
  /** Durably enqueue one job row (PENDING); returns the generated job id. */
  insertJob(
    merchantId: string,
    type: InboundJobType,
    payload: Record<string, unknown>,
  ): Promise<string>;
  close(): Promise<void>;
}

interface AccessTokenRow extends RowDataPacket {
  merchant_id: string;
}

interface CredentialStatusRow extends RowDataPacket {
  status: string;
}

interface OrderItemRow extends RowDataPacket {
  merchant_id: string;
}

/**
 * Raw mysql2 pool over the SAME `unicommerce_app` DB the backend's unicommerce
 * module owns. Deliberately no ORM: this app only reads a handful of existing
 * columns and writes `uc_inbound_jobs`. Connection settings mirror
 * core/db/kysely-factory.ts (timezone Z, keep-alive, bounded queue).
 */
export function createDb(databaseUrl: string): Db {
  const pool: Pool = createPool({
    uri: databaseUrl,
    connectionLimit: 5,
    queueLimit: 20,
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: 'Z',
  });

  return {
    async validateApiKey(apiKey: string): Promise<string | null> {
      const tokenHash = createHash('sha256').update(apiKey).digest('hex');
      // UTC_TIMESTAMP(3) — the backend writes expires_at from a JS Date over a
      // timezone-Z connection (i.e. UTC); comparing against the session clock
      // could skew by the server's local offset.
      const [rows] = await pool.query<AccessTokenRow[]>(
        'SELECT merchant_id FROM uc_access_tokens WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)',
        [tokenHash],
      );
      return rows[0]?.merchant_id ?? null;
    },

    async getCredentialStatus(
      merchantId: string,
    ): Promise<'active' | 'paused' | 'uninstalled' | null> {
      const [rows] = await pool.query<CredentialStatusRow[]>(
        'SELECT status FROM uc_credentials WHERE merchant_id = ?',
        [merchantId],
      );
      const status = rows[0]?.status;
      if (status === 'active' || status === 'paused' || status === 'uninstalled') return status;
      return null;
    },

    async touchInboundCall(merchantId: string): Promise<void> {
      await pool.query(
        'UPDATE uc_credentials SET last_inbound_call_at = UTC_TIMESTAMP(3) WHERE merchant_id = ?',
        [merchantId],
      );
    },

    async resolveOrderItem(orderItemId: string): Promise<{ merchantId: string } | null> {
      const [rows] = await pool.query<OrderItemRow[]>(
        'SELECT merchant_id FROM uc_order_item_map WHERE order_item_id = ?',
        [orderItemId],
      );
      const row = rows[0];
      return row ? { merchantId: row.merchant_id } : null;
    },

    async insertJob(
      merchantId: string,
      type: InboundJobType,
      payload: Record<string, unknown>,
    ): Promise<string> {
      // The id is generated here (not via the column's UUID() default) because
      // `id` is a char(36) default-expression column, NOT an auto-increment —
      // mysql2's insertId would be 0 and we'd lose the job id we need to
      // publish to Kafka. Same table, same schema; the backend consumer only
      // ever reads the row back by id, never assumes who generated it.
      const id = randomUUID();
      await pool.query<ResultSetHeader>(
        'INSERT INTO uc_inbound_jobs (id, merchant_id, type, payload, status) VALUES (?, ?, ?, ?, ?)',
        [id, merchantId, type, JSON.stringify(payload), 'PENDING'],
      );
      return id;
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
