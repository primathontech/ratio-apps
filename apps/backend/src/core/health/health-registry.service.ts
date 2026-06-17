import { Injectable } from '@nestjs/common';
import type { HealthProbe } from './health-probe';

@Injectable()
export class HealthRegistry {
  private readonly probes: HealthProbe[] = [];
  private booted = false;

  register(probe: HealthProbe): void {
    if (this.probes.find((p) => p.name === probe.name)) {
      throw new Error(`HealthRegistry: probe '${probe.name}' is already registered`);
    }
    this.probes.push(probe);
  }

  list(): readonly HealthProbe[] {
    return this.probes;
  }

  /**
   * Called once by main.ts after `app.listen` resolves so /ready can
   * distinguish "in-flight bootstrap" (return 503) from "running" (run
   * the probes). Without this, /ready returns `{ status: 'ready',
   * checks: {} }` during the boot window if zero probes have registered
   * yet — orchestrators see "healthy" and route traffic to a half-booted pod.
   */
  markBooted(): void {
    this.booted = true;
  }

  isBooted(): boolean {
    return this.booted;
  }
}
