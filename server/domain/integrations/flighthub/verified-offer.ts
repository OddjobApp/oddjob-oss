import { isFlightHubUrl } from '@shared/flighthub-links';
import type { FlightSearchParams, FlightSearchResult } from './types.js';

export interface FlightSnapshot extends FlightSearchResult { params: FlightSearchParams }

/** Only executed search evidence can identify a proposed itinerary. */
export function verifiedOffer(snapshot: FlightSnapshot | undefined, ref: string, maxTotal?: number) {
    if (!snapshot || !isFlightHubUrl(snapshot.resultsUrl)
        || !Number.isFinite(Date.parse(snapshot.searchedAt))
        || Date.now() - Date.parse(snapshot.searchedAt) > 15 * 60_000) {
        throw new Error('Flight results are missing or stale. Run a fresh search before proposing a booking.');
    }
    const offer = snapshot.offers.find(item => item.offerRef === ref && ref === `${item.offerIndex}:${item.signature}`);
    if (!offer) throw new Error('The selected offer was not returned by this search. Search again.');
    if (maxTotal != null) {
        if (!Number.isFinite(maxTotal) || maxTotal <= 0 || !offer.currency
            || !Number.isFinite(offer.priceAmount) || (offer.priceAmount ?? 0) <= 0) {
            throw new Error('A budget requires a verified positive fare and explicit currency.');
        }
        if (offer.priceAmount! > maxTotal) throw new Error('The displayed fare exceeds your budget ceiling.');
    }
    return offer;
}
