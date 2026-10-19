import { describe, expect, it } from 'vitest';
import { assertIsoDate } from './search-url.js';
import { verifiedOffer, type FlightSnapshot } from './verified-offer.js';
import { isFlightHubUrl } from '@shared/flighthub-links';

const snapshot = (): FlightSnapshot => ({
  provider: 'test', sessionId: 'session', resultsUrl: 'https://www.flighthub.com/results', searchedAt: new Date().toISOString(),
  params: { origin: 'YYZ', destination: 'YVR', departDate: '2026-12-01', tripType: 'oneway', adults: 2, children: 0, infants: 0, cabinClass: 'business', maxResults: 8 },
  offers: [{ offerIndex: 0, signature: 'abc', offerRef: '0:abc', priceAmount: 500, priceDisplay: 'CA$500', currency: 'CAD' }],
});
describe('FlightHub verified handoff', () => {
  it('rejects rollover dates', () => {
    expect(() => assertIsoDate('2026-02-30', 'departure')).toThrow();
    expect(assertIsoDate('2028-02-29', 'departure')).toBe('2028-02-29');
  });
  it('requires an exact saved offer rather than an index or invented signature', () => {
    expect(verifiedOffer(snapshot(), '0:abc').currency).toBe('CAD');
    expect(() => verifiedOffer(snapshot(), '0:invented')).toThrow();
  });
  it('rejects stale or missing search evidence', () => {
    expect(() => verifiedOffer(undefined, '0:abc')).toThrow();
    expect(() => verifiedOffer({ ...snapshot(), searchedAt: '2020-01-01' }, '0:abc')).toThrow();
  });
  it('enforces a budget and refuses unknown prices or currencies', () => {
    expect(() => verifiedOffer(snapshot(), '0:abc', 499)).toThrow(/budget/);
    expect(verifiedOffer(snapshot(), '0:abc', 500).priceAmount).toBe(500);
    const unknown = snapshot(); unknown.offers[0].currency = undefined;
    expect(() => verifiedOffer(unknown, '0:abc', 500)).toThrow(/currency/);
  });
  it('rejects lookalikes, credentials and unsafe protocols', () => {
    for (const url of ['https://www.flighthub.com.evil.test/', 'https://evilflighthub.com/', 'http://flighthub.com/', 'https://user@flighthub.com/', 'https://flighthub.com:8443/']) expect(isFlightHubUrl(url)).toBe(false);
    expect(isFlightHubUrl('https://www.flighthub.com/results')).toBe(true);
  });
});
