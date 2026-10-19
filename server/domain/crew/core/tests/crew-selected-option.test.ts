import { describe, expect, it } from 'vitest';
import { resolveSelectedOption } from '../crew-selected-option.js';
import { isExplicitExternalResearchRequest } from '../crew-round-context.js';

describe('selected research action', () => {
    it('carries the selected website visit to external tool routing', () => {
        const message = resolveSelectedOption('1', [{ speakerType: 'agent', content: 'Choose:\n1. Visit the Orange County website\n2. Discuss a different data source' }]);
        expect(message).toContain('Visit the Orange County website');
        expect(message).not.toContain('Discuss a different');
        expect(isExplicitExternalResearchRequest(message)).toBe(true);
    });
    it('does not invent context for an unmatched selection', () => {
        expect(resolveSelectedOption('2', [{ speakerType: 'agent', content: 'No options offered.' }])).toBe('2');
    });
});
