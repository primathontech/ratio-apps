import { Inject, Injectable } from '@nestjs/common';
import type { LoyaltyConditionNode } from '@ratio-app/shared/schemas/loyalty-rules';
import { RedisService } from '../../../core/cache/redis.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { LoyaltyDatabase, LoyaltyRuleTargetType, LoyaltyRuleType } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';

/** JSON-safe projection of an active rule, as stored in Redis. */
export interface CachedRule {
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
}

/**
 * The cached active-rule set for one merchant. `listMembership[ruleId]` is the
 * embedded phone list for CUSTOMER_LIST rules — or `null` when the list is
 * larger than {@link RULE_LIST_EMBED_CAP}, meaning "check the DB at eval time"
 * (via {@link RuleCacheService.isInList}).
 */
export interface CachedRuleSet {
  rules: CachedRule[];
  listMembership: Record<string, string[] | null>;
}

export const RULE_CACHE_TTL_SECONDS = 600;
export const RULE_LIST_EMBED_CAP = 10_000;

/**
 * `conditions` may arrive from mysql2 as a JSON string OR an already-parsed
 * object depending on driver/config — normalize both to a tree (or null).
 */
export function parseConditionsColumn(raw: unknown): LoyaltyConditionNode | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as LoyaltyConditionNode;
    } catch {
      return null;
    }
  }
  return raw as LoyaltyConditionNode;
}

/**
 * Redis cache of a merchant's ACTIVE rule set (`loyalty:rules:{merchantId}`,
 * TTL 10 min, deleted on every rule mutation). On a cache hit the webhook
 * path does zero MySQL rule queries (TRD performance budget). Redis being
 * down degrades to the DB on every call — never an error.
 */
@Injectable()
export class RuleCacheService {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly redis: RedisService,
  ) {}

  private key(merchantId: string): string {
    return `loyalty:rules:${merchantId}`;
  }

  async getActive(merchantId: string): Promise<CachedRuleSet> {
    const key = this.key(merchantId);
    const hit = await this.redis.getJson<CachedRuleSet>(key);
    if (hit) return hit;

    const rows = await this.handle.db
      .selectFrom('loyalty_rules')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('active', '=', true)
      .execute();

    const rules: CachedRule[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      ruleType: r.ruleType,
      value: Number(r.value),
      targetType: r.targetType,
      conditions: parseConditionsColumn(r.conditions),
      startsAt: new Date(r.startsAt).toISOString(),
      endsAt: r.endsAt ? new Date(r.endsAt).toISOString() : null,
      active: Boolean(r.active),
      priority: Number(r.priority),
    }));

    const listMembership: Record<string, string[] | null> = {};
    for (const rule of rules) {
      if (rule.targetType !== 'CUSTOMER_LIST') continue;
      // Fetch cap+1 rows: exactly one query tells us both the membership and
      // whether the list is too large to embed.
      const phones = await this.handle.db
        .selectFrom('loyalty_rule_customers')
        .select('phone')
        .where('ruleId', '=', rule.id)
        .limit(RULE_LIST_EMBED_CAP + 1)
        .execute();
      listMembership[rule.id] =
        phones.length > RULE_LIST_EMBED_CAP ? null : phones.map((p) => p.phone);
    }

    const set: CachedRuleSet = { rules, listMembership };
    await this.redis.setJson(key, set, RULE_CACHE_TTL_SECONDS);
    return set;
  }

  /**
   * Membership check for a CUSTOMER_LIST rule: embedded set when the cache
   * carries it, DB lookup when the list was too large to embed (`null`).
   */
  async isInList(cached: CachedRuleSet, ruleId: string, phone: string): Promise<boolean> {
    const membership = cached.listMembership[ruleId];
    if (Array.isArray(membership)) return membership.includes(phone);
    const row = await this.handle.db
      .selectFrom('loyalty_rule_customers')
      .select('phone')
      .where('ruleId', '=', ruleId)
      .where('phone', '=', phone)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Called by EVERY rule mutation — next getActive() rebuilds from the DB. */
  async invalidate(merchantId: string): Promise<void> {
    await this.redis.del(this.key(merchantId));
  }
}
