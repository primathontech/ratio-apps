import { Injectable } from '@nestjs/common';

export type MappedStatus =
  | 'no_change' | 'fulfilled' | 'delivered' | 'return_in_progress' | 'returned'
  | 'return_pickup_scheduled' | 'restocked' | 'return_failed';

// Corrected against live Unicommerce documentation — the source PRD's
// forward-flow list was missing 7 real values (LOCATION_NOT_SERVICEABLE,
// PICKED, PENDING_CUSTOMIZATION, CUSTOMIZATION_COMPLETE, SPLITTED, MERGED,
// MANIFESTED). Every one of them is deliberately mapped to 'no_change' here,
// EXCEPT LOCATION_NOT_SERVICEABLE — flagged in the TRD as worth a Product
// call rather than silent logging, but shipped as 'no_change' until Product
// decides otherwise (see the dispatch controller's comment for why this
// isn't blocking).
const FORWARD_MAP: Record<string, MappedStatus> = {
  CREATED: 'no_change', LOCATION_NOT_SERVICEABLE: 'no_change', PICKING: 'no_change', PICKED: 'no_change',
  PENDING_CUSTOMIZATION: 'no_change', CUSTOMIZATION_COMPLETE: 'no_change', PACKED: 'no_change',
  READY_TO_SHIP: 'no_change', SPLITTED: 'no_change', MERGED: 'no_change', MANIFESTED: 'no_change',
  DISPATCHED: 'fulfilled', SHIPPED: 'fulfilled',
  DELIVERED: 'delivered',
  RETURN_EXPECTED: 'return_in_progress', RETURN_ACKNOWLEDGED: 'return_in_progress',
  RETURNED: 'returned',
};

const REVERSE_MAP: Record<string, MappedStatus> = {
  CREATED: 'return_pickup_scheduled',
  COURIER_ALLOCATED: 'return_pickup_scheduled',
  COMPLETE: 'restocked',
  NOT_RECEIVED: 'return_failed',
};

@Injectable()
export class UcStatusMappingService {
  map(ucStatus: string, isReverse: boolean): MappedStatus {
    const table = isReverse ? REVERSE_MAP : FORWARD_MAP;
    const mapped = table[ucStatus];
    if (!mapped) {
      throw new Error(`unrecognized Unicommerce status: ${ucStatus} (${isReverse ? 'reverse' : 'forward'})`);
    }
    return mapped;
  }
}
