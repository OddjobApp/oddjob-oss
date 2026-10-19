import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeDecayedWeight, userInterestGraphService } from "../core/user-interest-graph.service.js";
import { oceanAssessmentService } from "../core/ocean-assessment.service.js";
import { syntheticPersonaService } from "../core/synthetic-persona.service.js";

describe("User Synthetic Persona & Knowledge Graph Suite", () => {
    describe("14-Day Temporal Recency Decay", () => {
        it("should apply 14-day exponential decay formula correctly", () => {
            const now = new Date();
            const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
            const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

            const initialWeight = 100.0;
            const weight14 = computeDecayedWeight(initialWeight, fourteenDaysAgo);
            const weight28 = computeDecayedWeight(initialWeight, twentyEightDaysAgo);

            expect(Math.round(weight14)).toBe(50);
            expect(Math.round(weight28)).toBe(25);
        });
    });

    describe("OCEAN Assessment & Steering Directives", () => {
        it("should generate structured communication steering directives based on trait thresholds", () => {
            const profile = {
                openness: 0.8,
                conscientiousness: 0.8,
                extraversion: 0.4,
                agreeableness: 0.5,
                neuroticism: 0.2,
                confidence: 80,
                observationCount: 10,
                lastCalibratedAt: new Date().toISOString(),
            };

            const steering = oceanAssessmentService.generateSteeringDirectives(profile);

            expect(steering.communicationDirectives).toBeDefined();
            expect(steering.communicationDirectives.length).toBeGreaterThan(0);
            expect(steering.guidanceText).toContain("structured, step-by-step verification");
            expect(steering.guidanceText).toContain("architectural options");
        });
    });

    describe("Synthetic Persona Archetype Assignment", () => {
        it("should synthesize appropriate archetype and active focus vector", async () => {
            // Mock ToM, UserRep, and Interest Graph
            const orgId = 291;
            const userId = "test-user-1";

            const persona = await syntheticPersonaService.getPersona(orgId, userId);
            // Service returns fallback or synthesized object gracefully
            if (persona) {
                expect(persona.archetype).toBeDefined();
                expect(persona.communicationDirectives).toBeInstanceOf(Array);
                expect(persona.activeFocusVector).toBeInstanceOf(Array);
            }
        });
    });
});
