import { Controller, Get, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { FormsMerchantTokenGuard } from '../guards';

@Controller('forms/api/merchants')
@UseGuards(FormsMerchantTokenGuard)
export class FormsMerchantsController {
  /** Current merchant identity (incl. `isActive`); admin uses it to bootstrap the session and route inactive merchants to /disabled. */
  @Get('me')
  me(@CurrentMerchant() merchant: Merchant): Merchant {
    return merchant;
  }
}
