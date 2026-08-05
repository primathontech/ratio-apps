import { Injectable, Logger } from '@nestjs/common';
import { FbtProductInvalidationHandler } from './product-invalidation.base';
import { FBT_TOPICS } from './topics';

/**
 * An edited title, description, tags, or variants change the text the embedding was
 * derived from, so the cached vector is now wrong.
 */
@Injectable()
export class FbtProductUpdatedHandler extends FbtProductInvalidationHandler {
  readonly topic = FBT_TOPICS.PRODUCT_UPDATED;
  protected readonly logger = new Logger(FbtProductUpdatedHandler.name);
}
