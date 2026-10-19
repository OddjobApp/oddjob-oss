import { describe, it, expect } from "vitest";
import { PIPELINE_TOOLS } from "./pipelines.js";
import { UNIVERSAL_PRESENTATION_TOOLS } from "@domain/crew/core/crew-tools.service.js";

/**
 * Guards the fix for the single largest source of recorded tool failures.
 *
 * Measured from agent_tool_usage (281 calls, Jun–Aug 2026): 18.9% of tool calls
 * failed, 88.7% of those were "named a resource that does not exist", and 52 of
 * the 53 failures came from show_pipeline_input_form alone. The model invented a
 * plausible pipeline name, got back a dead end that never said what WAS valid,
 * and retried another invention until the circuit breaker opened (the remaining
 * 9.4% of failures).
 *
 * Two properties keep that from recurring, and neither is visible in a type:
 *   1. the not-found message must name the alternatives, and
 *   2. the discovery tool must be grantable wherever the form tool is, or the
 *      advice to "call list_pipelines first" points at a tool the agent lacks.
 */
describe("show_pipeline_input_form recovery contract", () => {
    it("tells the model to discover rather than guess a pipeline name", () => {
        const def = PIPELINE_TOOLS.show_pipeline_input_form;
        expect(def, "show_pipeline_input_form is not defined").toBeDefined();

        // It previously said "Use this IMMEDIATELY", which actively discouraged
        // the lookup that would have prevented the failures.
        expect(def.description).not.toMatch(/IMMEDIATELY/);
        expect(def.description).toMatch(/list_pipelines/);
    });

    it("ships the discovery tool in the same grant as the form tool", () => {
        // A recovery instruction naming a tool the agent does not hold is the
        // same defect as a prompt naming an unregistered tool: silently absent.
        const granted = UNIVERSAL_PRESENTATION_TOOLS as readonly string[];
        expect(granted).toContain("show_pipeline_input_form");
        expect(granted).toContain("list_pipelines");
    });

    it("defines list_pipelines so the advice resolves to a real tool", () => {
        expect(PIPELINE_TOOLS.list_pipelines).toBeDefined();
        expect(PIPELINE_TOOLS.list_pipelines.name).toBe("list_pipelines");
    });
});

/**
 * The recovery contract above made the dead end recoverable. It did not stop the
 * dead end from happening: 47 of the 52 failures were the model passing "1" — an
 * id it had just read from list_pipelines, or an ordinal from a list it rendered.
 *
 * Every string went down the name path, so the lookup asked for a pipeline
 * literally NAMED "1". The parameter is typed z.union([z.number(), z.string()]),
 * so a numeric string is a shape the contract explicitly invites; treating it as
 * a name was the defect.
 */
describe("show_pipeline_input_form identifier contract", () => {
    const def = PIPELINE_TOOLS.show_pipeline_input_form;

    it("accepts a numeric string, which is what the model actually sends", () => {
        const parsed = def.parameters.safeParse({ pipelineId: "1" });
        expect(parsed.success).toBe(true);
    });

    it("accepts a number and a name, so no caller shape regresses", () => {
        expect(def.parameters.safeParse({ pipelineId: 7 }).success).toBe(true);
        expect(def.parameters.safeParse({ pipelineId: "Daily Sync" }).success).toBe(true);
    });

    it("resolves a numeric string as an id before trying it as a name", () => {
        // Asserted on the source: the branch runs inside execute() behind a DB
        // call, and the property that matters is ordering — an id lookup must
        // precede the name lookup, or "1" resolves as a name again.
        const src = def.execute.toString();
        const idProbe = src.indexOf("asNumericId");
        const nameProbe = src.indexOf("ilike");
        expect(idProbe, "numeric-id resolution missing").toBeGreaterThan(-1);
        expect(nameProbe, "name resolution missing").toBeGreaterThan(-1);
        expect(idProbe).toBeLessThan(nameProbe);
    });

    it("scopes the id lookup by organization", () => {
        // An id is guessable in a way a name is not, so an unscoped lookup here
        // would let one tenant render another tenant's pipeline form.
        const src = def.execute.toString();
        const idProbe = src.indexOf("asNumericId");
        const scoped = src.indexOf("getOrgConditions", idProbe);
        const nameProbe = src.indexOf("ilike");
        expect(scoped).toBeGreaterThan(-1);
        expect(scoped).toBeLessThan(nameProbe);
    });

    it("still falls through to the name path, so a pipeline named '1' resolves", () => {
        // Structural, not comment-based: transpilation strips comments, so an
        // earlier version of this assertion passed only by accident of tooling.
        // The id lookup sets a flag and the name path sits in the else-branch, so
        // a miss continues rather than returning early.
        const src = def.execute.toString();
        expect(src).toMatch(/resolvedById/);
        const flagUse = src.indexOf("if (resolvedById)");
        expect(flagUse, "id resolution must gate the branch, not return early").toBeGreaterThan(-1);
        expect(src.indexOf("ilike")).toBeGreaterThan(flagUse);
    });
});
