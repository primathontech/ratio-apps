import { Button, Typography } from '@primathonos/orion';
import {
  LOYALTY_BOOLEAN_OPERATORS,
  LOYALTY_CONDITION_FIELDS,
  LOYALTY_DATE_OPERATORS,
  LOYALTY_ENUM_OPERATORS,
  LOYALTY_NUMERIC_OPERATORS,
  type LoyaltyConditionField,
  type LoyaltyConditionGroup,
  type LoyaltyConditionLeaf,
  type LoyaltyConditionNode,
} from '@shared/schemas/loyalty-rules';

/**
 * Visual builder for SEGMENT rule condition trees: nested AND/OR groups over
 * `{field, operator, value}` leaves. Emits plain `LoyaltyConditionGroup`
 * objects that validate against the SHARED `loyaltyRuleConditionSchema` — the
 * backend runs the identical schema, so anything this builder emits saves.
 *
 * Controls are native <select>/<input> elements (aria-labelled) so the tree
 * is fully keyboard-accessible and deterministic under test — no portal
 * dropdowns.
 */

export const FIELD_LABELS: Record<LoyaltyConditionField, string> = {
  lifetime_orders: 'Lifetime orders',
  lifetime_spend: 'Lifetime spend (₹)',
  points_balance: 'Coins balance',
  lifetime_earned: 'Lifetime coins earned',
  last_order_at: 'Last order date',
  first_seen_source: 'First seen via',
  order_total: 'Order total (₹)',
  item_count: 'Order item count',
  is_first_order: 'Is first order',
};

const OPERATOR_LABELS: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
  between: 'between',
  before: 'before',
  after: 'after',
};

const FIRST_SEEN_SOURCES = ['order', 'bulk', 'qr', 'manual'] as const;

type FieldType = (typeof LOYALTY_CONDITION_FIELDS)[LoyaltyConditionField]['type'];

function operatorsFor(field: LoyaltyConditionField): readonly string[] {
  const type: FieldType = LOYALTY_CONDITION_FIELDS[field].type;
  switch (type) {
    case 'number':
      return LOYALTY_NUMERIC_OPERATORS;
    case 'date':
      return LOYALTY_DATE_OPERATORS;
    case 'enum':
      return LOYALTY_ENUM_OPERATORS;
    case 'boolean':
      return LOYALTY_BOOLEAN_OPERATORS;
  }
}

function defaultValueFor(
  field: LoyaltyConditionField,
  operator: string,
): LoyaltyConditionLeaf['value'] {
  const type = LOYALTY_CONDITION_FIELDS[field].type;
  if (operator === 'between') {
    return type === 'date' ? [todayIso(), todayIso()] : [0, 0];
  }
  switch (type) {
    case 'number':
      return 0;
    case 'date':
      return todayIso();
    case 'enum':
      return FIRST_SEEN_SOURCES[0];
    case 'boolean':
      return true;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function makeLeaf(field: LoyaltyConditionField = 'lifetime_spend'): LoyaltyConditionLeaf {
  const operator = operatorsFor(field)[0] as LoyaltyConditionLeaf['operator'];
  return { field, operator, value: defaultValueFor(field, operator) };
}

export function makeGroup(op: 'AND' | 'OR' = 'AND'): LoyaltyConditionGroup {
  return { op, children: [makeLeaf()] };
}

export function isGroup(node: LoyaltyConditionNode): node is LoyaltyConditionGroup {
  return 'op' in node && 'children' in node;
}

interface ConditionTreeBuilderProps {
  value: LoyaltyConditionGroup;
  onChange: (next: LoyaltyConditionGroup) => void;
}

export function ConditionTreeBuilder({ value, onChange }: ConditionTreeBuilderProps) {
  return <GroupEditor group={value} onChange={onChange} depth={0} />;
}

function GroupEditor({
  group,
  onChange,
  onRemove,
  depth,
}: {
  group: LoyaltyConditionGroup;
  onChange: (next: LoyaltyConditionGroup) => void;
  onRemove?: () => void;
  depth: number;
}) {
  const setChild = (index: number, child: LoyaltyConditionNode) => {
    const children = group.children.slice();
    children[index] = child;
    onChange({ ...group, children });
  };
  const removeChild = (index: number) => {
    onChange({ ...group, children: group.children.filter((_, i) => i !== index) });
  };

  return (
    <div
      style={{
        border: '1px solid #e5e5e5',
        borderRadius: 8,
        padding: 12,
        background: depth % 2 === 0 ? '#fafafa' : '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <select
          aria-label="Group operator"
          value={group.op}
          onChange={(e) => onChange({ ...group, op: e.target.value as 'AND' | 'OR' })}
          style={{ padding: '4px 8px' }}
        >
          <option value="AND">ALL of (AND)</option>
          <option value="OR">ANY of (OR)</option>
        </select>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {group.op === 'AND' ? 'every condition must match' : 'any condition may match'}
        </Typography.Text>
        <div style={{ flex: 1 }} />
        {onRemove && (
          <Button size="small" onClick={onRemove}>
            Remove group
          </Button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {group.children.map((child, index) =>
          isGroup(child) ? (
            <GroupEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: tree rows have no stable identity
              key={index}
              group={child}
              onChange={(next) => setChild(index, next)}
              onRemove={() => removeChild(index)}
              depth={depth + 1}
            />
          ) : (
            <LeafEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: tree rows have no stable identity
              key={index}
              leaf={child}
              onChange={(next) => setChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ),
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button
          size="small"
          onClick={() => onChange({ ...group, children: [...group.children, makeLeaf()] })}
        >
          + Add condition
        </Button>
        <Button
          size="small"
          onClick={() => onChange({ ...group, children: [...group.children, makeGroup('OR')] })}
        >
          + Add group
        </Button>
      </div>
    </div>
  );
}

function LeafEditor({
  leaf,
  onChange,
  onRemove,
}: {
  leaf: LoyaltyConditionLeaf;
  onChange: (next: LoyaltyConditionLeaf) => void;
  onRemove: () => void;
}) {
  const fieldType = LOYALTY_CONDITION_FIELDS[leaf.field].type;
  const operators = operatorsFor(leaf.field);

  const changeField = (field: LoyaltyConditionField) => {
    const operator = operatorsFor(field)[0] as LoyaltyConditionLeaf['operator'];
    onChange({ field, operator, value: defaultValueFor(field, operator) });
  };
  const changeOperator = (operator: string) => {
    onChange({
      ...leaf,
      operator: operator as LoyaltyConditionLeaf['operator'],
      value: defaultValueFor(leaf.field, operator),
    });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select
        aria-label="Condition field"
        value={leaf.field}
        onChange={(e) => changeField(e.target.value as LoyaltyConditionField)}
        style={{ padding: '4px 8px' }}
      >
        {(Object.keys(LOYALTY_CONDITION_FIELDS) as LoyaltyConditionField[]).map((field) => (
          <option key={field} value={field}>
            {FIELD_LABELS[field]}
          </option>
        ))}
      </select>

      <select
        aria-label="Condition operator"
        value={leaf.operator}
        onChange={(e) => changeOperator(e.target.value)}
        style={{ padding: '4px 8px' }}
      >
        {operators.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op] ?? op}
          </option>
        ))}
      </select>

      <LeafValueEditor leaf={leaf} fieldType={fieldType} onChange={onChange} />

      <Button size="small" onClick={onRemove} aria-label="Remove condition">
        ✕
      </Button>
    </div>
  );
}

function LeafValueEditor({
  leaf,
  fieldType,
  onChange,
}: {
  leaf: LoyaltyConditionLeaf;
  fieldType: FieldType;
  onChange: (next: LoyaltyConditionLeaf) => void;
}) {
  if (leaf.operator === 'between') {
    const tuple = Array.isArray(leaf.value)
      ? leaf.value
      : fieldType === 'date'
        ? [todayIso(), todayIso()]
        : [0, 0];
    const inputType = fieldType === 'date' ? 'date' : 'number';
    const coerce = (raw: string) => (fieldType === 'date' ? raw : Number(raw));
    return (
      <>
        <input
          type={inputType}
          aria-label="Condition value min"
          value={String(tuple[0])}
          onChange={(e) =>
            onChange({
              ...leaf,
              value: [coerce(e.target.value), tuple[1]] as LoyaltyConditionLeaf['value'],
            })
          }
          style={{ padding: '4px 8px', width: 120 }}
        />
        <Typography.Text type="secondary">and</Typography.Text>
        <input
          type={inputType}
          aria-label="Condition value max"
          value={String(tuple[1])}
          onChange={(e) =>
            onChange({
              ...leaf,
              value: [tuple[0], coerce(e.target.value)] as LoyaltyConditionLeaf['value'],
            })
          }
          style={{ padding: '4px 8px', width: 120 }}
        />
      </>
    );
  }

  if (fieldType === 'enum') {
    return (
      <select
        aria-label="Condition value"
        value={String(leaf.value)}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        style={{ padding: '4px 8px' }}
      >
        {FIRST_SEEN_SOURCES.map((source) => (
          <option key={source} value={source}>
            {source}
          </option>
        ))}
      </select>
    );
  }

  if (fieldType === 'boolean') {
    return (
      <select
        aria-label="Condition value"
        value={leaf.value === true ? 'true' : 'false'}
        onChange={(e) => onChange({ ...leaf, value: e.target.value === 'true' })}
        style={{ padding: '4px 8px' }}
      >
        <option value="true">yes</option>
        <option value="false">no</option>
      </select>
    );
  }

  if (fieldType === 'date') {
    return (
      <input
        type="date"
        aria-label="Condition value"
        value={String(leaf.value)}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        style={{ padding: '4px 8px', width: 150 }}
      />
    );
  }

  return (
    <input
      type="number"
      aria-label="Condition value"
      value={String(leaf.value)}
      onChange={(e) => onChange({ ...leaf, value: Number(e.target.value) })}
      style={{ padding: '4px 8px', width: 120 }}
    />
  );
}
