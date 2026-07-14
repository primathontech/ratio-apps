import {
  type FormsConfigInput,
  formsConfigInputSchema,
} from '@ratio-app/shared/schemas/forms-config';

/**
 * Re-export the shared input schema as the PUT body schema. The admin form
 * may send `recaptchaSiteKey` / `recaptchaSecret` (write-only; blank keeps
 * the stored ciphertext) and may omit `recaptchaThreshold` / `formsEnabled`
 * — Zod fills the defaults (0.3 / true).
 *
 * `UpdateConfigDto` is just the shared `FormsConfigInput` — re-exported
 * under a controller-friendly name so the controller and the shared package
 * cannot drift.
 */
export const updateConfigDtoSchema = formsConfigInputSchema;
export type UpdateConfigDto = FormsConfigInput;
