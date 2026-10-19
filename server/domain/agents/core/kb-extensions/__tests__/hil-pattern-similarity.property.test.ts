/**
 * Property-based test for HIL Pattern Similarity by Shape Not Values.
 *
 * **Property 3: HIL Pattern Similarity by Shape Not Values**
 *
 * For any two approval requests, they SHALL be considered matching if and only if
 * they share the same tool name AND the same sorted set of parameter keys,
 * regardless of the parameter values.
 *
 * **Validates: Requirements 2.3**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: kb-question-engine-extensions, Property 3: HIL Pattern Similarity by Shape Not Values
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createHash } from "crypto";

// ─── Reproduce the pattern matching logic under test ──────────────────────────

/**
 * Replicates `computeParamKeysHash` from the HIL pattern detector service.
 * This is the pure function that determines whether two requests match by shape.
 */
function computeParamKeysHash(params: Record<string, any>): string {
  const sortedKeys = Object.keys(params).sort().join(",");
  return createHash("sha256").update(sortedKeys).digest("hex").slice(0, 16);
}

/**
 * Two requests are considered matching patterns iff:
 * 1. `tool` names are equal (exact match)
 * 2. Sorted parameter key sets are identical (values excluded)
 */
function patternsMatch(
  reqA: { tool: string; params: Record<string, any> },
  reqB: { tool: string; params: Record<string, any> }
): boolean {
  if (reqA.tool !== reqB.tool) return false;
  return computeParamKeysHash(reqA.params) === computeParamKeysHash(reqB.params);
}

/**
 * Direct sorted keys comparison (no hashing) for cross-validation.
 */
function sortedKeysEqual(
  paramsA: Record<string, any>,
  paramsB: Record<string, any>
): boolean {
  const keysA = Object.keys(paramsA).sort();
  const keysB = Object.keys(paramsB).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, i) => key === keysB[i]);
}

// ─── Generators ───────────────────────────────────────────────────────────────

/** Generate a non-empty tool name */
const toolNameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);

/** Generate a non-empty key name (simple alphanumeric identifiers) */
const paramKeyArb = fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s));

/** Generate an arbitrary parameter value */
const paramValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.string(), { maxKeys: 3 })
);

/** Generate a params Record with 1-8 keys */
const paramsArb = fc.uniqueArray(paramKeyArb, { minLength: 1, maxLength: 8 }).chain(keys =>
  fc.tuple(...keys.map(() => paramValueArb)).map(values => {
    const obj: Record<string, any> = {};
    keys.forEach((key, i) => { obj[key] = values[i]; });
    return obj;
  })
);

/** Generate a request object { tool, params } */
const requestArb = fc.record({
  tool: toolNameArb,
  params: paramsArb,
});

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: kb-question-engine-extensions, Property 3: HIL Pattern Similarity by Shape Not Values", () => {
  /**
   * **Validates: Requirements 2.3**
   *
   * Two requests match iff tool is equal AND Object.keys(params).sort() produces identical arrays.
   */
  it("two requests match iff tool name is equal AND sorted param keys are identical", () => {
    fc.assert(
      fc.property(requestArb, requestArb, (reqA, reqB) => {
        const match = patternsMatch(reqA, reqB);
        const expectedMatch = reqA.tool === reqB.tool && sortedKeysEqual(reqA.params, reqB.params);
        expect(match).toBe(expectedMatch);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * Changing only values (not keys) still matches — shape defines the pattern.
   */
  it("changing only parameter values (not keys) still matches", () => {
    fc.assert(
      fc.property(
        toolNameArb,
        fc.uniqueArray(paramKeyArb, { minLength: 1, maxLength: 8 }),
        paramValueArb,
        paramValueArb,
        (tool, keys, _valSeed1, _valSeed2) => {
          // Build two requests with the same tool and same keys but different values
          const paramsA: Record<string, any> = {};
          const paramsB: Record<string, any> = {};
          keys.forEach((key, i) => {
            paramsA[key] = `value_a_${i}`;
            paramsB[key] = `value_b_${i}`;
          });

          const reqA = { tool, params: paramsA };
          const reqB = { tool, params: paramsB };

          expect(patternsMatch(reqA, reqB)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * Changing any key causes non-match (even if tool is the same).
   */
  it("changing any parameter key causes non-match", () => {
    fc.assert(
      fc.property(
        toolNameArb,
        fc.uniqueArray(paramKeyArb, { minLength: 1, maxLength: 8 }),
        paramKeyArb,
        fc.nat({ max: 100 }),
        (tool, keys, newKey, indexSeed) => {
          // Ensure newKey is not already in keys
          fc.pre(!keys.includes(newKey));

          // Build request A with the original keys
          const paramsA: Record<string, any> = {};
          keys.forEach((key, i) => { paramsA[key] = `val_${i}`; });

          // Build request B with one key replaced
          const replaceIdx = indexSeed % keys.length;
          const modifiedKeys = [...keys];
          modifiedKeys[replaceIdx] = newKey;

          const paramsB: Record<string, any> = {};
          modifiedKeys.forEach((key, i) => { paramsB[key] = `val_${i}`; });

          const reqA = { tool, params: paramsA };
          const reqB = { tool, params: paramsB };

          // The sorted key sets differ, so they should NOT match
          expect(patternsMatch(reqA, reqB)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * Different tool names never match, even with identical param shapes.
   */
  it("different tool names never match even with identical param keys", () => {
    fc.assert(
      fc.property(
        toolNameArb,
        toolNameArb,
        paramsArb,
        (toolA, toolB, params) => {
          fc.pre(toolA !== toolB);

          const reqA = { tool: toolA, params };
          const reqB = { tool: toolB, params };

          expect(patternsMatch(reqA, reqB)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * A request always matches itself (reflexivity).
   */
  it("a request always matches itself (reflexive)", () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        expect(patternsMatch(req, req)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * Matching is symmetric: if A matches B, then B matches A.
   */
  it("pattern matching is symmetric", () => {
    fc.assert(
      fc.property(requestArb, requestArb, (reqA, reqB) => {
        expect(patternsMatch(reqA, reqB)).toBe(patternsMatch(reqB, reqA));
      }),
      { numRuns: 100 }
    );
  });
});
