import { Injectable, Logger } from '@nestjs/common';
import { FbtProductInvalidationHandler } from './product-invalidation.base';
import { FBT_TOPICS } from './topics';

/**
 * A deleted product must stop being recommended. This removes its embedding and
 * similarity cache.
 *
 * NOTE: stripping the id from `recommendation_product_list` on existing
 * `mode='auto'` bundles is deliberately NOT done here — auto-bundle writes are
 * owned by the recos engine (Plan 3), which strips deleted ids on its next
 * generation pass. Until then the widget filters unknown ids at render time, so
 * a deleted product is not displayed.
 */
@Injectable()
export class FbtProductDeletedHandler extends FbtProductInvalidationHandler {
  readonly topic = FBT_TOPICS.PRODUCT_DELETED;
  protected readonly logger = new Logger(FbtProductDeletedHandler.name);
}
