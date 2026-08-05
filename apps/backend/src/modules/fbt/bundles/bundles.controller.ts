import {
  BadRequestException,
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
import type { FbtBundleOutput } from '@ratio-app/shared/schemas/fbt-bundle';
import { fbtBundleModeSchema, fbtBundleStatusSchema } from '@ratio-app/shared/schemas/fbt-bundle';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { FbtMerchantTokenGuard } from '../guards';
import {
  type CreateBundleDto,
  createBundleDtoSchema,
  type DuplicateBundleDto,
  duplicateBundleDtoSchema,
  type SetBundleStatusDto,
  setBundleStatusDtoSchema,
  type UpdateBundleDto,
  updateBundleDtoSchema,
} from './bundle.dto';
import { FbtBundleLookupService } from './bundle-lookup.service';
import { FbtBundlesService } from './bundles.service';

const DEFAULT_LIMIT = 20;

/**
 * Bundle CRUD for the admin. Merchant identity always comes from the guard,
 * never from a query param or body — the source app took `merchant_id` from the
 * query string on every route, which let any merchant address another's data.
 *
 * Route ORDER is load-bearing: static segments (`lookup`, `duplicate`) are
 * declared before the `:id` routes so a request for `/bundles/lookup` cannot
 * resolve as `getById('lookup')`.
 */
@Controller('fbt/api/bundles')
@UseGuards(FbtMerchantTokenGuard)
export class FbtBundlesController {
  constructor(
    private readonly bundles: FbtBundlesService,
    private readonly lookupService: FbtBundleLookupService,
  ) {}

  @Post()
  create(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(createBundleDtoSchema as unknown as ZodType<CreateBundleDto>))
    body: CreateBundleDto,
  ): Promise<FbtBundleOutput> {
    return this.bundles.create(merchant.id, body);
  }

  @Get()
  list(
    @CurrentMerchant() merchant: Merchant,
    @Query('status') status?: string,
    @Query('mode') mode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // Unrecognised filter values are dropped rather than forwarded — passing an
    // arbitrary string into a WHERE on an ENUM column is a 500, not a 400.
    const parsedStatus = fbtBundleStatusSchema.safeParse(status);
    const parsedMode = fbtBundleModeSchema.safeParse(mode);

    return this.bundles.list(merchant.id, {
      ...(parsedStatus.success ? { status: parsedStatus.data } : {}),
      ...(parsedMode.success ? { mode: parsedMode.data } : {}),
      page: Number(page) || 1,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  /**
   * Declared before `:id` so `/bundles/lookup` never resolves as an id.
   *
   * `async` (rather than a plain function returning a `Promise`) so the
   * guard-clause throw below surfaces as a rejected promise to a direct
   * caller, not a synchronous throw — Nest's own request pipeline would
   * catch either form, but a unit test invoking the method directly (no
   * HTTP layer) needs an actual promise to assert against with `.rejects`.
   */
  @Get('lookup')
  async lookup(
    @CurrentMerchant() merchant: Merchant,
    @Query('productId') productId?: string,
    @Query('collectionId') collectionId?: string,
  ): Promise<FbtBundleOutput> {
    if (!productId && !collectionId) {
      throw new BadRequestException({
        message: 'one of productId or collectionId is required',
        error_code: 'LOOKUP_TARGET_REQUIRED',
      });
    }
    return this.lookupService.resolve(merchant.id, {
      ...(productId ? { productId } : {}),
      ...(collectionId ? { collectionId } : {}),
    });
  }

  /** Declared before `:id/status` for the same reason as `lookup`. */
  @Post('duplicate')
  @HttpCode(201)
  duplicate(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(duplicateBundleDtoSchema as unknown as ZodType<DuplicateBundleDto>))
    body: DuplicateBundleDto,
  ): Promise<FbtBundleOutput> {
    return this.bundles.duplicate(merchant.id, body.id, body.name);
  }

  @Get(':id')
  getById(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<FbtBundleOutput> {
    return this.bundles.getById(merchant.id, id);
  }

  @Put(':id')
  update(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBundleDtoSchema as unknown as ZodType<UpdateBundleDto>))
    body: UpdateBundleDto,
  ): Promise<FbtBundleOutput> {
    return this.bundles.update(merchant.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentMerchant() merchant: Merchant, @Param('id') id: string): Promise<void> {
    await this.bundles.remove(merchant.id, id);
  }

  @Post(':id/status')
  @HttpCode(200)
  setStatus(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setBundleStatusDtoSchema as unknown as ZodType<SetBundleStatusDto>))
    body: SetBundleStatusDto,
  ): Promise<FbtBundleOutput> {
    return this.bundles.setStatus(merchant.id, id, body.status);
  }

  @Get(':id/preview')
  preview(@CurrentMerchant() merchant: Merchant, @Param('id') id: string) {
    return this.lookupService.preview(merchant.id, id);
  }
}
