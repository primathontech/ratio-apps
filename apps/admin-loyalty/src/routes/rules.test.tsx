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
    name: 'VIP multiplier',
    ruleType: 'MULTIPLIER',
    value: 2,
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
  it('renders MULTIPLIER and BONUS value labels distinctly', async () => {
    routeApi([
      makeRule(),
      makeRule({ id: 'r2', name: 'Diwali bonus', ruleType: 'BONUS', value: 50 }),
    ]);
    renderWithProviders(<RulesPage />);
    await waitFor(() => expect(screen.getByText('2×')).toBeInTheDocument());
    expect(screen.getByText('+50 coins')).toBeInTheDocument();
  });

  it('swaps the value label between Multiplier and Bonus in the form', async () => {
    routeApi([]);
    renderWithProviders(<RulesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    expect(screen.getByText('Multiplier (× base earn)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Bonus' }));
    expect(screen.getByText('Bonus coins per order')).toBeInTheDocument();
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
      expect(body.ruleType).toBe('MULTIPLIER');
      expect(body.value).toBe(2);
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
    const toggle = await screen.findByLabelText('Toggle VIP multiplier');
    fireEvent.click(toggle);
    await waitFor(() => {
      const statusCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/rules/r1/status',
      );
      expect(statusCall).toBeDefined();
    });
  });
});
