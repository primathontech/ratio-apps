import {
  type LoyaltyConditionGroup,
  loyaltyRuleConditionSchema,
} from '@shared/schemas/loyalty-rules';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test-utils';
import { ConditionTreeBuilder, makeGroup } from './ConditionTreeBuilder';

/** Controlled harness that surfaces the latest emitted tree for assertions. */
function Harness({ onEmit }: { onEmit: (g: LoyaltyConditionGroup) => void }) {
  const [value, setValue] = useState<LoyaltyConditionGroup>(makeGroup('AND'));
  return (
    <ConditionTreeBuilder
      value={value}
      onChange={(next) => {
        setValue(next);
        onEmit(next);
      }}
    />
  );
}

describe('ConditionTreeBuilder', () => {
  it('starts with a schema-valid AND group of one leaf', () => {
    let latest: LoyaltyConditionGroup = makeGroup('AND');
    renderWithProviders(
      <Harness
        onEmit={(g) => {
          latest = g;
        }}
      />,
    );
    // The initial default group must itself validate against the shared schema.
    expect(loyaltyRuleConditionSchema.safeParse(makeGroup('AND')).success).toBe(true);
    // And so must any tree the harness holds after render.
    expect(loyaltyRuleConditionSchema.safeParse(latest).success).toBe(true);
  });

  it('emits schema-valid JSON after adding a condition and switching the group to OR', () => {
    let latest: LoyaltyConditionGroup | null = null;
    renderWithProviders(
      <Harness
        onEmit={(g) => {
          latest = g;
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Add condition' }));
    fireEvent.change(screen.getByLabelText('Group operator'), { target: { value: 'OR' } });

    expect(latest).not.toBeNull();
    const parsed = loyaltyRuleConditionSchema.safeParse(latest);
    expect(parsed.success).toBe(true);
    expect((latest as unknown as LoyaltyConditionGroup).op).toBe('OR');
    expect((latest as unknown as LoyaltyConditionGroup).children.length).toBe(2);
  });

  it('constrains operators to the field type registry (date field has before/after/between)', () => {
    renderWithProviders(<Harness onEmit={() => {}} />);
    const fieldSelect = screen.getAllByLabelText('Condition field')[0] as HTMLSelectElement;
    fireEvent.change(fieldSelect, { target: { value: 'last_order_at' } });
    const opSelect = screen.getAllByLabelText('Condition operator')[0] as HTMLSelectElement;
    const options = Array.from(opSelect.options).map((o) => o.value);
    expect(options).toEqual(['before', 'after', 'between']);
  });

  it('emits a valid nested group after adding a sub-group', () => {
    let latest: LoyaltyConditionGroup | null = null;
    renderWithProviders(
      <Harness
        onEmit={(g) => {
          latest = g;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add group' }));
    expect(loyaltyRuleConditionSchema.safeParse(latest).success).toBe(true);
  });
});
