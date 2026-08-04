import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { UcAlertingService } from '../services/alerting.service';
import { UcConfigService } from '../services/config.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';
import { UcReconciliationSweepService } from '../services/reconciliation-sweep.service';
import { UcSyncQueueService } from '../services/sync-queue.service';

const reconcileSchema = z.object({
  merchantId: z.string().min(1),
  timeRangeStart: z.string().min(1),
  timeRangeEnd: z.string().min(1),
});
type ReconcileRequest = z.infer<typeof reconcileSchema>;

const acknowledgeSchema = z.object({ acknowledgedBy: z.string().min(1) });
type AcknowledgeRequest = z.infer<typeof acknowledgeSchema>;

const updateConfigSchema = z.object({
  productSyncEnabled: z.boolean().optional(),
  inventorySyncEnabled: z.boolean().optional(),
  orderPushEnabled: z.boolean().optional(),
  dispatchStatusSyncEnabled: z.boolean().optional(),
  cancelSyncEnabled: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
});
type UpdateConfigRequest = z.infer<typeof updateConfigSchema>;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;
const VALID_RESULTS = new Set(['success', 'failed', 'partial']);

/**
 * Admin-facing (no UcApiKeyGuard here — session/admin auth applies at the
 * gateway level, same as Task 2's connect controller).
 */
@Controller('unicommerce/admin')
export class UcAdminDashboardController {
  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
    private readonly syncQueue: UcSyncQueueService,
    private readonly reconciliationSweep: UcReconciliationSweepService,
    private readonly alerting: UcAlertingService,
    private readonly configService: UcConfigService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) {}

  /**
   * `?limit=` / `?offset=`: powers the admin's "Show more" pagination
   * (default 5 at a time, matching what fits without overwhelming the page).
   * `?result=failed`: powers the separate "Failed Syncs" tab — a dedicated
   * server-side filter rather than fetching everything and filtering
   * client-side, so "show me every failure" isn't silently capped by
   * whatever page of the unfiltered list happens to be loaded.
   *
   * `hasMore` is derived by fetching one extra row past `limit` rather than
   * a separate COUNT(*) query — cheaper, and exactly what "Show more" needs
   * to know (whether to render the button at all).
   */
  @Get('sync-activity')
  async listActivity(
    @Query('merchantId') merchantId: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
    @Query('result') result?: string,
  ) {
    if (!merchantId) throw new BadRequestException('merchantId is required');
    if (result && !VALID_RESULTS.has(result)) {
      throw new BadRequestException(`result must be one of: ${[...VALID_RESULTS].join(', ')}`);
    }
    const limit = Math.min(Math.max(Number(limitRaw) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Number(offsetRaw) || 0, 0);

    let query = this.handle.db
      .selectFrom('ucEventLogs')
      .selectAll()
      .where('merchantId', '=', merchantId);
    if (result) {
      query = query.where('result', '=', result as 'success' | 'failed' | 'partial');
    }

    const rows = await query
      .orderBy('createdAt', 'desc')
      .limit(limit + 1)
      .offset(offset)
      .execute();

    const hasMore = rows.length > limit;
    return { rows: rows.slice(0, limit), hasMore };
  }

  @Post('sync-activity/:jobId/retry')
  async retry(@Param('jobId') jobId: string) {
    await this.syncQueue.attemptImmediate(jobId);
    return { ok: true };
  }

  /**
   * Manual Reconciliation panel (§7): unlike the automatic sweep, this
   * always runs the full per-order diff directly and returns the job id
   * immediately (202-style) — the SPA polls `GET .../reconcile/:jobId` for
   * progress while it runs in the background.
   */
  @Post('reconcile')
  async triggerReconcile(@Body(new ZodValidationPipe(reconcileSchema)) body: ReconcileRequest) {
    const jobId = await this.reconciliationSweep.triggerManual(
      body.merchantId,
      new Date(body.timeRangeStart),
      new Date(body.timeRangeEnd),
    );
    return { jobId };
  }

  @Get('reconcile/:jobId')
  async getReconcileJob(@Param('jobId') jobId: string) {
    const job = await this.reconciliationSweep.getJob(jobId);
    if (!job) throw new NotFoundException('no reconciliation job found with that id');
    return job;
  }

  @Get('alerts')
  async listAlerts(@Query('merchantId') merchantId: string) {
    if (!merchantId) throw new BadRequestException('merchantId is required');
    return { alerts: await this.alerting.listAlerts(merchantId) };
  }

  @Post('alerts/:alertId/acknowledge')
  async acknowledgeAlert(
    @Param('alertId') alertId: string,
    @Body(new ZodValidationPipe(acknowledgeSchema)) body: AcknowledgeRequest,
  ) {
    await this.alerting.acknowledge(alertId, body.acknowledgedBy);
    return { ok: true };
  }

  @Get('config')
  async getConfig(@Query('merchantId') merchantId: string) {
    if (!merchantId) throw new BadRequestException('merchantId is required');
    return this.configService.getByMerchantId(merchantId);
  }

  @Put('config')
  async updateConfig(
    @Query('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(updateConfigSchema)) body: UpdateConfigRequest,
  ) {
    if (!merchantId) throw new BadRequestException('merchantId is required');
    const result = await this.configService.upsert(merchantId, body);
    this.featureFlags.invalidate(merchantId);
    return result;
  }
}
