import { describe, it, expect } from 'vitest';
import { scribeScopePrefix, type ScribeSelection } from './scribe-context';

describe('scribeScopePrefix', () => {
  it('formats excerpt selection with station title and key', () => {
    const selection: ScribeSelection = {
      documentId: 13,
      branchId: 13,
      stationKey: 'overview',
      stationTitle: '1. Overview & Objectives',
      nodeId: 44,
      excerpt: 'The system must support real-time sync.',
    };
    const prefix = scribeScopePrefix(selection);
    expect(prefix).toBe('[Scribe Station "1. Overview & Objectives" (overview) Node #44, Excerpt: "The system must support real-time sync."]');
  });

  it('formats annotation selection with lens type and critique body', () => {
    const selection: ScribeSelection = {
      documentId: 13,
      stationTitle: '2. Platform Components',
      annotationId: 99,
      lensType: 'legal',
      critiqueBody: 'Missing warranty disclaimer.',
    };
    const prefix = scribeScopePrefix(selection);
    expect(prefix).toBe('[Scribe Annotation #99 (legal) on "2. Platform Components": "Missing warranty disclaimer."]');
  });
});
