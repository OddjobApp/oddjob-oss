/**
 * Property-Based Tests: CREW delta merge.
 *
 * The room no longer refetches its whole state on every SSE event — it merges
 * deltas into what it already holds. That trades a cheap-but-correct refetch for
 * merge rules that can silently lose a turn, so the properties here are about
 * loss and duplication rather than any particular example.
 *
 * Uses fast-check with a minimum of 100 iterations per property.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { mergeById, mergeTurns, type MergeableTurn } from './crew-delta';

const speakerType = fc.constantFrom<MergeableTurn['speakerType']>('user', 'agent', 'supervisor');

/** Real (persisted) turns: non-negative ids, as the server assigns them. */
const realTurn = fc.record({
  id: fc.integer({ min: 0, max: 500 }),
  speakerType,
  content: fc.string({ maxLength: 40 }),
});

const realTurns = fc.uniqueArray(realTurn, { maxLength: 25, selector: (t) => t.id });

const identified = fc.uniqueArray(
  fc.record({ id: fc.integer({ min: 0, max: 500 }), value: fc.string({ maxLength: 20 }) }),
  { maxLength: 25, selector: (i) => i.id },
);

describe('mergeById', () => {
  it('is the union of both inputs, with no duplicate ids', () => {
    fc.assert(
      fc.property(identified, identified, fc.constantFrom<'asc' | 'desc'>('asc', 'desc'), (prev, incoming, order) => {
        const merged = mergeById(prev, incoming, order);

        const expectedIds = new Set([...prev, ...incoming].map((i) => i.id));
        const mergedIds = merged.map((i) => i.id);

        expect(new Set(mergedIds)).toEqual(expectedIds);
        expect(mergedIds.length).toBe(expectedIds.size);
      }),
      { numRuns: 200 },
    );
  });

  it('never loses an item the client already held', () => {
    fc.assert(
      fc.property(identified, identified, (prev, incoming) => {
        const mergedIds = new Set(mergeById(prev, incoming, 'asc').map((i) => i.id));
        for (const item of prev) expect(mergedIds.has(item.id)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('lets an incoming item win for an id held on both sides', () => {
    fc.assert(
      fc.property(identified, identified, (prev, incoming) => {
        const merged = mergeById(prev, incoming, 'asc');
        for (const item of incoming) {
          expect(merged.find((m) => m.id === item.id)?.value).toBe(item.value);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('sorts by id in the requested direction', () => {
    fc.assert(
      fc.property(identified, identified, fc.constantFrom<'asc' | 'desc'>('asc', 'desc'), (prev, incoming, order) => {
        // An empty delta short-circuits and returns prev untouched, which carries
        // whatever order it already had; sorting is only promised on a real merge.
        fc.pre(incoming.length > 0);
        const ids = mergeById(prev, incoming, order).map((i) => i.id);
        const expected = [...ids].sort((a, b) => (order === 'asc' ? a - b : b - a));
        expect(ids).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });
});

describe('mergeTurns', () => {
  it('keeps every real turn from both sides exactly once, in id order', () => {
    fc.assert(
      fc.property(realTurns, realTurns, (prev, incoming) => {
        // An empty delta short-circuits to prev by reference (so React skips the
        // re-render), which carries whatever order prev already had. Ordering is
        // only promised on a real merge; the empty case has its own test.
        fc.pre(incoming.length > 0);
        const merged = mergeTurns(prev, incoming);
        const mergedReal = merged.filter((t) => t.id >= 0).map((t) => t.id);

        const expectedIds = new Set([...prev, ...incoming].map((t) => t.id));
        expect(new Set(mergedReal)).toEqual(expectedIds);
        expect(mergedReal.length).toBe(expectedIds.size);
        expect(mergedReal).toEqual([...mergedReal].sort((a, b) => a - b));
      }),
      { numRuns: 200 },
    );
  });

  it('drops an optimistic bubble once the server echoes the same message back', () => {
    fc.assert(
      fc.property(realTurns, fc.string({ minLength: 1, maxLength: 40 }), fc.integer({ min: 1, max: 500 }), (existing, message, realId) => {
        const optimistic: MergeableTurn = { id: -1, speakerType: 'user', content: message };
        const echoed: MergeableTurn = { id: realId, speakerType: 'user', content: message };

        const merged = mergeTurns([...existing, optimistic], [echoed]);

        expect(merged.some((t) => t.id < 0)).toBe(false);
        expect(merged.filter((t) => t.content === message && t.speakerType === 'user').length).toBe(
          // The generated history may coincidentally contain the same message.
          new Set([...existing.filter((t) => t.speakerType === 'user' && t.content === message).map((t) => t.id), realId]).size,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('keeps an optimistic bubble last while its message is unconfirmed', () => {
    fc.assert(
      fc.property(realTurns, fc.string({ minLength: 1, maxLength: 40 }), realTurns, (existing, message, incoming) => {
        // Only unconfirmed if nothing on either side is the same user message.
        const confirmed = [...existing, ...incoming].some(
          (t) => t.speakerType === 'user' && t.content === message,
        );
        fc.pre(!confirmed && incoming.length > 0);

        const optimistic: MergeableTurn = { id: -1, speakerType: 'user', content: message };
        const merged = mergeTurns([...existing, optimistic], incoming);

        expect(merged[merged.length - 1]).toEqual(optimistic);
      }),
      { numRuns: 200 },
    );
  });

  it('returns previous state untouched for an empty delta', () => {
    fc.assert(
      fc.property(realTurns, (prev) => {
        expect(mergeTurns(prev, [])).toBe(prev);
      }),
      { numRuns: 100 },
    );
  });
});
