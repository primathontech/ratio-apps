import { Controller, ForbiddenException, Get, Logger, Param, Query, Res } from '@nestjs/common';
import type { ProductIdType } from '@ratio-app/shared/constants/meta-events';
import type { FastifyReply } from 'fastify';
import { MerchantIdPipe } from '../../../core/common/pipes/merchant-id.pipe';
import { MetaConfigService } from '../config/config.service';
import { CatalogSourceService } from './catalog-source.service';
import { CatalogTransformerService } from './catalog-transformer.service';
import type { MetaProductDto } from './catalog.types';

/**
 * Public product feed (RSS 2.0 + g: namespace) that Meta pulls on a schedule.
 *   GET /meta/feed/:merchantId.xml?token=<feed_token>
 * Token-authenticated. STREAMS page-by-page (we hijack the raw response and
 * write each os-item page's items as we go) — bounded memory for any catalog
 * size. Prices are decimal here (paise/100).
 */
@Controller('meta/feed')
export class MetaFeedController {
  private readonly logger = new Logger(MetaFeedController.name);

  constructor(
    private readonly config: MetaConfigService,
    private readonly source: CatalogSourceService,
    private readonly transformer: CatalogTransformerService,
  ) {}

  @Get(':merchantId.xml')
  async feed(
    @Param('merchantId', MerchantIdPipe) merchantId: string,
    @Query('token') token: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const expected = await this.config.getFeedToken(merchantId);
    if (!expected || token !== expected) {
      throw new ForbiddenException({ message: 'invalid feed token', error_code: 'FEED_BAD_TOKEN' });
    }
    const cfg = await this.config.getCatalogConfig(merchantId);
    const productIdType: ProductIdType = cfg?.productIdType ?? 'product_id';
    const base = (process.env.RATIO_META_STOREFRONT_BASE_URL ?? 'https://storefront.example.com').replace(/\/+$/, '');

    reply.hijack(); // we own the raw response now
    const raw = reply.raw;
    raw.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
    raw.write('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n<title>Product Feed</title>\n');
    try {
      await this.source.eachPage(merchantId, async (products) => {
        const xml = products
          .flatMap((p) => this.transformer.transform(p, productIdType, base))
          .map((i) => this.item(i))
          .join('\n');
        if (xml) raw.write(`${xml}\n`);
      });
    } catch (err) {
      this.logger.error({ msg: 'feed stream error', merchantId, err });
    }
    raw.write('</channel>\n</rss>\n');
    raw.end();
  }

  private item(i: MetaProductDto): string {
    const price = `${(i.price / 100).toFixed(2)} ${i.currency}`;
    const parts = [
      `<g:id>${esc(i.retailerId)}</g:id>`,
      `<g:title>${esc(i.name)}</g:title>`,
      `<g:description>${esc(i.description)}</g:description>`,
      `<g:link>${esc(i.url)}</g:link>`,
      `<g:image_link>${esc(i.imageUrl)}</g:image_link>`,
      `<g:availability>${esc(i.availability)}</g:availability>`,
      `<g:condition>${esc(i.condition)}</g:condition>`,
      `<g:price>${esc(price)}</g:price>`,
      `<g:brand>${esc(i.brand)}</g:brand>`,
    ];
    if (i.salePrice !== undefined) parts.push(`<g:sale_price>${esc(`${(i.salePrice / 100).toFixed(2)} ${i.currency}`)}</g:sale_price>`);
    if (i.itemGroupId) parts.push(`<g:item_group_id>${esc(i.itemGroupId)}</g:item_group_id>`);
    if (i.productType) parts.push(`<g:product_type>${esc(i.productType)}</g:product_type>`);
    return `<item>${parts.join('')}</item>`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
