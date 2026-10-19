/**
 * Unit tests for JSON diff utilities (Shadow Diff UI).
 * Aligned with docs/specs/HIL_2_ACCOUNTABILITY_SPEC.md
 */

import { describe, it, expect } from 'vitest';
import { computeLineDiff, computeImpactLevel } from "@shared/utils/json-diff.js";

describe('json-diff utilities (HIL_2_ACCOUNTABILITY_SPEC)', () => {
  describe('computeLineDiff', () => {
    it('returns empty for identical strings', () => {
      const text = 'line1\nline2\nline3';
      const lines = computeLineDiff(text, text);
      expect(lines.every((l: any) => l.type === 'same')).toBe(true);
      expect(lines.length).toBe(3);
    });

    it('marks added lines', () => {
      const oldText = 'a\nb';
      const newText = 'a\nb\nc';
      const lines = computeLineDiff(oldText, newText);
      const added = lines.filter((l: any) => l.type === 'add');
      expect(added.length).toBe(1);
      expect(added[0].content).toBe('c');
    });

    it('marks removed lines', () => {
      const oldText = 'a\nb\nc';
      const newText = 'a\nb';
      const lines = computeLineDiff(oldText, newText);
      const removed = lines.filter((l: any) => l.type === 'remove');
      expect(removed.length).toBe(1);
      expect(removed[0].content).toBe('c');
    });
  });

  describe('computeImpactLevel', () => {
    it('returns none for identical', () => {
      const json = '{"a":1,"b":2}';
      expect(computeImpactLevel(json, json)).toBe('none');
    });

    it('returns minor for small edits', () => {
      const oldJson = '{"a":1,"b":2}';
      const newJson = '{"a":1,"b":3}';
      expect(computeImpactLevel(oldJson, newJson)).toBe('minor');
    });

    it('returns structural when keys are added', () => {
      const oldJson = '{"a":1}';
      const newJson = '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7}';
      expect(computeImpactLevel(oldJson, newJson)).toBe('structural');
    });

    it('returns major for large value-only edits (same structure)', () => {
      const base = { a: 1, b: 2, c: 3 };
      const expanded = { a: 'x'.repeat(200), b: 'y'.repeat(200), c: 'z'.repeat(200) };
      const oldJson = JSON.stringify(base, null, 2);
      const newJson = JSON.stringify(expanded, null, 2);
      expect(computeImpactLevel(oldJson, newJson)).toBe('major');
    });
  });
});
