import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { FormIdPipe } from '../../../core/common/pipes/form-id.pipe';
import { FormsEmbedService } from './embed.service';

/** Serves the drop-in iframe embed page; FormIdPipe validates `:formId` before any DB lookup (guards path-traversal / control chars / length). */
@Controller('forms/embed')
export class FormsEmbedController {
  constructor(private readonly embed: FormsEmbedService) {}

  @Get(':formId')
  async serve(
    @Param('formId', FormIdPipe) formId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // FRAMEABILITY: drop the global X-Frame-Options and open frame-ancestors for THIS route only so merchants can embed the form cross-site.
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
