import { z } from 'zod';

/**
 * Runtime schema for a single CAPI event sent by the browser pixel (Call B).
 * Validated in MetaCapiController before any DB or dispatch work.
 *
 * Limits:
 *  - event_name / event_id / action_source / event_source_url capped to
 *    prevent memory exhaustion from oversized strings.
 *  - user_data / custom_data are plain objects with max 50 keys each —
 *    prevents deeply-nested payload attacks.
 *  - Top-level batch capped at 100 events — prevents DoS via single request.
 */
const rawCapiEventSchema = z.object({
  event_name: z.string().min(1).max(100),
  event_id: z.string().min(1).max(100).optional(),
  event_time: z.number().int().positive().optional(),
  event_source_url: z.string().max(2048).optional(),
  action_source: z.enum(['website', 'app', 'offline', 'email', 'phone_call', 'chat', 'physical_store', 'system_generated', 'business_messaging', 'other']).optional(),
  user_data: z.record(z.string().max(64), z.unknown()).optional(),
  custom_data: z.record(z.string().max(64), z.unknown()).optional(),
});

export const capiIngestSchema = z.object({
  events: z.array(rawCapiEventSchema).min(1).max(100),
});

export type CapiIngestBody = z.infer<typeof capiIngestSchema>;
