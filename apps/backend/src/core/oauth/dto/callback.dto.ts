import { z } from 'zod';

export const callbackDtoSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
});

export type CallbackDto = z.infer<typeof callbackDtoSchema>;
