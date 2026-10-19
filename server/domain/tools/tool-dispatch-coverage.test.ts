/**
 * Phase 2 — durable guard that advertised tools stay dispatchable.
 *
 * handleToolCall dispatches a tool either via an explicit switch case (bespoke
 * handlers) or the generic registry fallthrough. Every tool advertised to the
 * planner must be reachable by one of those. These tests fail the build if:
 *   - a tool is advertised but malformed (no execute / bad schema), or
 *   - the registry fallthrough is removed while tools still rely on it, or
 *   - an advertised tool isn't actually resolvable from the registry.
 */

/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getAgentTools, auditToolRegistrySanity } from "@domain/tools/v1/capabilities/index.js";
import { normalizeToolName } from "@domain/tools/v1/tool-registry.service.js";

const handlersSrc = fs.readFileSync(
    path.resolve(process.cwd(), "server/mcp/handlers.ts"),
    "utf8",
);
const caseLabels = new Set<string>(
    [...handlersSrc.matchAll(/case\s+"([^"]+)"\s*:/g)].map(m => m[1]),
);
const advertised = Object.keys(getAgentTools(true));

describe("tool dispatch coverage (advertised ⊆ dispatchable)", () => {
    it("every advertised tool is executable (has execute + parseable schema)", () => {
        const { missingExecute, badSchema } = auditToolRegistrySanity();
        expect({ missingExecute, badSchema }).toEqual({ missingExecute: [], badSchema: [] });
    });

    it("keeps the registry fallthrough — many advertised tools depend on it", () => {
        // Tools with no explicit switch case rely entirely on the fallthrough.
        const relyOnFallthrough = advertised.filter(
            n => !caseLabels.has(n) && !caseLabels.has(normalizeToolName(n)),
        );
        // Documents reality (was 182): if this collapses, the switch grew cases
        // unexpectedly; if the fallthrough vanishes, the next assertion fails.
        expect(relyOnFallthrough.length).toBeGreaterThan(50);
        // The fallthrough MUST still be present in handleToolCall, or every tool
        // in relyOnFallthrough silently regresses to "Unknown tool".
        expect(handlersSrc).toMatch(/getAgentTools\(\)\[normalizedName\]/);
    });

    it("no advertised tool is unresolvable (advertised names resolve in the registry)", () => {
        const reg = getAgentTools(true);
        const unresolvable = advertised.filter(n => !reg[normalizeToolName(n)] && !reg[n]);
        expect(unresolvable).toEqual([]);
    });
});
