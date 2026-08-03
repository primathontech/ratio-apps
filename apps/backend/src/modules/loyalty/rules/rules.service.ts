import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type LoyaltyConditionNode,
  type LoyaltyRuleInput,
  loyaltyRuleInputSchema,
} from '@ratio-app/shared/schemas/loyalty-rules';
import { ulid } from 'ulid';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { normalizePhone } from '../common/normalize-phone';
import type {
  LoyaltyDatabase,
  LoyaltyRuleRow,
  LoyaltyRuleTargetType,
  LoyaltyRuleType,
} from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import { parseConditionsColumn, RuleCacheService } from './rule-cache.service';

/** JSON-safe rule shape returned to the admin. */
export interface LoyaltyRuleDto {
  id: string;
  name: string;
  ruleType: LoyaltyRuleType;
  value: number;
  targetType: LoyaltyRuleTargetType;
  conditions: LoyaltyConditionNode | null;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  priority: number;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface RuleCustomersPage {
  items: string[];
  total: number;
  page: number;
  limit: number;
}

export interface AppendCustomersResult {
  /** Rows actually inserted (INSERT IGNORE skips phones already in the list). */
  added: number;
  /** Inputs that failed E.164 normalization — reported, never inserted. */
  invalid: number;
}

export interface RulePerformance {
  matches: number;
  extraCoins: number;
  uniqueCustomers: number;
}

/**
 * Earning-rule CRUD + customer-list management. Every write validates through
 * the SHARED `loyaltyRuleInputSchema` (the admin's rule builder validates
 * identically), stores `conditions` as a JSON string, and invalidates the
 * merchant's Redis rule cache — the webhook path must never evaluate a stale
 * set for more than one in-flight read.
 *
 * All lookups are merchant-scoped: an unknown or foreign rule id is a 404,
 * never a cross-tenant leak.
 */
@Injectable()
export class RulesService {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly cache: RuleCacheService,
  ) {}

  async list(merchantId: string): Promise<LoyaltyRuleDto[]> {
    const rows = (await this.handle.db
      .selectFrom('loyalty_rules')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('priority', 'desc')
      .orderBy('createdAt', 'desc')
      .execute()) as LoyaltyRuleRow[];
    return rows.map((row) => toDto(row));
  }

  async get(merchantId: string, ruleId: string): Promise<LoyaltyRuleDto> {
    return toDto(await this.requireRule(merchantId, ruleId));
  }

  async create(merchantId: string, input: unknown): Promise<LoyaltyRuleDto> {
    const parsed = loyaltyRuleInputSchema.parse(input);
    const id = ulid();
    await this.handle.db
      .insertInto('loyalty_rules')
      .values({
        id,
        merchantId,
        name: parsed.name,
        ruleType: parsed.ruleType,
        value: parsed.value,
        targetType: parsed.targetType,
        conditions: parsed.conditions ? JSON.stringify(parsed.conditions) : null,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt ?? null,
        active: parsed.active,
        priority: parsed.priority,
      })
      .execute();
    await this.cache.invalidate(merchantId);
    return inputToDto(id, parsed);
  }

  async update(merchantId: string, ruleId: string, input: unknown): Promise<LoyaltyRuleDto> {
    await this.requireRule(merchantId, ruleId);
    const parsed = loyaltyRuleInputSchema.parse(input);
    await this.handle.db
      .updateTable('loyalty_rules')
      .set({
        name: parsed.name,
        ruleType: parsed.ruleType,
        value: parsed.value,
        targetType: parsed.targetType,
        conditions: parsed.conditions ? JSON.stringify(parsed.conditions) : null,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt ?? null,
        active: parsed.active,
        priority: parsed.priority,
      })
      .where('id', '=', ruleId)
      .where('merchantId', '=', merchantId)
      .execute();
    await this.cache.invalidate(merchantId);
    return inputToDto(ruleId, parsed);
  }

  async setActive(merchantId: string, ruleId: string, active: boolean): Promise<LoyaltyRuleDto> {
    const row = await this.requireRule(merchantId, ruleId);
    await this.handle.db
      .updateTable('loyalty_rules')
      .set({ active })
      .where('id', '=', ruleId)
      .where('merchantId', '=', merchantId)
      .execute();
    await this.cache.invalidate(merchantId);
    return { ...toDto(row), active };
  }

  async delete(merchantId: string, ruleId: string): Promise<void> {
    await this.requireRule(merchantId, ruleId);
    // Membership rows go with the rule; `loyalty_rule_applications` stay —
    // they are the historical ledger the performance endpoint reads.
    await this.handle.db
      .deleteFrom('loyalty_rule_customers')
      .where('ruleId', '=', ruleId)
      .execute();
    await this.handle.db
      .deleteFrom('loyalty_rules')
      .where('id', '=', ruleId)
      .where('merchantId', '=', merchantId)
      .execute();
    await this.cache.invalidate(merchantId);
  }

  async listCustomers(
    merchantId: string,
    ruleId: string,
    page: number,
    limit: number,
  ): Promise<RuleCustomersPage> {
    await this.requireRule(merchantId, ruleId);
    const totalRow = (await this.handle.db
      .selectFrom('loyalty_rule_customers')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .where('ruleId', '=', ruleId)
      .executeTakeFirst()) as { total: number | string } | undefined;
    const rows = await this.handle.db
      .selectFrom('loyalty_rule_customers')
      .select('phone')
      .where('ruleId', '=', ruleId)
      .orderBy('addedAt', 'asc')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();
    return {
      items: rows.map((r) => r.phone),
      total: Number(totalRow?.total ?? 0),
      page,
      limit,
    };
  }

  async appendCustomers(
    merchantId: string,
    ruleId: string,
    phones: string[],
  ): Promise<AppendCustomersResult> {
    await this.requireRule(merchantId, ruleId);
    let invalid = 0;
    const normalized = new Set<string>();
    for (const raw of phones) {
      const phone = normalizePhone(raw);
      if (!phone) {
        invalid += 1;
        continue;
      }
      normalized.add(phone);
    }
    let added = 0;
    if (normalized.size > 0) {
      const res = await this.handle.db
        .insertInto('loyalty_rule_customers')
        .ignore()
        .values([...normalized].map((phone) => ({ ruleId, phone })))
        .executeTakeFirst();
      added = Number(res.numInsertedOrUpdatedRows ?? 0);
    }
    await this.cache.invalidate(merchantId);
    return { added, invalid };
  }

  async removeCustomers(
    merchantId: string,
    ruleId: string,
    phones: string[],
  ): Promise<{ removed: number }> {
    await this.requireRule(merchantId, ruleId);
    const normalized = [...new Set(phones.map((p) => normalizePhone(p)).filter(isString))];
    let removed = 0;
    if (normalized.length > 0) {
      const res = await this.handle.db
        .deleteFrom('loyalty_rule_customers')
        .where('ruleId', '=', ruleId)
        .where('phone', 'in', normalized)
        .executeTakeFirst();
      removed = Number(res.numDeletedRows ?? 0);
    }
    await this.cache.invalidate(merchantId);
    return { removed };
  }

  async performance(merchantId: string, ruleId: string): Promise<RulePerformance> {
    await this.requireRule(merchantId, ruleId);
    const row = (await this.handle.db
      .selectFrom('loyalty_rule_applications')
      .select((eb) => [
        eb.fn.countAll<number>().as('matches'),
        eb.fn.sum<string | null>('extraPoints').as('extraCoins'),
        eb.fn.count<number>('phone').distinct().as('uniqueCustomers'),
      ])
      .where('merchantId', '=', merchantId)
      .where('ruleId', '=', ruleId)
      .executeTakeFirst()) as
      | {
          matches: number | string;
          extraCoins: number | string | null;
          uniqueCustomers: number | string;
        }
      | undefined;
    return {
      matches: Number(row?.matches ?? 0),
      extraCoins: Number(row?.extraCoins ?? 0),
      uniqueCustomers: Number(row?.uniqueCustomers ?? 0),
    };
  }

  /** Merchant-scoped fetch — unknown/foreign rule id is a 404. */
  private async requireRule(merchantId: string, ruleId: string): Promise<LoyaltyRuleRow> {
    const row = (await this.handle.db
      .selectFrom('loyalty_rules')
      .selectAll()
      .where('id', '=', ruleId)
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst()) as LoyaltyRuleRow | undefined;
    if (!row || row.merchantId !== merchantId) {
      throw new NotFoundException({ message: 'rule not found', error_code: 'RULE_NOT_FOUND' });
    }
    return row;
  }
}

function isString(v: string | null): v is string {
  return v !== null;
}

function toDto(row: LoyaltyRuleRow): LoyaltyRuleDto {
  return {
    id: row.id,
    name: row.name,
    ruleType: row.ruleType,
    value: Number(row.value),
    targetType: row.targetType,
    conditions: parseConditionsColumn(row.conditions),
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
    active: Boolean(row.active),
    priority: Number(row.priority),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
  };
}

function inputToDto(id: string, parsed: LoyaltyRuleInput): LoyaltyRuleDto {
  return {
    id,
    name: parsed.name,
    ruleType: parsed.ruleType,
    value: parsed.value,
    targetType: parsed.targetType,
    conditions: parsed.conditions ?? null,
    startsAt: parsed.startsAt.toISOString(),
    endsAt: parsed.endsAt ? parsed.endsAt.toISOString() : null,
    active: parsed.active,
    priority: parsed.priority,
  };
}
