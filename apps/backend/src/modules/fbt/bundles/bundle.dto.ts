import {
  type FbtBundleInput,
  type FbtDuplicateBundleInput,
  type FbtSetBundleStatusInput,
  fbtBundleInputSchema,
  fbtDuplicateBundleSchema,
  fbtSetBundleStatusSchema,
} from '@ratio-app/shared/schemas/fbt-bundle';

/**
 * Controller-facing aliases for the shared bundle schemas. Going through the
 * shared types (rather than a local `z.infer<>`) avoids the Zod 3 / Zod 4
 * inference mismatch — same reason `wizzy/config/wizzy-config.dto.ts` does it.
 */
export const createBundleDtoSchema = fbtBundleInputSchema;
export type CreateBundleDto = FbtBundleInput;

export const updateBundleDtoSchema = fbtBundleInputSchema;
export type UpdateBundleDto = FbtBundleInput;

export const duplicateBundleDtoSchema = fbtDuplicateBundleSchema;
export type DuplicateBundleDto = FbtDuplicateBundleInput;

export const setBundleStatusDtoSchema = fbtSetBundleStatusSchema;
export type SetBundleStatusDto = FbtSetBundleStatusInput;
