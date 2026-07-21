import { Injectable, Logger } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpTransformerService } from '../transformer/transformer.service';
import { RpIdMappingService } from '../id-mapping/id-mapping.service';

@Injectable()
export class RpProductsService {
  private readonly logger = new Logger(`RP:${RpProductsService.name}`);

  constructor(
    private readonly ratioClient: RpRatioClientService,
    private readonly transformer: RpTransformerService,
    private readonly idMapping: RpIdMappingService,
  ) {}

  async getProduct(merchantId: string, domain: string, productId: string): Promise<unknown> {
    // OS product IDs are > MAX_SAFE_INTEGER so we hash them (id-mapping/hash-id.ts) before
    // showing them to RP. RP sends the hashed id back — we must resolve it to the real OS
    // id before calling OS Item Service, which only knows the original id. Resolution reads
    // ratio-apps' own id-mapping table (populated by orders.service.ts, order-sync.service.ts,
    // and webhooks.service.ts whenever they mint a hash), never RP's own MongoDB.
    this.logger.log({ merchantId, domain, productId }, 'product lookup requested (possibly hashed id)');
    const resolvedId = (await this.idMapping.resolveRealId('product', productId)) ?? productId;
    this.logger.log(
      { productId, resolvedId, resolved: resolvedId !== productId },
      'resolved product id for OS lookup',
    );

    const raw = await this.ratioClient.getProduct(merchantId, domain, resolvedId) as Record<string, unknown>;
    const product = (raw?.product ?? raw?.data ?? raw) as Record<string, unknown>;
    const shaped = this.transformer.shopifyProduct(product);

    // If OS returned a real product, ensure its id in the response is the hashed
    // value RP expects (so RP's product cache stores and matches by the same id).
    if (shaped && typeof shaped === 'object' && resolvedId !== productId) {
      (shaped as Record<string, unknown>).id = Number(productId) || productId;
    }

    return { product: shaped };
  }
}
