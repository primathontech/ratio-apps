import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';

@Injectable()
export class RpClientService {
  private readonly logger = new Logger(RpClientService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async registerMerchant(domain: string): Promise<void> {
    const token = this.config.get('RP_INTERNAL_API_TOKEN', { infer: true }) as string;
    const baseUrl = this.config.get('RP_BASE_URL', { infer: true }) as string;

    try {
      const res = await fetch(`${baseUrl}/api/internal/stores/register`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          store_url: domain,
          store_type: 'os',
          access_token: token,
        }),
      });

      if (!res.ok) {
        this.logger.error({ domain, status: res.status }, 'RP register call failed');
      }
    } catch (err) {
      this.logger.error({ domain, err }, 'RP register call threw');
    }
  }
}
