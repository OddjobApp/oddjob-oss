/**
 * signalFiltersSchema — the validation boundary for workflow signal
 * subscriptions, mirroring the cycle subscriptions' filter vocabulary.
 */
import { describe, expect, it } from "vitest";
import { signalFiltersSchema } from "./workflow-signals.js";

describe("signalFiltersSchema", () => {
    it("accepts an empty filter block and a fully populated one", () => {
        expect(signalFiltersSchema.parse({})).toEqual({});
        expect(signalFiltersSchema.parse({
            eventTypes: ["policy_change"],
            sectors: ["Energy"],
            jurisdictions: ["US"],
            entityIds: ["asset-1"],
            minimumConfidence: 0.75,
            minimumSeverity: "High",
        })).toMatchObject({ minimumSeverity: "High", minimumConfidence: 0.75 });
    });

    it("rejects an unknown severity", () => {
        expect(() => signalFiltersSchema.parse({ minimumSeverity: "Extreme" })).toThrow();
    });

    it("rejects a confidence outside 0-1 and unknown keys", () => {
        expect(() => signalFiltersSchema.parse({ minimumConfidence: 1.5 })).toThrow();
        expect(() => signalFiltersSchema.parse({ madeUp: true })).toThrow();
    });
});
