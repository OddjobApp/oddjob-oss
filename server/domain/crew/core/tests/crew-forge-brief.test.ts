import { describe, expect, it } from 'vitest';
import { roomForgeBrief, hasPendingForgeDraft } from '../crew-forge-brief.js';
import { forgeIntentResolver, decideStudioAction } from '@domain/intent-router/core/forge-intent-resolver.service.js';

describe('room app requirements', () => {
    it.each(['I want users to search by county', 'Let users export matching properties', "I'd like to save searches"])(
        'treats a desired behavior as an edit when an app is active: %s', message => {
            expect(decideStudioAction(message, { appId: 42 })).toMatchObject({ kind: 'apply', instruction: message });
        });
    it('uses the existing app edit path for a contextual feature request', () => {
        expect(decideStudioAction('Add county and ZIP filters', { appId: 42, name: 'Property Research' }))
            .toMatchObject({ kind: 'apply', appId: 42, instruction: 'Add county and ZIP filters' });
        expect(decideStudioAction('What would you add to the search?', { appId: 42 })).toEqual({ kind: 'none' });
    });
    it('stops treating a built app as an old pending draft', () => {
        const turns = [
            { speakerType: 'agent', content: '', artifacts: [{ payload: { type: 'forge_confirmation_card' } }] },
            { speakerType: 'agent', content: '', artifacts: [{ payload: { type: 'app_studio_pod', appId: 42 } }] },
        ];
        expect(hasPendingForgeDraft(turns)).toBe(false);
    });
    const initial = { speakerType: 'user', content: 'I want to develop a distressed properties research tool' };
    it.each([initial.content, 'Can you please build the app?'])( 'recognizes app building: %s', (message) => {
        const result = forgeIntentResolver.resolve(message);
        expect(result.intent).toBe('build_app');
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
    it('carries the subject into a generic build request', () => {
        const result = roomForgeBrief('Can you build an app for me?', [initial]);
        expect(result.name).toBe('Distressed Properties Research Tool');
        expect(result.requirements).toContain(initial.content);
    });
    it('retains user refinements and ignores agent speculation and confirmation JSON', () => {
        const result = roomForgeBrief('Can you please build the app?', [initial,
            { speakerType: 'agent', content: 'Add automated offers and underwriting.' },
            { speakerType: 'user', content: 'The app should provide a way to search for distressed properties. Name it whatever you like.' },
            { speakerType: 'user', content: 'I confirmed stage "stage-intake" with configuration: {"_trace":{}}' },
        ]);
        expect(result.requirements).toContain('provide a way to search');
        expect(result.requirements).not.toContain('automated offers');
        expect(result.requirements).not.toContain('_trace');
        expect(result.name).not.toBe('New Application');
    });
    it('does not carry a previous app into a specifically requested different app', () => {
        const result = roomForgeBrief('Create an app for warehouse inventory', [initial]);
        expect(result.requirements).not.toContain('distressed');
        expect(result.name).toBe('Warehouse Inventory');
    });
});
