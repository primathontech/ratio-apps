import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RpRequestGuard, type RpRequest } from '../guards';
import { RpCustomersService } from './customers.service';

@Controller('rp/shopify/customers')
@UseGuards(RpRequestGuard)
export class RpCustomersController {
  constructor(private readonly customers: RpCustomersService) {}

  @Get('search')
  search(
    @Req() req: RpRequest,
    @Query('query') query: string | undefined,
  ): Promise<unknown> {
    return this.customers.search(req.rpMerchant.merchantId, query);
  }

  @Post()
  create(@Req() req: RpRequest, @Body() body: unknown): Promise<unknown> {
    return this.customers.create(req.rpMerchant.merchantId, body);
  }
}
