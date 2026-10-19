/**
 * Property-based test for Route Resolution Completeness.
 *
 * **Property 1: Route resolution completeness**
 *
 * For any URL path string (including paths with query parameters, fragments,
 * special characters, and deeply nested segments), `getEntryForUrl` SHALL return
 * exactly one of the five values: 'auth', 'operations', 'intelligence',
 * 'knowledge', or 'armory' — never 'admin', 'main', undefined, or any other value.
 *
 * **Validates: Requirements 8.2, 8.6**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: ui-spa-consolidation-phase-2, Property 1: Route resolution completeness
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getEntryForUrl } from '../../client/src/lib/spa-utils.js';

// ─── Valid SPA entries ────────────────────────────────────────────────────────

const VALID_ENTRIES = ['auth', 'operations', 'intelligence', 'knowledge', 'armory'] as const;

// ─── Generators ───────────────────────────────────────────────────────────────

/** Generate a path segment (alphanumeric with hyphens and underscores) */
const pathSegmentArb = fc.stringOf(
  fc.oneof(
    fc.char().filter(c => /[a-zA-Z0-9\-_.]/.test(c)),
    fc.constant('-'),
    fc.constant('_'),
    fc.constant('.')
  ),
  { minLength: 1, maxLength: 20 }
);

/** Generate a deeply nested path with 1-10 segments */
const nestedPathArb = fc.array(pathSegmentArb, { minLength: 1, maxLength: 10 })
  .map(segments => '/' + segments.join('/'));

/** Generate arbitrary query parameters */
const queryParamArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_]/.test(s)),
  fc.string({ minLength: 0, maxLength: 30 })
).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);

const queryStringArb = fc.array(queryParamArb, { minLength: 1, maxLength: 5 })
  .map(params => '?' + params.join('&'));

/** Generate URL fragments */
const fragmentArb = fc.string({ minLength: 1, maxLength: 20 })
  .map(s => '#' + encodeURIComponent(s));

/** Generate a complete URL path with optional query and fragment */
const urlWithQueryAndFragmentArb = fc.tuple(
  nestedPathArb,
  fc.option(queryStringArb, { nil: undefined }),
  fc.option(fragmentArb, { nil: undefined })
).map(([path, query, fragment]) => {
  let url = path;
  if (query) url += query;
  if (fragment) url += fragment;
  return url;
});

/** Generate paths with special characters */
const specialCharsPathArb = fc.stringOf(
  fc.oneof(
    fc.char(),
    fc.constantFrom('/', ' ', '%', '@', '!', '~', '+', '=', '&', '(', ')', '[', ']', '{', '}')
  ),
  { minLength: 1, maxLength: 50 }
).map(s => '/' + s);

/** Generate completely arbitrary strings (edge cases) */
const arbitraryStringArb = fc.string({ minLength: 0, maxLength: 100 });

/** Generate an empty string */
const emptyStringArb = fc.constant('');

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Feature: ui-spa-consolidation-phase-2, Property 1: Route resolution completeness', () => {
  /**
   * **Validates: Requirements 8.2, 8.6**
   *
   * For any nested path URL, getEntryForUrl returns exactly one of the 5 valid SPA entries.
   */
  it('returns a valid SPA entry for any nested path with query params and fragments', () => {
    fc.assert(
      fc.property(urlWithQueryAndFragmentArb, (url) => {
        const result = getEntryForUrl(url);
        expect(VALID_ENTRIES).toContain(result);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 8.2, 8.6**
   *
   * For paths containing special characters, getEntryForUrl still returns a valid entry.
   */
  it('returns a valid SPA entry for paths with special characters', () => {
    fc.assert(
      fc.property(specialCharsPathArb, (url) => {
        const result = getEntryForUrl(url);
        expect(VALID_ENTRIES).toContain(result);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 8.2, 8.6**
   *
   * For completely arbitrary strings (including empty string, no leading slash, etc.),
   * getEntryForUrl still returns a valid entry and never throws.
   */
  it('returns a valid SPA entry for arbitrary strings without crashing', () => {
    fc.assert(
      fc.property(arbitraryStringArb, (url) => {
        const result = getEntryForUrl(url);
        expect(VALID_ENTRIES).toContain(result);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 8.2, 8.6**
   *
   * The return value is never 'admin', 'main', undefined, null, or any non-string value.
   */
  it('never returns admin, main, undefined, or null for any input', () => {
    fc.assert(
      fc.property(arbitraryStringArb, (url) => {
        const result = getEntryForUrl(url);
        expect(result).not.toBe('admin');
        expect(result).not.toBe('main');
        expect(result).not.toBeUndefined();
        expect(result).not.toBeNull();
        expect(typeof result).toBe('string');
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 8.2, 8.6**
   *
   * Edge case: empty string input returns a valid SPA entry.
   */
  it('returns a valid SPA entry for empty string', () => {
    fc.assert(
      fc.property(emptyStringArb, (url) => {
        const result = getEntryForUrl(url);
        expect(VALID_ENTRIES).toContain(result);
      }),
      { numRuns: 1 }
    );
  });
});
