import {
  delhiveryConfigInputSchema,
  type DelhiveryConfigInput,
} from '@ratio-app/shared/schemas/delhivery-config';

/**
 * Re-export the shared input schema as the PUT body schema. The admin form
 * sends `apiToken` + `pickupLocationName` + `gstin` + `defaultBox` (required)
 * and may omit `pickupCutoff` / `awbTrigger` / `enabled` — the service fills
 * those with defaults.
 *
 * `UpdateConfigDto` is just the shared `DelhiveryConfigInput` — we re-export
 * under a controller-friendly name. Going through the shared type (rather
 * than `z.infer<>` here) avoids a Zod 3 / Zod 4 inference mismatch: the
 * shared package ships its types compiled against Zod 3 while the backend
 * uses Zod 4, and `z.infer<>` against a foreign-version schema yields
 * `unknown` (Phase B precedent).
 */
export const updateConfigDtoSchema = delhiveryConfigInputSchema;
export type UpdateConfigDto = DelhiveryConfigInput;
