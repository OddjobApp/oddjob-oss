import { describe, expect, it } from "vitest";
import { PredictionInferenceExecutor } from "./prediction-inference-executor.js";
import { SpatialRerankerExecutor } from "./spatial-reranker-executor.js";

describe("PredictionInferenceExecutor", () => {
    const executor = new PredictionInferenceExecutor();

    it("canExecute matches prediction_inference", () => {
        expect(executor.canExecute("prediction_inference")).toBe(true);
        expect(executor.canExecute("shell")).toBe(false);
    });

    it("refuses a framework nothing implements, rather than substituting kinematics", async () => {
        // onnx is the schema default, so this was the usual case: a config asking
        // for ONNX was quietly handed a kinematic answer labelled "onnx".
        const result = await executor.execute(
            { id: 1, name: "Test Ingest" } as any,
            {
                modelId: "coastal-collision-01",
                framework: "onnx",
                inputFeatures: JSON.stringify({ velocity_knots: 28, distance_m: 800 }),
                horizonSeconds: 300,
                confidenceThreshold: 0.70,
            },
            {} as any,
            {} as any,
        );

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not implemented/i);
        expect(result.error).toMatch(/kinematic_surrogate/);
    });

    it("computes a trajectory for the framework it does implement", async () => {
        const result = await executor.execute(
            { id: 1, name: "Test Ingest" } as any,
            {
                modelId: "coastal-collision-01",
                framework: "kinematic_surrogate",
                inputFeatures: JSON.stringify({ velocity_knots: 28, distance_m: 800 }),
                horizonSeconds: 300,
                confidenceThreshold: 0.70,
            },
            {} as any,
            {} as any,
        );

        expect(result.success).toBe(true);
        expect(result.status).toBe("success");
        const parsed = JSON.parse(result.output);
        expect(parsed.modelId).toBe("coastal-collision-01");
        expect(parsed).toHaveProperty("p10");
        expect(parsed).toHaveProperty("p50");
        expect(parsed).toHaveProperty("p90");
        expect(parsed).toHaveProperty("breachDetected");
        expect(parsed).toHaveProperty("etaSeconds");
        // Reports what was computed, not what was requested.
        expect(parsed.method).toBe("kinematic_surrogate");
        expect(result.telemetry).toMatchObject({
            model_id: "coastal-collision-01",
            framework: "kinematic_surrogate",
        });
    });

    it("evaluates environmental leeway and multi-horizon trajectory arrays", async () => {
        const result = await executor.execute(
            { id: 1, name: "Test Environmental" } as any,
            {
                modelId: "coastal-collision-01",
                framework: "kinematic_surrogate",
                inputFeatures: {
                    velocity_knots: 18,
                    heading_deg: 90,
                    distance_m: 600,
                    wind_speed_knots: 25,
                    wind_dir_deg: 90,
                    current_speed_knots: 2.5,
                    current_dir_deg: 90,
                    bathymetry_depth_m: 6.2,
                    vessel_draft_m: 4.8,
                },
                horizonSeconds: 300,
                confidenceThreshold: 0.70,
            },
            {} as any,
            {} as any
        );

        expect(result.success).toBe(true);
        const parsed = JSON.parse(result.output);
        expect(parsed.multiHorizonPoints).toHaveLength(4);
        expect(parsed.multiHorizonPoints[0].horizon).toBe("15m");
        expect(parsed.multiHorizonPoints[3].horizon).toBe("120m");
        expect(parsed.underKeelClearanceM).toBe(1.4); // 6.2 - 4.8 = 1.4m (shallow water hazard)
        expect(parsed.environmental).toMatchObject({
            windSpeedKnots: 25,
            currentSpeedKnots: 2.5,
            bathymetryDepthM: 6.2,
            vesselDraftM: 4.8,
        });
        expect(parsed.breachDetected).toBe(true);
    });
});

describe("SpatialRerankerExecutor", () => {
    const executor = new SpatialRerankerExecutor();

    it("canExecute matches spatial_reranker", () => {
        expect(executor.canExecute("spatial_reranker")).toBe(true);
        expect(executor.canExecute("reranker")).toBe(false);
    });

    it("reranks entities based on H3 spatial proximity and decay", async () => {
        const candidateDocs = [
            { id: "entity-distant", h3Index: "882681e699f0000", score: 0.8 },
            { id: "entity-immediate", h3Index: "882681e699fffff", score: 0.8 },
            { id: "entity-mid", h3Index: "882681e699f1111", score: 0.8 },
        ];

        const result = await executor.execute(
            { id: 2, name: "Test Spatial" } as any,
            {
                h3IndexSource: "882681e699fffff",
                kRing: 3,
                spatialDecayFactor: 0.7,
                topK: 2,
                documents: JSON.stringify(candidateDocs),
            },
            {} as any,
            {} as any
        );

        expect(result.success).toBe(true);
        const reranked = JSON.parse(result.output);
        expect(reranked).toHaveLength(2);
        // The entity sharing the identical H3 index (ring 0) should be ranked first
        expect(reranked[0].id).toBe("entity-immediate");
        expect(reranked[0].spatialDistanceRing).toBe(0);
        expect(result.telemetry).toMatchObject({
            target_h3: "882681e699fffff",
            k_ring: 3,
            input_count: 3,
            reranked_count: 2,
        });
    });
});
