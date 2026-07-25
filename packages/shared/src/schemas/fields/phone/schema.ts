import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';
import { PHONE_COUNTRY_CODES } from './constants';

/**
 * Multi-country dial-code config (Batch-4 P0). Both keys are OPTIONAL so
 * existing +91-only forms stay valid and byte-identical — absent config ⇒ the
 * SDK/server treat the field as India-only (`+91`, 10 digits), exactly as v1.
 *
 * The two keys are wrapped in this nested, self-refined object (rather than
 * added at the top level) so the phone member of the discriminated union stays
 * a plain `ZodObject`: a `.refine` on the union member itself would produce a
 * `ZodEffects` and break `z.discriminatedUnion('type', …)`. The plan lists them
 * as `allowedCountries` / `defaultCountry`; here they are `countries.allowed` /
 * `countries.default` to satisfy that structural constraint.
 *
 * Security envelope: `allowed`/`default` are a closed enum (curated country
 * table), and the array is bounded by the number of known countries.
 */
const phoneCountriesSchema = z
  .object({
    // Enabled countries in the dial-code selector; ≥1, ≤ table size, all enum.
    allowed: z.array(z.enum(PHONE_COUNTRY_CODES)).min(1).max(PHONE_COUNTRY_CODES.length).optional(),
    // Pre-selected / single-country default (implicitly 'IN' when omitted).
    default: z.enum(PHONE_COUNTRY_CODES).optional(),
  })
  .refine(
    (v) => v.allowed === undefined || v.default === undefined || v.allowed.includes(v.default),
    {
      message: 'default country must be one of the allowed countries',
      path: ['default'],
    },
  );

export type PhoneCountriesConfig = z.infer<typeof phoneCountriesSchema>;

/**
 * Phone field. v1 default is +91 + 10 digits, enforced server-side. Optional
 * `countries` config enables a multi-country dial-code selector; per-country
 * length/placeholder come from the zod-free `PHONE_COUNTRY_META` table.
 */
export const phoneFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('phone'),
  countries: phoneCountriesSchema.optional(),
});
