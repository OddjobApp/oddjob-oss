/**
 * Studio deliverable job config schema tests
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { scribePublishConfigSchema, mediaTakeConfigSchema } from './config-studio.js';
import { jobConfigSchema } from './table.js';

describe('scribePublishConfigSchema', () => {
    it('accepts a minimal valid config and defaults format to markdown', () => {
        const parsed = scribePublishConfigSchema.parse({ documentId: 42 });
        expect(parsed.format).toBe('markdown');
    });

    it('accepts the full shape', () => {
        const parsed = scribePublishConfigSchema.parse({
            documentId: 42,
            format: 'word',
            versionTag: 'v1.2',
            releaseNotes: 'First cut',
            contextParagraph: 'Upstream produced these findings.',
            branchId: 7,
        });
        expect(parsed.format).toBe('word');
        expect(parsed.branchId).toBe(7);
    });

    it('rejects a missing documentId', () => {
        expect(scribePublishConfigSchema.safeParse({ format: 'word' }).success).toBe(false);
    });

    it('rejects an unknown format', () => {
        expect(scribePublishConfigSchema.safeParse({ documentId: 1, format: 'pdf' }).success).toBe(false);
    });
});

describe('mediaTakeConfigSchema', () => {
    it('accepts a scene config and applies defaults', () => {
        const parsed = mediaTakeConfigSchema.parse({ productionId: 20, sceneId: 100 });
        expect(parsed.waitFor).toBe('approved');
        expect(parsed.maxTakes).toBe(10);
    });

    it('accepts explicit shotIds', () => {
        const parsed = mediaTakeConfigSchema.parse({ productionId: 20, shotIds: [1, 2], waitFor: 'ready_for_review' });
        expect(parsed.shotIds).toEqual([1, 2]);
    });

    it('rejects when neither sceneId nor shotIds is provided', () => {
        const result = mediaTakeConfigSchema.safeParse({ productionId: 20 });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toContain('sceneId or shotIds');
        }
    });

    it('rejects an empty shotIds array', () => {
        expect(mediaTakeConfigSchema.safeParse({ productionId: 20, shotIds: [] }).success).toBe(false);
    });

    it('rejects maxTakes above the safety cap', () => {
        expect(mediaTakeConfigSchema.safeParse({ productionId: 20, sceneId: 1, maxTakes: 51 }).success).toBe(false);
    });
});

describe('jobConfigSchema registration', () => {
    it('parses scribe_publish entries', () => {
        const result = jobConfigSchema.safeParse({ type: 'scribe_publish', config: { documentId: 42 } });
        expect(result.success).toBe(true);
    });

    it('parses media_take entries', () => {
        const result = jobConfigSchema.safeParse({ type: 'media_take', config: { productionId: 20, shotIds: [3] } });
        expect(result.success).toBe(true);
    });

    it('rejects a media_take entry with no shot source', () => {
        const result = jobConfigSchema.safeParse({ type: 'media_take', config: { productionId: 20 } });
        expect(result.success).toBe(false);
    });
});
