import { Injectable, Logger } from '@nestjs/common';
import { FbtProductInvalidationHandler } from './product-invalidation.base';
import { FBT_TOPICS } from './topics';

/**
 * A new product has no embedding yet, so there is normally nothing to delete —
 * but we still clear, because a reused product id (delete → recreate) would
 * otherwise inherit the old product's vector and produce confidently-wrong
 * recommendations.
 */
@Injectable()
export class FbtProductCreatedHandler extends FbtProductInvalidationHandler {
  readonly topic = FBT_TOPICS.PRODUCT_CREATED;
  protected readonly logger = new Logger(FbtProductCreatedHandler.name);
}
