import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CLEVERTAP_CHARGED_EVENT,
  CLEVERTAP_REGIONS,
  type ClevertapWebhookEventTopic,
  DEFAULT_CLEVERTAP_REGION,
} from '@ratio-app/shared/constants/clevertap-events';
import type { Transaction } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { ClevertapConfigRow, ClevertapDatabase, ClevertapForwardStatus } from '../db/types';
import {
  CLEVERTAP_APP_ENABLED,
  CLEVERTAP_CRYPTO,
  CLEVERTAP_FORWARD_WORKER_ENABLED,
} from '../tokens';
import type { ClevertapCustomerTopic } from '../webhooks/topics';
import {
  CLEVERTAP_EVENTS_CLIENT_FACTORY,
  type ClevertapEventsClientFactory,
} from './clevertap-events.client';
import { mapLoyaltyEvent } from './loyalty-event.mapper';
import {
  buildIdempotencyKey,
  deriveOrderEventName,
  describeUnmappableOrder,
  type MappedClevertapEvent,
  mapCustomerProfile,
  mapOrderEvent,
} from './order-event.mapper';
import {
  deriveReviewEventName,
  describeUnmappableReview,
  mapReviewEvent,
} from './review-event.mapper';

type WebhookTrx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

type ClevertapTrx = Transaction<ClevertapDatabase>;

const MAX_ERROR_LEN = 500;

@Injectable()
export class ClevertapForwardingService {
  private readonly logger = new Logger(ClevertapForwardingService.name);

  constructor(
    @Inject(CLEVERTAP_CRYPTO) private readonly crypto: Pick<CryptoService, 'decrypt'>,
    @Inject(CLEVERTAP_EVENTS_CLIENT_FACTORY)
    private readonly clientFactory: ClevertapEventsClientFactory,
    @Optional() @Inject(CLEVERTAP_APP_ENABLED) private readonly platformEnabled = true,
    @Optional()
    @Inject(CLEVERTAP_FORWARD_WORKER_ENABLED)
    private readonly workerEnabled = false,
  ) {}

  async forwardOrder(
    topic: ClevertapWebhookEventTopic,
    order: Record<string, unknown>,
    merchantId: string | null,
    trx: WebhookTrx,
  ): Promise<void> {
    const mapped = mapOrderEvent(topic, order);
    if (mapped) return this.forward(topic, mapped, merchantId, trx);
    return this.recordUnmappable(topic, order, merchantId, trx);
  }

  private async recordUnmappable(
    topic: string,
    order: Record<string, unknown>,
    merchantId: string | null,
    trx: WebhookTrx,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'webhook for unknown merchant — no-op', topic });
      return;
    }
    const { subjectId, reason } = describeUnmappableOrder(order);
    if (!subjectId) {
      this.logger.warn({ msg: 'payload has no usable resource id — not forwarded', topic, reason });
      return;
    }

    const ctrx = trx as unknown as ClevertapTrx;
    const idempotencyKey = buildIdempotencyKey(topic, subjectId);
    await this.record(ctrx, {
      merchantId,
      idempotencyKey,
      topic,
      clevertapEvent: deriveOrderEventName(topic),
      status: 'skipped',
      error: reason,
    });
    this.logger.warn({
      msg: 'server-side forwarding skipped — unmappable payload',
      merchantId,
      topic,
      idempotencyKey,
      status: 'skipped',
      reason,
    });
  }

  async forwardCustomerProfile(
    topic: ClevertapCustomerTopic,
    customer: Record<string, unknown>,
    merchantId: string | null,
    trx: WebhookTrx,
  ): Promise<void> {
    return this.forward(topic, mapCustomerProfile(topic, customer), merchantId, trx);
  }

  async forwardLoyaltyEvent(
    topic: string,
    payload: Record<string, unknown>,
    merchantId: string | null,
    trx: WebhookTrx,
  ): Promise<void> {
    return this.forward(topic, mapLoyaltyEvent(topic, payload), merchantId, trx);
  }

  async forwardReviewEvent(
    topic: string,
    review: Record<string, unknown>,
    merchantId: string | null,
    trx: WebhookTrx,
  ): Promise<void> {
    const mapped = mapReviewEvent(topic, review);
    if (mapped) return this.forward(topic, mapped, merchantId, trx);
    return this.recordUnmappableReview(topic, review, merchantId, trx);
  }

  private async recordUnmappableReview(
    topic: string,
    review: Record<string, unknown>,
    merchantId: string | null,
    trx: WebhookTrx,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'webhook for unknown merchant — no-op', topic });
      return;
    }
    const { subjectId, reason } = describeUnmappableReview(review);
    if (!subjectId) {
      this.logger.warn({ msg: 'payload has no usable resource id — not forwarded', topic, reason });
      return;
    }

    const ctrx = trx as unknown as ClevertapTrx;
    const idempotencyKey = buildIdempotencyKey(topic, subjectId);
    await this.record(ctrx, {
      merchantId,
      idempotencyKey,
      topic,
      clevertapEvent: deriveReviewEventName(topic),
      status: 'skipped',
      error: reason,
    });
    this.logger.warn({
      msg: 'server-side forwarding skipped — unmappable payload',
      merchantId,
      topic,
      idempotencyKey,
      status: 'skipped',
      reason,
    });
  }

  private async forward(
    topic: string,
    mapped: MappedClevertapEvent | null,
    merchantId: string | null,
    trx: WebhookTrx,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'webhook for unknown merchant — no-op', topic });
      return;
    }
    if (!mapped) {
      this.logger.warn({ msg: 'payload has no usable resource id — not forwarded', topic });
      return;
    }

    const ctrx = trx as unknown as ClevertapTrx;
    const idempotencyKey = buildIdempotencyKey(topic, mapped.subjectId);

    const config = await ctrx
      .selectFrom('clevertap_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();

    const skipReason = skipReasonFor(config, this.platformEnabled, topic, mapped.clevertapEvent);
    if (skipReason !== null) {
      await this.record(ctrx, {
        merchantId,
        idempotencyKey,
        topic,
        clevertapEvent: mapped.clevertapEvent,
        status: 'skipped',
        error: skipReason,
      });
      this.logger.log({
        msg: 'server-side forwarding skipped',
        merchantId,
        topic,
        idempotencyKey,
        status: 'skipped',
        reason: skipReason,
      });
      return;
    }
    const row = config as ClevertapConfigRow & { passcodeEnc: string };

    if (this.workerEnabled) {
      const queued = await this.record(ctrx, {
        merchantId,
        idempotencyKey,
        topic,
        clevertapEvent: mapped.clevertapEvent,
        status: 'queued',
        error: null,
        payload: JSON.stringify(mapped.records),
      });
      this.logger.log({
        msg: queued
          ? 'server-side forwarding enqueued (outbox)'
          : 'duplicate forward suppressed — already recorded',
        merchantId,
        topic,
        idempotencyKey,
      });
      return;
    }

    const inserted = await this.record(ctrx, {
      merchantId,
      idempotencyKey,
      topic,
      clevertapEvent: mapped.clevertapEvent,
      status: 'failed',
      error: 'forward in flight — not yet confirmed',
    });
    if (!inserted) {
      this.logger.log({
        msg: 'duplicate forward suppressed — already recorded',
        merchantId,
        topic,
        idempotencyKey,
      });
      return;
    }

    let result: { ok: boolean; status: number; error?: string };
    try {
      const passcode = this.crypto.decrypt(row.passcodeEnc);
      const client = this.clientFactory(apiHostFor(row.region));
      result = await client.upload({
        accountId: row.accountId,
        passcode,
        records: mapped.records,
      });
    } catch (err) {
      result = {
        ok: false,
        status: 0,
        error: err instanceof Error ? err.name : 'forward_error',
      };
    }

    await ctrx
      .updateTable('clevertap_forwarded_events')
      .set({
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? null : truncate(result.error ?? `clevertap ${result.status}`),
      })
      .where('merchantId', '=', merchantId)
      .where('idempotencyKey', '=', idempotencyKey)
      .execute();

    this.logger.log({
      msg: result.ok ? 'forwarded to clevertap' : 'clevertap forward failed',
      merchantId,
      topic,
      idempotencyKey,
      status: result.ok ? 'sent' : 'failed',
      clevertapEvent: mapped.clevertapEvent,
    });
  }

  private async record(
    ctrx: ClevertapTrx,
    values: {
      merchantId: string;
      idempotencyKey: string;
      topic: string;
      clevertapEvent: string;
      status: ClevertapForwardStatus;
      error: string | null;
      payload?: string;
    },
  ): Promise<boolean> {
    const res = await ctrx
      .insertInto('clevertap_forwarded_events')
      .ignore()
      .values({ ...values, error: values.error === null ? null : truncate(values.error) })
      .executeTakeFirst();
    return Number(res?.numInsertedOrUpdatedRows ?? 0) > 0;
  }
}

export function skipReasonFor(
  config: ClevertapConfigRow | undefined,
  platformEnabled: boolean,
  topic: string,
  clevertapEvent: string,
): string | null {
  if (!platformEnabled) return 'platform disabled';
  if (!config) return 'no clevertap config row';
  if (!config.clevertapEnabled) return 'app disabled';
  if (!config.serverEventsEnabled) return 'server_events_enabled is false';

  if (clevertapEvent === CLEVERTAP_CHARGED_EVENT) {
    if (config.chargedSource === 'client') return 'charged sent client-side';
  } else if (topicIsDisabled(config.disabledTopics, topic)) {
    return 'topic disabled';
  }

  if (!config.passcodeEnc) return 'no passcode configured';
  if (!config.accountId) return 'no account id configured';
  return null;
}

function topicIsDisabled(disabledTopics: unknown, topic: string): boolean {
  let list = disabledTopics;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return false;
    }
  }
  return Array.isArray(list) && list.includes(topic);
}

export function apiHostFor(region: string): string {
  const known = (CLEVERTAP_REGIONS as Record<string, { apiHost: string } | undefined>)[region];
  return (known ?? CLEVERTAP_REGIONS[DEFAULT_CLEVERTAP_REGION]).apiHost;
}

function truncate(s: string): string {
  return s.length > MAX_ERROR_LEN ? s.slice(0, MAX_ERROR_LEN) : s;
}
