import { describe, it, expect } from 'vitest';
import { sortLinksByImpact } from './EntityDetailPanel';
import type { CausalLinkDto } from './ImpactVisualization';

describe('EntityDetailPanel', () => {
  describe('sortLinksByImpact', () => {
    it('sorts by descending impactConfidence first', () => {
      const links: CausalLinkDto[] = [
        { id: '1', targetEntityType: 'team', targetEntityId: 'a', impactConfidence: 0.5, blastRadius: 3 },
        { id: '2', targetEntityType: 'team', targetEntityId: 'a', impactConfidence: 0.9, blastRadius: 1 },
        { id: '3', targetEntityType: 'team', targetEntityId: 'a', impactConfidence: 0.7, blastRadius: 5 },
      ];

      const sorted = sortLinksByImpact(links);

      expect(sorted.map((l) => l.id)).toEqual(['2', '3', '1']);
    });

    it('breaks ties on impactConfidence by descending blastRadius', () => {
      const links: CausalLinkDto[] = [
        { id: '1', targetEntityType: 'team', targetEntityId: 'a', impactConfidence: 0.8, blastRadius: 2 },
        { id: '2', targetEntityType: 'team', targetEntityId: 'a', impactConfidence: 0.8, blastRadius: 7 },
        { id: '3', targetEntityType: 'team', targetEntityId: 'a', impactConfidence: 0.8, blastRadius: 4 },
      ];

      const sorted = sortLinksByImpact(links);

      expect(sorted.map((l) => l.id)).toEqual(['2', '3', '1']);
    });

    it('returns empty array for empty input', () => {
      expect(sortLinksByImpact([])).toEqual([]);
    });

    it('does not mutate the original array', () => {
      const links: CausalLinkDto[] = [
        { id: '1', targetEntityType: 'team', targetEntityId: 'a', impactConfidence: 0.3, blastRadius: 1 },
        { id: '2', targetEntityType: 'team', targetEntityId: 'a', impactConfidence: 0.9, blastRadius: 5 },
      ];
      const original = [...links];

      sortLinksByImpact(links);

      expect(links).toEqual(original);
    });

    it('handles single-element array', () => {
      const links: CausalLinkDto[] = [
        { id: '1', targetEntityType: 'org', targetEntityId: 'x', impactConfidence: 0.6, blastRadius: 3 },
      ];

      const sorted = sortLinksByImpact(links);

      expect(sorted).toEqual(links);
    });
  });
});
