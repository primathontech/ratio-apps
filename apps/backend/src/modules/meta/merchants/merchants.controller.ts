import { Controller, Get, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { MetaMerchantTokenGuard } from '../guards';

@Controller('meta/api/merchants')
@UseGuards(MetaMerchantTokenGuard)
export class MetaMerchantsController {
  /**
   * Returns the current merchant identity (including `isActive`). The admin
   * uses this both to bootstrap the session and to route inactive merchants
   * to the `/disabled` view.
   */
  @Get('me')
  me(@CurrentMerchant() merchant: Merchant): Merchant {
    return merchant;
  }
}
