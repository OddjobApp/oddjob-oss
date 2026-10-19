/**
 * The shared matcher behind both cycle and workflow signal subscriptions.
 * The cycle service's property test exercises it through `matches()`; this
 * file pins the extracted function's contract directly.
 */
import { describe, expect, it } from "vitest";
import { signalMatchesFilters } from "./signal-subscription-filters.js";

const event = (over: Record<string, unknown> = {}) => ({
    id: "e1",
    organizationId: 7,
    eventType: "policy_change",
    targetSector: "Energy",
    jurisdiction: "US",
    severity: "High",
    confidenceScore: 0.9,
    ...over,
}) as any;

describe("signalMatchesFilters", () => {
    it("passes an event through filters it satisfies and rejects the first one it fails", () => {
        const filters = {
            eventTypes: ["policy_change"],
            jurisdictions: ["US", "EU"],
            minimumSeverity: "Medium",
            minimumConfidence: 0.5,
        };
        expect(signalMatchesFilters(filters, event(), [])).toBe(true);
        expect(signalMatchesFilters({ ...filters, eventTypes: ["sanctions"] }, event(), [])).toBe(false);
        expect(signalMatchesFilters({ ...filters, minimumSeverity: "Critical" }, event(), [])).toBe(false);
        expect(signalMatchesFilters({ ...filters, entityIds: ["asset-9"] }, event(), [])).toBe(false);
        expect(signalMatchesFilters({ ...filters, entityIds: ["asset-9"] }, event(), [{ targetEntityId: "asset-9" }] as any)).toBe(true);
    });
});
