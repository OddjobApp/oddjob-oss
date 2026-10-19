import { describe, it, expect, beforeEach } from "vitest";
import { affordanceMapService } from "../core/affordance-map.service.js";

describe("AffordanceMapService", () => {
    const TEST_MISSION_ID = 456;

    beforeEach(() => {
        affordanceMapService.clearAll();
    });

    it("should record an affordance observation with default success confidence", () => {
        const observation = affordanceMapService.recordObservation({
            missionId: TEST_MISSION_ID,
            observedBy: "agent_1",
            state: {
                kind: "ui",
                signature: "button:Submit",
                label: "Submit",
                selector: "button[type=submit]",
            },
            action: {
                kind: "click",
                description: "Click the Submit button",
            },
            outcome: {
                status: "success",
                description: "Form submitted",
            },
            evidence: ["navigation completed"],
            tags: ["form", "submit"],
        });

        expect(observation.id).toMatch(/^affordance_/);
        expect(observation.confidence).toBe(0.8);
        expect(affordanceMapService.getObservation(observation.id)).toEqual(observation);
    });

    it("should clamp explicit confidence values", () => {
        const observation = affordanceMapService.recordObservation({
            missionId: TEST_MISSION_ID,
            observedBy: "agent_1",
            state: {
                kind: "api",
                signature: "GET /users",
                method: "GET",
                path: "/users",
            },
            action: {
                kind: "call",
                description: "Call the users endpoint",
            },
            outcome: {
                status: "success",
                description: "Users returned",
            },
            confidence: 3,
            evidence: [],
            tags: ["api"],
        });

        expect(observation.confidence).toBe(1);
    });

    it("should query affordances by state and action filters", () => {
        affordanceMapService.recordObservation({
            missionId: TEST_MISSION_ID,
            observedBy: "agent_1",
            state: {
                kind: "ui",
                signature: "input:Email",
                label: "Email",
            },
            action: {
                kind: "type",
                description: "Type into the email field",
            },
            outcome: {
                status: "success",
                description: "Email accepted",
            },
            evidence: ["value persisted"],
            tags: ["form"],
        });
        affordanceMapService.recordObservation({
            missionId: TEST_MISSION_ID,
            observedBy: "agent_1",
            state: {
                kind: "api",
                signature: "POST /login",
                method: "POST",
                path: "/login",
            },
            action: {
                kind: "call",
                description: "Post login payload",
            },
            outcome: {
                status: "failure",
                description: "Missing token",
            },
            evidence: ["401 response"],
            tags: ["auth"],
        });

        const results = affordanceMapService.queryAffordances({
            missionId: TEST_MISSION_ID,
            kind: "ui",
            actionKind: "type",
            tags: ["form"],
        });

        expect(results).toHaveLength(1);
        expect(results[0].state.signature).toBe("input:Email");
    });

    it("should rank successful high-confidence actions before failures", () => {
        affordanceMapService.recordObservation({
            missionId: TEST_MISSION_ID,
            observedBy: "agent_1",
            state: {
                kind: "ui",
                signature: "button:Save",
                label: "Save",
            },
            action: {
                kind: "click",
                description: "Click Save",
            },
            outcome: {
                status: "failure",
                description: "Validation error",
            },
            confidence: 0.9,
            evidence: ["validation banner"],
            tags: ["save"],
        });
        const success = affordanceMapService.recordObservation({
            missionId: TEST_MISSION_ID,
            observedBy: "agent_2",
            state: {
                kind: "ui",
                signature: "button:Save",
                label: "Save",
            },
            action: {
                kind: "click",
                description: "Click Save after filling required fields",
            },
            outcome: {
                status: "success",
                description: "Record saved",
            },
            confidence: 0.8,
            evidence: ["toast appeared"],
            tags: ["save"],
        });

        const suggestions = affordanceMapService.suggestActions({
            missionId: TEST_MISSION_ID,
            signature: "button:Save",
        });

        expect(suggestions[0].action.description).toBe(success.action.description);
    });

    it("should merge updated outcomes", () => {
        const observation = affordanceMapService.recordObservation({
            missionId: TEST_MISSION_ID,
            observedBy: "agent_1",
            state: {
                kind: "tool",
                signature: "tool:deploy",
                label: "Deploy",
            },
            action: {
                kind: "execute",
                description: "Run deploy tool",
            },
            outcome: {
                status: "unknown",
                description: "Started deploy",
            },
            evidence: [],
            tags: ["deploy"],
        });

        const updated = affordanceMapService.mergeObservation(observation.id, {
            outcome: {
                status: "success",
                description: "Deploy completed",
                rewardHint: 0.5,
            },
            evidence: ["green deployment"],
        });

        expect(updated?.outcome.status).toBe("success");
        expect(updated?.evidence).toEqual(["green deployment"]);
    });

    it("should report mission stats", () => {
        affordanceMapService.recordObservation({
            missionId: TEST_MISSION_ID,
            observedBy: "agent_1",
            state: {
                kind: "file",
                signature: "file:README.md",
            },
            action: {
                kind: "read",
                description: "Read README",
            },
            outcome: {
                status: "success",
                description: "Content loaded",
            },
            evidence: [],
            tags: ["docs"],
        });

        const stats = affordanceMapService.getMissionStats(TEST_MISSION_ID);

        expect(stats.total).toBe(1);
        expect(stats.byKind.file).toBe(1);
        expect(stats.byStatus.success).toBe(1);
        expect(stats.averageConfidence).toBeGreaterThan(0);
    });
});
