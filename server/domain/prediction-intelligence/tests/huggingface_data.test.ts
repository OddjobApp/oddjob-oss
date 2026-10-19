import { describe, it, expect, vi } from "vitest";
import { predictionPod } from "../prediction/prediction-pod.service.js";
import { hiddenStatePod } from "../hidden-state/hidden-state-pod.service.js";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

// Mock database calls to avoid failing on missing tables
vi.mock("@server/database_service.js", () => ({
    db: {
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue({})
        })
    }
}));

describe("Hugging Face Data Prediction Test", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    const csvPath = `${process.cwd()}/storage/prediction/test.csv`;

    it("should process telco churn data and generate predictions", async () => {
        if (!fs.existsSync(csvPath)) {
            console.log("CSV file not found, skipping test.");
            return;
        }

        const csvData = fs.readFileSync(csvPath, "utf-8");
        const lines = csvData.split("\n");
        const header = lines[0].split(",");
        
        // Find indices of interest
        const ageIdx = header.indexOf("Age");
        const monthlyChargeIdx = header.indexOf("Monthly Charge");
        const tenureIdx = header.indexOf("Tenure in Months");
        const churnIdx = header.indexOf("Churn");
        const customerIdIdx = header.indexOf("Customer ID");

        console.log(`Indices: Age=${ageIdx}, MonthlyCharge=${monthlyChargeIdx}, Tenure=${tenureIdx}, Churn=${churnIdx}`);

        // Process first 3 rows (skip header)
        for (let i = 1; i <= 3; i++) {
            if (!lines[i]) continue;
            
            // Simple split by comma (ignoring quoted commas for these specific fields which shouldn't have them)
            const row = lines[i].split(",");
            
            const customerId = row[customerIdIdx] || `cust-${i}`;
            const age = parseFloat(row[ageIdx]);
            const monthlyCharge = parseFloat(row[monthlyChargeIdx]);
            const tenure = parseFloat(row[tenureIdx]);
            const churn = row[churnIdx]?.trim(); // "0" or "1"

            console.log(`\n[Test] Processing Customer ${customerId}: Age=${age}, MonthlyCharge=${monthlyCharge}, Tenure=${tenure}, Actual Churn=${churn}`);

            // 1. Create Quants with full interface support
            const activeQuants = [
                {
                    id: randomUUID(),
                    contextId: customerId,
                    type: "event_signal",
                    label: "monthly_charge",
                    magnitude: monthlyCharge,
                    confidence: 1.0,
                    uncertainty: 0,
                    entropyContribution: 0,
                    sourceEventIds: [randomUUID()],
                    sourceEpisodeIds: [],
                    sourcePredictionIds: [],
                    sourceQuantIds: [],
                    epistemic: {
                        status: "known_known",
                        worldKnownness: 1,
                        systemKnownness: 1,
                        evidenceStrength: 1,
                        recognitionLevel: 1,
                        resolutionLevel: 1
                    },
                    position: { epistemic: [1, 0, 0] },
                    trajectory: { velocity: [0, 0, 0], acceleration: [0, 0, 0], direction: [1, 0, 0] },
                    realmContributions: [],
                    branchInfluences: [],
                    hiddenStateInfluences: [],
                    relationships: [],
                    lifecycle: { status: "active", decayRate: 0 },
                    provenance: { sourceSystem: "test", ingestedAt: ctx.now },
                    createdAt: ctx.now,
                    updatedAt: ctx.now,
                    value: monthlyCharge
                },
                {
                    id: randomUUID(),
                    contextId: customerId,
                    type: "event_signal",
                    label: "tenure_months",
                    magnitude: tenure,
                    confidence: 1.0,
                    uncertainty: 0,
                    entropyContribution: 0,
                    sourceEventIds: [randomUUID()],
                    sourceEpisodeIds: [],
                    sourcePredictionIds: [],
                    sourceQuantIds: [],
                    epistemic: {
                        status: "known_known",
                        worldKnownness: 1,
                        systemKnownness: 1,
                        evidenceStrength: 1,
                        recognitionLevel: 1,
                        resolutionLevel: 1
                    },
                    position: { epistemic: [1, 0, 0] },
                    trajectory: { velocity: [0, 0, 0], acceleration: [0, 0, 0], direction: [1, 0, 0] },
                    realmContributions: [],
                    branchInfluences: [],
                    hiddenStateInfluences: [],
                    relationships: [],
                    lifecycle: { status: "active", decayRate: 0 },
                    provenance: { sourceSystem: "test", ingestedAt: ctx.now },
                    createdAt: ctx.now,
                    updatedAt: ctx.now,
                    value: tenure
                }
            ];

            // 2. Estimate Hidden State
            const stateEstimate = await hiddenStatePod.estimate({
                context: { id: customerId, sessionId: "session-1", mode: "realtime" as const, createdAt: ctx.now },
                activeQuants: activeQuants as any,
                quantField: { id: "field-1", fieldEntropy: 0.5, fieldCoherence: 0.5 } as any,
                realmResults: { contributions: [] } as any,
                memoryResults: [],
                mode: "realtime" as const
            }, ctx);

            // 3. Generate Predictions
            const predictionResult = await predictionPod.generatePredictions({
                mode: "realtime",
                context: { id: customerId, sessionId: "session-1", mode: "realtime" as const, createdAt: ctx.now },
                quantField: { id: "field-1", fieldEntropy: 0.5, fieldCoherence: 0.5, collapseProbability: 0.1 } as any,
                activeQuants: activeQuants as any,
                realmResults: { contributions: [], conflicts: [], agreement: null } as any,
                hiddenState: stateEstimate,
                memoryMatches: []
            }, { ...ctx, organizationId: 1 });

            expect(predictionResult).toBeDefined();
            expect(predictionResult.prediction).toBeDefined();
            
            console.log(`[Test] Prediction ID: ${predictionResult.prediction.id}`);
            console.log(`[Test] Top Predicate: ${predictionResult.prediction.topPredicate}`);
            console.log(`[Test] Confidence: ${predictionResult.prediction.confidence}`);
            
            if (predictionResult.branches.length > 0) {
                console.log(`[Test] Top Branch Probability: ${predictionResult.branches[0].probability}`);
            }
        }
    });
});
