import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { raceWithTimeout } from '../common/race-with-timeout';
import { HealthRegistry } from './health-registry.service';

@Controller()
export class HealthController {
  constructor(private readonly registry: HealthRegistry) {}

  @Get('health')
  health(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  @Get('live')
  live(): { status: 'live' } {
    return { status: 'live' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ready'; checks: Record<string, 'ok' | 'fail'> }> {
    if (!this.registry.isBooted()) {
      // Shape the payload to match GlobalExceptionFilter's envelope contract
      // ({ message, error_code, details }) — otherwise the filter strips the
      // unknown keys and orchestrators can't tell "booting" from "broken".
      throw new ServiceUnavailableException({
        message: 'booting',
        error_code: 'BOOTING',
        details: { checks: {} },
        safeForClient: true,
      });
    }
    const probes = this.registry.list();
    const results: Record<string, 'ok' | 'fail'> = {};
    let allOk = true;
    await Promise.all(
      probes.map(async (p) => {
        try {
          await raceWithTimeout(p.check(), 1000, 'probe timeout');
          results[p.name] = 'ok';
        } catch {
          results[p.name] = 'fail';
          allOk = false;
        }
      }),
    );
    if (!allOk) {
      throw new ServiceUnavailableException({
        message: 'not_ready',
        error_code: 'NOT_READY',
        details: { checks: results },
        safeForClient: true,
      });
    }
    return { status: 'ready', checks: results };
  }
}
