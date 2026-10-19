import { describe, expect, it } from 'vitest';
import { normalizeCrewSourceHref } from './crew-source-link';

describe('normalizeCrewSourceHref', () => {
  it('repairs legacy invented Google hosts for internal knowledge links', () => {
    expect(normalizeCrewSourceHref('https://oddjob.google.com/knowledge/store'))
      .toBe('/knowledge/store');
  });

  it('preserves real external document URLs', () => {
    expect(normalizeCrewSourceHref('https://docs.example.com/source/42'))
      .toBe('https://docs.example.com/source/42');
  });

  it('preserves document-specific internal links', () => {
    expect(normalizeCrewSourceHref('/knowledge/store?documentId=7617'))
      .toBe('/knowledge/store?documentId=7617');
  });
});
