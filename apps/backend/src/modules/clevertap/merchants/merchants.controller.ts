import { Controller, Get, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ClevertapMerchantTokenGuard } from '../guards';

@Controller('clevertap/api/merchants')
@UseGuards(ClevertapMerchantTokenGuard)
export class ClevertapMerchantsController {
  @Get('me')
  me(@CurrentMerchant() merchant: Merchant): Merchant {
    return merchant;
  }
}
