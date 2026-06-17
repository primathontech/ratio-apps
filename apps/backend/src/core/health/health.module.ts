import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthRegistry } from './health-registry.service';

@Global()
@Module({
  controllers: [HealthController],
  providers: [HealthRegistry],
  exports: [HealthRegistry],
})
export class HealthModule {}
