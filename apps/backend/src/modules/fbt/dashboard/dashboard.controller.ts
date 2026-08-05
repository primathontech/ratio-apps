import { Controller, Get, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { FbtMerchantTokenGuard } from '../guards';
import { FbtDashboardService, type FbtDashboardSummary } from './dashboard.service';

/** Bundle counts for the admin's Dashboard screen. */
@Controller('fbt/api/dashboard')
@UseGuards(FbtMerchantTokenGuard)
export class FbtDashboardController {
  constructor(private readonly dashboard: FbtDashboardService) {}

  @Get('summary')
  summary(@CurrentMerchant() merchant: Merchant): Promise<FbtDashboardSummary> {
    return this.dashboard.summary(merchant.id);
  }
}
