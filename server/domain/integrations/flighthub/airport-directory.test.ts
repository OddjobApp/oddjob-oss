import { describe, expect, it } from 'vitest';
import { lookupAirports, resolveAirport } from './airport-directory.js';
describe('bundled airport lookup', () => {
    it('resolves Los Angeles without requiring the user to supply LAX', () => {
        expect(resolveAirport('Los Angeles').airport?.code).toBe('LAX');
    });
    it('keeps Tokyo airport choice explicit', () => {
        const result = resolveAirport('Tokyo');
        expect(result.airport).toBeUndefined();
        expect(result.options.map(a => a.code)).toEqual(expect.arrayContaining(['HND', 'NRT']));
    });
    it('resolves a specific airport name and an exact code', () => {
        expect(resolveAirport('Haneda').airport?.code).toBe('HND');
        expect(resolveAirport('nrt').airport?.code).toBe('NRT');
    });
    it('does not manufacture codes and supports country filtering', () => {
        expect(resolveAirport('ZZZ').airport).toBeUndefined();
        expect(lookupAirports('London', 'CA').every(a => a.country === 'CA')).toBe(true);
    });
});
