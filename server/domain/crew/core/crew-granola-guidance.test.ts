import { describe, expect, it } from 'vitest';
import { granolaGuidanceFor } from './crew-granola-guidance.js';
import { selectCrewGuidance } from './crew-guidance-selection.js';

describe('Granola crew guidance', () => {
    it('selects context and preparation guidance for upcoming meeting prep', () => {
        expect(granolaGuidanceFor('Prepare me for the upcoming meeting with Acme').map(entry => entry.id)).toEqual(['granola-context', 'granola-prep']);
    });
    it('selects review guidance for decision-aware review requests', () => {
        const selected = selectCrewGuidance({ message: 'Review this against what we decided in the meeting' });
        expect(selected.receipt.entries.map(entry => entry.id)).toEqual(expect.arrayContaining(['granola-context', 'granola-review']));
        expect(selected.prompt).toContain('granola_search_meetings');
    });
    it('does not add Granola guidance to unrelated requests', () => {
        expect(granolaGuidanceFor('Calculate outstanding invoices')).toEqual([]);
    });
});
