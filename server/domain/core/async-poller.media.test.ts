/**
 * Async poller: media_take step handling
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Query results are consumed in call order: first the pipelineExecutions
// lookup, then the mediaTakes read.
let selectResults: any[][] = [];
const refreshTakeStatus = vi.fn();
const updateStepExecution = vi.fn();
const updateExecution = vi.fn();
const getStepById = vi.fn();
const resumePipelineExecution = vi.fn();

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => {
                    const rows = selectResults.shift() ?? [];
                    const promise = Promise.resolve(rows);
                    return { limit: () => Promise.resolve(rows), then: promise.then.bind(promise) };
                },
            }),
        }),
    },
}));
vi.mock("@domain/media-studio/core/media-studio.service.js", () => ({
    mediaStudio: { refreshTakeStatus },
}));
vi.mock("@domain/pipeline/core/pipeline.service.js", () => ({
    pipelineService: { updateStepExecution, updateExecution, getStepById },
}));
vi.mock("@server/core/pipeline-executor.js", () => ({
    pipelineExecutor: { resumePipelineExecution },
}));
vi.mock("@domain/knowledge/core/file-storage.js", () => ({
    fileStorageSuccess: { listFiles: vi.fn() },
}));
vi.mock("@server/utils/auth-context.js", () => ({
    assertOrgId: (id: number) => id,
    getSystemOrgContext: (organizationId: number | null) => ({
        userId: "system",
        organizationId,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: true,
    }),
}));

import { handleMediaTakeStep } from "./async-poller.service.js";

const job = { id: 5, type: "media_take", organizationId: 3 } as any;

function stepExec(output: any) {
    return {
        id: 88,
        jobId: 5,
        pipelineExecutionId: 400,
        pipelineStepId: 12,
        stepOrder: 1,
        output: JSON.stringify(output),
    } as any;
}

function takeRow(id: number, status: string, extra: Record<string, any> = {}) {
    return {
        id,
        shotId: id + 1000,
        organizationId: 3,
        status,
        videoAssetId: null,
        costCents: 250,
        error: null,
        notes: null,
        ...extra,
    };
}

const pendingOutput = (overrides: Record<string, any> = {}) => ({
    _type: "media_takes",
    productionId: 20,
    takeIds: [500, 501],
    waitFor: "approved",
    requestedAt: new Date().toISOString(),
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    selectResults = [];
    refreshTakeStatus.mockResolvedValue(undefined);
    getStepById.mockResolvedValue(null); // no step row → "Stop Pipeline" default
});

describe('handleMediaTakeStep', () => {
    it('marks success and resumes when every take is approved', async () => {
        selectResults = [
            [{ id: 400, organizationId: 3 }],                       // pipelineExecutions
            [takeRow(500, 'approved'), takeRow(501, 'approved', { videoAssetId: 12 })], // mediaTakes
        ];

        await handleMediaTakeStep(stepExec(pendingOutput()), job);

        expect(refreshTakeStatus).toHaveBeenCalledTimes(2);
        expect(updateStepExecution).toHaveBeenCalledWith(88, expect.objectContaining({ status: 'success' }));
        const output = JSON.parse(updateStepExecution.mock.calls[0][1].output);
        expect(output._type).toBe('media_takes_result');
        expect(output.productionId).toBe(20);
        expect(output.takes).toHaveLength(2);
        expect(output.takes[0]).toMatchObject({ takeId: 500, shotId: 1500, status: 'approved' });
        expect(output.totalCostCents).toBe(500);
        expect(resumePipelineExecution).toHaveBeenCalledWith(400);
    });

    it('fails the step when a take is rejected', async () => {
        selectResults = [
            [{ id: 400, organizationId: 3 }],
            [takeRow(500, 'approved'), takeRow(501, 'rejected', { notes: 'The render was not approved.' })],
        ];

        await handleMediaTakeStep(stepExec(pendingOutput()), job);

        expect(updateStepExecution).toHaveBeenCalledWith(88, expect.objectContaining({
            status: 'failed',
            error: expect.stringContaining('Take 501 rejected'),
        }));
        expect(updateExecution).toHaveBeenCalledWith(400, expect.objectContaining({ status: 'failed' }));
        expect(resumePipelineExecution).not.toHaveBeenCalled();
    });

    it('leaves the step waiting while takes are still rendering', async () => {
        selectResults = [
            [{ id: 400, organizationId: 3 }],
            [takeRow(500, 'rendering'), takeRow(501, 'queued')],
        ];

        await handleMediaTakeStep(stepExec(pendingOutput()), job);

        expect(updateStepExecution).not.toHaveBeenCalledWith(88, expect.objectContaining({ status: 'success' }));
        expect(updateStepExecution).not.toHaveBeenCalledWith(88, expect.objectContaining({ status: 'failed' }));
        expect(resumePipelineExecution).not.toHaveBeenCalled();
    });

    it('completes on ready_for_review when waitFor=ready_for_review', async () => {
        selectResults = [
            [{ id: 400, organizationId: 3 }],
            [takeRow(500, 'ready_for_review'), takeRow(501, 'approved')],
        ];

        await handleMediaTakeStep(stepExec(pendingOutput({ waitFor: 'ready_for_review' })), job);

        expect(updateStepExecution).toHaveBeenCalledWith(88, expect.objectContaining({ status: 'success' }));
        expect(resumePipelineExecution).toHaveBeenCalledWith(400);
    });

    it('does not complete on ready_for_review when waitFor=approved', async () => {
        selectResults = [
            [{ id: 400, organizationId: 3 }],
            [takeRow(500, 'ready_for_review'), takeRow(501, 'ready_for_review')],
        ];

        await handleMediaTakeStep(stepExec(pendingOutput()), job);

        expect(resumePipelineExecution).not.toHaveBeenCalled();
        expect(updateStepExecution).not.toHaveBeenCalledWith(88, expect.objectContaining({ status: 'success' }));
    });

    it('fails after the 72h wall-clock timeout', async () => {
        selectResults = [
            [{ id: 400, organizationId: 3 }],
            [takeRow(500, 'rendering'), takeRow(501, 'rendering')],
        ];
        const stale = pendingOutput({ requestedAt: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString() });

        await handleMediaTakeStep(stepExec(stale), job);

        expect(updateStepExecution).toHaveBeenCalledWith(88, expect.objectContaining({
            status: 'failed',
            error: 'media takes did not complete within 72h',
        }));
    });
});
