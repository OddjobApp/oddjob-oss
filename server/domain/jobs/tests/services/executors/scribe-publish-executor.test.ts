/**
 * ScribePublishExecutor tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job, Pipeline } from "@shared/schema/index.js";

const crystallizeFromContext = vi.fn();
const publishDocument = vi.fn();
const buildExportFile = vi.fn();
const attachToRoom = vi.fn();

vi.mock("@domain/scribe/core/scribe.service.js", () => ({
    scribeService: { crystallizeFromContext, publishDocument },
}));
vi.mock("@domain/scribe/core/scribe-export.service.js", () => ({
    buildExportFile,
}));
vi.mock("@domain/knowledge/core/attachment.service.js", () => ({
    attachmentService: { attachToRoom },
}));

import { ScribePublishExecutor } from "@domain/jobs/core/executors/scribe-publish-executor.js";

const executor = new ScribePublishExecutor();

const mockJob = {
    id: 7,
    name: 'Publish Brief',
    type: 'scribe_publish',
    config: {},
    organizationId: 3,
} as unknown as Job;

const mockPipeline = {
    id: 11,
    name: 'Publish Flow',
    organizationId: 3,
} as unknown as Pipeline;

const baseContext = { named: {}, positional: {} } as any;

const publishedResult = {
    document: { id: 42, sessionId: 9, title: 'Incident Brief' },
    compiled: { title: 'Incident Brief', content: '# Hi', wordCount: 1200 },
    attachment: { id: 55, blobId: 66, projectId: 77 },
    versionTag: 'v2.0',
    downloadUrl: '/api/attachments/55/download',
};

beforeEach(() => {
    vi.clearAllMocks();
    publishDocument.mockResolvedValue(publishedResult);
});

describe('ScribePublishExecutor', () => {
    it('canExecute matches scribe_publish only', () => {
        expect(executor.canExecute('scribe_publish')).toBe(true);
        expect(executor.canExecute('media_take')).toBe(false);
    });

    it('publishes markdown and returns the publication output', async () => {
        const result = await executor.execute(mockJob, { documentId: 42, format: 'markdown' }, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(result.status).toBe('success');
        expect(publishDocument).toHaveBeenCalledWith(42, 3, {
            branchId: undefined,
            versionTag: undefined,
            releaseNotes: undefined,
            userId: 'workflow-runtime',
        });
        const out = JSON.parse(result.output);
        expect(out).toMatchObject({
            _type: 'scribe_publication',
            documentId: 42,
            title: 'Incident Brief',
            wordCount: 1200,
            versionTag: 'v2.0',
            format: 'markdown',
            attachmentId: 55,
            blobId: 66,
            downloadUrl: '/api/attachments/55/download',
        });
        expect(out.wordAttachmentId).toBeUndefined();
        expect(crystallizeFromContext).not.toHaveBeenCalled();
    });

    it('crystallizes a non-empty contextParagraph before publishing', async () => {
        const result = await executor.execute(
            mockJob,
            { documentId: 42, format: 'markdown', contextParagraph: 'Upstream findings: the pump failed.' },
            mockPipeline,
            baseContext
        );

        expect(result.success).toBe(true);
        expect(crystallizeFromContext).toHaveBeenCalledWith(42, 3, 'Upstream findings: the pump failed.', {});
        expect(crystallizeFromContext.mock.invocationCallOrder[0]).toBeLessThan(publishDocument.mock.invocationCallOrder[0]);
    });

    it('attaches a DOCX when format is word', async () => {
        buildExportFile.mockResolvedValue({
            filename: 'Incident_Brief_v2.0.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            body: Buffer.from('docx-bytes'),
        });
        attachToRoom.mockResolvedValue({ attachment: { id: 88 }, blob: { id: 99 } });

        const result = await executor.execute(mockJob, { documentId: 42, format: 'word', versionTag: 'v2.0' }, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(buildExportFile).toHaveBeenCalledWith(publishedResult.compiled, 'word');
        expect(attachToRoom).toHaveBeenCalledWith({
            orgId: 3,
            projectId: 77,
            sessionId: 9,
            buffer: expect.any(Buffer),
            originalName: 'Incident_Brief_v2.0.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            uploadedBy: 'workflow-runtime',
        });
        expect(JSON.parse(result.output).wordAttachmentId).toBe(88);
    });

    it('fails when no organization is resolvable', async () => {
        const job = { ...mockJob, organizationId: null } as unknown as Job;
        const pipeline = { ...mockPipeline, organizationId: null } as unknown as Pipeline;
        const result = await executor.execute(job, { documentId: 42, format: 'markdown' }, pipeline, baseContext);

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toMatch(/organization/i);
        expect(publishDocument).not.toHaveBeenCalled();
    });

    it('returns a failed result instead of throwing when the service errors', async () => {
        publishDocument.mockRejectedValue(new Error('Document not found'));

        const result = await executor.execute(mockJob, { documentId: 999, format: 'markdown' }, mockPipeline, baseContext);

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toBe('Document not found');
    });
});
