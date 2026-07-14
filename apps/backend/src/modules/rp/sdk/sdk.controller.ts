import { Controller, Get, Res } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyReply } from 'fastify';

const sdkPath = resolve(process.cwd(), '../../packages/rp-sdk/dist/rp-portal.js');

@Controller('rp/sdk')
export class RpSdkController {
  @Get('rp-portal.js')
  portalJs(@Res() reply: FastifyReply) {
    // Read fresh each request so a rebuilt SDK is served immediately (no stale cache).
    let content: string;
    try {
      content = readFileSync(sdkPath, 'utf-8');
    } catch {
      content = '// rp-sdk not built';
    }
    reply.header('Content-Type', 'application/javascript; charset=utf-8');
    reply.header('Cache-Control', 'no-cache');
    reply.send(content);
  }
}
