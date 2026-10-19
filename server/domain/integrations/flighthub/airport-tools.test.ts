import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('./resolver.js', () => ({ resolveFlightProvider: vi.fn().mockResolvedValue({ provider: { search: mocks.search } }) }));
import { FLIGHTHUB_TOOLS } from '../../tools/v1/capabilities/flighthub.js';
beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockResolvedValue({ blocked: 'challenge', sessionId: 'session', pageUrl: 'https://www.flighthub.com/', detail: 'Human check' });
});
describe('airport tools are wired into flight search', () => {
    const context = { organizationId: 342, userId: 'owner' };
    const search = FLIGHTHUB_TOOLS.flighthub_search_flights;
    it('converts city and airport names to sourced codes before invoking FlightHub', async () => {
        await search.execute(search.parameters.parse({ origin: 'Los Angeles', destination: 'Haneda', depart_date: '2026-12-01', trip_type: 'oneway' }), context);
        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ origin: 'LAX', destination: 'HND', tripType: 'oneway' }), expect.objectContaining(context));
    });
    it('returns actual Tokyo airport options without running an ambiguous search', async () => {
        const result = JSON.parse(await search.execute(search.parameters.parse({ origin: 'Los Angeles', destination: 'Tokyo', depart_date: '2026-12-01', trip_type: 'oneway' }), context));
        expect(result.code).toBe('airport_selection_required');
        expect(result.destination.options.map((a: any) => a.code)).toEqual(expect.arrayContaining(['HND', 'NRT']));
        expect(mocks.search).not.toHaveBeenCalled();
    });
    it('exposes a usable standalone lookup tool rather than requiring ontology setup', async () => {
        const tool = FLIGHTHUB_TOOLS.flighthub_lookup_airports;
        const result = JSON.parse(await tool.execute(tool.parameters.parse({ query: 'Haneda' }), context));
        expect(result.airports[0].code).toBe('HND');
        expect(result.source).toBe('https://ourairports.com/data/');
    });
});
