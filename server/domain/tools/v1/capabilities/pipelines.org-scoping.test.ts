import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards the tenant boundary on show_pipeline_input_form's name lookup.
 *
 * The lookup was originally `eq(pipelines.name, ...)` with no organization
 * filter at all. That was fixed with `orgId != null ? eq(...) : undefined` —
 * which closes the common case and leaves the null one wide open, because
 * `.where(undefined)` is not a narrow query, it is NO query: every
 * organization's rows come back.
 *
 * `OrgContext.organizationId` is `number | null`, so null is a case that
 * actually occurs. It matters most in the not-found branch, which puts the
 * names it finds directly into the model's context and from there into the
 * user's chat — disclosure, not merely a wide read.
 *
 * These tests assert the property that a type cannot: every query this path
 * issues carries a WHERE clause, whether or not an organization is present.
 */

const whereArgs: unknown[] = [];
let selectResults: any[][] = [];

function makeChain() {
    const chain: any = {
        from: () => chain,
        where: (w: unknown) => { whereArgs.push(w); return chain; },
        limit: () => chain,
        then: (resolve: any, reject: any) =>
            Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
    };
    return chain;
}

vi.mock("../../../../database_service.js", () => ({
    db: {
        select: () => makeChain(),
        query: { agentDeployments: { findFirst: vi.fn().mockResolvedValue(undefined) } },
    },
}));

// Force the DB name-resolution branch: with no asset-triage match, the tool
// falls through to looking the name up in `pipelines`.
vi.mock("../../../asset-service/form-block.service.js", () => ({
    formBlockService: { resolveByKey: () => null, getIntentForm: vi.fn() },
}));

import { PIPELINE_TOOLS } from "./pipelines.js";

async function resolveInventedName(organizationId: number | null) {
    whereArgs.length = 0;
    // 1st select: the name lookup (miss). 2nd: the "available pipelines" listing.
    selectResults = [[], [{ name: "Other Tenant Pipeline" }]];

    return PIPELINE_TOOLS.show_pipeline_input_form.execute(
        { pipelineId: "intent_selection", fields: [] },
        { organizationId, userId: "u1" } as any,
    );
}

describe("show_pipeline_input_form tenant scoping", () => {
    beforeEach(() => {
        whereArgs.length = 0;
        selectResults = [];
    });

    it("scopes both queries when an organization is present", async () => {
        await resolveInventedName(42);

        expect(whereArgs.length).toBe(2);
        for (const w of whereArgs) expect(w).toBeDefined();
    });

    it("still scopes both queries when organizationId is null", async () => {
        // The regression: `.where(undefined)` on the null path returned every
        // organization's pipeline names. The canonical rule for a null org is
        // `organizationId IS NULL` — org-less pipelines only, never all of them.
        await resolveInventedName(null);

        expect(whereArgs.length).toBe(2);
        for (const w of whereArgs) {
            expect(w, "a null organizationId must not drop the WHERE clause").toBeDefined();
        }
    });

    it("still names the alternatives it is allowed to see", async () => {
        // Scoping must not regress the recovery behaviour the error exists for.
        const out = await resolveInventedName(42);

        expect(String(out)).toContain("Other Tenant Pipeline");
        expect(String(out)).toContain("list_pipelines");
    });

    it("tells the model to stop rather than guess when it can see none", async () => {
        whereArgs.length = 0;
        selectResults = [[], []];

        const out = await PIPELINE_TOOLS.show_pipeline_input_form.execute(
            { pipelineId: "intent_selection", fields: [] },
            { organizationId: 42, userId: "u1" } as any,
        );

        expect(String(out)).toMatch(/No pipelines are defined/);
        expect(String(out)).toMatch(/rather than retrying/i);
    });
});
