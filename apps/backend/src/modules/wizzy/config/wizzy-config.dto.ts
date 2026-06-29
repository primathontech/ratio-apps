import {
  type WizzyConfigInput,
  wizzyConfigInputSchema,
} from '@ratio-app/shared/schemas/wizzy-config';

/**
 * Re-export the shared input schema as the PUT body schema. The admin form
 * sends the Wizzy config fields; the service fills those with defaults.
 *
 * `UpdateConfigDto` is just the shared `WizzyConfigInput` — we re-export
 * under a controller-friendly name. Going through the shared type (rather
 * than `z.infer<>` here) avoids a Zod 3 / Zod 4 inference mismatch.
 */
export const updateConfigDtoSchema = wizzyConfigInputSchema;
export type UpdateConfigDto = WizzyConfigInput;
