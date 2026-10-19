/**
 * resolveFlightProvider — which flight source this organization uses.
 *
 * Today there is exactly one: the org's sandboxed desktop browser driving
 * flighthub.com. The indirection exists so an official FlightHub/partner API
 * (via an org credential with metadata.provider naming it) can slot in without
 * touching the capability layer — the same seam the Amazon resolver uses.
 */

import { flightHubBrowserProvider } from './browser-provider.js';
import type { FlightProvider } from './types.js';

export interface ResolvedFlight {
    provider: FlightProvider;
    providerId: 'flighthub_browser';
}

export async function resolveFlightProvider(_organizationId: number): Promise<ResolvedFlight | null> {
    // Browser search needs no credential — the org desktop is the channel.
    // Organization settings (trycuaEnabled) gate session creation downstream.
    return { provider: flightHubBrowserProvider, providerId: 'flighthub_browser' };
}
