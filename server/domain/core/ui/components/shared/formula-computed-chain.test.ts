/**
 * Computed fields must chain — a formula may reference an earlier computed field.
 *
 * Regression cover for the copilot "tip calculator" instant app, which rendered
 * and submitted a $100 total for a $100 bill with an $18 tip. Each computed
 * field was evaluated against the raw *input* values only, so `totalAmount`'s
 * reference to the computed `tipAmount` was unresolved — and an unresolved
 * identifier is coerced to 0 by `toNum`, silently turning `bill + tip` into
 * `bill + 0`. No error surfaced anywhere; the number was just wrong.
 *
 * The 0-coercion is deliberate (it keeps a half-filled form from showing NaN),
 * which is exactly why this needs a test: the failure mode is a plausible-looking
 * number rather than a crash.
 */
import { describe, it, expect } from 'vitest';
import { evalComputedFields } from './formula';

// The schema the copilot emits for "build me a tip calculator", in its own field
// order: inputs first, then computed outputs that chain off them.
const TIP_CALCULATOR = [
    { key: 'billAmount', type: 'number' },
    { key: 'tipPercent', type: 'number' },
    { key: 'tipAmount', type: 'computed', formula: 'round(billAmount * tipPercent / 100, 2)' },
    { key: 'totalAmount', type: 'computed', formula: 'round(billAmount + tipAmount, 2)' },
];

describe('evalComputedFields', () => {
    it('resolves a computed field that references another computed field', () => {
        // Values arrive from the form as strings, as react-hook-form supplies them.
        const out = evalComputedFields(TIP_CALCULATOR, { billAmount: '100', tipPercent: '18' });

        expect(out.tipAmount).toBe(18);
        // Was 100 before the fix: `tipAmount` read as 0 inside totalAmount's formula.
        expect(out.totalAmount).toBe(118);
    });

    it('keeps the raw inputs alongside the computed results', () => {
        const out = evalComputedFields(TIP_CALCULATOR, { billAmount: '80', tipPercent: '15' });

        expect(out.billAmount).toBe('80');
        expect(out.tipPercent).toBe('15');
        expect(out.tipAmount).toBe(12);
        expect(out.totalAmount).toBe(92);
    });

    it('chains through more than one level', () => {
        const out = evalComputedFields(
            [
                { key: 'base', type: 'number' },
                { key: 'a', type: 'computed', formula: 'base * 2' },
                { key: 'b', type: 'computed', formula: 'a + 1' },
                { key: 'c', type: 'computed', formula: 'b * 10' },
            ],
            { base: '5' },
        );

        expect(out.a).toBe(10);
        expect(out.b).toBe(11);
        expect(out.c).toBe(110);
    });

    it('leaves non-computed fields untouched and tolerates an empty schema', () => {
        expect(evalComputedFields([], { x: '1' })).toEqual({ x: '1' });
        expect(evalComputedFields([{ key: 'x', type: 'number' }], { x: '1' })).toEqual({ x: '1' });
    });

    it('still yields a number for an empty form rather than NaN', () => {
        const out = evalComputedFields(TIP_CALCULATOR, {});

        expect(out.tipAmount).toBe(0);
        expect(out.totalAmount).toBe(0);
    });
});
