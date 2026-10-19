/**
 * Every FlightHub DOM assumption lives here. The site is a private SPA whose
 * markup changes without notice; when a selector set stops matching, fix it
 * here — the provider and tests never spell a selector themselves.
 *
 * Where several candidate selectors are listed, the provider tries them in
 * order and uses the first that matches anything.
 */

/** Home/landing page search form, tried in order for each field. */
export const FORM = {
    /** One-way vs round-trip toggles, matched by accessible text too. */
    oneWay: [
        'input[type="radio"][value*="one" i]',
        '[role="tab"]:has-text("One way"), [role="radio"]:has-text("One way")',
        'button:has-text("One way"), label:has-text("One way")',
    ],
    roundTrip: [
        'input[type="radio"][value*="round" i]',
        '[role="tab"]:has-text("Round"), [role="radio"]:has-text("Round")',
        'button:has-text("Round trip"), label:has-text("Round trip")',
    ],
    origin: [
        'input[name*="origin" i], input[id*="origin" i]',
        'input[placeholder*="from" i], input[aria-label*="from" i]',
    ],
    destination: [
        'input[name*="dest" i], input[id*="dest" i]',
        'input[placeholder*="to" i], input[aria-label*="to" i]',
    ],
    departDate: [
        'input[name*="depart" i], input[id*="depart" i]',
        'input[placeholder*="depart" i], input[aria-label*="depart" i]',
    ],
    returnDate: [
        'input[name*="return" i], input[id*="return" i]',
        'input[placeholder*="return" i], input[aria-label*="return" i]',
    ],
    travelers: [
        'button:has-text("Passenger"), button:has-text("Traveller"), button:has-text("Traveler")',
        '[aria-label*="passenger" i], [aria-label*="traveler" i], [aria-label*="traveller" i]',
    ],
    submit: [
        'button[type="submit"]:has-text("Search")',
        'button:has-text("Search flights"), button:has-text("Search")',
        '[role="button"]:has-text("Search")',
    ],
} as const;

/** A page that is a bot check rather than results. Matched against body text. */
export const CHALLENGE_MARKERS = [
    'verify you are human',
    'checking your browser',
    'verify your identity',
    'cloudflare',
    'unusual traffic',
    'press and hold',
    'are you a robot',
    'cf-challenge',
] as const;

/**
 * Candidate containers for one offer card on the results page, tried in order.
 * The extraction also reports how many each matched so a drift is diagnosable.
 */
export const RESULT_CARD_SELECTORS = [
    '[data-testid*="result" i], [data-testid*="itinerary" i], [data-testid*="offer" i]',
    '[class*="itinerary" i][class*="card" i], [class*="flight-card" i], [class*="flightCard" i]',
    '[class*="result-item" i], [class*="search-result" i]',
    // Last resort: any element that directly contains a price-looking span and a
    // select/book control — matches real cards and little else.
    'div:has(> * :has-text("$")):has(button:has-text("Select"))',
] as const;

/** Marker text on the checkout/payment step — the agent must stop here. */
export const PAYMENT_STEP_MARKERS = [
    'payment information',
    'billing information',
    'card number',
    'enter your card',
    'payment details',
] as const;

/** Element that selects an offer — the booking task clicks this. */
export const SELECT_BUTTON_HINTS = ['select', 'continue', 'book'] as const;

export const RESULTS_LOAD_TIMEOUT_MS = 60_000;
export const FORM_STEP_TIMEOUT_MS = 15_000;
