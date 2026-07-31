import {
  type LoyaltyConditionNode,
  loyaltyRuleConditionSchema,
} from '@shared/schemas/loyalty-rules';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { RulesPage } from './rules';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: 'VIP bonus',
    ruleType: 'BONUS',
    value: 50,
    targetType: 'SEGMENT',
    conditions: { op: 'AND', children: [{ field: 'lifetime_spend', operator: 'gt', value: 0 }] },
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: null,
    active: true,
    priority: 0,
    ...overrides,
  };
}

function routeApi(rules: unknown[]) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path === '/api/rules') return Promise.resolve(rules);
    if (method === 'POST' && path === '/api/rules') return Promise.resolve(makeRule());
    if (method === 'DELETE' && /\/api\/rules\/.+/.test(path))
      return Promise.resolve({ deleted: true });
    if (method === 'POST' && /\/status$/.test(path))
      return Promise.resolve(makeRule({ active: false }));
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('RulesPage', () => {
  it('renders bonus coins, and flags a legacy multiplier as retired', async () => {
    routeApi([
      makeRule(),
      makeRule({ id: 'r2', name: 'Old 2x', ruleType: 'MULTIPLIER', value: 2 }),
    ]);
    renderWithProviders(<RulesPage />);
    await waitFor(() => expect(screen.getByText('+50 coins')).toBeInTheDocument());
    // A retired multiplier grants nothing — say so instead of rendering `2×`
    // as though it were still applied.
    expect(screen.getByText('2×')).toBeInTheDocument();
    expect(screen.getByText('retired')).toBeInTheDocument();
  });

  it('offers only flat bonus coins when creating a rule', async () => {
    routeApi([]);
    renderWithProviders(<RulesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    expect(screen.getByText(/^Bonus coins per order/)).toBeInTheDocument();
    // The rule-type choice is gone: MULTIPLIER can't be priced without the
    // Core-owned earn rate.
    expect(screen.queryByRole('radio', { name: 'Multiplier' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Multiplier \(× base earn\)/)).not.toBeInTheDocument();
  });

  it('warns when editing a legacy multiplier rule', async () => {
    routeApi([makeRule({ ruleType: 'MULTIPLIER', value: 3 })]);
    renderWithProviders(<RulesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByText('This is a retired multiplier rule')).toBeInTheDocument();
    expect(screen.getByText(/converts this rule to a flat bonus/)).toBeInTheDocument();
  });

  it('POSTs a schema-valid SEGMENT rule (conditions tree included)', async () => {
    routeApi([]);
    renderWithProviders(<RulesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    fireEvent.change(screen.getByPlaceholderText('VIP 3x multiplier'), {
      target: { value: 'Big spenders' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => {
      const postCall = mockedApi.mock.calls.find((c) => c[0] === 'POST' && c[1] === '/api/rules');
      expect(postCall).toBeDefined();
      const body = postCall?.[2] as {
        conditions: LoyaltyConditionNode;
        ruleType: string;
        value: number;
      };
      expect(body.ruleType).toBe('BONUS');
      expect(body.value).toBe(50);
      expect(loyaltyRuleConditionSchema.safeParse(body.conditions).success).toBe(true);
    });
  });

  it('deletes a rule from the list actions', async () => {
    routeApi([makeRule()]);
    renderWithProviders(<RulesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      const del = mockedApi.mock.calls.find((c) => c[0] === 'DELETE' && c[1] === '/api/rules/r1');
      expect(del).toBeDefined();
    });
  });

  it('toggles a rule active state via the switch', async () => {
    routeApi([makeRule()]);
    renderWithProviders(<RulesPage />);
    const toggle = await screen.findByLabelText('Toggle VIP bonus');
    fireEvent.click(toggle);
    await waitFor(() => {
      const statusCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/rules/r1/status',
      );
      expect(statusCall).toBeDefined();
    });
  });
});

describe('RulesPage — validation', () => {
  async function openNewRuleForm() {
    routeApi([]);
    renderWithProviders(<RulesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
  }

  it('marks every mandatory field with an asterisk', async () => {
    await openNewRuleForm();
    // `Target` also appears as a table column header, so assert that at least
    // one element with each label carries the required marker.
    for (const label of [
      'Rule name',
      'Bonus coins per order',
      'Target',
      'Segment conditions',
      'Starts at',
    ]) {
      const marked = screen
        .getAllByText(new RegExp(`^${label.replace(/[()×]/g, '\\$&')}`))
        .some((el) => /\*/.test(el.textContent ?? '') && /\(required\)/.test(el.textContent ?? ''));
      expect(marked, `${label} should be marked required`).toBe(true);
    }
    // Genuinely optional fields carry no marker.
    expect(screen.getByText(/^Ends at/)).not.toHaveTextContent('*');
  });

  it('reports a missing name against the name field, not in one lumped alert', async () => {
    await openNewRuleForm();
    // Name left blank; the segment tree is empty too.
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    const messages = screen.getAllByRole('alert').map((el) => el.textContent ?? '');
    // Both problems surface, each as its own field-level message…
    expect(messages.some((m) => /too small|at least 1|required/i.test(m))).toBe(true);
    // …and no "Rule is invalid" bullet-list banner is rendered.
    expect(screen.queryByText('Rule is invalid')).not.toBeInTheDocument();
    expect(mockedApi.mock.calls.filter((c) => c[0] === 'POST' && c[1] === '/api/rules')).toEqual(
      [],
    );
  });

  it('blames the value field when the bonus is not positive', async () => {
    await openNewRuleForm();
    fireEvent.change(screen.getByPlaceholderText('VIP 3x multiplier'), {
      target: { value: 'Zero bonus' },
    });
    fireEvent.change(screen.getByLabelText('Rule value'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => {
      const messages = screen.getAllByRole('alert').map((el) => el.textContent ?? '');
      expect(messages.some((m) => /greater than 0|too small|positive/i.test(m))).toBe(true);
    });
    expect(mockedApi.mock.calls.filter((c) => c[0] === 'POST' && c[1] === '/api/rules')).toEqual(
      [],
    );
  });
});
