import {
  type LoyaltyConfigInput,
  loyaltyConfigInputSchema,
} from '@ratio-app/shared/schemas/loyalty-config';

/**
 * PUT /loyalty/api/loyalty-config body — re-exports the shared input schema so
 * the admin form and the backend validate identically.
 *
 * Going through the shared type (rather than `z.infer<>` here) avoids a
 * Zod 3 / Zod 4 inference mismatch: the shared package ships its types
 * compiled against Zod 3 while the backend uses Zod 4, and `z.infer<>`
 * against a foreign-version schema yields `unknown` (Phase B precedent).
 */
export const updateConfigDtoSchema = loyaltyConfigInputSchema;
export type UpdateConfigDto = LoyaltyConfigInput;
