/**
 * The computer-use task instruction that turns an approved booking proposal
 * into browser steps. Kept as a pure function so the wording — especially the
 * payment stop rule — is testable and lives in one place.
 *
 * The task runs on the session that produced the search: the results page is
 * already open on the desktop, and the offer is identified by the same
 * signature the extraction recorded, since card order can drift.
 */

import type { FlightOffer } from './types.js';
import { PAYMENT_STEP_MARKERS, SELECT_BUTTON_HINTS } from './selectors.js';

export interface BookingTaskRequest {
    offer: FlightOffer;
    passengers: number;
    resultsUrl?: string;
    /** Free-text note from the proposal, e.g. passenger names already known. */
    passengerNote?: string;
}

export function buildBookingTaskInstruction(request: BookingTaskRequest): string {
    const { offer, passengers, resultsUrl, passengerNote } = request;
    const route = [offer.originCode, offer.destinationCode].filter(Boolean).join(' → ') || 'the requested route';
    const identity = [
        offer.airlineName ? `airline ${offer.airlineName}` : '',
        offer.departAt ? `departing ${offer.departAt}` : '',
        offer.arriveAt ? `arriving ${offer.arriveAt}` : '',
        offer.priceDisplay ? `priced ${offer.priceDisplay}` : '',
        `offer #${offer.offerIndex + 1} on the results list`,
    ].filter(Boolean).join(', ');

    return [
        `Continue a FlightHub booking on the already-open results page${resultsUrl ? ` (${resultsUrl})` : ''}.`,
        `Select the flight itinerary for ${route}: ${identity}.`,
        `If the list has re-sorted, match by airline, times and price rather than position. Click its ${SELECT_BUTTON_HINTS.join(' / ')} button.`,
        `Continue through the fare-option and passenger-details steps for ${passengers} passenger${passengers === 1 ? '' : 's'}, choosing the standard/default fare unless the page requires a choice.`,
        passengerNote ? `Passenger details to use: ${passengerNote}.` : 'Leave passenger detail fields empty rather than inventing names or contact information.',
        `HARD STOP: as soon as the page asks for ${PAYMENT_STEP_MARKERS.slice(0, 3).join(', ')}, or any payment card field, call yield_to_user with a short explanation and do not type anything into those fields.`,
        'Never enter payment card, billing, or login credentials. If the site demands a login or shows a bot check, call yield_to_user and explain what the person must do.',
        'Do not click any final "Book", "Pay", "Purchase" or "Complete booking" button — the human finishes checkout.',
    ].join('\n');
}
