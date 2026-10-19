import { describe, it, expect } from "vitest";
import { memoryPruner, type SemanticTriplet } from "../../core/memory-pruner.service.js";

describe("MemoryPrunerService", () => {
    it("consolidates duplicate semantic triplets and boosts confidence", () => {
        const triplets: SemanticTriplet[] = [
            {
                id: "t1",
                subject: "Project Rescue",
                predicate: "uses_framework",
                object: "Next.js",
                confidence: 0.85,
                lastObservedAt: new Date("2026-08-01"),
                accessCount: 5,
            },
            {
                id: "t2",
                subject: "Project Rescue",
                predicate: "uses_framework",
                object: "Next.js",
                confidence: 0.95,
                lastObservedAt: new Date("2026-08-15"),
                accessCount: 3,
            },
        ];

        const { updated, report } = memoryPruner.pruneKnowledgeGraph(triplets);

        expect(report.scannedTriplets).toBe(2);
        expect(report.consolidatedDuplicates).toBe(1);
        expect(updated.length).toBe(1);
        expect(updated[0].confidence).toBe(0.95);
        expect(updated[0].accessCount).toBe(8);
    });

    it("decays and removes stale unreferenced triplets beyond threshold", () => {
        const triplets: SemanticTriplet[] = [
            {
                id: "t_stale",
                subject: "Old System",
                predicate: "hosted_on",
                object: "Deprecated Cluster",
                confidence: 0.60,
                lastObservedAt: new Date("2025-01-01"),
                accessCount: 0,
            },
            {
                id: "t_active",
                subject: "Active Core",
                predicate: "hosted_on",
                object: "Kubernetes Cloud",
                confidence: 0.99,
                lastObservedAt: new Date(),
                accessCount: 12,
            },
        ];

        const { updated, report } = memoryPruner.pruneKnowledgeGraph(triplets, 90);

        expect(report.decayedStaleTriplets).toBe(1);
        expect(updated.length).toBe(1);
        expect(updated[0].id).toBe("t_active");
    });
});
