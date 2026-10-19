/** A flight-search request must reach the browser tool, not a prose answer. */
export function isFlightSearchRequest(message: string): boolean {
    return /\b(?:flighthub|airport|iata)\b/i.test(message)
        || /\b(?:find|search|look\s*up|browse|compare|get|book|show)\b[^.!?\n]*\b(?:flights?|airfare|airline tickets?)\b/i.test(message)
        || /\bflights?\s+(?:from\s+)?[\w\s]+\bto\b/i.test(message);
}

export function flightDirective(message: string): string {
    if (!isFlightSearchRequest(message)) return '';
    return '\n\nFLIGHT SEARCH: Use flighthub_lookup_airports to source airport names and codes yourself from the local airport directory. No CSV download, user-supplied IATA codes or ontology setup is needed. ' +
        'The search also needs dates and passenger counts. Whatever it is missing — airports, dates, trip type, passengers — collect with request_human_input, a form the person answers inline in this room; do not ask in prose and never guess dates or airports. ' +
        'For ambiguous cities, put the named airport options in that form as a select and let the person pick; never silently pick an airport. ' +
        'Use flighthub_search_flights for actual fares only once origin, destination and dates are known — it runs in the organization’s managed desktop browser (computer use) in an isolated context. Use exactly roundtrip with a return date or oneway without one. ' +
        'If the tool fails, say what blocked it in one plain sentence — never paste its raw output or JSON. A bot check ("verify you are human") means a person must clear it once on the organization’s desktop (Admin → Settings → Computer Use → Open desktop), then retry; a desktop that is disabled or unreachable needs an org admin to enable Computer Use. ' +
        'A trip-type/page-layout failure concerns browser controls, not airport codes, ontology, dates or enum spelling. Do not claim that airport ingestion fixes it. Relay the actual failure. ' +
        'Do not invent fares or repeat the complete results card in prose. Propose only a selected saved offer using its session_id and offer_ref. ' +
        'Approval prepares a human booking link only; the person verifies the final fare and completes booking on FlightHub.';
}
