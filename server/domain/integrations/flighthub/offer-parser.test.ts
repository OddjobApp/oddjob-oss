import { describe, expect, it, vi } from 'vitest';
vi.mock('../trycua/trycua-service.js', () => ({ trycuaService: {} }));
import { parseOffer } from './browser-provider.js';
describe('FlightHub fare extraction', () => {
  it('preserves Canadian currency and rejects a lookalike booking URL', () => {
    const offer = parseOffer({ index: 0, text: 'Air Canada\nYYZ YVR\n6:00 AM 9:15 AM\nCA$298.50', href: 'https://www.flighthub.com.evil.test/pay' }, 'https://www.flighthub.com/results');
    expect(offer?.currency).toBe('CAD');
    expect(offer?.priceAmount).toBe(298.5);
    expect(offer?.bookingUrl).toBe('https://www.flighthub.com/results');
  });
  it('does not invent USD for an ambiguous dollar sign', () => {
    expect(parseOffer({ index: 0, text: 'Air Canada\nYYZ YVR\n6:00 AM 9:15 AM\n$298' }, 'https://www.flighthub.com/results')?.currency).toBeUndefined();
  });
});
