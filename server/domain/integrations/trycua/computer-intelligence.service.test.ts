/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
    resolveGroundedTarget,
    type TrycuaGuidedActionInput,
    type TrycuaObservation,
} from "./computer-intelligence.service.js";

function makeInput(overrides: Partial<TrycuaGuidedActionInput> = {}): TrycuaGuidedActionInput {
    return {
        sessionId: "sess_test",
        organizationId: 1,
        userId: "user_test",
        instruction: "click Submit",
        ...overrides,
    };
}

function makeObservation(overrides: Partial<TrycuaObservation> = {}): TrycuaObservation {
    return {
        id: "obs_test",
        sessionId: "sess_test",
        organizationId: 1,
        userId: "user_test",
        provider: "mock",
        os: "linux",
        status: "running",
        observedAt: "2026-01-01T00:00:00.000Z",
        screenshot: {
            mediaType: "image/png",
            bytesApprox: 1024,
            fingerprint: "abc123",
        },
        accessibility: {
            available: true,
            source: "mock",
            capturedAt: "2026-01-01T00:00:00.000Z",
            root: { role: "window", title: "Test" },
            nodes: [],
        },
        ui: {
            source: "hybrid",
            surfaceType: "desktop",
            activeApp: {
                name: "Test App",
                category: "application",
                confidence: 0.8,
                evidence: ["test fixture"],
            },
            visibleText: [],
            controls: [],
            textInputs: [],
            clickableRegions: [],
            warnings: [],
            confidence: 0.8,
        },
        riskFlags: [],
        limitations: [],
        ...overrides,
    };
}

describe("resolveGroundedTarget", () => {
    it("uses explicit coordinates when supplied", () => {
        const result = resolveGroundedTarget(
            makeInput({ target: { x: 7, y: 9, label: "Submit" } }),
            makeObservation(),
            "Submit",
        );

        expect(result.resolved).toBe(true);
        expect(result.method).toBe("explicit_coordinates");
        expect(result.target).toMatchObject({ x: 7, y: 9, label: "Submit" });
        expect(result.confidence).toBe(1);
    });

    it("grounds matching accessibility regions to their center point", () => {
        const observation = makeObservation({
            ui: {
                ...makeObservation().ui,
                clickableRegions: [
                    {
                        id: "submit-button",
                        kind: "button",
                        label: "Submit report",
                        bounds: { x: 20, y: 40, width: 120, height: 30 },
                        confidence: 0.84,
                        evidence: ["accessibility_tree:button"],
                    },
                ],
            },
        });

        const result = resolveGroundedTarget(makeInput(), observation, "Submit");

        expect(result.resolved).toBe(true);
        expect(result.method).toBe("accessibility_tree");
        expect(result.target).toMatchObject({
            x: 80,
            y: 55,
            label: "Submit report",
            role: "button",
        });
        expect(result.confidence).toBeGreaterThanOrEqual(0.84);
    });

    it("leaves low-confidence label matches unresolved", () => {
        const observation = makeObservation({
            ui: {
                ...makeObservation().ui,
                clickableRegions: [
                    {
                        id: "cancel-button",
                        kind: "button",
                        label: "Cancel",
                        bounds: { x: 20, y: 40, width: 120, height: 30 },
                        confidence: 0.9,
                        evidence: ["accessibility_tree:button"],
                    },
                ],
            },
        });

        const result = resolveGroundedTarget(makeInput(), observation, "Submit");

        expect(result.resolved).toBe(false);
        expect(result.method).toBe("none");
        expect(result.confidence).toBeLessThan(0.58);
    });

    it("resolves parent bounds recursively as union of child bounds if parent is missing bounds", async () => {
        const { trycuaService } = await import("./trycua-service.js");
        const sessionRow: any = { providerSessionId: "mock-sess-1", sandboxName: "My Sandbox" };
        
        const tree = await (trycuaService as any).providers.mock.getAccessibilityTree(sessionRow);
        expect(tree.available).toBe(true);
        expect(tree.root?.bounds).toBeDefined();
    });

    it("grounds non-interactive labels to adjacent input fields (label-to-input mapping)", () => {
        const observation = makeObservation({
            ui: {
                ...makeObservation().ui,
                controls: [
                    {
                        id: "label-email",
                        kind: "content",
                        label: "Email Address:",
                        bounds: { x: 10, y: 20, width: 100, height: 20 },
                        confidence: 0.9,
                        evidence: ["accessibility_tree"],
                    },
                ],
                textInputs: [
                    {
                        id: "input-email",
                        kind: "text_input",
                        label: "Email textfield",
                        bounds: { x: 120, y: 20, width: 200, height: 20 },
                        confidence: 0.9,
                        evidence: ["accessibility_tree"],
                    },
                ],
            },
        });

        const result = resolveGroundedTarget(makeInput(), observation, "Email Address:");
        expect(result.resolved).toBe(true);
        expect(result.target?.x).toBe(220); // x center of textfield (120 + 200/2)
        expect(result.target?.y).toBe(30);  // y center of textfield (20 + 20/2)
        expect(result.target?.role).toBe("text_input");
    });

    it("grounds targets with directional relative modifiers (e.g. button below Cancel)", () => {
        const observation = makeObservation({
            ui: {
                ...makeObservation().ui,
                clickableRegions: [
                    {
                        id: "cancel-btn",
                        kind: "button",
                        label: "Cancel Button",
                        bounds: { x: 10, y: 10, width: 50, height: 20 },
                        confidence: 0.9,
                        evidence: ["accessibility_tree"],
                    },
                    {
                        id: "submit-btn",
                        kind: "button",
                        label: "Submit Button",
                        bounds: { x: 10, y: 100, width: 50, height: 20 },
                        confidence: 0.9,
                        evidence: ["accessibility_tree"],
                    },
                ],
            },
        });

        const result = resolveGroundedTarget(makeInput(), observation, "button below Cancel Button");
        expect(result.resolved).toBe(true);
        expect(result.target?.x).toBe(35);   // x center of Submit (10 + 50/2)
        expect(result.target?.y).toBe(110);  // y center of Submit (100 + 20/2)
        expect(result.target?.role).toBe("button");
    });
});
