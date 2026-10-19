/**
 * AgentPersonaService Unit Tests
 */

import { describe, it, expect } from "vitest";
import { AgentPersonaService, PERSONA_TEMPLATES } from "@domain/agents/agent-persona.service.js";

describe("AgentPersonaService", () => {
    describe("getTemplate", () => {
        it("should return the generic template for 'generic' persona", () => {
            const tpl = AgentPersonaService.getTemplate("generic");
            expect(tpl.name).toBe("Generic Agent");
            expect(tpl.systemPromptTrait).toBeDefined();
        });

        it("should return the researcher template", () => {
            const tpl = AgentPersonaService.getTemplate("researcher");
            expect(tpl.name).toBe("Researcher");
            expect(tpl.suggestedTools).toContain("google_search");
        });

        it("should return the critic template", () => {
            const tpl = AgentPersonaService.getTemplate("critic");
            expect(tpl.name).toBe("Critic / Reviewer");
            expect(tpl.defaultSpecialties).toContain("Fact Checking");
        });

        it("should return the analyst template", () => {
            const tpl = AgentPersonaService.getTemplate("analyst");
            expect(tpl.name).toBe("Data Analyst");
            expect(tpl.suggestedTools).toContain("sql_query");
        });

        it("should return the strategist template", () => {
            const tpl = AgentPersonaService.getTemplate("strategist");
            expect(tpl.name).toBe("Strategist");
        });

        it("should return the debugger template", () => {
            const tpl = AgentPersonaService.getTemplate("debugger");
            expect(tpl.name).toBe("Debugger / Fixer");
            expect(tpl.suggestedTools).toContain("shell");
        });

        it("should return the creator template", () => {
            const tpl = AgentPersonaService.getTemplate("creator");
            expect(tpl.name).toBe("Creator");
        });

        it("should fall back to generic for unknown persona", () => {
            const tpl = AgentPersonaService.getTemplate("unknown" as any);
            expect(tpl.name).toBe("Generic Agent");
        });
    });

    describe("augmentSystemPrompt", () => {
        it("should return base prompt unchanged for generic persona", () => {
            const result = AgentPersonaService.augmentSystemPrompt("generic", "My base prompt.");
            expect(result).toBe("My base prompt.");
        });

        it("should return empty string for generic with no base prompt", () => {
            const result = AgentPersonaService.augmentSystemPrompt("generic");
            expect(result).toBe("");
        });

        it("should prepend persona header for non-generic persona", () => {
            const result = AgentPersonaService.augmentSystemPrompt("researcher", "Base prompt.");
            expect(result).toContain("## PERSONA: Researcher");
            expect(result).toContain("Base prompt.");
        });

        it("should inject persona trait into system prompt", () => {
            const result = AgentPersonaService.augmentSystemPrompt("critic", "Do stuff.");
            const tpl = PERSONA_TEMPLATES["critic"];
            expect(result).toContain(tpl.systemPromptTrait);
        });

        it("should work for strategist without base prompt", () => {
            const result = AgentPersonaService.augmentSystemPrompt("strategist");
            expect(result).toContain("## PERSONA: Strategist");
        });
    });
});
