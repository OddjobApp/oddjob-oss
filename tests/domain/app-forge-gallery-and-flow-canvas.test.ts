/**
 * Tests for App Forge Storefront Blueprint Catalog & Visual Flow Canvas Invariants
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { forgeBlueprintService } from "../../server/domain/apps/core/forge-blueprint.service.js";

describe("App Forge Blueprint Catalog & Metadata", () => {
    it("returns all canonical blueprints with enriched metadata", async () => {
        const blueprints = await forgeBlueprintService.listBlueprints();
        expect(blueprints.length).toBeGreaterThanOrEqual(34);

        // Verify required metadata fields exist on every blueprint
        blueprints.forEach(bp => {
            expect(bp.slug).toBeDefined();
            expect(bp.name).toBeDefined();
            expect(bp.description).toBeDefined();
            expect(bp.category).toBeDefined();
            expect(bp.persona).toBeDefined();
            expect(Array.isArray(bp.capabilities)).toBe(true);
            expect(bp.capabilities.length).toBeGreaterThan(0);
            expect(bp.icon).toBeDefined();
            expect(["low", "medium", "high"]).toContain(bp.governanceRisk);
            expect(bp.formalVerification).toBeDefined();
            expect(["PASSED", "EXEMPT"]).toContain(bp.formalVerification.status);
        });
    });

    it("verifies rescue-dispatch has spatial H3 and high risk governance", async () => {
        const blueprints = await forgeBlueprintService.listBlueprints();
        const rescue = blueprints.find(bp => bp.slug === "rescue-dispatch");

        expect(rescue).toBeDefined();
        expect(rescue?.category).toBe("Operations & Field");
        expect(rescue?.persona).toBe("Incident Commander");
        expect(rescue?.capabilities).toContain("Spatial");
        expect(rescue?.governanceRisk).toBe("high");
        expect(rescue?.formalVerification.maxSmtVerified).toBe(true);
    });

    it("verifies compliance-sentinel has formal verification and security tags", async () => {
        const blueprints = await forgeBlueprintService.listBlueprints();
        const compliance = blueprints.find(bp => bp.slug === "compliance-sentinel");

        expect(compliance).toBeDefined();
        expect(compliance?.category).toBe("Governance & Compliance");
        expect(compliance?.persona).toBe("Compliance Auditor");
        expect(compliance?.capabilities).toContain("Shield");
        expect(compliance?.formalVerification.status).toBe("PASSED");
    });

    it("verifies 5 distinct operational categories cover the catalog", async () => {
        const blueprints = await forgeBlueprintService.listBlueprints();
        const categories = new Set(blueprints.map(bp => bp.category));

        expect(categories.has("Operations & Field")).toBe(true);
        expect(categories.has("SDLC & Engineering")).toBe(true);
        expect(categories.has("Governance & Compliance")).toBe(true);
        expect(categories.has("Business & Intelligence")).toBe(true);
        expect(categories.has("Foundational & Microservices")).toBe(true);
    });
});
