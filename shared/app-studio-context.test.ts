import { describe, expect, it } from 'vitest';
import { appStudioScopePrefix, collectAppStudioChanges } from './app-studio-context';

const turn = (id: number, appId: number, appliedAt: string, status = 'applied') => ({ id, artifacts: [{ tool: 'mount_app_studio', payload: { appId, lastChange: { appliedAt, status, summary: `Result ${id}`, instruction: 'Add a table', canRevert: true } } }] });

describe('App Studio conversation history', () => {
    it('keeps repeated requests separate and filters other apps', () => {
        const history = collectAppStudioChanges([turn(1, 42, 'a'), turn(2, 99, 'b'), turn(3, 42, 'c', 'build_failed')], 42);
        expect(history.map(change => change.turnId)).toEqual([3, 1]);
        expect(history[0].status).toBe('build_failed');
    });
    it('deduplicates a redelivered dispatch and retains its newest outcome', () => {
        const history = collectAppStudioChanges([turn(1, 42, 'a', 'applying'), turn(2, 42, 'a')], 42);
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe('applied');
        expect(history[0].turnId).toBe(2);
    });
    it('reconstructs the same history after remount and does not guess an app', () => {
        const turns = [turn(1, 42, 'a')];
        expect(collectAppStudioChanges(JSON.parse(JSON.stringify(turns)), 42)).toEqual(collectAppStudioChanges(turns, 42));
        expect(collectAppStudioChanges(turns)).toEqual([]);
    });
    it('carries the app, file, component and observed change into the prompt', () => {
        const selection = { appId: 42, kind: 'component' as const, label: 'Revenue table', componentId: 'node-2', filePath: 'app/page.tsx', changeId: 'a' };
        expect(appStudioScopePrefix(selection)).toContain(JSON.stringify(selection));
    });
});
