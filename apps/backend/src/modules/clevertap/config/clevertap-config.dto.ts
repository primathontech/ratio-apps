import {
  type ClevertapConfigInput,
  clevertapConfigInputSchema,
} from '@ratio-app/shared/schemas/clevertap-config';

export const updateConfigDtoSchema = clevertapConfigInputSchema;
export type UpdateConfigDto = ClevertapConfigInput;
