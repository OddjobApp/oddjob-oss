import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards the tenant boundary on tools that delegate to the MCP handlers.
 *
 * The handlers resolve their organization with getOrgContext(context), which
 * falls back to ODDJOB_ORG_ID || 1 when context is missing or its org is null.
 * These wrappers called `handleX(params)` with no context at all, so every
 * agent in every organization (CREW included) read org 1's pipeline runs and
 * details, ran org 1's pipelines, and created datasets and graph entities in
 * org 1. A wrapper must pass the caller's context through, and must refuse
 * rather than reach the fallback.
 */

const handlers = vi.hoisted(() => {
    const ok = () => ({ content: [{ type: "text", text: '{"success":true}' }] });
    return {
        handleGetPipelineDetails: vi.fn(async () => ok()),
        handleRunPipeline: vi.fn(async () => ok()),
        handleListRecentExecutions: vi.fn(async () => ok()),
        handleCreateDataset: vi.fn(async () => ok()),
        handleCreateEntity: vi.fn(async () => ok()),
        handleCreateRelationship: vi.fn(async () => ok()),
        handleSuggestSchema: vi.fn(async () => ok()),
    };
});
vi.mock("../../../../mcp/handlers.js", () => handlers);

const db = vi.hoisted(() => ({ rows: [] as any[], whereArgs: [] as unknown[] }));
vi.mock("../../../../database_service.js", () => {
    const chain: any = {
        from: () => chain,
        where: (w: unknown) => { db.whereArgs.push(w); return chain; },
        limit: () => chain,
        then: (resolve: any, reject: any) => Promise.resolve(db.rows).then(resolve, reject),
    };
    return { db: { select: () => chain } };
});

vi.mock("../../../core/input-validation.service.js", () => ({
    InputValidationService: {
        validateInputs: vi.fn(async () => ({ isValid: true, errors: [] })),
        generateAgentPrompt: vi.fn(async () => "INPUT SCHEMA"),
    },
}));

import { PIPELINE_TOOLS } from "./pipelines.js";
import { DATA_TOOLS } from "./data.js";
import { KNOWLEDGE_TOOLS } from "./knowledge.js";

const ORG = { organizationId: 42, userId: "u1", isAdmin: true, isOrgAdmin: true } as any;

const cases: Array<[string, () => any, string, any]> = [
    ["get_pipeline_details", () => PIPELINE_TOOLS.get_pipeline_details, "handleGetPipelineDetails", { pipelineId: 7 }],
    ["run_pipeline", () => PIPELINE_TOOLS.run_pipeline, "handleRunPipeline", { pipelineId: 7 }],
    ["list_recent_executions", () => PIPELINE_TOOLS.list_recent_executions, "handleListRecentExecutions", {}],
    ["create_dataset", () => DATA_TOOLS.create_dataset, "handleCreateDataset", { name: "d" }],
    ["create_entity", () => KNOWLEDGE_TOOLS.create_entity, "handleCreateEntity", { name: "e", entityType: "Service" }],
    ["create_relationship", () => KNOWLEDGE_TOOLS.create_relationship, "handleCreateRelationship", { sourceEntityName: "a", targetEntityName: "b", relationType: "USES" }],
    ["suggest_schema", () => KNOWLEDGE_TOOLS.suggest_schema, "handleSuggestSchema", { domainDescription: "x" }],
];

describe("MCP-delegating tools carry the caller's organization", () => {
    beforeEach(() => {
        for (const fn of Object.values(handlers)) fn.mockClear();
        db.rows = [{ id: 7 }];
        db.whereArgs = [];
    });

    it.each(cases)("%s passes the caller's context to its handler", async (_name, tool, handler, params) => {
        await tool().execute(params, ORG);
        const fn = (handlers as any)[handler];
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn.mock.calls[0][1]?.organizationId).toBe(42);
    });

    it.each(cases)("%s refuses with no organization instead of falling back to org 1", async (_name, tool, handler, params) => {
        await expect(tool().execute(params, { ...ORG, organizationId: null })).rejects.toThrow(/Organization context required/);
        expect((handlers as any)[handler]).not.toHaveBeenCalled();
    });

    it("run_pipeline does not validate or run a pipeline id outside the caller's organization", async () => {
        db.rows = [];
        const out = await PIPELINE_TOOLS.run_pipeline.execute({ pipelineId: 999 }, ORG);
        expect(String(out)).toMatch(/not found in this organization/);
        expect(handlers.handleRunPipeline).not.toHaveBeenCalled();
        expect(db.whereArgs).toHaveLength(1);
    });

    it("get_pipeline_details adds no input schema for a pipeline the scoped handler did not find", async () => {
        handlers.handleGetPipelineDetails.mockResolvedValueOnce({
            isError: true, content: [{ type: "text", text: '{"success":false,"error":"Pipeline not found"}' }],
        } as any);
        const out = await PIPELINE_TOOLS.get_pipeline_details.execute({ pipelineId: 999 }, ORG);
        expect(String(out)).toContain("Pipeline not found");
        expect(String(out)).not.toContain("INPUT SCHEMA");
    });
});
