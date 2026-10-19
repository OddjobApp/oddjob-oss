/**
 * HumanApprovalExecutor — the Form Studio stage branch.
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job, Pipeline } from "@shared/schema/index.js";

const openFormStage = vi.fn();

vi.mock("@domain/pipeline/core/form-studio-stage-requests.service.js", () => ({
    openFormStage,
    isFormStageRequest: vi.fn(),
}));
vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@domain/integrations/gmail-service.js", () => ({
    gmailService: { loadCredentials: vi.fn().mockResolvedValue(false), sendHilNotification: vi.fn() },
}));
vi.mock("@domain/core/auth/jwt.service.js", () => ({
    generateExternalToken: vi.fn(() => "token"),
}));

import { HumanApprovalExecutor } from "@domain/jobs/core/executors/human-approval-executor.js";

const executor = new HumanApprovalExecutor();

const job = { id: 7, name: 'Intake approval', type: 'human_approval', organizationId: 3, config: {} } as unknown as Job;
const pipeline = { id: 11, name: 'Intake flow', organizationId: 3 } as unknown as Pipeline;
const config = { formId: 12, stageId: 'intake', approvers: [{ type: 'external', email: 'a@b.c' }] };

beforeEach(() => {
    vi.clearAllMocks();
    openFormStage.mockResolvedValue({
        kind: 'waiting', responseId: 5, approvalRequestIds: [1], message: 'Waiting for a@b.c',
    });
});

describe('HumanApprovalExecutor form-stage branch', () => {
    it('passes the manifest-pinned release through to openFormStage', async () => {
        const context = {
            named: {}, positional: {},
            workflowRelease: { id: 71, formReleases: { '12': { releaseNumber: 2, formRevision: 9, name: 'Intake v2' } } },
        } as any;

        const result = await executor.execute(job, config, pipeline, context, undefined, 100);

        expect(result.status).toBe('waiting_external_input');
        expect(openFormStage).toHaveBeenCalledWith(expect.objectContaining({
            formId: 12,
            stageId: 'intake',
            releaseNumber: 2,
        }));
    });

    it('leaves releaseNumber unset on a run with no workflow release', async () => {
        const result = await executor.execute(job, config, pipeline, { named: {}, positional: {} } as any, undefined, 100);

        expect(result.status).toBe('waiting_external_input');
        expect(openFormStage).toHaveBeenCalledWith(expect.objectContaining({ releaseNumber: undefined }));
    });
});
