import {
  _templateConfigInputSchema,
  type TemplateConfigInput,
} from '@ratio-app/shared/schemas/_template-config';

/**
 * Re-export the shared input schema as the PUT body schema. The admin form
 * sends `apiKey` + `host` (required) and may omit `debug` / `events` — the
 * service fills those with defaults.
 *
 * `UpdateConfigDto` is just the shared `TemplateConfigInput` — we re-export
 * under a controller-friendly name. Going through the shared type (rather
 * than `z.infer<>` here) avoids a Zod 3 / Zod 4 inference mismatch: the
 * shared package ships its types compiled against Zod 3 while the backend
 * uses Zod 4, and `z.infer<>` against a foreign-version schema yields
 * `unknown` (Phase B precedent).
 */
export const updateConfigDtoSchema = _templateConfigInputSchema;
export type UpdateConfigDto = TemplateConfigInput;
