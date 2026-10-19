/**
 * Property-based test for Operational Mode Persistence Round-Trip.
 *
 * **Property 2: Round trip consistency**
 *
 * For any valid OperationalMode value, writing it to localStorage and then
 * mounting the provider SHALL result in that mode being restored as the active
 * mode. Conversely, for any string that is NOT a valid OperationalMode,
 * loading from localStorage SHALL default to "agent-chat". Additionally, for
 * any valid mode M, calling setMode(M) SHALL persist M to localStorage.
 *
 * **Validates: Requirements 2.5, 2.6, 2.7**
 *
 * Uses fast-check for property-based testing.
 * Tag: Feature: hat-menu-intent-router, Property 2: Round trip consistency
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { render, act } from '@testing-library/react';
import { createElement, useState, useEffect } from 'react';
import {
  OperationalModeProvider,
  useOperationalMode,
  type OperationalMode,
} from './OperationalModeContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_MODES: OperationalMode[] = ['agent-chat', 'feeds-cycles', 'h3-spatial-watch'];
const STORAGE_KEY = 'oddjob:operational-mode';

// ─── Generators ───────────────────────────────────────────────────────────────

/** Generate one of the three valid operational modes */
const validModeArb = fc.constantFrom(...VALID_MODES);

/** Generate arbitrary strings that are NOT valid modes */
const invalidModeArb = fc.string({ minLength: 0, maxLength: 50 }).filter(
  (s) => !VALID_MODES.includes(s as OperationalMode)
);

// ─── Test Helper ──────────────────────────────────────────────────────────────

/**
 * A consumer component that exposes activeMode and setMode via a ref-like
 * callback so we can inspect values from outside the React tree.
 */
function ModeReader({ onMount }: { onMount: (mode: OperationalMode, setMode: (m: OperationalMode) => void) => void }) {
  const { activeMode, setMode } = useOperationalMode();
  useEffect(() => {
    onMount(activeMode, setMode);
  }, [activeMode, setMode, onMount]);
  return null;
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Feature: hat-menu-intent-router, Property 2: Round trip consistency', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * For any valid OperationalMode, writing it to localStorage before mounting
   * the provider results in that mode being the activeMode.
   */
  it('valid modes persist and restore from localStorage', () => {
    fc.assert(
      fc.property(validModeArb, (mode) => {
        localStorage.clear();
        localStorage.setItem(STORAGE_KEY, mode);

        let capturedMode: OperationalMode | null = null;

        render(
          createElement(OperationalModeProvider, null,
            createElement(ModeReader, {
              onMount: (m) => { capturedMode = m; },
            })
          )
        );

        expect(capturedMode).toBe(mode);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.7**
   *
   * For any string that is NOT a valid OperationalMode (including empty string,
   * random characters, near-miss strings), loading from localStorage defaults
   * to "agent-chat".
   */
  it('invalid mode strings in localStorage default to agent-chat', () => {
    fc.assert(
      fc.property(invalidModeArb, (invalidMode) => {
        localStorage.clear();
        localStorage.setItem(STORAGE_KEY, invalidMode);

        let capturedMode: OperationalMode | null = null;

        render(
          createElement(OperationalModeProvider, null,
            createElement(ModeReader, {
              onMount: (m) => { capturedMode = m; },
            })
          )
        );

        expect(capturedMode).toBe('agent-chat');
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * For any two distinct valid modes (initial and target), calling setMode(target)
   * persists the target mode to localStorage.
   *
   * Note: setMode only persists when the mode actually changes (by design from
   * Requirement 1.9 — selecting the already-active mode is a no-op). We test
   * with a distinct initial mode to guarantee a state change triggers persistence.
   */
  it('setMode persists valid modes to localStorage on mode change', () => {
    fc.assert(
      fc.property(
        fc.tuple(validModeArb, validModeArb).filter(([a, b]) => a !== b),
        ([initialMode, targetMode]) => {
          localStorage.clear();
          // Set initial mode so the provider starts with a known different mode
          localStorage.setItem(STORAGE_KEY, initialMode);

          let capturedSetMode: ((m: OperationalMode) => void) | null = null;

          const { unmount } = render(
            createElement(OperationalModeProvider, null,
              createElement(ModeReader, {
                onMount: (_m, setFn) => { capturedSetMode = setFn; },
              })
            )
          );

          expect(capturedSetMode).not.toBeNull();
          act(() => {
            capturedSetMode!(targetMode);
          });

          expect(localStorage.getItem(STORAGE_KEY)).toBe(targetMode);
          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});
