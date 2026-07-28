import {
  type FormsConfigInput,
  formsConfigInputSchema,
} from '@ratio-app/shared/schemas/forms-config';

// Re-export the shared input schema/type under controller-friendly names so they can't drift.
export const updateConfigDtoSchema = formsConfigInputSchema;
export type UpdateConfigDto = FormsConfigInput;
