import { Injectable } from '@nestjs/common';
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
  /** Merchant's configured coins-per-₹1 base earn rate. */
  baseEarnRate: number;
}

/**
 * Pure rule selection — no DB, no clock, no I/O. Among ACTIVE, in-window,
 * target-matching rules, the highest-priority MULTIPLIER and the
 * highest-priority BONUS stack (TRD §1). Priority ties break by name so the
 * outcome is deterministic across redeliveries.
 *
 * CUSTOMER_LIST matching reads the cached embedded membership only; `null`
 * membership (>10k list) never matches here — the caller resolves those via
 * `RuleCacheService.isInList` BEFORE evaluation.
 */
@Injectable()
export class RuleEvaluatorService {
  selectWinners(input: SelectWinnersInput): RuleWinner[] {
    const { cached, customerRow, orderFacts, phone, now, baseEarnRate } = input;
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

    const winners: RuleWinner[] = [];
    for (const ruleType of ['MULTIPLIER', 'BONUS'] as const) {
      const best = matching
        .filter((r) => r.ruleType === ruleType)
        .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))[0];
      if (!best) continue;
      const extraPoints = this.extraPointsFor(best, orderFacts.orderTotal, baseEarnRate);
      if (extraPoints > 0) winners.push({ rule: best, extraPoints });
    }
    return winners;
  }

  private extraPointsFor(rule: CachedRule, orderTotal: number, baseEarnRate: number): number {
    if (rule.ruleType === 'MULTIPLIER') {
      // Extra over the base Core earns: (m − 1) × total × rate.
      return Math.round((rule.value - 1) * orderTotal * baseEarnRate);
    }
    return Math.round(rule.value);
  }
}
