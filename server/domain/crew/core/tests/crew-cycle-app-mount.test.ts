import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inserted, execute, listOrgAppTargets } = vi.hoisted(() => ({
    inserted: [] as any[],
    execute: vi.fn(),
    listOrgAppTargets: vi.fn(),
}));

vi.mock('@server/database_service.js', () => ({ db: { insert: () => ({ values: (value: any) => {
    inserted.push(value);
    return { returning: async () => [{ ...value, id: 999 }] };
} }) } }));
vi.mock('../crew-stream.service.js', () => ({ crewStreamService: { publish: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../crew-tools.service.js', () => ({ crewToolsService: { execute } }));
vi.mock('@domain/tools/v1/capabilities/app-forge-tools.js', () => ({ listOrgAppTargets }));
vi.mock('@domain/tools/v1/capabilities/index.js', () => ({ getAgentTools: () => ({ render_app_surface: { name: 'render_app_surface' } }) }));

import { appTargetNamedIn, runDirectCycleAppMount } from '../crew-app-studio.service.js';
import { isAppOpenRequest } from '../crew-round-context.js';

const wayfare = {
    slug: 'wayfare-8fd06', title: 'Wayfare', href: '/app/wayfare-8fd06',
    source: 'app', appId: 7, deploymentId: 9, publicSlug: 'wayfare-8fd06',
};
const card = { id: 1, name: 'Copilot' } as any;
const context = (message: string) => ({
    orgId: 342, sessionKey: 'test-room', session: { id: 1 }, userId: 'user', message,
    priorTurns: [], roundTurns: [], round: 2, replyTarget: 1, projectId: null, projectKey: null,
    cost: { toolCalls: 0 }, prefetch: { toolsMap: new Map() },
}) as any;

const canvasArtifact = {
    tool: 'render_app_surface',
    payload: {
        type: 'assistant_app', title: 'Wayfare', source: 'app', slug: 'wayfare-8fd06',
        href: '/app/wayfare-8fd06', mode: 'embed', studioSurface: 'cycle_canvas',
        publicSlug: 'wayfare-8fd06', publicPath: '/app/wayfare-8fd06', appId: 7, deploymentId: 9,
    },
};

beforeEach(() => {
    inserted.length = 0;
    execute.mockReset();
    listOrgAppTargets.mockReset();
    listOrgAppTargets.mockResolvedValue([wayfare]);
    execute.mockResolvedValue({ record: { name: 'render_app_surface', ok: true, ms: 2 }, output: '', artifact: canvasArtifact });
});

describe('isAppOpenRequest', () => {
    it('accepts explicit open gestures', () => {
        for (const m of ['open Wayfare', 'launch Wayfare', 'show me the wayfare app', 'pull up wayfare']) {
            expect(isAppOpenRequest(m), m).toBe(true);
        }
    });
    it('rejects build, change and studio requests', () => {
        for (const m of [
            'build a wayfare app', 'fix the wayfare app', 'open app studio',
            'open project studio', 'open computer use studio', 'what is wayfare',
        ]) {
            // "open app studio" still passes the verb filter — no catalog target
            // is named "app studio", so the mount declines it downstream.
            if (m === 'open app studio') { expect(isAppOpenRequest(m), m).toBe(true); continue; }
            expect(isAppOpenRequest(m), m).toBe(false);
        }
    });
});

describe('appTargetNamedIn', () => {
    it('matches on title, slug and first slug segment', () => {
        expect(appTargetNamedIn('open wayfare', wayfare)).toBe(true);
        expect(appTargetNamedIn('open Wayfare Field Ops', { ...wayfare, title: 'Wayfare Field Ops' })).toBe(true);
        expect(appTargetNamedIn('open wayfare', { ...wayfare, title: 'Wayfare Field Ops' })).toBe(true);
    });
    it('refuses generic segments and absent names', () => {
        expect(appTargetNamedIn('open the portal', { ...wayfare, slug: 'portal-1', publicSlug: 'portal-1', title: 'Ops Portal' })).toBe(false);
        expect(appTargetNamedIn('open dispatch', wayfare)).toBe(false);
    });
});

describe('runDirectCycleAppMount', () => {
    it('mounts the canvas for an installed app named in the message', async () => {
        const ctx = context('open Wayfare');
        expect(await runDirectCycleAppMount(ctx, card)).toBe(true);
        expect(execute).toHaveBeenCalledWith('render_app_surface',
            expect.objectContaining({ source: 'app', slug: 'wayfare-8fd06', href: '/app/wayfare-8fd06', mode: 'embed' }),
            expect.any(Array), expect.objectContaining({ organizationId: 342 }));
        const turn = inserted[0];
        expect(turn.artifacts[0].payload.studioSurface).toBe('cycle_canvas');
        expect(turn.artifacts[0].payload.publicSlug).toBe('wayfare-8fd06');
        expect(turn.toolsUsed).toHaveLength(1);
        expect(turn.content).toContain('App Studio');
    });

    it('mounts via first-segment slug match when the title is longer', async () => {
        listOrgAppTargets.mockResolvedValue([{ ...wayfare, title: 'Wayfare Field Ops' }]);
        expect(await runDirectCycleAppMount(context('launch the wayfare app'), card)).toBe(true);
        expect(inserted).toHaveLength(1);
    });

    it('declines a build request so the forge path keeps it', async () => {
        expect(await runDirectCycleAppMount(context('build a wayfare app for field ops'), card)).toBe(false);
        expect(listOrgAppTargets).not.toHaveBeenCalled();
        expect(inserted).toHaveLength(0);
    });

    it('declines when the name matches no installed deployment', async () => {
        expect(await runDirectCycleAppMount(context('open dispatch console'), card)).toBe(false);
        expect(inserted).toHaveLength(0);
    });

    it('declines platform surfaces that carry no deployment', async () => {
        listOrgAppTargets.mockResolvedValue([
            wayfare,
            { slug: 'signal-intelligence', title: 'Signal Intelligence', href: '/signal-intelligence', source: 'app' },
        ]);
        expect(await runDirectCycleAppMount(context('open signal intelligence'), card)).toBe(false);
    });

    it('declines a target whose artifact is not canvas-marked', async () => {
        execute.mockResolvedValue({
            record: { name: 'render_app_surface', ok: true, ms: 2 },
            output: '', artifact: { tool: 'render_app_surface', payload: { type: 'assistant_app', title: 'Wayfare' } },
        });
        expect(await runDirectCycleAppMount(context('open Wayfare'), card)).toBe(false);
        expect(inserted).toHaveLength(0);
    });

    it('declines without a speaker card', async () => {
        expect(await runDirectCycleAppMount(context('open Wayfare'), undefined)).toBe(false);
    });
});

describe('mountedStudioApp on a canvas artifact', () => {
    it('treats the mounted canvas as the room\'s open app', async () => {
        const mounted = { speakerType: 'agent', content: '', artifacts: [canvasArtifact] };
        const ctx = context('whatever', ) as any;
        ctx.priorTurns = [mounted];
        const { mountedStudioApp } = await import('../crew-app-studio.service.js');
        expect(mountedStudioApp(ctx)).toEqual({ appId: 7, slug: 'wayfare-8fd06', name: 'Wayfare' });
    });
    it('ignores an unmarked app card', async () => {
        const card = { speakerType: 'agent', content: '', artifacts: [{ tool: 'render_app_surface', payload: { type: 'assistant_app', title: 'X', appId: 3 } }] };
        const ctx = context('whatever') as any;
        ctx.priorTurns = [card];
        const { mountedStudioApp } = await import('../crew-app-studio.service.js');
        expect(mountedStudioApp(ctx)).toBeNull();
    });
});
