import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { RpRequestGuard, type RpRequest } from '../guards';
import { RpInventoryService } from './inventory.service';

@Controller('rp/shopify/inventory_levels')
@UseGuards(RpRequestGuard)
export class RpInventoryController {
  constructor(private readonly inventory: RpInventoryService) {}

  @Post('adjust')
  adjust(@Req() req: RpRequest, @Body() body: unknown): Promise<unknown> {
    return this.inventory.adjustInventoryLevel(req.rpMerchant.merchantId, body);
  }
}
