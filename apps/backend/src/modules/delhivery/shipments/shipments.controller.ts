import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { FastifyReply } from 'fastify';
import { z, type ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { DelhiveryShipmentRow, DelhiveryTrackingEventRow } from '../db/types';
import { DelhiveryMerchantTokenGuard } from '../guards';
import { PickupCron } from '../pickup/pickup.cron';
import { DelhiverySdkService } from '../sdk/sdk.service';
import { DelhiveryShipmentService, type PendingOrdersPage } from './shipment.service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  status: z.string().max(32).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const pendingQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
});
type PendingQuery = z.infer<typeof pendingQuerySchema>;

const manualCreateSchema = z.object({
  order_id: z.string().min(1).max(128),
  order_number: z.string().min(1).max(128).optional(),
});
type ManualCreateDto = z.infer<typeof manualCreateSchema>;

const pickupSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});
type PickupDto = z.infer<typeof pickupSchema>;

const AWB_RE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Merchant-facing shipment endpoints (TRD §2): list/detail for the Shipments
 * screen, manual AWB creation (manual trigger mode), the label-PDF proxy
 * (Delhivery creds stay server-side), and manual "Request Pickup".
 */
@Controller('delhivery/api')
@UseGuards(DelhiveryMerchantTokenGuard)
export class DelhiveryShipmentsController {
  constructor(
    private readonly shipments: DelhiveryShipmentService,
    private readonly sdk: DelhiverySdkService,
    private readonly pickup: PickupCron,
  ) {}

  @Get('shipments')
  async list(
    @CurrentMerchant() merchant: Merchant,
    @Query(new ZodValidationPipe(listQuerySchema as unknown as ZodType<ListQuery>))
    query: ListQuery,
  ): Promise<{ items: DelhiveryShipmentRow[]; page: number; pageSize: number }> {
    return this.shipments.list(merchant.id, query);
  }

  /** Manual AWB creation — the Shipments screen's "Create shipment" action. */
  @Post('shipments')
  async create(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(manualCreateSchema as unknown as ZodType<ManualCreateDto>))
    body: ManualCreateDto,
  ): Promise<DelhiveryShipmentRow> {
    const row = await this.shipments.createForOrder(
      merchant.id,
      { orderId: body.order_id, orderNumber: body.order_number },
      { manual: true },
    );
    if (!row) {
      throw new BadRequestException({
        message: 'shipment could not be created (config disabled or order missing)',
        error_code: 'SHIPMENT_NOT_CREATED',
      });
    }
    return row;
  }

  /**
   * Label PDF proxy. The backend calls Delhivery with the merchant's token
   * and streams the bytes back — the browser never sees carrier credentials.
   * `:awb` is validated and ownership-checked against the merchant's own
   * shipments before any upstream call.
   */
  /** Paid + unfulfilled orders awaiting a manual AWB (manual trigger mode). */
  @Get('shipments/pending')
  async pending(
    @CurrentMerchant() merchant: Merchant,
    @Query(new ZodValidationPipe(pendingQuerySchema as unknown as ZodType<PendingQuery>))
    query: PendingQuery,
  ): Promise<PendingOrdersPage> {
    return this.shipments.listPendingOrders(merchant.id, query.page);
  }

  @Get('shipments/:awb/label')
  async label(
    @CurrentMerchant() merchant: Merchant,
    @Param('awb') awb: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!AWB_RE.test(awb)) {
      throw new BadRequestException({ message: 'invalid awb', error_code: 'INVALID_AWB' });
    }
    const shipment = await this.shipments.findByAwb(merchant.id, awb);
    if (!shipment) {
      throw new NotFoundException({ message: 'shipment not found', error_code: 'SHIPMENT_NOT_FOUND' });
    }
    const { pdf, contentType } = await this.sdk.getLabel(merchant.id, awb);
    reply
      .header('content-type', contentType)
      .header('content-disposition', `inline; filename="label-${awb}.pdf"`)
      .send(pdf);
  }

  @Get('shipments/:id')
  async detail(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<{ shipment: DelhiveryShipmentRow; events: DelhiveryTrackingEventRow[] }> {
    return this.shipments.detail(merchant.id, id);
  }

  /** Manual "Request Pickup" — files a pickup for all pending shipments. */
  @Post('pickup')
  async requestPickup(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(pickupSchema as unknown as ZodType<PickupDto>))
    body: PickupDto,
  ): Promise<{ scheduled: boolean; count: number }> {
    return this.pickup.requestNow(merchant.id, body.date);
  }
}
