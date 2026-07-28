import { describe, expect, it } from 'vitest';
import type { FormRow } from '../../../../src/modules/forms/db/types';
import { WebhookDeliveryService } from '../../../../src/modules/forms/outbound/webhook-delivery.service';
import { kitchenSinkForm } from './fixtures/forms';

// The admin "send test payload" must mirror a REAL submission's shape: select
// fields store the option VALUE (string / string[]), never the {value,label}
// object — a merchant wires their parser against this test call.
describe('WebhookDeliveryService.buildTestPayload — select-field value shape', () => {
  const build = (form: FormRow) =>
    (
      WebhookDeliveryService as unknown as {
        buildTestPayload(f: FormRow): { fields: Record<string, unknown> };
      }
    ).buildTestPayload(form);

  it('emits the stored value string for dropdown and string[] for multi_select', () => {
    const { fields } = build(kitchenSinkForm() as unknown as FormRow);
    expect(fields.topic).toBe('sales');
    expect(fields.channels).toEqual(['email']);
  });
});
