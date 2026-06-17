import { BadRequestException } from '@nestjs/common';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { DatabaseWithMerchants, MerchantRow } from '../merchants/merchant.types';
import type { DatabaseWithWebhookLog } from './webhook-log.types';
import {
  WEBHOOK_MAX_PAYLOAD_BYTES,
  WEBHOOK_MAX_SKEW_MS,
  type WebhookEnvelope,
  type WebhookHandler,
} from './webhooks.types';

export interface WebhooksServiceDeps<DB> {
  db: Kysely<DB>;
  /**
   * Single-handler form (legacy). Kept for backward compatibility with modules
   * that subscribe to exactly one topic (e.g. `_template`). Usable alongside
   * `handlers` — both are normalized into one topic→handler map.
   */
  handler?: WebhookHandler;
  /**
   * Multi-handler form. A module that subscribes to several topics (e.g. the
   * `google` app: `app.uninstalled` + `products.*`) passes one handler per
   * topic. Dispatch routes `envelope.event` to the handler whose `topic`
   * matches. Duplicate topics are a wiring error and throw at construction.
   */
  handlers?: readonly WebhookHandler[];
}

type WebhookLogDb = DatabaseWithMerchants & DatabaseWithWebhookLog;

// TODO(D9): `webhook_log.id` currently defaults to MySQL's `UUID()`, which
// emits UUIDv1 with the high-entropy bits leading. That gives the primary
// key essentially random insert order, which fragments the InnoDB B-tree
// and amplifies write I/O at high webhook volume. Switch to UUIDv7 (time-
// ordered) once MySQL adds a native generator — MySQL 9.7 does NOT ship
// `UUID_v7()` yet (verified on the dev image, error 1305 "FUNCTION ...
// UUID_v7 does not exist"). Two viable paths when we revisit:
//   1. Wait for MySQL to ship `UUID_v7()` and add a migration that changes
//      the `webhook_log.id` DEFAULT from `(UUID())` to `(UUID_v7())`.
//   2. Generate the id in app code (e.g. the `uuidv7` npm package) and
//      pass it explicitly on insert — this would also let us migrate
//      the column to `BINARY(16)` via `UUID_TO_BIN(uuid, 1)` for half
//      the storage and tighter b-tree locality.
// Either way, the migration is non-trivial and gated on a real volume
// problem — leave the column alone until then.
export class WebhooksService<DB extends DatabaseWithMerchants & DatabaseWithWebhookLog> {
  /**
   * Topic → handler routing table, built once at construction from the legacy
   * `handler` and/or the `handlers[]` array. Routing by exact `topic` equality
   * preserves the single-handler dispatch semantics; a module with N topics
   * simply registers N entries.
   */
  private readonly handlersByTopic: ReadonlyMap<string, WebhookHandler>;

  constructor(private readonly deps: WebhooksServiceDeps<DB>) {
    const list: WebhookHandler[] = [
      ...(deps.handler ? [deps.handler] : []),
      ...(deps.handlers ?? []),
    ];
    const map = new Map<string, WebhookHandler>();
    for (const h of list) {
      if (map.has(h.topic)) {
        throw new Error(`WebhooksService: duplicate handler registered for topic '${h.topic}'`);
      }
      map.set(h.topic, h);
    }
    this.handlersByTopic = map;
  }

  private get qb(): Kysely<WebhookLogDb> {
    return this.deps.db as unknown as Kysely<WebhookLogDb>;
  }

  /**
   * Dispatch an inbound webhook envelope.
   *
   * All-or-nothing transactional dispatch:
   *   The merchant lookup, `INSERT IGNORE` into `webhook_log`, handler
   *   invocation, and the `processed_at` UPDATE all run inside a SINGLE
   *   MySQL transaction. The handler receives the open `trx` so its own
   *   writes (e.g. `merchants.is_active = false`) participate in the same
   *   atomic scope. If the handler throws — or the trailing UPDATE throws,
   *   or the pod crashes between the two — MySQL rolls back the INSERT
   *   too. The next Ratio retry of the same `ratio_webhook_id` then sees a
   *   fresh INSERT (because the row no longer exists) and re-runs the
   *   handler. That's the self-healing guarantee: there is no observable
   *   state in which the `webhook_log` row exists but the handler's side
   *   effect didn't commit.
   *
   * `processed_at` contract:
   *   `processed_at` is set on EVERY successful trx commit — both the
   *   "handler ran" path and the "topic-mismatch skip" path. A NULL
   *   `processed_at` therefore means exactly one thing: the row's
   *   transaction crashed/was killed mid-handler before the trailing
   *   UPDATE could run. Future dead-letter / ops scanners can rely on
   *   `processed_at IS NULL` as the unambiguous signal for "in-flight or
   *   crashed, may need attention". To distinguish "no handler ran" from
   *   "handler ran successfully" on a committed row, observers compare
   *   `webhook_log.topic` against the handler's configured topic — the
   *   topic-mismatch skip leaves the original envelope topic in place,
   *   which by construction differs from any registered handler.topic.
   *
   * Topic-mismatch fast-path (perf):
   *   When the envelope's `event` doesn't match the registered
   *   `handler.topic`, we fold `processed_at = NOW()` directly into the
   *   INSERT IGNORE — skipping the trailing UPDATE round-trip. Most
   *   inbound deliveries hit this path (a single registered handler.topic
   *   matches one Ratio event type), so this is the hot path and a wasted
   *   UPDATE per delivery adds up at volume. We also skip the merchant
   *   FOR UPDATE lock on this path since no handler will mutate the row.
   *
   * Idempotency / dedupe contract (unchanged):
   *   - `webhook_log` has a UNIQUE constraint on `ratio_webhook_id`. We
   *     `INSERT IGNORE` first; the request that wins the INSERT is solely
   *     responsible for invoking the handler. Every losing request returns
   *     immediately as a no-op (HTTP 200) — regardless of whether the
   *     winner has finished yet.
   *   - This closes the double-execution race: a loser that arrives while
   *     the winner is still mid-handler would see `processed_at = NULL`
   *     and re-run the handler. Now the loser exits before touching the
   *     handler — we do NOT peek at `processed_at` on the loser path.
   *   - Idempotent retries by Ratio still work: Ratio assigns a fresh
   *     `ratio_webhook_id` to each delivery attempt, so a real retry from
   *     the upstream produces a new INSERT and re-runs the handler. Only
   *     duplicate fan-out of the SAME delivery id is deduped here.
   */
  async dispatch(envelope: WebhookEnvelope): Promise<void> {
    const age = Date.now() - envelope.timestamp.getTime();
    if (Math.abs(age) > WEBHOOK_MAX_SKEW_MS) {
      throw new BadRequestException({
        message: 'webhook timestamp out of acceptable window',
        error_code: 'WEBHOOK_STALE',
      });
    }

    // mysql2 doesn't auto-serialize JS objects to JSON columns — it would
    // send `[object Object]` and MySQL rejects with "Invalid JSON text".
    // Pre-stringify, matching the same pattern config.service.ts uses for the
    // `_template_configs.events` / `_template_configs.events` JSON columns.
    const payloadJson = JSON.stringify(envelope.data);

    // App-layer payload-size guard. Rejects pathological/abusive bodies
    // before we ever open a transaction or hit MySQL's max_allowed_packet.
    const payloadBytes = Buffer.byteLength(payloadJson);
    if (payloadBytes > WEBHOOK_MAX_PAYLOAD_BYTES) {
      throw new BadRequestException({
        message: 'webhook payload too large',
        error_code: 'WEBHOOK_PAYLOAD_TOO_LARGE',
        details: { bytes: payloadBytes, max: WEBHOOK_MAX_PAYLOAD_BYTES },
      });
    }

    await this.qb.transaction().execute(async (trx) => {
      // Compute the matching handler BEFORE the merchant lookup so the SELECT
      // can decide whether to take the row lock up front (match path) or stay
      // non-locking (mismatch fast-path). With multiple registered handlers,
      // routing is an exact `topic` lookup — identical semantics to the old
      // single-handler equality check, just generalized to N topics.
      const matchedHandler = this.handlersByTopic.get(envelope.event);
      const isMatch = matchedHandler !== undefined;

      // Merchant lookup MUST live inside the trx alongside the log insert,
      // handler call, and processed-at update — otherwise a concurrent
      // uninstall handler (or any other transaction touching the same row)
      // could change the merchant out from under us between the read and
      // the handler's writes. We inline the SELECT here (rather than
      // spinning up a new MerchantsService bound to the trx) because the
      // read is trivial and avoids leaking trx into the module-level
      // service surface.
      //
      // On the match path we take SELECT ... FOR UPDATE at the initial
      // read — this avoids a lock upgrade later (the handler would
      // otherwise issue its own FOR UPDATE on the same row, forcing
      // InnoDB to upgrade a non-locking S-lock to an X-lock).
      const merchant: MerchantRow | null = envelope.merchantId
        ? (((await (isMatch
            ? trx
                .selectFrom('merchants')
                .selectAll()
                .where('id', '=', envelope.merchantId)
                .forUpdate()
                .limit(1)
                .executeTakeFirst()
            : trx
                .selectFrom('merchants')
                .selectAll()
                .where('id', '=', envelope.merchantId)
                .limit(1)
                .executeTakeFirst())) ?? null) as MerchantRow | null)
        : null;

      // Topic-mismatch fast-path: fold `processed_at = NOW()` into the
      // INSERT IGNORE so the dispatch trx is single-round-trip on the
      // common case. The row's `topic` field is the envelope's, not the
      // handler's, so observers can still distinguish "no handler ran"
      // from "handler ran". On the match path we keep `processed_at`
      // NULL until the handler returns, so a crash mid-handler leaves
      // the row visibly unprocessed for dead-letter scanners.
      const insertResults = await trx
        .insertInto('webhook_log')
        .values({
          ratioWebhookId: envelope.id,
          topic: envelope.event,
          payload: payloadJson as unknown as Record<string, unknown>,
          signatureOk: true,
          merchantId: merchant?.id ?? null,
          processedAt: isMatch ? null : (sql`CURRENT_TIMESTAMP(3)` as unknown as Date | null),
        })
        .ignore()
        .execute();

      const first = insertResults[0] as { numInsertedOrUpdatedRows?: bigint } | undefined;
      const isNew = (first?.numInsertedOrUpdatedRows ?? 0n) > 0n;

      // Lost the dedupe race — another request owns this envelope. Do NOT
      // peek at `processed_at`: if the winner is still mid-handler, that
      // column is NULL and we'd race-run the handler a second time.
      if (!isNew) return;

      // Topic-mismatch fast-path: the INSERT above already stamped
      // processed_at; no handler will run and no trailing UPDATE is
      // needed. Single round-trip done.
      if (!isMatch) return;

      // `matchedHandler` is defined here: isMatch === true implies a hit, and
      // the two early returns above cover the !isNew and !isMatch paths.
      await (matchedHandler as WebhookHandler).handle(
        envelope.data,
        merchant?.id ?? null,
        trx as Transaction<WebhookLogDb>,
      );

      await trx
        .updateTable('webhook_log')
        .set({ processedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
        .where('ratioWebhookId', '=', envelope.id)
        .execute();
    });
  }
}
