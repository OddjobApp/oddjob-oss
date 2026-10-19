/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `formStudioStages.start` — a workflow release pins the form release its
 * response starts on; everything else keeps answering the form's CURRENT
 * release.
 *
 * `db` is the chainable fake: each awaited builder resolves the next
 * `h.results` entry; `insert(...).values(...)` records into `h.inserted`.
 */

const h = vi.hoisted(() => ({
    results: [] as any[],
    inserted: [] as any[],
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
    return {
        db: {
            select: () => qb(),
            insert: () => qb(),
            update: () => qb(),
            delete: () => qb(),
            execute: async () => undefined,
            transaction: async (fn: any) => fn({ select: () => qb(), insert: () => qb(), update: () => qb() }),
        },
    };
});

// The studio-definition helpers are exercised elsewhere; start() only needs
// them to exist and hand back the release schema.
vi.mock("@shared/form-studio.js", () => ({
    asStudioDefinition: vi.fn((schema: any) => schema),
    evaluateStudio: vi.fn(() => ({ decision: { state: "undecided" } })),
    withoutCohortValues: vi.fn((v: any) => v),
}));
vi.mock("@shared/form-studio-stages.js", () => ({
    emptyLedger: vi.fn(() => ({ stages: [] })),
    nextStageId: vi.fn(() => "stage-1"),
    lockStage: vi.fn(),
    stageView: vi.fn(),
    StageError: class StageError extends Error {
        reason: string;
        constructor(reason: string, message: string) { super(message); this.reason = reason; }
    },
}));
vi.mock("./form-studio-cohorts.service.js", () => ({ cohortValuesFor: vi.fn(async () => ({})) }));

const { formStudioStages } = await import("./form-studio-stages.service.js");

const form = (published?: number) => ({
    id: 12,
    name: "Intake Form",
    organizationId: 7,
    kind: "template",
    isArchived: false,
    config: published ? { formStudio: { published: { releaseNumber: published } } } : {},
});

const release = (n: number) => ({
    id: 90 + n,
    formId: 12,
    kind: "release",
    releaseNumber: n,
    formRevision: 40 + n,
    name: `Intake v${n}`,
    schema: { studio: { stages: [{ id: "stage-1" }] } },
});

describe("formStudioStages.start", () => {
    beforeEach(() => {
        h.results = [];
        h.inserted = [];
        vi.clearAllMocks();
    });

    it("starts on the form's current published release without opts", async () => {
        h.results.push([form(3)], [release(3)], [{ id: 55 }]);

        const result = await formStudioStages.start(12, 7, { pipelineExecutionId: 9 });

        expect(result.releaseNumber).toBe(3);
        const inserted = h.inserted[0];
        expect(inserted.config.formStudioResponse).toMatchObject({
            formId: 12,
            releaseNumber: 3,
            origin: { pipelineExecutionId: 9 },
        });
    });

    it("starts on the PINNED release a workflow release recorded, not the current one", async () => {
        // The form has moved on to v3 since the workflow release pinned v2.
        h.results.push([form(3)], [release(2)], [{ id: 55 }]);

        const result = await formStudioStages.start(12, 7, {}, { releaseNumber: 2 });

        expect(result.releaseNumber).toBe(2);
        expect(h.inserted[0].config.formStudioResponse.releaseNumber).toBe(2);
    });

    it("refuses a pinned release that no longer exists", async () => {
        h.results.push([form(3)], []); // v2 was never written or was removed

        await expect(formStudioStages.start(12, 7, {}, { releaseNumber: 2 }))
            .rejects.toMatchObject({ statusCode: 404, message: 'Release v2 of "Intake Form" no longer exists' });
    });

    it("still refuses an unpublished form with no pin", async () => {
        h.results.push([form()]);

        await expect(formStudioStages.start(12, 7))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});
