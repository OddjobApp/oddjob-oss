/** Normalized FlightHub search evidence. Approval prepares a human booking
 * link; no autonomous checkout task executes. */

export type FlightCabinClass = 'economy' | 'premium' | 'business' | 'first';
export type FlightTripType = 'oneway' | 'roundtrip';

export interface FlightSearchParams {
    /** Origin city or IATA code, e.g. "Toronto" or "YYZ". */
    origin: string;
    /** Destination city or IATA code, e.g. "Vancouver" or "YVR". */
    destination: string;
    /** Departure date, YYYY-MM-DD. */
    departDate: string;
    /** Return date for round trips, YYYY-MM-DD. */
    returnDate?: string;
    tripType: FlightTripType;
    adults: number;
    children: number;
    infants: number;
    cabinClass: FlightCabinClass;
    maxResults: number;
}

export interface FlightOffer {
    /**
     * Reference the booking proposal passes back, "index:signature" — the
     * index alone is fragile (results re-sort), so the signature lets the
     * booking task re-find this offer on a possibly-refreshed page.
     */
    offerRef: string;
    offerIndex: number;
    /** Short hash of route + times + airline + price — the offer's identity. */
    signature: string;
    airlineName?: string;
    flightNumbers?: string[];
    originCode?: string;
    destinationCode?: string;
    /** Display strings as shown on the site (local airport times, not ISO). */
    departAt?: string;
    arriveAt?: string;
    durationDisplay?: string;
    durationMinutes?: number;
    stops?: number;
    stopsDisplay?: string;
    cabinClass?: string;
    priceDisplay?: string;
    priceAmount?: number;
    currency?: string;
    /** Live URL of the results page the offer was extracted from. */
    bookingUrl?: string;
}

/**
 * A successful search always carries the session that produced it — booking a
 * selected offer continues on that same desktop session.
 */
export interface FlightSearchResult {
    provider: string;
    offers: FlightOffer[];
    sessionId: string;
    resultsUrl: string;
    searchedAt: string;
    warnings?: string[];
}

/**
 * FlightHub is showing a bot challenge ("verify you are human"). Not thrown:
 * the caller turns this into a handoff message — a human clears the challenge
 * once on the desktop and the search can be retried on the same session.
 */
export interface FlightBlockedResult {
    blocked: 'challenge';
    sessionId: string;
    pageUrl: string;
    detail: string;
}

export type FlightSearchOutcome = FlightSearchResult | FlightBlockedResult;

export function isFlightBlocked(result: FlightSearchOutcome): result is FlightBlockedResult {
    return (result as FlightBlockedResult).blocked === 'challenge';
}

export interface FlightSearchContext {
    organizationId: number;
    userId: string;
    /** Reuse an existing desktop session instead of opening a new one. */
    sessionId?: string;
}

export interface FlightProvider {
    id: string;
    search(params: FlightSearchParams, ctx: FlightSearchContext): Promise<FlightSearchOutcome>;
}
