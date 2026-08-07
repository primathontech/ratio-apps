import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from './db';
import type { InboundEventMessage } from './kafka';
import type { Logger } from './logger';

declare module 'fastify' {
  interface FastifyRequest {
    ucMerchantId?: string;
  }
}

export interface AppDeps {
  db: Db;
  publish: (message: InboundEventMessage) => Promise<void>;
  logger: Logger;
}

/**
 * Request schemas copied field-for-field from the backend's sync controllers
 * (status.controller.ts / inventory.controller.ts) so this edge accepts exactly
 * what the old synchronous endpoints accepted — including the capital-I
 * `IsReverse` and `inventory` as a STRING (UC's contract).
 */
const statusSchema = z.object({
  orderItems: z
    .array(
      z.object({
        orderItemId: z.string(),
        status: z.string(),
        // Capital-I `IsReverse` — confirmed directly against
        // post_status_notification.html; a lowercase `isReverse` never matches.
        IsReverse: z.boolean(),
        updated: z.string(),
      }),
    )
    .min(1),
});

const updateInventorySchema = z.object({
  inventoryList: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string(),
      inventory: z.string(),
      hsnCode: z.string().optional(),
      facilityCode: z.string().optional(),
    }),
  ),
});

/** Error carrying an HTTP status, rendered by Fastify's default error handler. */
function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

// Debug-only inbound request logging mirroring `logInboundRequest` in the
// backend's guards.ts — credential-shaped headers/query params redacted.
const CREDENTIAL_KEY_RE = /^(apikey|securitykey|authorization|cookie)$/i;

function redactUrl(url: string): string {
  return url.replace(/([?&](?:password|apikey|securitykey|token)=)[^&]*/gi, '$1***redacted***');
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        CREDENTIAL_KEY_RE.test(key) ? '***redacted***' : redactSensitive(val),
      ]),
    );
  }
  return value;
}

function logInboundRequest(req: FastifyRequest, logger: Logger): void {
  logger.debug({
    msg: 'unicommerce inbound request',
    method: req.method,
    url: redactUrl(req.url),
    headers: redactSensitive(req.headers),
    body: redactSensitive(req.body),
  });
}

/**
 * Authenticates the `apikey` header Unicommerce sends on every inbound call,
 * mirroring the backend's UcApiKeyGuard exactly:
 *  - missing header → 401 `missing apiKey header`
 *  - unknown/expired token (sha256-hex lookup in uc_access_tokens) → 401
 *    `invalid or expired apiKey`
 *  - paused/uninstalled merchant (kill-switch) → 403
 * Stamps `last_inbound_call_at` best-effort (never fails the request).
 */
function authenticate(deps: AppDeps): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    logInboundRequest(req, deps.logger);

    const apiKey = req.headers.apikey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw httpError(401, 'missing apiKey header');
    }

    const merchantId = await deps.db.validateApiKey(apiKey);
    if (!merchantId) throw httpError(401, 'invalid or expired apiKey');

    const status = await deps.db.getCredentialStatus(merchantId);
    if (status === 'paused') throw httpError(403, 'merchant is paused — inbound calls blocked');
    if (status === 'uninstalled')
      throw httpError(403, 'merchant is uninstalled — inbound calls blocked');

    req.ucMerchantId = merchantId;

    deps.db.touchInboundCall(merchantId).catch(() => {
      // Best-effort proof-of-life stamp — a failure here must never reject the request.
    });
  };
}

/** Publish to Kafka, log-and-swallow: the job row (PENDING) is the durable record. */
async function publishOrLog(deps: AppDeps, message: InboundEventMessage): Promise<void> {
  try {
    await deps.publish(message);
  } catch (err) {
    deps.logger.error({
      msg: 'kafka publish failed — job row stays PENDING for later processing',
      jobId: message.jobId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 400 envelope mirroring the backend's ZodValidationPipe (core/common/pipes). */
function sendValidationError(reply: FastifyReply, details: unknown): void {
  reply.code(400).send({
    statusCode: 400,
    error: 'Bad Request',
    message: 'validation failed',
    error_code: 'INVALID_REQUEST_BODY',
    details,
  });
}

function handleStatusNotify(
  deps: AppDeps,
): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const orderId = (req.params as { orderId: string }).orderId;
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(reply, parsed.error.flatten().fieldErrors);
      return;
    }
    const body = parsed.data;
    const merchantId = req.ucMerchantId as string;

    // Top-level `status` is ALWAYS pinned to SUCCESS (confirmed by UC's team) —
    // real per-item failures go into `orderItems[].errorMessage`, exactly like
    // the backend's status.controller.ts. Here the only edge-detectable failure
    // is an unknown/foreign orderItemId; duplicate (`no_change`) and
    // `unrecognized status` detection stays in the backend worker, which has
    // the full row + mapping service.
    const results: { orderItemId: string; errorMessage?: string }[] = [];

    for (const item of body.orderItems) {
      const mapped = await deps.db.resolveOrderItem(item.orderItemId);
      if (!mapped || mapped.merchantId !== merchantId) {
        results.push({ orderItemId: item.orderItemId, errorMessage: 'unknown orderItemId' });
        continue;
      }

      // Per-item job granularity: one row per order item, payload shaped exactly
      // like the worker's StatusNotifyPayload.
      const jobId = await deps.db.insertJob(merchantId, 'status_notify', {
        orderId,
        orderItemId: item.orderItemId,
        status: item.status,
        IsReverse: item.IsReverse,
        updated: item.updated,
      });
      await publishOrLog(deps, { jobId, merchantId, type: 'status_notify' });
      results.push({ orderItemId: item.orderItemId });
    }

    return { status: 'SUCCESS', orderItems: results };
  };
}

function handleUpdateInventory(
  deps: AppDeps,
): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const parsed = updateInventorySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(reply, parsed.error.flatten().fieldErrors);
      return;
    }
    const body = parsed.data;
    const merchantId = req.ucMerchantId as string;

    // Deliberately NO local variant existence check: the backend's
    // UcInventoryService.apply performs no pre-check either (TRD v2 — UC sends
    // OUR OWN Ratio variant_id directly; there is no merchant→variant catalog
    // table, and a `uc_variant_inventory` existence check would reject valid
    // FIRST-time updates). Every item is enqueued; the worker reproduces the
    // sync path's exact per-item error handling (Ratio call decides).
    for (const item of body.inventoryList) {
      const payload: Record<string, unknown> = {
        productId: item.productId,
        variantId: item.variantId,
        inventory: item.inventory,
      };
      if (item.hsnCode !== undefined) payload.hsnCode = item.hsnCode;
      if (item.facilityCode !== undefined) payload.facilityCode = item.facilityCode;

      const jobId = await deps.db.insertJob(merchantId, 'inventory_update', payload);
      await publishOrLog(deps, { jobId, merchantId, type: 'inventory_update' });
    }

    return { status: 'SUCCESS', failedProductList: [] };
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));

  app.post(
    '/unicommerce/api/v1/order/:orderId',
    { preHandler: authenticate(deps) },
    handleStatusNotify(deps),
  );

  app.post(
    '/unicommerce/api/v1/updateInventory',
    { preHandler: authenticate(deps) },
    handleUpdateInventory(deps),
  );

  return app;
}
