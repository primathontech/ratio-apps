import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { type FormInput, formInputSchema } from '@ratio-app/shared/schemas/form-schema';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { type ZodType, z } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { FormsMerchantTokenGuard } from '../guards';
import { type FormEntity, type FormListResult, FormsService } from './forms.service';

/** `?page&limit` for the forms list — bounded like the submissions list. */
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const formInputPipe = new ZodValidationPipe(formInputSchema as unknown as ZodType<FormInput>);

/**
 * Merchant-guarded form CRUD (TRD §2). Bodies validate against the SHARED
 * `formInputSchema` — the same contract the admin builder and the storefront
 * SDK use, so a payload that renders is a payload that saves.
 */
@Controller('forms/api')
@UseGuards(FormsMerchantTokenGuard)
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Post('forms')
  async create(
    @CurrentMerchant() merchant: Merchant,
    @Body(formInputPipe) body: FormInput,
  ): Promise<FormEntity> {
    return this.forms.create(merchant.id, body);
  }

  @Get('forms')
  async list(
    @CurrentMerchant() merchant: Merchant,
    @Query(new ZodValidationPipe(listQuerySchema as unknown as ZodType<ListQuery>))
    query: ListQuery,
  ): Promise<FormListResult> {
    return this.forms.list(merchant.id, query.page, query.limit);
  }

  @Get('forms/:id')
  async get(@CurrentMerchant() merchant: Merchant, @Param('id') id: string): Promise<FormEntity> {
    return this.forms.getById(merchant.id, id);
  }

  @Put('forms/:id')
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body(formInputPipe) body: FormInput,
  ): Promise<FormEntity> {
    return this.forms.update(merchant.id, id, body);
  }

  @Delete('forms/:id')
  @HttpCode(204)
  async remove(@CurrentMerchant() merchant: Merchant, @Param('id') id: string): Promise<void> {
    await this.forms.softDelete(merchant.id, id);
  }

  @Post('forms/:id/activate')
  async activate(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<FormEntity> {
    return this.forms.setStatus(merchant.id, id, 'active');
  }

  @Post('forms/:id/deactivate')
  async deactivate(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<FormEntity> {
    return this.forms.setStatus(merchant.id, id, 'inactive');
  }

  @Post('forms/:id/duplicate')
  async duplicate(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<FormEntity> {
    return this.forms.duplicate(merchant.id, id);
  }
}
