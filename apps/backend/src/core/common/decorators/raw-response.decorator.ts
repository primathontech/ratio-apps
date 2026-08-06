import { SetMetadata } from '@nestjs/common';

/** Reflector key checked by `ResponseInterceptor` to bypass the global envelope. */
export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * Opt a controller (or a single route) out of the global `ResponseInterceptor`
 * envelope. Use on inbound integration endpoints that must return a
 * third-party platform's own documented response contract unwrapped — e.g.
 * the Unicommerce-facing controllers, which return Unicommerce's flat
 * `{status, ...}` shape rather than Ratio's `{status_code, message, data}`
 * envelope.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
