import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillDecisionEngine } from "../../server/domain/agents/core/skill-decision-engine.js";
import { SkillAugmentationService } from "../../server/domain/agents/core/skill-augmentation.service.js";
import { SkillGovernanceService } from "../../server/domain/agents/core/skill-governance.service.js";

describe("Skill Integration System - End-to-End Logic", () => {
    it("exports all core domain services", () => {
        expect(SkillDecisionEngine).toBeDefined();
        expect(SkillAugmentationService).toBeDefined();
        expect(SkillGovernanceService).toBeDefined();
    });

    it("evaluates decision recommendations across threshold bands", () => {
        expect(SkillDecisionEngine.getRecommendationForScore(95)).toBe("augment_existing");
        expect(SkillDecisionEngine.getRecommendationForScore(80)).toBe("augment_existing");
        expect(SkillDecisionEngine.getRecommendationForScore(75)).toBe("assign_multiple");
        expect(SkillDecisionEngine.getRecommendationForScore(60)).toBe("assign_multiple");
        expect(SkillDecisionEngine.getRecommendationForScore(50)).toBe("hybrid");
        expect(SkillDecisionEngine.getRecommendationForScore(40)).toBe("hybrid");
        expect(SkillDecisionEngine.getRecommendationForScore(30)).toBe("create_new_agent");
        expect(SkillDecisionEngine.getRecommendationForScore(0)).toBe("create_new_agent");
    });

    it("evaluates multi-factor compatibility between skill and agent card", () => {
        const mockAgent = {
            id: 201,
            organizationId: 291,
            name: "Financial Analyst",
            description: "Expert in accounting, financial models, revenue projections, and spreadsheets.",
            personaType: "finance-advisor",
            modelBindingProviderId: null,
            modelBindingModelId: null,
            capabilities: ["revenue forecasting", "budget variance", "DCF valuation"],
            tools: ["excel_generator", "calculator", "quickbooks_reader"],
            topicAffinities: ["Finance", "General"],
            intentAffinities: ["Analysis"],
            enabled: true,
            isDefault: false,
            oceanTraits: { o: 0.7, c: 0.9, e: 0.4, a: 0.6, n: 0.2 },
            soulArchetype: "Analyst",
            legend: "Financial precision.",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const matchingSkill = {
            name: "Corporate Financial Modeling Toolset",
            description: "Advanced revenue forecasting and DCF valuation tools for finance-advisor personas.",
            persona: "finance-advisor",
            capabilities: ["revenue forecasting", "DCF valuation", "EBITDA analysis"],
            tools: ["excel_generator", "tax_calculator"],
            tags: ["Finance"],
            securityReport: { riskLevel: "low" as const },
        };

        const match = SkillDecisionEngine.evaluateMatch(matchingSkill, mockAgent);
        expect(match.score).toBeGreaterThanOrEqual(80);
        expect(match.recommendation).toBe("augment_existing");
        expect(match.breakdown.matchedCapabilities).toContain("revenue forecasting");
        expect(match.breakdown.matchedCapabilities).toContain("DCF valuation");
        expect(match.breakdown.newCapabilities).toContain("EBITDA analysis");
    });
});
