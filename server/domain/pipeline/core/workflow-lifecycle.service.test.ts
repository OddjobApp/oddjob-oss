/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit coverage for the workflow lifecycle service: idempotent create, the
 * publish dedupe, release-ownership checks on activate, the no-active-deployment
 * gate on startRun, and the zero-steps manifest refusal.
 *
 * `db` is a chainable fake: every query builder resolves to the next entry of
 * `h.results` in call order, so each test queues the rows its scenario reads.
 * The transaction body is run against the same fake.
 */

const h = vi.hoisted(() => ({
    results: [] as any[],
    inserted: [] as any[],
    getPipelineById: vi.fn(),
    getSystem: vi.fn(),
    getByIds: vi.fn(),
    resolveProjectForResource: vi.fn(),
    attachResource: vi.fn(),
    getProject: vi.fn(),
    roleFor: vi.fn(),
    executePipeline: vi.fn(),
}));

vi.mock("@server/database_service.js", () => {
    const qb = () =>
        new Proxy({} as any, {
            get(_t, prop: string) {
                if (prop === "then") {
                    return (res: any, rej: any) => Promise.resolve(h.results.shift()).then(res, rej);
                }
                return (...args: any[]) => {
                    if (prop === "values") h.inserted.push(args[0]);
                    return qb();
                };
            },
        });
    const fakeDb = {
        select: () => qb(),
        insert: () => qb(),
        update: () => qb(),
        delete: () => qb(),
        execute: async () => undefined,
        transaction: async (fn: any) => fn({ select: () => qb(), insert: () => qb(), execute: async () => undefined }),
    };
    return { db: fakeDb };
});

vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: (_name: string, fn: () => any) => fn(),
}));

vi.mock("@domain/pipeline/core/pipeline.service.js", () => ({
    pipelineService: {
        getById: h.getPipelineById,
        getSystem: h.getSystem,
    },
}));

vi.mock("@domain/jobs/job.service.js", () => ({
    jobService: { getByIds: h.getByIds },
}));

vi.mock("@domain/projects/core/project.service.js", () => ({
    projectService: {
        resolveProjectForResource: h.resolveProjectForResource,
        attachResource: h.attachResource,
        getProject: h.getProject,
        roleFor: h.roleFor,
    },
}));

vi.mock("@server/core/pipeline-executor.js", () => ({
    pipelineExecutor: { executePipeline: h.executePipeline },
}));

import { workflowLifecycleService } from "./workflow-lifecycle.service.js";
import { manifestDigest } from "./workflow-manifest.js";

const ctx = { userId: "user-1", organizationId: 7, isAdmin: false, isSuperAdmin: false, isOrgAdmin: true };

const workflow = {
    id: 42,
    organizationId: 7,
    title: "Lead triage",
    description: null,
    draftPipelineId: 100,
    status: "draft",
    createdBy: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
};

const pipeline = {
    id: 100,
    name: "Lead triage",
    description: "Triage inbound leads",
    triggerType: "manual",
    triggerCredentialId: null,
    labels: null,
    isActive: true,
    organizationId: 7,
    createdBy: "user-1",
    createdAt: new Date(),
    currentVersion: 1,
    monthlyBudgetUsd: null,
    enableKnowledgeGraph: false,
    knowledgeGraphConfig: null,
    lifecycleStatus: "active",
    governorSettings: null,
    governorPolicyId: null,
    baselineRunId: null,
    baselineOutput: null,
    selfHealingEnabled: false,
};

const steps = [
    { id: 11, pipelineId: 100, jobId: 5, order: 0 },
    { id: 12, pipelineId: 100, jobId: 9, order: 1, fallbackJobId: null },
];

const jobs = [
    { id: 5, name: "Score lead", organizationId: 7 },
    { id: 9, name: "Notify", organizationId: 7 },
];

function queuePublish(latestRelease: any, nextNumber: number, inserted: any) {
    // getWorkflowRow, buildManifest(steps, triggers), latest release, tx max, tx insert
    h.results.push(
        [workflow],
        steps,
        [],
        latestRelease ? [latestRelease] : [],
        [{ max: nextNumber - 1 }],
        [inserted],
    );
}

beforeEach(() => {
    h.results = [];
    h.inserted = [];
    vi.clearAllMocks();
    h.getPipelineById.mockResolvedValue(pipeline);
    h.getSystem.mockResolvedValue(pipeline);
    h.getByIds.mockResolvedValue(jobs);
    h.resolveProjectForResource.mockResolvedValue(null);
    h.executePipeline.mockResolvedValue({ success: true, executionId: 555 });
});

describe("createFromPipeline", () => {
    it("creates a workflow the first time and returns the same row on retry", async () => {
        // First call: no existing workflow -> insert.
        h.results.push([], [{ ...workflow }]);
        const first = await workflowLifecycleService.createFromPipeline(ctx, { pipelineId: 100 });
        expect(first.id).toBe(42);
        expect(h.inserted[0]).toMatchObject({ draftPipelineId: 100, organizationId: 7, title: "Lead triage" });

        // Second call: the unique-index row is found, nothing is inserted again.
        h.inserted = [];
        h.results.push([workflow]);
        const second = await workflowLifecycleService.createFromPipeline(ctx, { pipelineId: 100 });
        expect(second.id).toBe(42);
        expect(h.inserted).toHaveLength(0);
    });

    it("still attaches to a project when the workflow already existed", async () => {
        h.results.push([workflow]);
        h.attachResource.mockResolvedValue({ id: 1 });
        await workflowLifecycleService.createFromPipeline(ctx, { pipelineId: 100, projectId: 9 });
        expect(h.attachResource).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 7 }), 9, "workflow", 42, "primary");
    });
});

describe("buildManifest", () => {
    it("refuses a pipeline with zero steps", async () => {
        h.results.push([]); // steps
        await expect(workflowLifecycleService.buildManifest(100)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("refuses when a referenced job no longer exists", async () => {
        h.getByIds.mockResolvedValue([jobs[0]]);
        h.results.push(steps, []);
        await expect(workflowLifecycleService.buildManifest(100)).rejects.toMatchObject({ statusCode: 400 });
    });

    /**
     * human_approval {formId, stageId} steps ask the form's CURRENT release at
     * run time — the manifest pins the release current at publish time instead.
     */
    const approvalStep = { id: 13, pipelineId: 100, jobId: 6, order: 0, fallbackJobId: null };
    const approvalJob = { id: 6, name: "Intake stage", type: "human_approval", organizationId: 7, config: { formId: 12, stageId: "intake" } };
    const form = (published?: number) => ({
        id: 12, name: "Intake Form", organizationId: 7, kind: "template", isArchived: false,
        config: published ? { formStudio: { published: { releaseNumber: published } } } : {},
    });
    const formRelease = (n: number, schema: any = { studio: { stages: ["intake"] } }) => ({
        id: 90 + n, formId: 12, kind: "release", releaseNumber: n, formRevision: 40 + n,
        name: `Intake v${n}`, schema,
    });

    it("pins the form release a human_approval step references", async () => {
        h.getByIds.mockResolvedValue([approvalJob]);
        // steps, triggers, form template row, release row
        h.results.push([approvalStep], [], [form(2)], [formRelease(2)]);
        const manifest = await workflowLifecycleService.buildManifest(100);

        expect(manifest.formReleases).toEqual({ "12": { releaseNumber: 2, formRevision: 42, name: "Intake v2" } });
        const dep = manifest.dependencies.find((d) => d.kind === "form_release");
        expect(dep).toMatchObject({ id: "12", revision: 2 });
        expect(dep?.digest).toHaveLength(64);
        expect(manifest.dependencies).toContainEqual(expect.objectContaining({ kind: "job", id: "6" }));
    });

    it("refuses to release when the form is unpublished or missing", async () => {
        h.getByIds.mockResolvedValue([approvalJob]);
        h.results.push([approvalStep], [], [form()]); // template exists, never published
        await expect(workflowLifecycleService.buildManifest(100))
            .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Publish form "Intake Form" before releasing') });

        h.results = [];
        h.results.push([approvalStep], [], []); // no template row at all
        await expect(workflowLifecycleService.buildManifest(100))
            .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Form 12 referenced by job "Intake stage" was not found') });
    });

    it("digests differently when the form release changes", async () => {
        h.getByIds.mockResolvedValue([approvalJob]);
        h.results.push([approvalStep], [], [form(2)], [formRelease(2)]);
        const first = await workflowLifecycleService.buildManifest(100);

        h.results.push([approvalStep], [], [form(3)], [formRelease(3, { studio: { stages: ["intake", "signoff"] } })]);
        const second = await workflowLifecycleService.buildManifest(100);

        expect(manifestDigest(first)).not.toBe(manifestDigest(second));
        expect(second.formReleases?.["12"].releaseNumber).toBe(3);
    });
});

describe("publish", () => {
    it("returns unchanged without inserting when the draft is identical", async () => {
        // First publish inserts release 1.
        queuePublish(null, 1, { id: 71, workflowId: 42, releaseNumber: 1 });
        const first = await workflowLifecycleService.publish(ctx, 42);
        expect(first).toMatchObject({ unchanged: false });
        const digest = first.release.digest ?? manifestDigest((h.inserted.at(-1) as any).manifest);

        // Second publish: the latest release carries the same digest.
        const existing = { id: 71, workflowId: 42, releaseNumber: 1, digest };
        h.results.push([workflow], steps, [], [existing]); // no tx entries needed
        const second = await workflowLifecycleService.publish(ctx, 42);
        expect(second).toEqual({ release: existing, unchanged: true });
    });

    it("mints releaseNumber 2 with a different digest after a step change", async () => {
        queuePublish(null, 1, { id: 71, workflowId: 42, releaseNumber: 1, digest: "d1" });
        await workflowLifecycleService.publish(ctx, 42);

        const changedSteps = [{ ...steps[0], outputName: "renamed" }, steps[1]];
        const latest = { id: 71, workflowId: 42, releaseNumber: 1, digest: "d1" };
        h.results.push([workflow], changedSteps, [], [latest], [{ max: 1 }], [{ id: 72, workflowId: 42, releaseNumber: 2 }]);
        const second = await workflowLifecycleService.publish(ctx, 42);
        expect(second.unchanged).toBe(false);
        expect(second.release.releaseNumber).toBe(2);
    });
});

describe("activate", () => {
    it("rejects a release that belongs to another workflow", async () => {
        h.results.push([workflow], []); // workflow found, release lookup empty
        await expect(workflowLifecycleService.activate(ctx, 42, { releaseId: 999 }))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("startRun", () => {
    it("refuses when no active deployment exists for the environment", async () => {
        h.results.push([workflow], []);
        await expect(workflowLifecycleService.startRun(ctx, 42)).rejects.toMatchObject({ statusCode: 409 });
        expect(h.executePipeline).not.toHaveBeenCalled();
    });

    it("runs the draft pipeline tagged with the active release and deployment", async () => {
        h.results.push([workflow], [{ id: 88, releaseId: 71, status: "active" }]);
        const result = await workflowLifecycleService.startRun(ctx, 42, { input: { q: 1 } });
        expect(result).toEqual({ executionId: 555 });
        expect(h.executePipeline).toHaveBeenCalledWith(
            100, "user-1", null, null, { q: 1 },
            undefined, undefined, undefined, undefined,
            { workflowReleaseId: 71, workflowDeploymentId: 88 },
        );
    });
});

describe("project gates", () => {
    const notFound = Object.assign(new Error("Project 'p' not found."), { statusCode: 404 });

    it("needs operator on the workflow's project to start a run", async () => {
        h.resolveProjectForResource.mockResolvedValue(3);
        h.getProject.mockResolvedValue({ id: 3, key: "p" });
        h.roleFor.mockResolvedValue("viewer");
        h.results.push([workflow]);
        await expect(workflowLifecycleService.startRun(ctx, 42)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.executePipeline).not.toHaveBeenCalled();
    });

    it("hides a workflow in a private project the caller cannot read", async () => {
        h.resolveProjectForResource.mockResolvedValue(3);
        h.getProject.mockRejectedValue(notFound);
        h.results.push([workflow]);
        await expect(workflowLifecycleService.get(ctx, 42)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("drops unreadable workflows from the org-wide list", async () => {
        const other = { ...workflow, id: 43 };
        h.resolveProjectForResource.mockImplementation(async (_t: string, id: number) => (id === 43 ? 3 : null));
        h.getProject.mockRejectedValue(notFound);
        h.results.push([workflow, other]);
        const rows = await workflowLifecycleService.list(ctx);
        expect(rows.map((w: any) => w.id)).toEqual([42]);
    });
});
