import { Injectable, Logger } from '@nestjs/common';
import { DELHIVERY_CARRIER } from '@ratio-app/shared/constants/delhivery-events';
import { DelhiverySdkService } from '../sdk/sdk.service';

/** The checkout-facing serviceability contract (GoKwik Checkout consumes this). */
export interface ServiceabilityResult {
  serviceable: boolean;
  cod_available: boolean;
  edd_min: number;
  edd_max: number;
  /** True when edd_min/edd_max are a generic estimate, not a carrier per-lane value (see EDD const). */
  edd_estimated: boolean;
  carrier: string;
  /** True when Delhivery was unreachable and we failed OPEN with generic EDD. */
  degraded?: boolean;
}

/** 6 hours, per the PRD's serviceability cache requirement. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Short TTL for a serviceable pincode whose real EDD couldn't be fetched (TAT
// lookup failed → generic estimate). A full 6h cache here would freeze the
// estimate for hours after the TAT API recovers; a short TTL lets the real
// per-lane EDD repopulate promptly without hammering the TAT API per request.
const ESTIMATE_TTL_MS = 10 * 60 * 1000;
// Fallback EDD band (days). Real per-lane EDD comes from Delhivery's Expected
// TAT API (sdk.expectedTatBand → edd_estimated:false). This generic estimate is
// used only when no pickup pincode is configured or the TAT lookup fails, and
// on the fail-open path when serviceability itself is degraded.
const EDD = { min: 2, max: 5 } as const;
const EDD_DEGRADED = { min: 3, max: 7 } as const;

/**
 * Pincode serviceability with a 6h in-process cache, keyed per
 * `(merchant, pincode)`. Fails OPEN: checkout must never lose an order
 * because the carrier API hiccuped — a Delhivery outage yields
 * `serviceable: true` with a generic EDD (and is NOT cached, so recovery
 * is immediate).
 */
@Injectable()
export class DelhiveryServiceabilityService {
  private readonly logger = new Logger(DelhiveryServiceabilityService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: ServiceabilityResult }>();

  constructor(private readonly sdk: DelhiverySdkService) {}

  async check(merchantId: string, pincode: string): Promise<ServiceabilityResult> {
    const key = `${merchantId}:${pincode}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() < hit.expiresAt) return hit.value;

    try {
      const raw = await this.sdk.checkServiceability(merchantId, pincode);
      // Real per-lane EDD from the Expected TAT API when available; otherwise a
      // generic estimate. Only worth querying for a serviceable pincode.
      let eddMin: number = EDD.min;
      let eddMax: number = EDD.max;
      let eddEstimated = true;
      if (raw.serviceable) {
        const band = await this.sdk.expectedTatBand(merchantId, pincode);
        if (band) {
          eddMin = band.min;
          eddMax = band.max;
          eddEstimated = false;
        }
      }
      const value: ServiceabilityResult = {
        serviceable: raw.serviceable,
        cod_available: raw.serviceable && raw.codAvailable,
        edd_min: eddMin,
        edd_max: eddMax,
        edd_estimated: eddEstimated,
        carrier: DELHIVERY_CARRIER,
      };
      // Serviceable-but-estimated (TAT lookup failed) gets the short TTL so a
      // recovered TAT API repopulates the real EDD soon; everything else (real
      // EDD, or a settled not-serviceable verdict) keeps the full 6h.
      const ttl = raw.serviceable && eddEstimated ? ESTIMATE_TTL_MS : CACHE_TTL_MS;
      this.cache.set(key, { expiresAt: Date.now() + ttl, value });
      return value;
    } catch (err) {
      this.logger.warn({ msg: 'serviceability degraded — failing open', pincode, err: `${err}` });
      return {
        serviceable: true,
        cod_available: true,
        edd_min: EDD_DEGRADED.min,
        edd_max: EDD_DEGRADED.max,
        edd_estimated: true,
        carrier: DELHIVERY_CARRIER,
        degraded: true,
      };
    }
  }
}
