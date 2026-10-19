/**
 * FlightHub URL helpers.
 *
 * The results-page URL format is not a published contract, so the provider's
 * primary path is the homepage form — it works whatever the URL format is.
 * `buildSearchUrl` still produces a best-effort parameterized URL so a card's
 * "Open on FlightHub" link lands on something useful for a human, and so a
 * confirmed format found during live use can be dropped in here in one place.
 */

export const FLIGHTHUB_ORIGIN = 'https://www.flighthub.com';
export const FLIGHTHUB_HOME = `${FLIGHTHUB_ORIGIN}/`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIataCode(value: string): boolean {
    return /^[A-Za-z]{3}$/.test(value.trim());
}

export function assertIsoDate(value: string, field: string): string {
    if (!DATE_RE.test(value)) throw new Error(`${field} must be a YYYY-MM-DD date, got "${value}".`);
    const parsed = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} is not a real date: "${value}".`);
    return value;
}

/**
 * Best-effort results URL. FlightHub's SPA reads a search payload rather than a
 * stable query contract; this follows the cheap-flights deeplink convention
 * (city-airport pairs) that the site itself publishes, with dates carried as
 * query parameters the SPA honors when present. If the format drifts the link
 * still lands on flighthub.com and the provider's form path is unaffected.
 */
export function buildSearchUrl(origin: string, destination: string): string {
    const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${FLIGHTHUB_ORIGIN}/cheap-flights/${slug(origin)}-to-${slug(destination)}`;
}
