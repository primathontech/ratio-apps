import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  type LoyaltyRuleInput,
  loyaltyRuleInputSchema,
} from '@ratio-app/shared/schemas/loyalty-rules';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { type ZodType, z } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { LoyaltyMerchantTokenGuard } from '../guards';
import {
  type AppendCustomersResult,
  type LoyaltyRuleDto,
  type RuleCustomersPage,
  type RulePerformance,
  RulesService,
} from './rules.service';

const statusBodySchema = z.object({ active: z.boolean() });
type StatusBody = z.infer<typeof statusBodySchema>;

const customersBodySchema = z.object({
  phones: z.array(z.string().min(1)).min(1).max(10_000),
});
type CustomersBody = z.infer<typeof customersBodySchema>;

const CUSTOMERS_PAGE_MAX_LIMIT = 100;

/**
 * Merchant admin API for earning rules. Every route runs behind the merchant
 * token guard; the service re-scopes every rule id to the authenticated
 * merchant (foreign ids 404).
 */
@Controller('loyalty/api')
@UseGuards(LoyaltyMerchantTokenGuard)
export class LoyaltyRulesController {
  constructor(private readonly rules: RulesService) {}

  @Get('rules')
  list(@CurrentMerchant() merchant: Merchant): Promise<LoyaltyRuleDto[]> {
    return this.rules.list(merchant.id);
  }

  @Post('rules')
  create(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(loyaltyRuleInputSchema as unknown as ZodType<LoyaltyRuleInput>))
    body: LoyaltyRuleInput,
  ): Promise<LoyaltyRuleDto> {
    return this.rules.create(merchant.id, body);
  }

  @Get('rules/:id')
  get(@CurrentMerchant() merchant: Merchant, @Param('id') id: string): Promise<LoyaltyRuleDto> {
    return this.rules.get(merchant.id, id);
  }

  @Put('rules/:id')
  update(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(loyaltyRuleInputSchema as unknown as ZodType<LoyaltyRuleInput>))
    body: LoyaltyRuleInput,
  ): Promise<LoyaltyRuleDto> {
    return this.rules.update(merchant.id, id, body);
  }

  @Delete('rules/:id')
  async delete(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.rules.delete(merchant.id, id);
    return { deleted: true };
  }

  @Post('rules/:id/status')
  setStatus(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusBodySchema as unknown as ZodType<StatusBody>))
    body: StatusBody,
  ): Promise<LoyaltyRuleDto> {
    return this.rules.setActive(merchant.id, id, body.active);
  }

  @Get('rules/:id/customers')
  listCustomers(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<RuleCustomersPage> {
    const page = Math.max(1, Math.trunc(Number(pageRaw)) || 1);
    const limit = Math.min(
      CUSTOMERS_PAGE_MAX_LIMIT,
      Math.max(1, Math.trunc(Number(limitRaw)) || 20),
    );
    return this.rules.listCustomers(merchant.id, id, page, limit);
  }

  @Post('rules/:id/customers')
  appendCustomers(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(customersBodySchema as unknown as ZodType<CustomersBody>))
    body: CustomersBody,
  ): Promise<AppendCustomersResult> {
    return this.rules.appendCustomers(merchant.id, id, body.phones);
  }

  @Delete('rules/:id/customers')
  removeCustomers(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(customersBodySchema as unknown as ZodType<CustomersBody>))
    body: CustomersBody,
  ): Promise<{ removed: number }> {
    return this.rules.removeCustomers(merchant.id, id, body.phones);
  }

  @Get('rules/:id/performance')
  performance(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<RulePerformance> {
    return this.rules.performance(merchant.id, id);
  }
}
