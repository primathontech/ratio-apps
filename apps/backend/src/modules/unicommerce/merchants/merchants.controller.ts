import { Controller, Get, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { UcMerchantTokenGuard } from '../guards';

/**
 * `GET /unicommerce/api/merchants/me` — was missing entirely until now, same
 * gap class as the OAuth callback controller: every sibling module (google/
 * meta/moengage/posthog/wizzy/_template) has this exact controller, but
 * unicommerce never got one built across the original 16-task plan. Confirmed
 * as a REAL, live-traffic gap (not a theoretical one) — the admin SPA's
 * `useMerchant()` hook calls this route directly on the real Ratio dashboard,
 * and it 404'd in production/sandbox testing before this fix.
 */
@Controller('unicommerce/api/merchants')
@UseGuards(UcMerchantTokenGuard)
export class UcMerchantsController {
  /**
   * Returns the current merchant identity (including `isActive`). The admin
   * SPA uses this both to bootstrap the session and to route inactive
   * merchants to a disabled view.
   */
  @Get('me')
  me(@CurrentMerchant() merchant: Merchant): Merchant {
    return merchant;
  }
}
