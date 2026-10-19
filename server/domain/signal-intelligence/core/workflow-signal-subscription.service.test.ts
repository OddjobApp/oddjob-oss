/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signal → workflow delivery: a matching event starts a run of the bound
 * workflow's ACTIVE deployment, deduped by the unique delivery row.
 *
 * `db` is the same chainable fake the lifecycle test uses — each awaited
 * builder resolves the next `h.results` entry, `insert(...).values(...)`
 * records into `h.inserted`, `update(...).set(...)` into `h.sets`.
 */

const h = vi.hoisted(() => ({
    results: [] as any[],
    inserted: [] as any[],
    sets: [] as any[],
    getWorkflowRow: vi.fn(),
    assertProjectRead: vi.fn(),
    assertProjectRole: vi.fn(),
    getByIdSystem: vi.fn(),
    resolveActiveRelease: vi.fn(),
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
                    if (prop === "set") h.sets.push(args[0]);
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

vi.mock("@domain/pipeline/core/workflow-lifecycle.service.js", () => ({
    workflowLifecycleService: {
        getWorkflowRow: h.getWorkflowRow,
        assertProjectRead: h.assertProjectRead,
        assertProjectRole: h.assertProjectRole,
        getByIdSystem: h.getByIdSystem,
        resolveActiveRelease: h.resolveActiveRelease,
    },
}));

vi.mock("@server/core/pipeline-executor.js", () => ({
    pipelineExecutor: { executePipeline: h.executePipeline },
}));

const { workflowSignalSubscriptionService } = await import("./workflow-signal-subscription.service.js");

const sub = (over: Record<string, unknown> = {}) => ({
    id: 1,
    organizationId: 7,
    workflowId: 5,
    name: "policy alerts",
    enabled: true,
    filters: {},
    environment: "production",
    cooldownMinutes: 0,
    lastDeliveredAt: null,
    createdBy: "user-1",
    ...over,
});

const event = (over: Record<string, unknown> = {}) => ({
    id: "evt-1",
    organizationId: 7,
    eventType: "policy_change",
    targetSector: "Energy",
    jurisdiction: "US",
    severity: "High",
    confidenceScore: 0.9,
    createdAt: new Date(),
    ...over,
}) as any;

const transition = { id: "tr-1", environmentVariables: { price: 42 } } as any;
const workflow = { id: 5, organizationId: 7, draftPipelineId: 100, title: "Triage", status: "draft" };

describe("workflow signal delivery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.results = [];
        h.inserted = [];
        h.sets = [];
        h.getByIdSystem.mockResolvedValue(workflow);
        h.executePipeline.mockResolvedValue({ success: true, executionId: 777 });
    });

    it("a matching signal with an active deployment starts a release-pinned run", async () => {
        h.resolveActiveRelease.mockResolvedValue({ workflowId: 5, releaseId: 11, deploymentId: 22, manifest: {} });
        h.results.push(
            [sub()],                    // subscriptions select
            [{ id: "del-1" }],          // delivery insert returning
            [],                         // deliveries update (release/deployment — synchronous)
            [],                         // subscriptions lastDeliveredAt update
            [],                         // deliveries update (executionId — after the run resolves)
        );

        const started = await workflowSignalSubscriptionService.deliver(event(), transition, []);

        // Counted at launch: the run itself is detached so a long workflow
        // cannot block the ingest path.
        expect(started).toBe(1);
        expect(h.inserted[0]).toMatchObject({
            organizationId: 7,
            subscriptionId: 1,
            workflowId: 5,
            eventPrimitiveId: "evt-1",
            disposition: "started",
        });
        expect(h.executePipeline).toHaveBeenCalledWith(
            100,
            "system-signal-trigger",
            null,
            null,
            expect.objectContaining({
                signal: expect.objectContaining({
                    id: "evt-1",
                    eventType: "policy_change",
                    severity: "High",
                    subscriptionId: 1,
                }),
            }),
            undefined,
            undefined,
            undefined,
            undefined,
            { workflowReleaseId: 11, workflowDeploymentId: 22 },
        );
        // The release/deployment stamp lands synchronously; pipelineExecutionId
        // arrives when the detached run resolves.
        expect(h.sets).toContainEqual(
            expect.objectContaining({ releaseId: 11, deploymentId: 22 }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(h.sets).toContainEqual(
            expect.objectContaining({ pipelineExecutionId: 777 }),
        );
    });

    it("skips with 'skipped:no_active_deployment' when nothing is active", async () => {
        h.resolveActiveRelease.mockResolvedValue(null);
        h.results.push(
            [sub()],
            [{ id: "del-1", payload: {} }],
            [],                          // paused deployment check → none
            [],                          // markDelivery update
            [],                          // lastDeliveredAt update
        );

        const started = await workflowSignalSubscriptionService.deliver(event(), transition, []);

        expect(started).toBe(0);
        expect(h.executePipeline).not.toHaveBeenCalled();
        expect(h.sets).toContainEqual(expect.objectContaining({ disposition: "skipped:no_active_deployment" }));
    });

    it("skips with 'skipped:paused' when the deployment exists but is paused", async () => {
        h.resolveActiveRelease.mockResolvedValue(null);
        h.results.push(
            [sub()],
            [{ id: "del-1", payload: {} }],
            [{ id: 9 }],                  // paused deployment exists
            [],
            [],
        );

        await workflowSignalSubscriptionService.deliver(event(), transition, []);

        expect(h.executePipeline).not.toHaveBeenCalled();
        expect(h.sets).toContainEqual(expect.objectContaining({ disposition: "skipped:paused" }));
    });

    it("ignores a duplicate delivery — the unique row already exists", async () => {
        h.results.push(
            [sub()],
            [],                          // insert onConflictDoNothing → nothing
        );

        const started = await workflowSignalSubscriptionService.deliver(event(), transition, []);

        expect(started).toBe(0);
        expect(h.executePipeline).not.toHaveBeenCalled();
        expect(h.getByIdSystem).not.toHaveBeenCalled();
    });

    it("honours the cooldown window", async () => {
        h.results.push([sub({ cooldownMinutes: 60, lastDeliveredAt: new Date() })]);

        const started = await workflowSignalSubscriptionService.deliver(event(), transition, []);

        expect(started).toBe(0);
        expect(h.inserted).toHaveLength(0);
        expect(h.executePipeline).not.toHaveBeenCalled();
    });

    it("records 'error' when the executor fails and continues to the next subscription", async () => {
        h.resolveActiveRelease.mockResolvedValue({ workflowId: 5, releaseId: 11, deploymentId: 22, manifest: {} });
        // The first run stays pending until the loop is done — that is the
        // whole point of the detach: its rejection must not interleave with,
        // or block, the second subscription's synchronous launch.
        let rejectFirst!: (error: Error) => void;
        h.executePipeline
            .mockImplementationOnce(() => new Promise((_res, rej) => { rejectFirst = rej; }))
            .mockResolvedValueOnce({ success: true, executionId: 888 });
        h.results.push(
            [sub({ id: 1 }), sub({ id: 2 })],
            [{ id: "del-1", payload: {} }],
            [],                          // release/deployment stamp for sub 1
            [],                          // lastDeliveredAt for sub 1
            [{ id: "del-2", payload: {} }],
            [],                          // release/deployment stamp for sub 2
            [],                          // lastDeliveredAt for sub 2
            [],                          // executionId update for sub 2 (detached)
            [],                          // markDelivery error update for sub 1 (detached)
        );

        const started = await workflowSignalSubscriptionService.deliver(event(), transition, []);

        // Both subscriptions launch synchronously — the first one's pending
        // run did not block the second.
        expect(started).toBe(2);
        expect(h.executePipeline).toHaveBeenCalledTimes(2);

        rejectFirst(new Error("release exploded"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(h.sets).toContainEqual(
            expect.objectContaining({ disposition: "error", payload: expect.objectContaining({ error: "release exploded" }) }),
        );
        expect(h.sets).toContainEqual(expect.objectContaining({ pipelineExecutionId: 888 }));
    });

    it("writes nothing for a filter mismatch", async () => {
        h.results.push([sub({ filters: { eventTypes: ["sanctions_change"] } })]);

        const started = await workflowSignalSubscriptionService.deliver(event(), transition, []);

        expect(started).toBe(0);
        expect(h.inserted).toHaveLength(0);
        expect(h.executePipeline).not.toHaveBeenCalled();
    });
});
