/**
 * MediaTakeExecutor tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job, Pipeline } from "@shared/schema/index.js";
import type { ProductionView, SceneView, ShotView, TakeView } from "@shared/media-studio.js";

const getProduction = vi.fn();
const requestTake = vi.fn();
const refreshTakeStatus = vi.fn();

vi.mock("@domain/media-studio/core/media-studio.service.js", () => ({
    mediaStudio: { getProduction, requestTake, refreshTakeStatus },
}));
vi.mock("@server/utils/auth-context.js", () => ({
    getSystemOrgContext: (organizationId: number | null) => ({
        userId: "system",
        organizationId,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: true,
    }),
}));

import { MediaTakeExecutor } from "@domain/jobs/core/executors/media-take-executor.js";

const executor = new MediaTakeExecutor();

const mockJob = {
    id: 5,
    name: 'Shoot Scene',
    type: 'media_take',
    config: {},
    organizationId: 3,
} as unknown as Job;

const mockPipeline = {
    id: 11,
    name: 'Media Flow',
    organizationId: 3,
} as unknown as Pipeline;

const baseContext = { named: {}, positional: {} } as any;

function take(id: number, takeNumber: number, status: TakeView["status"]): TakeView {
    return { id, takeNumber, status } as TakeView;
}

function shot(id: number, takes: TakeView[] = []): ShotView {
    return { id, takes } as ShotView;
}

function scene(id: number, shots: ShotView[]): SceneView {
    return { id, shots } as SceneView;
}

function production(scenes: SceneView[]): ProductionView {
    return { id: 20, scenes } as ProductionView;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('MediaTakeExecutor', () => {
    it('canExecute matches media_take only', () => {
        expect(executor.canExecute('media_take')).toBe(true);
        expect(executor.canExecute('scribe_publish')).toBe(false);
    });

    it('sceneId resolves all shots and suspends with the returned take ids', async () => {
        const initial = production([scene(100, [shot(1), shot(2)])]);
        getProduction.mockResolvedValue(initial);
        requestTake
            .mockResolvedValueOnce(production([scene(100, [shot(1, [take(500, 1, 'pending_approval')]), shot(2)])]))
            .mockResolvedValueOnce(production([scene(100, [shot(1, [take(500, 1, 'pending_approval')]), shot(2, [take(501, 1, 'pending_approval')])])]));

        const result = await executor.execute(mockJob, { productionId: 20, sceneId: 100, waitFor: 'approved', maxTakes: 10 }, mockPipeline, baseContext);

        expect(requestTake).toHaveBeenCalledTimes(2);
        expect(requestTake).toHaveBeenNthCalledWith(1, expect.objectContaining({ userId: 'workflow-runtime', organizationId: 3 }), 1, expect.any(Object), {});
        expect(result.success).toBe(true);
        expect(result.status).toBe('waiting_async');
        const out = JSON.parse(result.output);
        expect(out).toMatchObject({ _type: 'media_takes', productionId: 20, takeIds: [500, 501], waitFor: 'approved' });
        expect(out.requestedAt).toBeTruthy();
        expect((result as any).suspensionMetadata).toEqual({ waitReason: 'media_render', takeIds: [500, 501] });
    });

    it('fails when shotIds are not part of the production, before any request', async () => {
        getProduction.mockResolvedValue(production([scene(100, [shot(1), shot(2)])]));

        const result = await executor.execute(mockJob, { productionId: 20, shotIds: [1, 999], waitFor: 'approved', maxTakes: 10 }, mockPipeline, baseContext);

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toContain('999');
        expect(requestTake).not.toHaveBeenCalled();
    });

    it('completes immediately when every take is simulated', async () => {
        getProduction.mockResolvedValue(production([scene(100, [shot(1)])]));
        requestTake.mockResolvedValue(production([scene(100, [shot(1, [take(700, 1, 'simulated')])])]));

        const result = await executor.execute(mockJob, { productionId: 20, shotIds: [1], waitFor: 'approved', maxTakes: 10 }, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(result.status).toBe('success');
        const out = JSON.parse(result.output);
        expect(out.mode).toBe('simulation');
        expect(out.takeIds).toEqual([700]);
    });

    it('fails before requesting when the resolved shots exceed maxTakes', async () => {
        getProduction.mockResolvedValue(production([scene(100, [shot(1), shot(2), shot(3)])]));

        const result = await executor.execute(mockJob, { productionId: 20, sceneId: 100, waitFor: 'approved', maxTakes: 2 }, mockPipeline, baseContext);

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toMatch(/maxTakes/);
        expect(requestTake).not.toHaveBeenCalled();
    });

    it('fails when the scene is not part of the production', async () => {
        getProduction.mockResolvedValue(production([scene(100, [shot(1)])]));

        const result = await executor.execute(mockJob, { productionId: 20, sceneId: 999, waitFor: 'approved', maxTakes: 10 }, mockPipeline, baseContext);

        expect(result.success).toBe(false);
        expect(requestTake).not.toHaveBeenCalled();
    });
});
