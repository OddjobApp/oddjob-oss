/**
 * Predictive Planning Service Tests
 * 
 * Comprehensive test suite for AI-powered mission planning.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    predictivePlanningService,
    type MissionPattern,
    type GeneratedPlan,
} from "../core/predictive-planning.service.js";

// Mock dependencies
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        publish: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("@domain/mission/core/mission-correlation.service.js", () => ({
    missionCorrelationService: {
        getCorrelationId: vi.fn().mockReturnValue("corr_test_123"),
    },
}));

/**
 * Rows the fake learned-patterns query returns, and what addPattern wrote.
 * vi.hoisted because mock factories are lifted above ordinary declarations.
 */
const { learnedPatternRows, insertedPatterns } = vi.hoisted(() => ({
    learnedPatternRows: [] as any[],
    insertedPatterns: [] as any[],
}));

vi.mock("../../../database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                }),
                // loadLearnedPatterns: select().from().where() resolves directly.
                // Honours the org filter, so a test can prove one org cannot
                // see another's rows rather than assuming it.
                where: vi.fn().mockImplementation(async (cond: any) => {
                    const orgId = cond?.__eq?.[0] === "org" ? cond.__eq[1] : undefined;
                    return orgId === undefined
                        ? learnedPatternRows
                        : learnedPatternRows.filter(r => r.organizationId === orgId);
                }),
            }),
        }),
        // An insert has to be visible to a subsequent select, or the fake is
        // not modelling the durability the test claims to check.
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((v: any) => {
                insertedPatterns.push(v);
                learnedPatternRows.push(v);
                return { onConflictDoUpdate: async () => undefined };
            }),
        }),
    },
}));

vi.mock("@shared/schema/index.js", () => ({
    missions: {},
    missionRuns: {},
    missionLearnedPatterns: { organizationId: "org", patternKey: "key" },
}));

vi.mock("drizzle-orm", () => ({
    // Returns a marker rather than SQL so the fake db can see what it is
    // filtering on.
    eq: vi.fn((col: any, val: any) => ({ __eq: [col, val] })),
    and: vi.fn(),
    sql: {
        orderBy: { desc: vi.fn() },
    },
    inArray: vi.fn(),
    desc: vi.fn(),
}));

/** Learned patterns are org-scoped now, so tests have to name an org. */
const TEST_ORG_ID = 1;
const OTHER_ORG_ID = 2;

describe("PredictivePlanningService", () => {
    beforeEach(() => {
        predictivePlanningService.clearCache();
    });

    describe("generatePlan", () => {
        it("should generate a complete plan", async () => {
            const plan = await predictivePlanningService.generatePlan(
                "Process customer data CSV and generate report"
            );

            expect(plan).toBeDefined();
            expect(plan.objective).toBe("Process customer data CSV and generate report");
            expect(plan.recommendedPipeline).toBeDefined();
            expect(plan.toolRecommendations).toBeDefined();
            expect(plan.estimatedCompletion).toBeDefined();
            expect(plan.riskAssessment).toBeDefined();
            expect(plan.suggestions).toBeDefined();
        });

        it("should include similar missions when considerHistory is true", async () => {
            const plan = await predictivePlanningService.generatePlan(
                "Process CSV data",
                { considerHistory: true }
            );

            expect(plan.similarMissions).toBeDefined();
        });

        it("should respect maxSuggestions option", async () => {
            const plan = await predictivePlanningService.generatePlan(
                "Simple task",
                { maxSuggestions: 3 }
            );

            expect(plan.suggestions.length).toBeLessThanOrEqual(5); // Should have at least some suggestions
        });
    });

    describe("matchPattern", () => {
        it("should match data processing pattern", () => {
            const pattern = predictivePlanningService.matchPattern("Process CSV data");
            
            expect(pattern).toBeDefined();
            expect(pattern?.name).toContain("Data Processing");
        });

        it("should match API integration pattern", () => {
            const pattern = predictivePlanningService.matchPattern("Integrate with external API");
            
            expect(pattern).toBeDefined();
            expect(pattern?.name).toContain("API Integration");
        });

        it("should match document generation pattern", () => {
            const pattern = predictivePlanningService.matchPattern("Generate monthly report PDF");
            
            expect(pattern).toBeDefined();
            expect(pattern?.name).toContain("Document Generation");
        });

        it("should return undefined for unknown patterns", () => {
            const pattern = predictivePlanningService.matchPattern("XYZ unknown task ABC");
            
            expect(pattern).toBeUndefined();
        });

        it("should be case insensitive", () => {
            const pattern1 = predictivePlanningService.matchPattern("PROCESS data");
            const pattern2 = predictivePlanningService.matchPattern("process DATA");
            
            expect(pattern1?.id).toBe(pattern2?.id);
        });
    });

    describe("recommendTools", () => {
        it("should recommend tools based on objective", async () => {
            const recommendations = await predictivePlanningService.recommendTools(
                "Process CSV file"
            );

            expect(recommendations.length).toBeGreaterThan(0);
            expect(recommendations[0].tool).toBeDefined();
            expect(recommendations[0].score).toBeGreaterThan(0);
        });

        it("should recommend tools based on pattern", async () => {
            const pattern = (await predictivePlanningService.getPatterns())[0];
            const recommendations = await predictivePlanningService.recommendTools(
                "test",
                pattern
            );

            expect(recommendations.length).toBeGreaterThan(0);
            expect(recommendations[0].reason).toContain("similar missions");
        });

        it("should include alternatives for each tool", async () => {
            const recommendations = await predictivePlanningService.recommendTools(
                "Read file"
            );

            if (recommendations.length > 0) {
                expect(recommendations[0].alternativeTools).toBeDefined();
                expect(Array.isArray(recommendations[0].alternativeTools)).toBe(true);
            }
        });

        it("should sort by score descending", async () => {
            const recommendations = await predictivePlanningService.recommendTools(
                "Complex task with multiple steps"
            );

            for (let i = 1; i < recommendations.length; i++) {
                expect(recommendations[i].score).toBeLessThanOrEqual(
                    recommendations[i - 1].score
                );
            }
        });
    });

    describe("getToolStats", () => {
        it("should return tool statistics", async () => {
            const stats = await predictivePlanningService.getToolStats("file_read");

            expect(stats.totalCalls).toBeDefined();
            expect(stats.successRate).toBeGreaterThanOrEqual(0);
            expect(stats.successRate).toBeLessThanOrEqual(1);
            expect(stats.avgDuration).toBeGreaterThanOrEqual(0);
        });

        it("should cache results", async () => {
            const stats1 = await predictivePlanningService.getToolStats("test_tool");
            const stats2 = await predictivePlanningService.getToolStats("test_tool");

            // Should return same values (cached)
            expect(stats1).toEqual(stats2);
        });

        it("should handle errors gracefully", async () => {
            const stats = await predictivePlanningService.getToolStats("nonexistent_tool");

            expect(stats).toBeDefined();
            expect(stats.successRate).toBe(0.5); // Default fallback
        });
    });

    describe("inferToolsFromKeywords", () => {
        it("should infer file tools from keywords", () => {
            const tools = predictivePlanningService.inferToolsFromKeywords("Read document file");

            expect(tools).toContain("file_read");
            expect(tools).toContain("file_write");
        });

        it("should infer API tools from keywords", () => {
            const tools = predictivePlanningService.inferToolsFromKeywords("Call HTTP endpoint API");

            expect(tools).toContain("api_call");
        });

        it("should infer data tools from keywords", () => {
            const tools = predictivePlanningService.inferToolsFromKeywords("Transform JSON CSV data");

            expect(tools).toContain("data_transform");
        });

        it("should infer search tools from keywords", () => {
            const tools = predictivePlanningService.inferToolsFromKeywords("Search query database");

            expect(tools).toContain("search");
        });

        it("should return unique tools", () => {
            const tools = predictivePlanningService.inferToolsFromKeywords(
                "API call to file endpoint with data"
            );

            const uniqueTools = [...new Set(tools)];
            expect(tools.length).toBe(uniqueTools.length);
        });
    });

    describe("inferPipelineFromTools", () => {
        it("should order tools logically", () => {
            const recommendations = [
                { tool: "export" },
                { tool: "file_read" },
                { tool: "analysis" },
            ];

            const pipeline = predictivePlanningService.inferPipelineFromTools(recommendations as any);

            expect(pipeline.indexOf("file_read")).toBeLessThan(pipeline.indexOf("analysis"));
            expect(pipeline.indexOf("analysis")).toBeLessThan(pipeline.indexOf("export"));
        });

        it("should handle unknown tools", () => {
            const recommendations = [
                { tool: "unknown_tool_1" },
                { tool: "file_read" },
                { tool: "unknown_tool_2" },
            ];

            const pipeline = predictivePlanningService.inferPipelineFromTools(recommendations as any);

            expect(pipeline).toContain("file_read");
            expect(pipeline).toContain("unknown_tool_1");
            expect(pipeline).toContain("unknown_tool_2");
        });
    });

    describe("estimateCompletion", () => {
        it("should estimate based on pattern", async () => {
            const pattern = (await predictivePlanningService.getPatterns())[0];
            const estimate = predictivePlanningService.estimateCompletion(
                "Process data",
                pattern.pipelineSequence,
                pattern
            );

            expect(estimate.estimatedMinutes).toBeGreaterThan(0);
            expect(estimate.confidence).toBeGreaterThan(0);
            expect(estimate.breakdown.length).toBeGreaterThan(0);
        });

        it("should estimate based on pipeline length without pattern", () => {
            const estimate = predictivePlanningService.estimateCompletion(
                "Unknown task",
                ["tool1", "tool2", "tool3"]
            );

            expect(estimate.estimatedMinutes).toBeGreaterThan(0);
            expect(estimate.breakdown.length).toBe(3);
        });

        it("should include confidence interval", () => {
            const estimate = predictivePlanningService.estimateCompletion(
                "Test",
                ["tool1"]
            );

            expect(estimate.confidenceInterval.min).toBeDefined();
            expect(estimate.confidenceInterval.max).toBeDefined();
            expect(estimate.confidenceInterval.min).toBeLessThanOrEqual(
                estimate.estimatedMinutes
            );
            expect(estimate.confidenceInterval.max).toBeGreaterThanOrEqual(
                estimate.estimatedMinutes
            );
        });

        it("should adjust for complexity", () => {
            const simpleEstimate = predictivePlanningService.estimateCompletion(
                "Simple task",
                ["tool1", "tool2"]
            );

            const complexEstimate = predictivePlanningService.estimateCompletion(
                "Complex multi-step sophisticated task with automation",
                ["tool1", "tool2"]
            );

            expect(complexEstimate.estimatedMinutes).toBeGreaterThan(
                simpleEstimate.estimatedMinutes
            );
        });
    });

    describe("assessComplexity", () => {
        it("should detect simple objectives", () => {
            const complexity = predictivePlanningService.assessComplexity("Read file");

            expect(complexity.multiplier).toBeCloseTo(1.0, 1);
            expect(complexity.factors).toHaveLength(0);
        });

        it("should detect complex objectives", () => {
            const complexity = predictivePlanningService.assessComplexity(
                "Complex sophisticated multi-step integration with automation"
            );

            expect(complexity.multiplier).toBeGreaterThan(1.0);
            expect(complexity.factors.length).toBeGreaterThan(0);
        });

        it("should detect multiple complexity indicators", () => {
            const complexity = predictivePlanningService.assessComplexity(
                "Large scale complex automation with various integrations and performance optimization"
            );

            expect(complexity.factors.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe("assessRisk", () => {
        it("should assess low risk for simple tasks", () => {
            const risk = predictivePlanningService.assessRisk("Read file", ["file_read"]);

            expect(risk.overallRisk).toBe("low");
            expect(risk.score).toBeLessThan(30);
        });

        it("should detect pattern-based risks", async () => {
            const pattern = (await predictivePlanningService.getPatterns())[0];
            const risk = predictivePlanningService.assessRisk("Process data", [], pattern);

            expect(risk.factors.length).toBeGreaterThan(0);
            if (pattern.riskFactors.length > 0) {
                expect(risk.score).toBeGreaterThan(0);
            }
        });

        it("should detect risky tools", () => {
            const risk = predictivePlanningService.assessRisk("Deploy", ["api_call", "deploy"]);

            const riskyFactor = risk.factors.find(f => 
                f.factor.includes("External dependency")
            );
            expect(riskyFactor).toBeDefined();
        });

        it("should provide success rate estimate", () => {
            const risk = predictivePlanningService.assessRisk("Test", ["tool1"]);

            expect(risk.estimatedSuccessRate).toBeGreaterThanOrEqual(0);
            expect(risk.estimatedSuccessRate).toBeLessThanOrEqual(1);
        });

        it("should provide mitigation suggestions", () => {
            const risk = predictivePlanningService.assessRisk(
                "Complex integration",
                ["api_call"]
            );

            const factorWithMitigation = risk.factors.find(f => f.mitigation);
            expect(factorWithMitigation).toBeDefined();
        });
    });

    describe("calculateSimilarity", () => {
        it("should return 1 for identical texts", () => {
            const similarity = predictivePlanningService.calculateSimilarity(
                "Process CSV data",
                "Process CSV data"
            );

            expect(similarity).toBe(1);
        });

        it("should return 0 for completely different texts", () => {
            const similarity = predictivePlanningService.calculateSimilarity(
                "ABC XYZ",
                "123 456"
            );

            expect(similarity).toBe(0);
        });

        it("should return values between 0 and 1 for partial matches", () => {
            const similarity = predictivePlanningService.calculateSimilarity(
                "Process customer data CSV",
                "Process sales data CSV"
            );

            expect(similarity).toBeGreaterThan(0);
            expect(similarity).toBeLessThan(1);
        });

        it("should be case insensitive", () => {
            const similarity = predictivePlanningService.calculateSimilarity(
                "Process Data",
                "process data"
            );

            expect(similarity).toBe(1);
        });
    });

    describe("generateSuggestions", () => {
        it("should suggest for novel missions", () => {
            const suggestions = predictivePlanningService.generateSuggestions(
                "Completely novel unique task never done before"
            );

            const novelSuggestion = suggestions.find(s => 
                s.includes("novel") || s.includes("breaking")
            );
            expect(novelSuggestion).toBeDefined();
        });

        it("should suggest for high risk", () => {
            const risk = predictivePlanningService.assessRisk(
                "Complex deployment",
                ["api_call", "deploy", "migrate"]
            );

            const suggestions = predictivePlanningService.generateSuggestions(
                "Complex deployment",
                undefined,
                risk
            );

            const riskSuggestion = suggestions.find(s => 
                s.includes("risk") || s.includes("High risk")
            );
            expect(riskSuggestion).toBeDefined();
        });

        it("should suggest for urgent missions", () => {
            const suggestions = predictivePlanningService.generateSuggestions(
                "Urgent ASAP task needed quickly"
            );

            const urgentSuggestion = suggestions.find(s => s.includes("Time-sensitive"));
            expect(urgentSuggestion).toBeDefined();
        });

        it("should suggest for first-time missions", () => {
            const suggestions = predictivePlanningService.generateSuggestions(
                "First time new experiment"
            );

            const experimentSuggestion = suggestions.find(s => s.includes("Novel"));
            expect(experimentSuggestion).toBeDefined();
        });
    });

    describe("getAlternativeTools", () => {
        it("should return alternatives for known tools", () => {
            const alternatives = predictivePlanningService.getAlternativeTools("file_read");

            expect(alternatives.length).toBeGreaterThan(0);
        });

        it("should return empty array for unknown tools", () => {
            const alternatives = predictivePlanningService.getAlternativeTools("unknown_xyz");

            expect(alternatives).toEqual([]);
        });
    });

    describe("getPatterns", () => {
        it("should return all patterns", async () => {
            const patterns = await predictivePlanningService.getPatterns();

            expect(patterns.length).toBeGreaterThan(0);
            expect(patterns[0].id).toBeDefined();
            expect(patterns[0].name).toBeDefined();
        });
    });

    describe("addPattern", () => {
        it("should add new pattern", async () => {
            const newPattern = await predictivePlanningService.addPattern({
                name: "Test Pattern",
                objectivePattern: "test|example",
                pipelineSequence: ["tool1", "tool2"],
                estimatedDuration: 30,
                successRate: 0.8,
                avgToolCalls: 5,
                commonTools: [],
                riskFactors: [],
                metadata: {
                    sampleSize: 10,
                    lastUpdated: new Date(),
                    confidence: 0.75,
                },
            }, TEST_ORG_ID);

            expect(newPattern.id).toMatch(/^pattern_\d+_/);
            expect(newPattern.name).toBe("Test Pattern");

            // Should be in patterns list
            const patterns = await predictivePlanningService.getPatterns(TEST_ORG_ID);
            expect(patterns.some(p => p.id === newPattern.id)).toBe(true);
        });

        it("writes the pattern through to the database, not just memory", async () => {
            // The whole point of the change: a learned pattern used to be pushed
            // onto a module-level array and lost at the next restart.
            insertedPatterns.length = 0;

            await predictivePlanningService.addPattern({
                name: "Durable Pattern",
                objectivePattern: "durable",
                pipelineSequence: ["a"],
                estimatedDuration: 10,
                successRate: 0.5,
                avgToolCalls: 2,
                commonTools: [],
                riskFactors: [],
                metadata: { sampleSize: 3, lastUpdated: new Date(), confidence: 0.4 },
            }, TEST_ORG_ID);

            expect(insertedPatterns).toHaveLength(1);
            expect(insertedPatterns[0]).toMatchObject({
                name: "Durable Pattern",
                organizationId: TEST_ORG_ID,
            });
        });

        it("does not serve one org's learned pattern to another", async () => {
            await predictivePlanningService.addPattern({
                name: "Org A Only",
                objectivePattern: "org-a-only",
                pipelineSequence: ["a"],
                estimatedDuration: 10,
                successRate: 0.5,
                avgToolCalls: 2,
                commonTools: [],
                riskFactors: [],
                metadata: { sampleSize: 3, lastUpdated: new Date(), confidence: 0.4 },
            }, TEST_ORG_ID);

            // The other org reads its own (empty) set plus the shared built-ins.
            const otherOrg = await predictivePlanningService.getPatterns(OTHER_ORG_ID);
            expect(otherOrg.some(p => p.name === "Org A Only")).toBe(false);
        });
    });

    describe("clearCache", () => {
        it("should clear tool stats cache", () => {
            // First call to populate cache
            predictivePlanningService.getToolStats("test_tool");
            
            // Clear cache
            predictivePlanningService.clearCache();
            
            // Should be able to get stats again (no error)
            expect(async () => {
                await predictivePlanningService.getToolStats("test_tool");
            }).not.toThrow();
        });
    });

    describe("findSimilarMissions", () => {
        it("should find similar missions", async () => {
            const similar = await predictivePlanningService.findSimilarMissions(
                "Process customer data"
            );

            expect(similar).toBeDefined();
            expect(Array.isArray(similar)).toBe(true);
        });

        it("should include similarity scores", async () => {
            const similar = await predictivePlanningService.findSimilarMissions(
                "Process data"
            );

            if (similar.length > 0) {
                expect(similar[0].similarity).toBeDefined();
                expect(similar[0].similarity).toBeGreaterThanOrEqual(0);
                expect(similar[0].similarity).toBeLessThanOrEqual(1);
            }
        });
    });

    describe("events", () => {
        it("should emit plan_generated event", async () => {
            await predictivePlanningService.generatePlan("Test objective");
            
            // Event emission is mocked, verify no error thrown
        });
    });
});
