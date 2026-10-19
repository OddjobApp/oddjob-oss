import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inserted, execute } = vi.hoisted(() => ({ inserted: [] as any[], execute: vi.fn() }));
vi.mock('@server/database_service.js', () => ({ db: { insert: () => ({ values: (value: any) => {
    inserted.push(value);
    return { returning: async () => [{ ...value, id: 999 }] };
} }) } }));
vi.mock('../crew-stream.service.js', () => ({ crewStreamService: { publish: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../crew-tools.service.js', () => ({ crewToolsService: { execute } }));
vi.mock('@domain/apps/app-registry.service.js', () => ({ appRegistryService: { listOrgDeployments: vi.fn().mockResolvedValue([]) } }));
vi.mock('@domain/tools/v1/capabilities/index.js', () => ({ getAgentTools: () => ({ mount_app_studio: { name: 'mount_app_studio' } }) }));
import { runDirectAppStudioMount, runDirectForgeStart, mountedStudioApp } from '../crew-app-studio.service.js';

const initial = { speakerType: 'user', content: 'I want to develop a distressed properties research tool', artifacts: [] };
const staleDraft = { speakerType: 'agent', content: '', artifacts: [{ tool: 'mount_app_studio', payload: {
    type: 'app_studio_pod', title: 'New Application', requirements: 'Can you build an app for me?', jobId: null,
} }] };
const card = { id: 1, name: 'Copilot' } as any;
const context = (message: string, priorTurns: any[] = [initial]) => ({
    orgId: 342, sessionKey: 'test-room', session: { id: 1 }, userId: 'user', message,
    priorTurns, roundTurns: [], round: 2, replyTarget: 1, projectId: null, projectKey: null,
    cost: { toolCalls: 0 }, prefetch: { toolsMap: new Map([[1, [{ definition: { name: 'mount_app_studio' } }]]]) },
}) as any;

beforeEach(() => { inserted.length = 0; execute.mockReset(); });
describe('app draft routing across room follow-ups', () => {
    it('targets the new draft instead of an older built app', async () => {
        const oldApp = { speakerType: 'agent', content: '', artifacts: [{ payload: { type: 'app_studio_pod', appId: 42 } }] };
        const ctx = context('Add county and ZIP filters', [oldApp, initial, staleDraft]);
        expect(mountedStudioApp(ctx)).toBeNull();
        expect(await runDirectAppStudioMount(ctx, card)).toBe(true);
        expect(inserted[0].artifacts[0].payload.requirements).toContain('Add county and ZIP filters');
    });
    it('applies a contextual filter request to the current draft', async () => {
        const message = 'Add county and ZIP filters';
        expect(await runDirectAppStudioMount(context(message, [initial, staleDraft]), card)).toBe(true);
        expect(inserted[0].artifacts[0].payload.requirements).toContain(message);
        expect(inserted[0].artifacts[0].payload.requirements).toContain(initial.content);
        expect(execute).not.toHaveBeenCalled();
    });
    it('leaves a request for suggestions as discussion', async () => {
        expect(await runDirectAppStudioMount(context('What would you add to the search?', [initial, staleDraft]), card)).toBe(false);
        expect(inserted).toHaveLength(0);
    });
    it('proposes the original research brief when asked to build the app', async () => {
        expect(await runDirectAppStudioMount(context('Can you please build the app?'), card)).toBe(true);
        const payload = inserted[0].artifacts[0].payload;
        expect(payload.name).toBe('Distressed Properties Research Tool');
        expect(payload.requirements).toContain(initial.content);
        expect(execute).not.toHaveBeenCalled();
    });
    it('turns requirements for a draft into an updated proposal instead of a map', async () => {
        const message = 'The app should provide a way to search for distressed properties. Name it whatever you like.';
        expect(await runDirectAppStudioMount(context(message, [initial, staleDraft]), card)).toBe(true);
        expect(inserted[0].artifacts[0].payload.requirements).toContain(message);
        expect(inserted[0].artifacts[0].payload.requirements).toContain(initial.content);
        expect(execute).not.toHaveBeenCalled();
    });
    it('does not revive the stale brief from an old architecture confirmation', async () => {
        execute.mockResolvedValue({ record: { name: 'mount_app_studio', ok: true, ms: 1 }, artifact: { tool: 'mount_app_studio', payload: { type: 'app_studio_pod' } } });
        const refinement = { speakerType: 'user', content: 'The app should support property searches by county.', artifacts: [] };
        const ctx = context('I confirmed stage "stage-intake" with configuration: {"selectedPacks":[]}', [initial, staleDraft, refinement]);
        expect(await runDirectForgeStart(ctx, card)).toBe(true);
        expect(execute.mock.calls[0][1]).toMatchObject({ title: 'Distressed Properties Research Tool' });
        expect(execute.mock.calls[0][1].requirements).toContain(refinement.content);
    });
});
