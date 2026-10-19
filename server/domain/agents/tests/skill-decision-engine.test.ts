import { describe, it, expect } from "vitest";
import { SkillDecisionEngine, type SkillEvaluationInput } from "../core/skill-decision-engine.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

describe("SkillDecisionEngine", () => {
    const mockAgent1: AgentCardRecord = {
        id: 101,
        organizationId: 291,
        name: "Data Analyst Pro",
        description: "Specializes in data analysis, SQL query generation, and dashboard metrics.",
        personaType: "data-analyst",
        modelBindingProviderId: null,
        modelBindingModelId: null,
        capabilities: ["data analysis", "SQL generation", "visualization", "metrics forecasting"],
        tools: ["sql_runner", "chart_generator", "csv_parser"],
        topicAffinities: ["Finance", "General"],
        topicLabelAffinities: [],
        intentAffinities: ["Analysis", "Code Execution"],
        enabled: true,
        isDefault: false,
        oceanTraits: { o: 0.8, c: 0.9, e: 0.4, a: 0.7, n: 0.2 },
        soulArchetype: "Analyst",
        legend: "I turn raw numbers into actionable business insights.",
        approvalBoundary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockAgent2: AgentCardRecord = {
        id: 102,
        organizationId: 291,
        name: "Security Sentinel",
        description: "Hardened security agent for vulnerability scans and audit logging.",
        personaType: "security-auditor",
        modelBindingProviderId: null,
        modelBindingModelId: null,
        capabilities: ["vulnerability scanning", "secret detection", "threat modeling"],
        tools: ["vuln_scanner", "secret_finder"],
        topicAffinities: ["Legal", "General"],
        topicLabelAffinities: [],
        intentAffinities: ["Alert", "Analysis"],
        enabled: true,
        isDefault: false,
        oceanTraits: { o: 0.4, c: 0.95, e: 0.3, a: 0.5, n: 0.1 },
        soulArchetype: "Guardian",
        legend: "Guarding systems with zero-trust rigor.",
        approvalBoundary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    describe("Capability Overlap Scoring", () => {
        it("scores maximum when all capabilities match exactly", () => {
            const result = SkillDecisionEngine.scoreCapabilityOverlap(
                ["data analysis", "SQL generation"],
                ["data analysis", "SQL generation", "visualization"]
            );
            expect(result.score).toBe(25);
            expect(result.matchedCapabilities).toContain("data analysis");
            expect(result.matchedCapabilities).toContain("SQL generation");
            expect(result.newCapabilities.length).toBe(0);
        });

        it("scores partially when semantic token similarity matches", () => {
            const result = SkillDecisionEngine.scoreCapabilityOverlap(
                ["analyze structured data", "generate sql queries"],
                ["data analysis", "SQL generation"]
            );
            expect(result.score).toBeGreaterThanOrEqual(10);
            expect(result.matchedCapabilities.length).toBeGreaterThan(0);
        });

        it("identifies new capabilities when no overlap exists", () => {
            const result = SkillDecisionEngine.scoreCapabilityOverlap(
                ["quantum cryptography", "dna sequencing"],
                ["data analysis", "SQL generation"]
            );
            expect(result.score).toBe(0);
            expect(result.newCapabilities).toContain("quantum cryptography");
            expect(result.newCapabilities).toContain("dna sequencing");
        });
    });

    describe("Risk Assessment Scoring", () => {
        it("awards full 25 points for low risk", () => {
            const score = SkillDecisionEngine.scoreRiskAssessment({ riskLevel: "low" });
            expect(score).toBe(25);
        });

        it("awards 15 points for medium risk", () => {
            const score = SkillDecisionEngine.scoreRiskAssessment({ riskLevel: "medium" });
            expect(score).toBe(15);
        });

        it("awards 5 points for high risk and docks further for secrets", () => {
            const score = SkillDecisionEngine.scoreRiskAssessment({
                riskLevel: "high",
                findings: [{ type: "secret", message: "Leaked API key", severity: "high" }],
            });
            expect(score).toBeLessThanOrEqual(5);
        });
    });

    describe("Multi-Agent Ranking & Recommendations", () => {
        it("recommends augment_existing when compatibility score is >= 80", () => {
            const highMatchSkill: SkillEvaluationInput = {
                name: "Advanced SQL & Data Analytics Skill",
                description: "Enhances data analysis, visualization, and SQL query creation for data-analyst personas.",
                persona: "data-analyst",
                capabilities: ["data analysis", "SQL generation", "visualization"],
                tools: ["sql_runner", "chart_generator"],
                tags: ["Finance", "Analysis"],
                securityReport: { riskLevel: "low" },
            };

            const result = SkillDecisionEngine.rankAgents(highMatchSkill, [mockAgent1, mockAgent2]);
            expect(result.bestMatch?.agentCardId).toBe(101);
            expect(result.compatibilityScore).toBeGreaterThanOrEqual(80);
            expect(result.overallRecommendation).toBe("augment_existing");
            expect(result.targetAgentCardId).toBe(101);
        });

        it("recommends create_new_agent when no existing agent matches (< 40)", () => {
            const novelSkill: SkillEvaluationInput = {
                name: "Biomedical Gene Expression Mapper",
                description: "Translates RNA sequences and genomic variant annotations.",
                persona: "bioinformatician",
                capabilities: ["rna sequencing", "variant mapping", "genomic alignment"],
                tools: ["blast_tool", "foldseek"],
                tags: ["Health", "Bio"],
                securityReport: { riskLevel: "low" },
            };

            const result = SkillDecisionEngine.rankAgents(novelSkill, [mockAgent1, mockAgent2]);
            expect(result.compatibilityScore).toBeLessThan(50);
            expect(result.overallRecommendation).toBe("create_new_agent");
            expect(result.targetAgentCardId).toBeNull();
        });

        it("handles empty agent list gracefully", () => {
            const result = SkillDecisionEngine.rankAgents({ name: "Any Skill" }, []);
            expect(result.overallRecommendation).toBe("create_new_agent");
            expect(result.topMatches).toEqual([]);
            expect(result.compatibilityScore).toBe(0);
        });
    });
});
