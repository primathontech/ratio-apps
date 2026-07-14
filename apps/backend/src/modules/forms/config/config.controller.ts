import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { FormsConfig } from '@ratio-app/shared/schemas/forms-config';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { FormsMerchantTokenGuard } from '../guards';
import { FormsConfigService } from './config.service';
import { type UpdateConfigDto, updateConfigDtoSchema } from './forms-config.dto';

/**
 * Merchant settings (TRD §2): GET returns the redacted shape
 * (`hasRecaptchaSecret`, never the secret); PUT accepts the write-only
 * secret (blank/absent = keep stored).
 */
@Controller('forms/api')
export class FormsConfigController {
  constructor(private readonly config: FormsConfigService) {}

  @Get('forms-config')
  @UseGuards(FormsMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<FormsConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('forms-config')
  @UseGuards(FormsMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<FormsConfig> {
    return this.config.upsert(merchant.id, body);
  }
}
