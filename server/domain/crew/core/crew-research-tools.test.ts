import { describe, expect, it } from "vitest";
import { classifyReadOnly, RESEARCH_TOOLS } from "./crew-tools.service.js";
import type { ToolDefinition } from "@domain/tools/v1/capabilities/types.js";

const def = (over: Partial<ToolDefinition> & { name: string }) =>
    ({ description: "", parameters: {} as never, execute: async () => "", ...over }) as ToolDefinition;

describe("research tier", () => {
    it("admits every research tool", () => {
        for (const name of RESEARCH_TOOLS) {
            const reason = classifyReadOnly(def({ name }));
            if (name === "propose_research_mission") {
                expect(reason, name).toBe("proposal");
            } else {
                expect(reason, name).toBe("research");
            }
        }
    });

    it("admits the two the name heuristic cannot", () => {
        // browse_web has no read verb; propose_research_mission reads as neither.
        // They are in only because the tier says so — which is the point of an
        // explicit list over loosening READ_TOKENS for everything.
        expect(classifyReadOnly(def({ name: "browse_web" }))).toBe("research");
        expect(classifyReadOnly(def({ name: "propose_research_mission" }))).toBe("proposal");
    });

    it("does not admit neighbours that merely look similar", () => {
        // Guards against the tier being read as "anything web-shaped is fine".
        expect(classifyReadOnly(def({ name: "post_webhook" }))).toBeNull();
        expect(classifyReadOnly(def({ name: "run_research_mission" }))).toBeNull();
        expect(classifyReadOnly(def({ name: "delete_web_cache" }))).toBeNull();
    });

    it("still refuses an admin-gated tool with a research name", () => {
        // Disqualifiers are checked before any tier, so membership cannot be used
        // to smuggle past an admin gate.
        expect(classifyReadOnly(def({ name: "google_search", adminOnly: true }))).toBeNull();
        expect(classifyReadOnly(def({ name: "browse_web", superAdminOnly: true }))).toBeNull();
        expect(classifyReadOnly(def({ name: "browse_web", riskLevel: "high" }))).toBeNull();
    });

    it("puts local knowledge before the open web", () => {
        // The order is the escalation the prompt describes, and the reason
        // propose_research_mission is last: it is the step taken when the
        // cheaper ones found nothing.
        expect(RESEARCH_TOOLS.indexOf("search_unified_knowledge")).toBeLessThan(
            RESEARCH_TOOLS.indexOf("google_search"),
        );
        expect(RESEARCH_TOOLS.indexOf("google_search")).toBeLessThan(
            RESEARCH_TOOLS.indexOf("browse_web"),
        );
        expect(RESEARCH_TOOLS[RESEARCH_TOOLS.length - 1]).toBe("propose_research_mission");
    });

    it("does not grant a tool that RUNS research rather than proposing it", () => {
        // The tier's admissibility argument rests on approval being a human's.
        expect(RESEARCH_TOOLS).not.toContain("run_research_mission" as never);
        expect(RESEARCH_TOOLS).not.toContain("execute_mission" as never);
    });
});
