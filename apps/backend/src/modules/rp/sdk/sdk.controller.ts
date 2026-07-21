import { Controller, Get, Res } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyReply } from 'fastify';

// Resolved from __dirname (this file's own compiled location), not process.cwd() —
// cwd depends on how the process is launched (e.g. PM2 starting it from the repo
// root vs from apps/backend), so a cwd-relative path silently breaks depending on
// deploy tooling even though the file exists on disk. __dirname is fixed at compile
// time: dist/apps/backend/src/modules/rp/sdk → up to repo root → packages/rp-sdk/dist.
const sdkPath = resolve(__dirname, '../../../../../../../../../packages/rp-sdk/dist/rp-portal.js');

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
    // Wildcard CORS: cross-origin <script type="module"> tags fetch in CORS mode, and this
    // is a public bundle with no secret — merchants must be able to load it from any domain.
    reply.header('Access-Control-Allow-Origin', '*');
    reply.send(content);
  }
}
