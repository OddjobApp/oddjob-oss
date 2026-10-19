/**
 * Unit tests for DecisionToastManager utility functions.
 *
 * Tests the extracted pure functions:
 * - truncateDescription: text truncation with ellipsis
 * - computeToastStack: toast visibility and summary computation
 *
 * Requirements: 3.2, 3.6
 */

import { describe, it, expect } from 'vitest';
import {
  truncateDescription,
  computeToastStack,
  type DecisionToast,
} from '../DecisionToastManager';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeToast(overrides: Partial<DecisionToast> = {}): DecisionToast {
  return {
    id: `toast-${Math.random()}`,
    requestId: 1,
    toolName: 'shell',
    riskLevel: 'medium',
    description: 'Test description',
    arrivedAt: Date.now(),
    isHovered: false,
    remainingMs: 8000,
    ...overrides,
  };
}

// ─── truncateDescription Tests ──────────────────────────────────────────────

describe('truncateDescription', () => {
  it('returns text as-is when length is within limit', () => {
    const text = 'Short text';
    expect(truncateDescription(text)).toBe(text);
  });

  it('returns text as-is when length is exactly at the limit', () => {
    const text = 'a'.repeat(80);
    expect(truncateDescription(text)).toBe(text);
  });

  it('truncates and adds ellipsis when text exceeds 80 chars', () => {
    const text = 'a'.repeat(100);
    const result = truncateDescription(text);
    expect(result).toBe('a'.repeat(80) + '…');
    expect(result.length).toBe(81); // 80 chars + 1 ellipsis char
  });

  it('uses custom maxLen parameter', () => {
    const text = 'Hello World';
    expect(truncateDescription(text, 5)).toBe('Hello…');
  });

  it('handles empty string', () => {
    expect(truncateDescription('')).toBe('');
  });

  it('handles single character', () => {
    expect(truncateDescription('a')).toBe('a');
  });

  it('handles maxLen of 0', () => {
    expect(truncateDescription('anything', 0)).toBe('…');
  });
});

// ─── computeToastStack Tests ────────────────────────────────────────────────

describe('computeToastStack', () => {
  it('returns all toasts as visible when count <= maxVisible', () => {
    const toasts = [makeToast(), makeToast(), makeToast()];
    const result = computeToastStack(toasts, 3);
    expect(result.visible).toHaveLength(3);
    expect(result.summaryCount).toBe(0);
  });

  it('returns empty arrays for no toasts', () => {
    const result = computeToastStack([], 3);
    expect(result.visible).toHaveLength(0);
    expect(result.summaryCount).toBe(0);
  });

  it('limits visible toasts and provides summary count when over maxVisible', () => {
    const toasts = [makeToast(), makeToast(), makeToast(), makeToast(), makeToast()];
    const result = computeToastStack(toasts, 3);
    expect(result.visible).toHaveLength(3);
    expect(result.summaryCount).toBe(2);
  });

  it('uses default maxVisible of 3', () => {
    const toasts = [makeToast(), makeToast(), makeToast(), makeToast()];
    const result = computeToastStack(toasts);
    expect(result.visible).toHaveLength(3);
    expect(result.summaryCount).toBe(1);
  });

  it('returns the first N toasts as visible', () => {
    const toasts = [
      makeToast({ id: 'first' }),
      makeToast({ id: 'second' }),
      makeToast({ id: 'third' }),
      makeToast({ id: 'fourth' }),
    ];
    const result = computeToastStack(toasts, 2);
    expect(result.visible[0].id).toBe('first');
    expect(result.visible[1].id).toBe('second');
    expect(result.summaryCount).toBe(2);
  });

  it('handles maxVisible of 1', () => {
    const toasts = [makeToast(), makeToast(), makeToast()];
    const result = computeToastStack(toasts, 1);
    expect(result.visible).toHaveLength(1);
    expect(result.summaryCount).toBe(2);
  });

  it('handles single toast with maxVisible > 1', () => {
    const toasts = [makeToast()];
    const result = computeToastStack(toasts, 5);
    expect(result.visible).toHaveLength(1);
    expect(result.summaryCount).toBe(0);
  });
});
