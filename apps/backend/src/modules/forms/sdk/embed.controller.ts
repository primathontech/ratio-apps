import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { FormIdPipe } from '../../../core/common/pipes/form-id.pipe';
import { FormsEmbedService } from './embed.service';

/**
 * Serves the drop-in iframe embed page:
 *   <iframe src="https://.../forms/embed/<formId>"></iframe>
 *
 * `FormIdPipe` validates `:formId` against the minted `form_<base64url>` shape
 * before any DB lookup (guards path-traversal / control chars / length).
 *
 * Sends raw HTML via the Fastify reply to bypass the global JSON
 * ResponseInterceptor (same technique as `FormsSdkController`).
 */
@Controller('forms/embed')
export class FormsEmbedController {
  constructor(private readonly embed: FormsEmbedService) {}

  @Get(':formId')
  async serve(
    @Param('formId', FormIdPipe) formId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // FRAMEABILITY: helmet's frameguard sets `X-Frame-Options: SAMEORIGIN`
    // globally (configure-app.ts leaves frameguard at its default), which would
    // block cross-site iframing. Remove it and open frame-ancestors for THIS
    // route only, so a merchant can embed the form into any existing page.
    // CSP is disabled globally, so this is the only policy on this response.
    reply.removeHeader('X-Frame-Options');
    reply.header('Content-Security-Policy', 'frame-ancestors *');
    reply.header('content-type', 'text/html; charset=utf-8');

    const form = await this.embed.resolve(formId);
    if (!form) {
      reply.status(404).send(this.embed.renderNotFound());
      return;
    }
    reply.send(this.embed.renderPage(formId, form));
  }
}
