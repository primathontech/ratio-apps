import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import { normalizePhone } from '../common/normalize-phone';
import type { CoreLoyaltyClient } from '../core-client/core-loyalty.client';
import type { LoyaltyCustomerRow, LoyaltyDatabase } from '../db/types';
import { CustomerMirrorService } from '../mirror/customer-mirror.service';
import type { OrderFacts } from '../rules/condition-tree';
import { type CachedRuleSet, RuleCacheService } from '../rules/rule-cache.service';
import { RuleEvaluatorService } from '../rules/rule-evaluator.service';
import { LOYALTY_CORE_CLIENT } from '../tokens';
import { LOYALTY_WEBHOOK_TOPICS } from './topics';

/** QR scans convert only if the order lands within 30 days of the scan. */
const QR_CONVERSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `orders/create` — the hot loyalty path. Inside the webhook-dispatch
 * transaction (all writes via `trx`, so a crash rolls back atomically with the
 * `webhook_log` row and Ratio's retry re-runs from scratch):
 *
 *   1. Mirror upsert — spend/orders accumulate, E.164 phone identity.
 *   2. Rule evaluation against the Redis-cached active set; each winner writes
 *      a `loyalty_rule_applications` row (INSERT IGNORE on the unique
 *      `(rule_id, order_id)`) and, ONLY when that insert landed, credits Core
 *      with idempotency key `rule:{ruleId}:{orderId}` — a webhook redelivery
 *      hits the duplicate row and never re-credits.
 *   3. Stamp QR conversion for unconverted scans within the last 30 days.
 *
 * A Core failure THROWS so the platform retries the delivery (TRD §4); the
 * idempotency keys make that retry safe.
 */
@Injectable()
export class LoyaltyOrderCreatedHandler implements WebhookHandler {
  readonly topic = LOYALTY_WEBHOOK_TOPICS.ordersCreate;
  private readonly logger = new Logger(LoyaltyOrderCreatedHandler.name);

  constructor(
    private readonly mirror: CustomerMirrorService,
    private readonly ruleCache: RuleCacheService,
    private readonly evaluator: RuleEvaluatorService,
    @Inject(LOYALTY_CORE_CLIENT) private readonly core: Pick<CoreLoyaltyClient, 'credit'>,
  ) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'orders/create for unknown merchant — no-op' });
      return;
    }

    const orderId = extractOrderId(data);
    const customer = (data.customer ?? {}) as Record<string, unknown>;
    const rawPhone = typeof customer.phone === 'string' ? customer.phone : '';
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (!orderId || !phone) {
      this.logger.warn({
        msg: 'orders/create without a usable order id or phone — skipping loyalty processing',
        merchantId,
        hasOrderId: Boolean(orderId),
        hasPhone: Boolean(phone),
      });
      return;
    }

    const orderTotal = toNumber(data.total_price) ?? 0;
    const itemCount = countItems(data.line_items);
    const name = extractName(customer);
    const email = typeof customer.email === 'string' && customer.email ? customer.email : null;
    const now = new Date();

    // The dispatch trx spans the loyalty DB — the loyalty tables live in the
    // same schema as merchants/webhook_log (per-module DB isolation).
    const ltrx = trx as unknown as Transaction<LoyaltyDatabase>;

    // Config read through the trx; a merchant without a config row earns at 1.
    const configRow = await ltrx
      .selectFrom('loyalty_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    const baseEarnRate = toNumber(configRow?.baseEarnRate) ?? 1;

    // Pre-upsert mirror read: first-order fact + condition-tree customer scope.
    const customerRow =
      ((await ltrx
        .selectFrom('loyalty_customers')
        .selectAll()
        .where('merchantId', '=', merchantId)
        .where('phone', '=', phone)
        .limit(1)
        .executeTakeFirst()) as LoyaltyCustomerRow | undefined) ?? null;
    const isFirstOrder = customerRow === null || customerRow.lifetimeOrders === 0;

    await this.mirror.upsertFromOrder(ltrx, merchantId, {
      phone,
      name,
      email,
      orderTotal,
      orderAt: now,
    });

    const orderFacts: OrderFacts = { orderTotal, itemCount, isFirstOrder };
    const cached = await this.ruleCache.getActive(merchantId);
    const resolved = await this.resolveLargeListMembership(cached, phone);
    const winners = this.evaluator.selectWinners({
      cached: resolved,
      customerRow,
      orderFacts,
      phone,
      now,
      baseEarnRate,
    });

    const basePoints = Math.round(orderTotal * baseEarnRate);
    for (const winner of winners) {
      // INSERT IGNORE on uq(rule_id, order_id): 0 affected rows means this
      // rule already credited this order (webhook redelivery) — skip Core.
      const inserted = await ltrx
        .insertInto('loyalty_rule_applications')
        .ignore()
        .values({
          merchantId,
          ruleId: winner.rule.id,
          orderId,
          phone,
          basePoints,
          extraPoints: winner.extraPoints,
        })
        .executeTakeFirst();
      if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) {
        this.logger.log({
          msg: 'rule application already recorded — skipping Core credit (redelivery)',
          merchantId,
          ruleId: winner.rule.id,
          orderId,
        });
        continue;
      }
      // Core failure propagates: the dispatch trx rolls back (including the
      // application row) and the platform retries the delivery.
      await this.core.credit({
        merchantId,
        phone,
        points: winner.extraPoints,
        idempotencyKey: `rule:${winner.rule.id}:${orderId}`,
        description: winner.rule.name,
        metadata: { rule_id: winner.rule.id, order_id: orderId },
      });
    }

    // Stamp QR conversion: unconverted scans by this phone in the last 30 days.
    await ltrx
      .updateTable('loyalty_qr_scans')
      .set({ convertedOrderId: orderId, convertedAt: now })
      .where('merchantId', '=', merchantId)
      .where('phone', '=', phone)
      .where('scannedAt', '>=', new Date(now.getTime() - QR_CONVERSION_WINDOW_MS))
      .where('convertedOrderId', 'is', null)
      .execute();
  }

  /**
   * CUSTOMER_LIST rules whose membership was too large to embed carry `null`
   * in the cache — the evaluator never matches those. Resolve them via a
   * point lookup BEFORE evaluation (rule-evaluator contract).
   */
  private async resolveLargeListMembership(
    cached: CachedRuleSet,
    phone: string,
  ): Promise<CachedRuleSet> {
    const unresolved = cached.rules.filter(
      (r) => r.targetType === 'CUSTOMER_LIST' && cached.listMembership[r.id] === null,
    );
    if (unresolved.length === 0) return cached;
    const listMembership = { ...cached.listMembership };
    for (const rule of unresolved) {
      const inList = await this.ruleCache.isInList(cached, rule.id, phone);
      listMembership[rule.id] = inList ? [phone] : [];
    }
    return { rules: cached.rules, listMembership };
  }
}

function extractOrderId(data: Record<string, unknown>): string | null {
  const raw = data.id;
  if (typeof raw === 'string' && raw) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Sum of line-item quantities (a missing/invalid quantity counts as 1). */
function countItems(lineItems: unknown): number {
  if (!Array.isArray(lineItems)) return 0;
  let count = 0;
  for (const item of lineItems) {
    const qty = toNumber((item as Record<string, unknown> | null)?.quantity);
    count += qty !== null && qty > 0 ? qty : 1;
  }
  return count;
}

function extractName(customer: Record<string, unknown>): string | null {
  const first = typeof customer.first_name === 'string' ? customer.first_name.trim() : '';
  const last = typeof customer.last_name === 'string' ? customer.last_name.trim() : '';
  const full = [first, last].filter(Boolean).join(' ');
  return full || null;
}
