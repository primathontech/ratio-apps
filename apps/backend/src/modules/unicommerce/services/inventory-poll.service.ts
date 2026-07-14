import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UC_MOCK_UNICOMMERCE } from '../tokens';
import type { MockUnicommerceService } from '../mock/mock-unicommerce.service';
import { UcOauthService } from './oauth.service';
import { UcCredentialsService } from './credentials.service';
import { UcCircuitBreakerService } from './circuit-breaker.service';

@Injectable()
export class UcInventoryPollService {
  private readonly logger = new Logger(UcInventoryPollService.name);
  private running = false;

  constructor(
    private readonly credentials: UcCredentialsService,
    private readonly oauth: UcOauthService,
    private readonly circuitBreaker: UcCircuitBreakerService,
    @Inject(UC_MOCK_UNICOMMERCE) private readonly ucMock: MockUnicommerceService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async pollAllMerchants(): Promise<void> {
    if (this.running) {
      this.logger.warn('inventory poll already running, skipping');
      return;
    }
    this.running = true;
    try {
      const merchants = await this.credentials.getAllActiveMerchants();
      this.logger.log({ msg: 'inventory poll starting', merchantCount: merchants.length });
      for (const merchant of merchants) {
        await this.pollMerchant(merchant.merchantId);
      }
    } finally {
      this.running = false;
    }
  }

  async pollMerchant(merchantId: string): Promise<number> {
    const tripped = await this.circuitBreaker.isTripped(merchantId);
    if (tripped) {
      this.logger.warn({ msg: 'circuit breaker tripped, skipping inventory poll', merchantId });
      return 0;
    }

    try {
      const creds = await this.credentials.getDecrypted(merchantId);
      if (!creds) return 0;

      const token = await this.oauth.getValidToken(merchantId);
      const response = await this.ucMock.getInventorySnapshot(creds.tenantSlug, token, 65);

      this.logger.log({
        msg: 'inventory poll complete',
        merchantId,
        skuCount: response.inventorySnapshots.length,
      });

      return response.inventorySnapshots.length;
    } catch (err) {
      await this.circuitBreaker.recordFailure(merchantId);
      this.logger.error({
        msg: 'inventory poll failed',
        merchantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }
}
