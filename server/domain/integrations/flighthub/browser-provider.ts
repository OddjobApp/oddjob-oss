import { setTripType } from './trip-control.js';
/** FlightHub search in a fresh isolated browser context. Search evidence is
 * saved by the capability; booking continues manually in the user's browser. */

import { isFlightHubUrl } from '@shared/flighthub-links';
import { createHash, randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { trycuaService } from '../trycua/trycua-service.js';

import type {
    FlightOffer,
    FlightProvider,
    FlightSearchContext,
    FlightSearchOutcome,
    FlightSearchParams,
} from './types.js';
import {
    CHALLENGE_MARKERS,
    FORM,
    FORM_STEP_TIMEOUT_MS,
    RESULTS_LOAD_TIMEOUT_MS,
    RESULT_CARD_SELECTORS,
} from './selectors.js';
import { FLIGHTHUB_HOME, assertIsoDate, buildSearchUrl, isIataCode } from './search-url.js';



interface RawOffer {
    index: number;
    text: string;
    href?: string;
}

/**
 * In-page card reader. Runs as one evaluate — per-element CDP round trips are
 * the reason extraction here is text-first: every known card layout puts
 * times, route, stops, duration and price in its innerText, so parsing that
 * text survives a class-name redesign better than nested selectors do.
 */
const READ_OFFERS = `(cards) => cards.map((el, index) => ({
    index,
    text: (el.innerText || '').trim().slice(0, 4000),
    href: el.querySelector('a[href]')?.href || el.closest('a[href]')?.href || undefined,
}))`;

async function firstVisible(page: Page, selectors: readonly string[], timeoutMs = FORM_STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            if (await locator.count() && await locator.isVisible().catch(() => false)) return locator;
        }
        await page.waitForTimeout(300);
    }
    return null;
}

async function pageIsChallenge(page: Page): Promise<boolean> {
    const body = await page.evaluate(() => ((document.body as HTMLElement | null)?.innerText ?? '').slice(0, 20000)).catch(() => '');
    const lower = body.toLowerCase();
    return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

/** Type a value and take the autocomplete suggestion the site shows for it. */
async function fillAutocomplete(page: Page, selectors: readonly string[], value: string, field: string) {
    const input = await firstVisible(page, selectors);
    if (!input) throw new Error(`the ${field} field could not be found`);
    await input.click();
    await input.fill('');
    await input.type(value, { delay: 60 });
    // Airport pickers list suggestions; choosing one is what commits the field.
    const suggestion = await firstVisible(page, [
        '[role="option"]:visible',
        '[role="listbox"] li:visible',
        '[class*="suggestion" i] li:visible, [class*="suggestion" i] div:visible',
        '[class*="autocomplete" i] [role="option"]:visible',
    ], 8_000);
    if (suggestion) {

        // Prefer a suggestion that mentions the typed code/city over the first.
        const choices = page.locator('[role="option"]:visible, [role="listbox"] li:visible');
        const count = await choices.count().catch(() => 0);
        let picked = false;
        for (let i = 0; i < count; i++) {
            const option = choices.nth(i);
            const optionText = (await option.innerText().catch(() => '')) || '';
            if (optionText.toLowerCase().includes(value.trim().toLowerCase())) {
                await option.click();
                picked = true;
                break;
            }
        }
        if (!picked) throw new Error(`No matching ${field} suggestion could be verified.`);
    } else {
        throw new Error(`No ${field} airport suggestion could be verified.`);
    }
}

/**
 * Set a date field. Text inputs take the ISO value directly; calendar popups
 * take a click on the day cell. Either way the value is verified afterwards —
 * a date the picker refused is reported rather than silently wrong.
 */
async function setDateField(page: Page, selectors: readonly string[], isoDate: string, field: string) {
    const input = await firstVisible(page, selectors);
    if (!input) throw new Error(`the ${field} field could not be found`);
    await input.click();
    const editable = await input.evaluate((el) => !(el as HTMLInputElement).readOnly && !(el as HTMLInputElement).disabled).catch(() => false);
    if (editable) {
        await input.fill(isoDate);
        const value = await input.evaluate((el) => (el as HTMLInputElement).value).catch(() => '');
        if (value === isoDate) return;
    }
    const cell = await firstVisible(page, [
        `[data-day="${isoDate}"], [data-date="${isoDate}"]`,
    ], 8_000);
    if (!cell) throw new Error(`Cannot safely select ${isoDate}: no exact date control is available.`);
    await cell.click();
    const value = await input.inputValue().catch(() => '');
    if (value !== isoDate) throw new Error(`Cannot verify the ${field} value. Select it manually before retrying.`);
}

async function runSearch(page: Page, params: FlightSearchParams): Promise<void> {
    await setTripType(page, params.tripType);

    await fillAutocomplete(page, FORM.origin, params.origin, 'origin');
    await fillAutocomplete(page, FORM.destination, params.destination, 'destination');
    await setDateField(page, FORM.departDate, params.departDate, 'departure date');
    if (params.tripType === 'roundtrip') {
        if (!params.returnDate) throw new Error('a round-trip search needs a return date');
        await setDateField(page, FORM.returnDate, params.returnDate, 'return date');
    }

    const travelers = await firstVisible(page, FORM.travelers, 2_000);
    if (travelers) await travelers.click();
    for (const [field, count] of [['adults', params.adults], ['children', params.children], ['infants', params.infants]] as const) {
        const control = await firstVisible(page, [`input[name="${field}" i], select[name="${field}" i]`], 2_000);
        if (!control) throw new Error(`Cannot verify ${field}; the passenger controls need manual setup.`);
        if (await control.evaluate(el => el.tagName === 'SELECT')) await control.selectOption(String(count));
        else await control.fill(String(count));
        if (await control.inputValue() !== String(count)) throw new Error(`Could not set ${field}.`);
    }
    const cabin = await firstVisible(page, ['select[name*="cabin" i], select[name*="class" i]'], 2_000);
    if (!cabin) throw new Error('Cannot verify the requested cabin class; configure it manually.');
    await cabin.selectOption({ label: params.cabinClass === 'premium' ? 'Premium Economy' : params.cabinClass[0].toUpperCase() + params.cabinClass.slice(1) });
    const submit = await firstVisible(page, FORM.submit, 8_000);
    if (!submit) throw new Error('the search button could not be found');
    await submit.click();
}

/** Parse the card text into offer fields. Pure heuristics — see READ_OFFERS. */
export function parseOffer(raw: RawOffer, resultsUrl: string): FlightOffer | null {
    const text = raw.text;
    if (!text || text.length < 10) return null;

    const priceMatch = text.match(/(?:[$€£]|CA\$|US\$)\s?\d[\d,]*(?:\.\d{2})?/);
    const timeMatches = text.match(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)\b/gi) ?? [];
    const codeMatches = text.match(/\b[A-Z]{3}\b/g) ?? [];
    const durationMatch = text.match(/\b\d+\s*h(?:ou)?rs?\s*\d*\s*m?(?:in)?\b|\b\d+h\s*\d+m\b/i);
    const stopsMatch = text.match(/\b(non-?stop|direct|\d+\s*stops?)\b/i);
    const flightNoMatches = text.match(/\b[A-Z]{2}\s?\d{3,4}\b/g) ?? [];

    // A card with no price and no times is not an offer — filter railings,
    // banners, "sort by" headers that shared a container selector.
    if (!priceMatch && timeMatches.length < 2) return null;

    const amount = priceMatch ? Number(priceMatch[0].replace(/[^\d.]/g, '')) : undefined;
    const currency = priceMatch ? (priceMatch[0].includes('€') ? 'EUR' : priceMatch[0].includes('£') ? 'GBP' : priceMatch[0].startsWith('CA$') ? 'CAD' : priceMatch[0].startsWith('US$') ? 'USD' : undefined) : undefined;
    const airline = text.split('\n').map((line) => line.trim()).find((line) =>
        line.length > 2 && line.length < 40 && !/[$€£]|\d{1,2}:\d{2}|\b[A-Z]{3}\b|stop|seat|bag/i.test(line));

    const signature = createHash('sha256')
        .update(`${codeMatches[0] ?? ''}|${codeMatches[1] ?? ''}|${timeMatches[0] ?? ''}|${timeMatches[1] ?? ''}|${airline ?? ''}|${priceMatch?.[0] ?? ''}`)
        .digest('hex')
        .slice(0, 12);

    const stopsRaw = stopsMatch?.[1]?.toLowerCase() ?? '';
    const stops = /non|direct/.test(stopsRaw) ? 0 : (Number.parseInt(stopsRaw, 10) || undefined);
    const durationMinutes = (() => {
        const m = durationMatch?.[0]?.match(/(\d+)\s*h\w*\s*(\d*)/i);
        return m ? Number(m[1]) * 60 + (Number(m[2]) || 0) : undefined;
    })();

    return {
        offerRef: `${raw.index}:${signature}`,
        offerIndex: raw.index,
        signature,
        airlineName: airline || undefined,
        flightNumbers: [...new Set(flightNoMatches)].slice(0, 4),
        originCode: codeMatches[0],
        destinationCode: codeMatches[1],
        departAt: timeMatches[0]?.replace(/\s+/g, ' ').trim(),
        arriveAt: timeMatches[1]?.replace(/\s+/g, ' ').trim(),
        durationDisplay: durationMatch?.[0],
        durationMinutes,
        stops,
        stopsDisplay: stopsMatch?.[1],
        priceDisplay: priceMatch?.[0],
        priceAmount: Number.isFinite(amount) ? amount : undefined,
        currency,
        bookingUrl: isFlightHubUrl(raw.href) ? raw.href : resultsUrl,
    };
}

async function readOffers(page: Page, maxResults: number, resultsUrl: string): Promise<{ offers: FlightOffer[]; matchedBy: string | null }> {
    let matchedBy: string | null = null;
    let raw: RawOffer[] = [];
    for (const selector of RESULT_CARD_SELECTORS) {
        const count = await page.locator(selector).count().catch(() => 0);
        if (!count) continue;
        raw = await page.locator(selector).evaluateAll(READ_OFFERS) as RawOffer[];
        matchedBy = selector;
        break;
    }
    const offers = raw
        .map((entry) => parseOffer(entry, resultsUrl))
        .filter((offer): offer is FlightOffer => offer !== null)
        .slice(0, maxResults);
    return { offers, matchedBy };
}

export class FlightHubBrowserProvider implements FlightProvider {
    readonly id = 'flighthub_browser';

    async search(params: FlightSearchParams, ctx: FlightSearchContext): Promise<FlightSearchOutcome> {
        assertIsoDate(params.departDate, 'depart_date');
        if (params.returnDate) assertIsoDate(params.returnDate, 'return_date');
        if (params.tripType === 'roundtrip' && !params.returnDate) {
            throw new Error('A round-trip search needs a return_date.');
        }

        if (params.returnDate && params.returnDate < params.departDate) throw new Error('Return date precedes departure.');
        if (params.adults + params.children + params.infants > 9 || params.infants > params.adults) throw new Error('Invalid passenger combination.');

        // Prerequisites before a session is minted: a disabled organization or a
        // desktop whose browser never comes up fails fast here instead of
        // leaving an orphaned session row behind every attempt.
        await trycuaService.assertEnabled(ctx.organizationId);

        const { orgDesktopService } = await import('../trycua/org-desktop.service.js');
        const { connectDesktopBrowser } = await import('../trycua/skill-recorder.js');
        const cdpHost = await orgDesktopService.ensureBrowser(ctx.organizationId).catch(() => undefined);
        if (!cdpHost) {
            throw new Error('FlightHub search needs the organization’s managed desktop (computer use) with its browser reachable. The desktop did not come up — check that Docker is running, or open the desktop from Settings → Computer Use, then retry.');
        }

        const session = ctx.sessionId
            ? await this.resumeSession(ctx.sessionId, ctx.organizationId, ctx.userId)
            : await trycuaService.createSession({ organizationId: ctx.organizationId, userId: ctx.userId });

        const browser = await connectDesktopBrowser(cdpHost);
        const isolated = await browser.newContext();
        try {
            const page = await isolated.newPage();
            await page.goto(FLIGHTHUB_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 });

            if (await pageIsChallenge(page)) {
                return {
                    blocked: 'challenge',
                    sessionId: session.id,
                    pageUrl: page.url(),
                    detail: 'FlightHub is showing a bot check on the desktop browser. A person can clear it once on the computer-use desktop — the profile keeps the clearance — then the search can be retried.',
                };
            }

            await runSearch(page, params);

            // Results stream in: wait for the first card selector to match, and
            // re-check for a challenge the submission may have triggered.
            const deadline = Date.now() + RESULTS_LOAD_TIMEOUT_MS;
            let result: { offers: FlightOffer[]; matchedBy: string | null } = { offers: [], matchedBy: null };
            while (Date.now() < deadline) {
                if (await pageIsChallenge(page)) {
                    return {
                        blocked: 'challenge',
                        sessionId: session.id,
                        pageUrl: page.url(),
                        detail: 'FlightHub answered the search with a bot check. Open FlightHub in your own browser to continue manually.',
                    };
                }
                result = await readOffers(page, params.maxResults, page.url());
                if (result.offers.length) break;
                await page.waitForTimeout(1_500);
            }

            if (!result.offers.length) {
                throw new Error(
                    `FlightHub loaded but no offer cards could be read${result.matchedBy ? ` (matched "${result.matchedBy}", none parsed as offers)` : ' (no result-card selector matched)'}. ` +
                    `The site may have changed markup, or the results may still be loading — retry, or check the desktop session ${session.id}.`,
                );
            }

            const searchNonce = randomUUID();
            const offers = result.offers.map(offer => {
                const signature = createHash('sha256').update(JSON.stringify({ params, identity: offer.signature, searchNonce })).digest('hex').slice(0, 24);
                return { ...offer, cabinClass: params.cabinClass, signature, offerRef: `${offer.offerIndex}:${signature}` };
            });
            return {
                provider: this.id,
                offers,
                sessionId: session.id,
                resultsUrl: page.url(),
                searchedAt: new Date().toISOString(),
                warnings: [
                    'Prices and availability are indicative — the live fare is shown again at checkout.',
                    ...(isIataCode(params.origin) && isIataCode(params.destination) ? [] : ['Airport codes were inferred from typed names — verify the route on the card.']),
                ],
            };
        } finally {
            // Close isolated cookies and tabs before disconnecting CDP.
            await isolated.close().catch(() => undefined);
            await browser.close().catch(() => undefined);
        }
    }

    private async resumeSession(sessionId: string, organizationId: number, userId: string) {
        const session = await trycuaService.getSession(sessionId, organizationId);
        if (session.userId !== userId) throw new Error('Trycua session does not belong to this user');
        if (session.expiresAt.getTime() <= Date.now()) throw new Error('Search session expired. Run a new search.');
        if (session.status !== 'active') throw new Error(`Trycua session is ${session.status} — run a new flight search.`);
        return session;
    }
}

export const flightHubBrowserProvider = new FlightHubBrowserProvider();
export { buildSearchUrl };
