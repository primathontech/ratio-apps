import { Inject, Injectable, Logger } from '@nestjs/common';
import { UC_MOCK_UNICOMMERCE, UC_MOCK_RATIO } from '../tokens';
import type { MockUnicommerceService } from '../mock/mock-unicommerce.service';
import type { MockRatioOrderService } from '../mock/mock-ratio-order.service';
import { UcOauthService } from './oauth.service';
import { UcCredentialsService } from './credentials.service';

export interface CancelResult {
  success: boolean;
  manualIntervention: boolean;
  message: string;
}

@Injectable()
export class UcOrderCancelService {
  private readonly logger = new Logger(UcOrderCancelService.name);

  constructor(
    private readonly credentials: UcCredentialsService,
    private readonly oauth: UcOauthService,
    @Inject(UC_MOCK_UNICOMMERCE) private readonly ucMock: MockUnicommerceService,
    @Inject(UC_MOCK_RATIO) private readonly ratioMock: MockRatioOrderService,
  ) {}

  async cancelOrder(merchantId: string, orderId: string): Promise<CancelResult> {
    const creds = await this.credentials.getDecrypted(merchantId);
    if (!creds || !creds.active || creds.killSwitch) {
      return { success: false, manualIntervention: false, message: 'Merchant not active' };
    }

    const order = await this.ratioMock.getOrder(orderId);
    if (!order) {
      return { success: false, manualIntervention: false, message: 'Order not found' };
    }

    const ucCode = (order as any).uc_order_code as string | undefined;
    if (!ucCode) {
      return { success: true, manualIntervention: false, message: 'Order not yet pushed to UC, no cancellation needed' };
    }

    const token = await this.oauth.getValidToken(merchantId);

    try {
      const response = await this.ucMock.cancelSaleOrder(creds.tenantSlug, token, ucCode);
      if (!response.successful) {
        const isDispatched = response.errors?.some((e) => e.toLowerCase().includes('already dispatched'));
        if (isDispatched) {
          this.logger.warn({ msg: 'UC cancel failed — already dispatched', merchantId, orderId, ucCode });
          return {
            success: false,
            manualIntervention: true,
            message: 'Order cannot be cancelled in Unicommerce — already dispatched. Contact warehouse directly.',
          };
        }
        return {
          success: false,
          manualIntervention: false,
          message: response.errors?.join('; ') ?? 'UC cancellation failed',
        };
      }

      await this.ratioMock.updateOrder(orderId, { status: 'cancelled' });
      this.logger.log({ msg: 'order cancelled in UC', merchantId, orderId, ucCode });
      return { success: true, manualIntervention: false, message: 'Order cancelled in Unicommerce' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ msg: 'UC cancel exception', merchantId, orderId, error: errorMsg });
      return { success: false, manualIntervention: false, message: errorMsg };
    }
  }
}
