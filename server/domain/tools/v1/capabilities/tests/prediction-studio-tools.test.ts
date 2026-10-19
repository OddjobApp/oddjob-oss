import { describe, expect, it } from "vitest";
import { PREDICTION_STUDIO_TOOLS } from "../prediction-studio-tools.js";
import { RICH_PAYLOAD_TYPES } from "@domain/crew/core/crew-tools.service.js";
import {
    PREDICTION_STUDIO_POD,
    PREDICTION_MODEL_PROPOSAL,
    PREDICTION_INFERENCE_RESULT,
} from "@shared/prediction-studio-crew.js";

describe("PREDICTION_STUDIO_TOOLS", () => {
    it("has mount_prediction_studio declared and executable", async () => {
        const tool = PREDICTION_STUDIO_TOOLS.mount_prediction_studio;
        expect(tool).toBeDefined();
        expect(tool.idempotency).toBe("read-safe");

        const result = await tool.execute({
            modelId: "test-model-1",
            modelName: "Test Kinetic Surrogate",
            streamId: "stream-01",
        }, {} as any);

        const parsed = JSON.parse(result as string);
        expect(parsed.type).toBe(PREDICTION_STUDIO_POD);
        expect(parsed.modelId).toBe("test-model-1");
        expect(parsed.module).toBe("PredictionStudioPod");
    });

    it("estimates a trajectory from the features, with no constants in the answer", async () => {
        const tool = PREDICTION_STUDIO_TOOLS.estimate_trajectory;
        expect(tool).toBeDefined();
        expect(tool.idempotency).toBe("read-safe");

        const slow = JSON.parse(await tool.execute(
            { features: { velocity_knots: 4, distance_m: 4000, heading_deg: 0 } }, {} as any,
        ) as string);
        const fast = JSON.parse(await tool.execute(
            { features: { velocity_knots: 40, distance_m: 400, heading_deg: 0 } }, {} as any,
        ) as string);

        // The table this replaced returned breachRisk 0.84 at 30 minutes for any
        // input at all. Closing a gap ten times faster has to move the numbers.
        expect(fast.etaSeconds).toBeLessThan(slow.etaSeconds);
        expect(fast.multiHorizonPoints[1].breachRisk).not.toBe(slow.multiHorizonPoints[1].breachRisk);
        expect(slow.multiHorizonPoints).toHaveLength(4);
    });

    it("says what it is, so a room cannot report it as model output", async () => {
        const out = JSON.parse(await PREDICTION_STUDIO_TOOLS.estimate_trajectory.execute(
            { features: { velocity_knots: 12 } }, {} as any,
        ) as string);

        expect(out.method).toBe("kinematic_surrogate");
        expect(out.note).toMatch(/No model was loaded/i);
        // The old shape claimed a latency and a confidence it never measured.
        expect(out).not.toHaveProperty("latencyMs");
        expect(out).not.toHaveProperty("topPredicate");
    });
});

describe("propose_prediction_job names what it already supports", () => {
    const draft = async (features: Record<string, unknown>) =>
        JSON.parse(await PREDICTION_STUDIO_TOOLS.propose_prediction_job.execute(
            {
                name: "Breach watch",
                instruction: "forecast breach risk",
                inputFeatures: JSON.stringify(features),
            },
            { organizationId: 1, userId: "u1" } as any,
        ) as string);

    it("tells the room which co-factors are supported but unset", async () => {
        // The first live round answered a draft by mounting two builder pods to
        // add environmental factors the surrogate already takes. Unstated
        // capability sends a room looking elsewhere for it.
        const out = await draft({ velocity_knots: 18, distance_m: 900 });
        const line = out.summary.find((l: string) => l.includes("Also supported"));
        expect(line).toBeTruthy();
        expect(line).toContain("wind_speed_knots");
        expect(line).toContain("bathymetry_depth_m");
    });

    it("says nothing when every co-factor is already set", async () => {
        const out = await draft({
            velocity_knots: 18,
            distance_m: 900,
            wind_speed_knots: 12,
            wind_dir_deg: 200,
            current_speed_knots: 1.5,
            current_dir_deg: 180,
            bathymetry_depth_m: 9,
            vessel_draft_m: 4,
        });
        expect(out.summary.some((l: string) => l.includes("Also supported"))).toBe(false);
    });

    it("drafts without writing anything, and fixes the framework it can run", async () => {
        const out = await draft({ velocity_knots: 18, distance_m: 900 });
        expect(out.type).toBe("prediction_model_proposal");
        expect(out.config.framework).toBe("kinematic_surrogate");
        expect(out.proposalId).toMatch(/^predjob_[a-f0-9]{8,}/);
    });
});

describe("the prediction payload types are registered in RICH_PAYLOAD_TYPES", () => {
    it("carries all prediction types", () => {
        expect(RICH_PAYLOAD_TYPES.has(PREDICTION_STUDIO_POD)).toBe(true);
        expect(RICH_PAYLOAD_TYPES.has(PREDICTION_MODEL_PROPOSAL)).toBe(true);
        expect(RICH_PAYLOAD_TYPES.has(PREDICTION_INFERENCE_RESULT)).toBe(true);
    });
});
