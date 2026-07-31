import { Injectable, Logger } from '@nestjs/common';
import type { LoyaltyCustomerRow } from '../db/types';
import { evaluateConditions, type OrderFacts } from './condition-tree';
import type { CachedRule, CachedRuleSet } from './rule-cache.service';

export interface RuleWinner {
  rule: CachedRule;
  /** Extra coins to credit for this rule — always > 0 (zero winners are dropped). */
  extraPoints: number;
}

export interface SelectWinnersInput {
  cached: CachedRuleSet;
  /** Pre-order mirror row (null for a brand-new phone). */
  customerRow: LoyaltyCustomerRow | null;
  orderFacts: OrderFacts;
  phone: string;
  now: Date;
}

/**
 * Pure rule selection — no DB, no clock, no I/O. Among ACTIVE, in-window,
 * target-matching rules, the highest-priority BONUS wins (TRD §1). Priority
 * ties break by name so the outcome is deterministic across redeliveries.
 *
 * MULTIPLIER rules are RETIRED (2026-07-31). A multiplier's extra was
 * `(m − 1) × orderTotal × baseEarnRate`, and `baseEarnRate` was a local mirror
 * of Core Loyalty's rate that the app no longer stores — Core owns order
 * earning, and it exposes no endpoint to read the rate back
 * (credit/debit/balance/history only). Legacy MULTIPLIER rows are therefore
 * un-computable: they are skipped with a warning rather than silently granting
 * a wrong amount. Rules now grant flat BONUS coins, which need no rate.
 *
 * CUSTOMER_LIST matching reads the cached embedded membership only; `null`
 * membership (>10k list) never matches here — the caller resolves those via
 * `RuleCacheService.isInList` BEFORE evaluation.
 */
@Injectable()
export class RuleEvaluatorService {
  private readonly logger = new Logger(RuleEvaluatorService.name);

  selectWinners(input: SelectWinnersInput): RuleWinner[] {
    const { cached, customerRow, orderFacts, phone, now } = input;
    const nowMs = now.getTime();

    const matching = cached.rules.filter((rule) => {
      if (!rule.active) return false;
      if (nowMs < new Date(rule.startsAt).getTime()) return false;
      if (rule.endsAt && nowMs > new Date(rule.endsAt).getTime()) return false;
      if (rule.targetType === 'CUSTOMER_LIST') {
        const membership = cached.listMembership[rule.id];
        return Array.isArray(membership) && membership.includes(phone);
      }
      // SEGMENT — a missing tree can never match.
      return (
        rule.conditions !== null && evaluateConditions(rule.conditions, customerRow, orderFacts)
      );
    });

    // Legacy multipliers can no longer be priced — surface them instead of
    // quietly awarding the wrong number of coins.
    const retired = matching.filter((r) => r.ruleType === 'MULTIPLIER');
    if (retired.length > 0) {
      this.logger.warn({
        msg: 'skipping retired MULTIPLIER rule(s) — baseEarnRate is owned by Core Loyalty and no longer stored; convert these to BONUS rules',
        ruleIds: retired.map((r) => r.id),
      });
    }

    const winners: RuleWinner[] = [];
    const best = matching
      .filter((r) => r.ruleType === 'BONUS')
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))[0];
    if (best) {
      const extraPoints = Math.round(best.value);
      if (extraPoints > 0) winners.push({ rule: best, extraPoints });
    }
    return winners;
  }
}
