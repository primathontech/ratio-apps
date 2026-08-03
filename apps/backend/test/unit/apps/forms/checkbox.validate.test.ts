import { describe, expect, it } from 'vitest';
import { validateCheckbox } from '../../../../src/modules/forms/submissions/fields/checkbox/validate';
import type { FieldOfType } from '../../../../src/modules/forms/submissions/fields/types';

const field = (required: boolean, extra: Record<string, unknown> = {}): FieldOfType<'checkbox'> =>
  ({
    key: 'consent',
    type: 'checkbox',
    label: 'I agree',
    required,
    ...extra,
  }) as FieldOfType<'checkbox'>;

describe('validateCheckbox (server-authoritative consent)', () => {
  it('accepts a ticked required consent box and returns the boolean canonical value', () => {
    expect(validateCheckbox(field(true), true)).toEqual({ value: true });
  });

  it('accepts false for an optional box', () => {
    expect(validateCheckbox(field(false), false)).toEqual({ value: false });
  });

  it('rejects an unticked required box even if the client omitted the check', () => {
    // A crafted POST could send `false` for a required consent box; the server
    // enforces the tick regardless of what the client validated.
    expect(validateCheckbox(field(true), false)).toEqual({ error: 'This field is required.' });
  });

  it('rejects a non-boolean value (client-bypassed truthy string)', () => {
    expect(validateCheckbox(field(true), 'yes')).toEqual({
      error: 'Please provide a valid response.',
    });
  });

  it('ignores consent config (consentText/links) — the stored shape stays boolean', () => {
    const configured = field(true, {
      consentText: 'I agree to the {link}.',
      links: [{ text: 'Terms', url: 'https://example.com/terms' }],
    });
    expect(validateCheckbox(configured, true)).toEqual({ value: true });
  });
});
