import { AIRPORT_SOURCE, AIRPORT_SNAPSHOT_DATE, lookupAirports, resolveAirport } from '@domain/integrations/flighthub/airport-directory.js';
/** Isolated flight search, verified offer proposals and human booking handoff. */

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ToolContext, ToolDefinition } from './types.js';
import { resolveFlightProvider } from '@domain/integrations/flighthub/resolver.js';
import { verifiedOffer, type FlightSnapshot } from '@domain/integrations/flighthub/verified-offer.js';
import { buildSearchUrl } from '@domain/integrations/flighthub/search-url.js';
import { isFlightBlocked, type FlightOffer } from '@domain/integrations/flighthub/types.js';


const GUARDRAILS = [
    'Search uses an isolated browser context without shared desktop cookies.',
    'Only offers saved from an executed search can be proposed. Results expire after 15 minutes.',
    'Approval prepares a FlightHub link for the human. It never starts an autonomous booking or purchases tickets.',
    'Displayed prices are indicative; the human must verify the final total and currency on FlightHub.',
];

const cabinClassSchema = z.enum(['economy', 'premium', 'business', 'first']);

const searchSchema = z.object({
    origin: z.string().min(2).max(100).describe('Origin city name or IATA airport code, e.g. "Toronto" or "YYZ"'),
    destination: z.string().min(2).max(100).describe('Destination city name or IATA airport code, e.g. "Vancouver" or "YVR"'),
    depart_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').describe('Departure date'),
    return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').optional().describe('Return date — required for round trips'),
    trip_type: z.enum(['oneway', 'roundtrip']).default('roundtrip'),
    adults: z.number().int().min(1).max(9).default(1),
    children: z.number().int().min(0).max(8).default(0),
    infants: z.number().int().min(0).max(8).default(0),
    cabin_class: cabinClassSchema.default('economy'),
    max_results: z.number().int().min(1).max(10).default(8),
    session_id: z.string().uuid().optional().describe('Reuse the desktop session from a previous flighthub_search_flights result instead of opening a new one'),
});

const proposeSchema = z.object({
    session_id: z.string().uuid().describe('The trycua session that produced the results card'),
    offer_ref: z.string().min(1).max(200).describe('The selected offer’s offerRef ("index:signature") from the results card'),
    offer_index: z.number().int().min(0).optional().describe('The offer’s index on the results list, if known'),
    itinerary: z.string().min(1).max(500).optional().describe('One-line itinerary summary, e.g. "YYZ → YVR · Air Canada · dep 6:00 AM arr 9:15 AM"'),
    origin_code: z.string().regex(/^[A-Z]{3}$/i).optional().describe('Origin IATA code from the offer'),
    destination_code: z.string().regex(/^[A-Z]{3}$/i).optional().describe('Destination IATA code from the offer'),
    airline: z.string().max(100).optional(),
    depart_at: z.string().max(40).optional().describe('Departure time as shown on the card, e.g. "6:00 AM"'),
    arrive_at: z.string().max(40).optional().describe('Arrival time as shown on the card'),
    price_display: z.string().max(60).optional().describe('The fare shown on the card, e.g. "$298"'),
    passengers: z.number().int().min(1).max(9).default(1),
    passenger_note: z.string().max(1000).optional().describe('Passenger details the person supplied for form filling — never payment data'),
    results_url: z.string().url().optional().describe('The results page URL from the search, for the booking task to return to'),
    max_total: z.number().positive().optional().describe('Budget ceiling in the fare’s currency — the approval reports if the checkout total visibly exceeds it'),
    reason: z.string().max(1000).optional(),
});

const statusSchema = z.object({
    task_id: z.string().uuid().describe('The booking computer-use task id'),
});

function requireOrg(context: ToolContext): number {
    if (context.organizationId == null) throw new Error('FlightHub tools need an organization context.');
    return context.organizationId;
}

function requireUser(context: ToolContext): string {
    if (!context.userId) throw new Error('FlightHub tools need a user context — the desktop session belongs to a person.');
    return String(context.userId);
}

/** Present an offer the way the results card and the approval card read it. */
function presentOffer(offer: FlightOffer) {
    const route = [offer.originCode, offer.destinationCode].filter(Boolean).join(' → ');
    return {
        ...offer,
        title: [route, offer.airlineName].filter(Boolean).join(' · ') || offer.offerRef,
    };
}

async function flighthub(context: ToolContext) {
    const organizationId = requireOrg(context);
    const resolved = await resolveFlightProvider(organizationId);
    if (!resolved) {
        throw new Error('FlightHub is not configured for this organization.');
    }
    return resolved;
}

async function proposeBooking(args: unknown, context: ToolContext) {
    const p = proposeSchema.parse(args);
    const organizationId = requireOrg(context);
    const userId = requireUser(context);

    const { trycuaService } = await import('@domain/integrations/trycua/trycua-service.js');
    const session = await trycuaService.getSession(p.session_id, organizationId);
    if (session.userId !== userId) {
        throw new Error('That desktop session belongs to another user — run the flight search again under your own session.');
    }
    if (session.status !== 'active') {
        throw new Error(`The search session is ${session.status} — run flighthub_search_flights again before proposing a booking.`);
    }
    if (session.expiresAt.getTime() <= Date.now()) {
        throw new Error('The search session has expired — run flighthub_search_flights again so the results page is fresh.');
    }

    const snapshot = (session.metadata as { flighthubSearch?: FlightSnapshot } | null)?.flighthubSearch;
    const offer = verifiedOffer(snapshot, p.offer_ref, p.max_total);
    const itinerary = [offer.originCode, offer.destinationCode, offer.airlineName, offer.departAt, offer.arriveAt].filter(Boolean).join(' · ');
    const passengers = snapshot!.params.adults + snapshot!.params.children + snapshot!.params.infants;
    const meta = {
        type: 'approval_request',
        kind: 'flighthub_booking',
        actionName: 'flighthub_booking',
        args: {
            sessionId: p.session_id,
            sessionOwnerUserId: userId,
            offerRef: offer.offerRef,
            offerIndex: offer.offerIndex,
            itinerary,
            originCode: offer.originCode ?? null,
            destinationCode: offer.destinationCode ?? null,
            airline: offer.airlineName ?? null,
            departAt: offer.departAt ?? null,
            arriveAt: offer.arriveAt ?? null,
            priceDisplay: offer.priceDisplay ?? null,
            passengers,
            passengerNote: p.passenger_note ?? null,
            resultsUrl: snapshot!.resultsUrl,
            currency: offer.currency ?? null,
            priceAmount: offer.priceAmount ?? null,
            ...(p.max_total != null ? { max_total: p.max_total } : {}),
        },
        title: `FlightHub booking — ${itinerary}`,
        reason: p.reason ?? 'Prepare the selected FlightHub results link for you to review and book manually.',
        projectId: context.projectId ?? null,
        sessionKey: context.sessionKey ?? null,
        status: 'pending',
    };

    const { db } = await import('@server/database_service.js');
    const { approvalRequests } = await import('@shared/schema/index.js');
    const [row] = await db.insert(approvalRequests).values({
        executionId: `flighthub_${randomBytes(16).toString('hex')}`,
        toolName: 'flighthub_propose_booking',
        toolArgs: meta,
        organizationId,
        approverType: 'user',
        approverEmail: userId,
        ...(/^[0-9a-f-]{36}$/i.test(userId) ? { approverId: userId } : {}),
        token: randomBytes(24).toString('hex'),
        status: 'pending',
    }).returning({ id: approvalRequests.id });
    if (!row) throw new Error('The booking proposal could not be saved.');
    return JSON.stringify({ ...meta, proposalId: row.id, message: 'Pending approval; nothing has been booked.' });
}

/** Approval only returns a validated human handoff; no computer-use task runs. */
export async function executeFlightHubBookingApproval(action: string, args: unknown, context: ToolContext) {
    if (action !== 'flighthub_booking') throw new Error('Unsupported FlightHub action.');
    const parsed = (args ?? {}) as {
        sessionId?: unknown; sessionOwnerUserId?: unknown; offerRef?: unknown; offerIndex?: unknown;
        itinerary?: unknown; originCode?: unknown; destinationCode?: unknown; airline?: unknown;
        departAt?: unknown; arriveAt?: unknown; priceDisplay?: unknown; passengers?: unknown;
        passengerNote?: unknown; resultsUrl?: unknown; max_total?: unknown;
    };
    const organizationId = requireOrg(context);
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : '';
    const sessionOwnerUserId = typeof parsed.sessionOwnerUserId === 'string' ? parsed.sessionOwnerUserId : '';
    if (!sessionId || !sessionOwnerUserId) {
        throw new Error('This booking proposal is missing its desktop session — re-run the flight search.');
    }

    const { trycuaService } = await import('@domain/integrations/trycua/trycua-service.js');
    const session = await trycuaService.getSession(sessionId, organizationId).catch(() => null);
    if (!session) throw new Error('The search session no longer exists — re-run the flight search for a fresh results page.');
    if (requireUser(context) !== sessionOwnerUserId || session.userId !== sessionOwnerUserId) {
        throw new Error('The stored session does not belong to the user who proposed this booking.');
    }
    if (session.status !== 'active' || session.expiresAt.getTime() <= Date.now()) {
        throw new Error(`The search session is ${session.status === 'active' ? 'expired' : session.status} — re-run the flight search and approve a fresh proposal.`);
    }

    const snapshot = (session.metadata as { flighthubSearch?: FlightSnapshot } | null)?.flighthubSearch;
    const offer = verifiedOffer(snapshot, typeof parsed.offerRef === 'string' ? parsed.offerRef : '',
        typeof parsed.max_total === 'number' ? parsed.max_total : undefined);
    return {
        sessionId,
        status: 'ready_for_human',
        checkoutUrl: snapshot!.resultsUrl,
        itinerary: [offer.originCode, offer.destinationCode, offer.airlineName, offer.departAt].filter(Boolean).join(' · '),
        priceDisplay: offer.priceDisplay,
        currency: offer.currency,
        maxTotal: parsed.max_total ?? null,
        handoff: 'human_booking',
        note: 'Open FlightHub, locate this itinerary, and verify the final total and currency before booking. No automated booking or purchase has run.',
    };
}

export const FLIGHTHUB_TOOLS: Record<string, ToolDefinition> = {
    flighthub_lookup_airports: {
        name: 'flighthub_lookup_airports', label: 'Find airport codes', group: 'Travel',
        idempotency: 'read-safe', riskLevel: 'low',
        description: 'Resolve city, airport name or IATA code using the bundled OurAirports directory. Returns actual airport names and codes, including multiple airports for ambiguous cities. No CSV upload, ontology setup, AI inference or credentials required. Ask for airport preference only when multiple relevant airports match.',
        parameters: z.object({ query: z.string().min(2).max(100), country: z.string().length(2).optional(), max_results: z.number().int().min(1).max(30).default(12) }),
        execute: async (p) => JSON.stringify({ airports: lookupAirports(p.query, p.country, p.max_results), source: AIRPORT_SOURCE, snapshotDate: AIRPORT_SNAPSHOT_DATE }),
    },
    flighthub_get_offer: {
        name: 'flighthub_get_offer', label: 'Read selected FlightHub offer', group: 'Travel',
        idempotency: 'read-safe', riskLevel: 'low',
        description: 'Read a saved executed search offer, scoped to the requesting user. This is indicative search evidence, not a new live fare check.',
        parameters: z.object({ session_id: z.string().uuid(), offer_ref: z.string().min(1).max(200) }),
        execute: async (p, context) => {
            const { trycuaService } = await import('@domain/integrations/trycua/trycua-service.js');
            const session = await trycuaService.getSession(p.session_id, requireOrg(context));
            if (session.userId !== requireUser(context)) throw new Error('Offer not found for this user.');
            if (session.status !== 'active' || session.expiresAt.getTime() <= Date.now()) throw new Error('Search session expired. Search again.');
            const snapshot = (session.metadata as { flighthubSearch?: FlightSnapshot } | null)?.flighthubSearch;
            return JSON.stringify({ offer: verifiedOffer(snapshot, p.offer_ref), params: snapshot!.params, searchedAt: snapshot!.searchedAt, resultsUrl: snapshot!.resultsUrl, sessionId: session.id });
        },
    },
    flighthub_search_flights: {
        name: 'flighthub_search_flights',
        label: 'Search FlightHub flights',
        group: 'Travel',
        idempotency: 'read-safe',
        riskLevel: 'medium',
        timeoutMs: 180_000,
        guardrails: GUARDRAILS,
        description:
            'Search FlightHub for flights in the organization’s real desktop browser (trycua). ' +
            'Returns normalized offers — route, airline, times, duration, stops, cabin, price — each ' +
            'carrying an offerRef, plus the sessionId and resultsUrl of the live results page. The ' +
            'saved search evidence lets flighthub_propose_booking prepare a human handoff. Fares ' +
            'are indicative until checkout.',
        parameters: searchSchema,
        execute: async (p, context) => {
            const origin = resolveAirport(p.origin);
            const destination = resolveAirport(p.destination);
            if (!origin.airport || !destination.airport) {
                return JSON.stringify({
                    error: 'Airport selection needed before flight search.',
                    code: 'airport_selection_required',
                    origin: { query: p.origin, airport: origin.airport, options: origin.options },
                    destination: { query: p.destination, airport: destination.airport, options: destination.options },
                    source: AIRPORT_SOURCE,
                    recovery: 'Put these named airport options in a request_human_input select field so the person picks — do not ask in prose, do not ask for IATA codes or ontology setup. If no options match, ask for a more precise city or country.',
                });
            }
            const resolved = await flighthub(context);
            const outcome = await resolved.provider.search({
                origin: origin.airport.code,
                destination: destination.airport.code,
                departDate: p.depart_date,
                returnDate: p.return_date,
                tripType: p.trip_type,
                adults: p.adults,
                children: p.children,
                infants: p.infants,
                cabinClass: p.cabin_class,
                maxResults: p.max_results,
            }, {
                organizationId: requireOrg(context),
                userId: requireUser(context),
                sessionId: p.session_id,
            });
            if (isFlightBlocked(outcome)) {
                // A leading "Error:" marks the turn's call as failed in crew
                // grounding, which is honest — nothing was found. It is prose
                // rather than a JSON envelope because the envelope is what the
                // model used to paste verbatim into the room.
                return `Error: FlightHub is showing a bot check that needs a person. ${outcome.detail} ` +
                    `The desktop session ${outcome.sessionId} is still open at ${outcome.pageUrl} — pass it as session_id when retrying. ` +
                    `A person can also open FlightHub directly in their own browser; the automated desktop cannot reuse their login or challenge clearance.`;
            }
            const { db } = await import('@server/database_service.js');
            const { trycuaSessions } = await import('@shared/schema/index.js');
            const snapshot: FlightSnapshot = { ...outcome, params: {
                origin: origin.airport.code, destination: destination.airport.code, departDate: p.depart_date,
                returnDate: p.return_date, tripType: p.trip_type, adults: p.adults,
                children: p.children, infants: p.infants, cabinClass: p.cabin_class, maxResults: p.max_results,
            } };
            await db.update(trycuaSessions).set({
                metadata: sql`jsonb_set(COALESCE(${trycuaSessions.metadata}, '{}'::jsonb), '{flighthubSearch}', ${JSON.stringify(snapshot)}::jsonb)`,
            }).where(and(eq(trycuaSessions.id, outcome.sessionId), eq(trycuaSessions.organizationId, requireOrg(context)), eq(trycuaSessions.userId, requireUser(context))));
            return JSON.stringify({
                items: outcome.offers.map(presentOffer),
                provider: outcome.provider,
                sessionId: outcome.sessionId,
                resultsUrl: outcome.resultsUrl,
                searchedAt: outcome.searchedAt,
                airports: { origin: origin.airport, destination: destination.airport },
                searchFallbackUrl: buildSearchUrl(p.origin, p.destination),
                warnings: outcome.warnings ?? [],
            });
        },
    },

    flighthub_propose_booking: {
        name: 'flighthub_propose_booking',
        label: 'Propose FlightHub booking',
        group: 'Travel',
        idempotency: 'none',
        riskLevel: 'low',
        approvalPolicy: { requiresApproval: false, rationale: 'Only saves a proposal; the authenticated approval service prepares a human handoff.' },
        guardrails: GUARDRAILS,
        description: 'Save an approval card for an offer returned by flighthub_search_flights. Only session_id and offer_ref identify the offer; itinerary and prices are loaded from executed search evidence. Approval provides a human booking link. No autonomous booking or purchase runs.',
        parameters: proposeSchema,
        execute: proposeBooking,
    },

    flighthub_booking_status: {
        name: 'flighthub_booking_status',
        label: 'FlightHub booking progress',
        group: 'Travel',
        idempotency: 'read-safe',
        riskLevel: 'low',
        guardrails: GUARDRAILS,
        description:
            'Read the status and latest steps of a booking computer-use task started by an approved ' +
            'flighthub_booking proposal — running, waiting on a person (needs_confirmation), succeeded or failed.',
        parameters: statusSchema,
        execute: async (p, context) => {
            const organizationId = requireOrg(context);
            const { db } = await import('@server/database_service.js');
            const { trycuaComputerUseTasks, trycuaComputerUseTaskSteps } = await import('@shared/schema/index.js');
            const [task] = await db
                .select()
                .from(trycuaComputerUseTasks)
                .where(and(eq(trycuaComputerUseTasks.id, p.task_id), eq(trycuaComputerUseTasks.organizationId, organizationId), eq(trycuaComputerUseTasks.userId, requireUser(context))))
                .limit(1);
            if (!task) throw new Error('Booking task not found.');
            const steps = await db
                .select({ stepNumber: trycuaComputerUseTaskSteps.stepNumber, phase: trycuaComputerUseTaskSteps.phase, status: trycuaComputerUseTaskSteps.status, action: trycuaComputerUseTaskSteps.action })
                .from(trycuaComputerUseTaskSteps)
                .where(and(eq(trycuaComputerUseTaskSteps.taskId, task.id), eq(trycuaComputerUseTaskSteps.organizationId, organizationId)))
                .orderBy(desc(trycuaComputerUseTaskSteps.stepNumber))
                .limit(8);
            return JSON.stringify({
                taskId: task.id,
                sessionId: task.sessionId,
                status: task.status,
                task: task.task,
                result: task.result ?? null,
                viewerUrl: `/workspace/computer-use?session=${encodeURIComponent(task.sessionId)}&task=${encodeURIComponent(task.id)}&orgId=${organizationId}`,
                recentSteps: steps.reverse(),
            });
        },
    },
};
