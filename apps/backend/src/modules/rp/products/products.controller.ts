import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { RpRequestGuard, type RpRequest } from '../guards';
import { RpProductsService } from './products.service';

@Controller('rp/shopify/products')
@UseGuards(RpRequestGuard)
export class RpProductsController {
  constructor(private readonly products: RpProductsService) {}

  @Get(':id')
  get(@Req() req: RpRequest, @Param('id') id: string): Promise<unknown> {
    return this.products.getProduct(req.rpMerchant.merchantId, req.rpMerchant.domain, id);
  }
}
