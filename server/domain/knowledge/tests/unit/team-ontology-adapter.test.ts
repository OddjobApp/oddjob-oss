import { describe, it, expect } from "vitest";
import { ONTOLOGY_ADAPTERS, getAdapter } from "../../core/ontology-adapters.js";

// SCOPE: these assert the adapter's DECLARED SHAPE only — registration and the
// `properties` map. They execute no SQL, so they cannot catch a column that exists
// in the Drizzle schema but not in the database (which is exactly how the squad
// columns shipped dark). They lived under tests/integration/ and were named as
// integration tests, which implied a coverage they never had. A real integration
// test for this belongs under tests/integration/ and must call list()/get()
// against a provisioned database.


describe("Team & Squad Ontology Virtual Adapter", () => {
    it("registers 'teams' virtual adapter in ONTOLOGY_ADAPTERS dictionary", () => {
        const adapter = getAdapter("teams");
        expect(adapter).toBeDefined();
        expect(ONTOLOGY_ADAPTERS.teams).toBe(adapter);
    });

    it("surfaces hybrid squad properties including human and agent member counts", () => {
        const adapter = getAdapter("teams");
        expect(adapter).toBeDefined();
        if (!adapter) return;

        const propKeys = Object.keys(adapter.properties);

        // Core identity & metadata
        expect(propKeys).toContain("id");
        expect(propKeys).toContain("name");
        expect(propKeys).toContain("slug");
        expect(propKeys).toContain("description");
        expect(propKeys).toContain("organizationId");

        // Squad operational & spatial fields
        expect(propKeys).toContain("squadType");
        expect(propKeys).toContain("leadUserId");
        expect(propKeys).toContain("homeH3Index");
        expect(propKeys).toContain("status");

        // Hybrid member counts
        expect(propKeys).toContain("humanMemberCount");
        expect(propKeys).toContain("agentMemberCount");
        expect(propKeys).toContain("createdAt");
    });

    it("declares 'name' as titleProperty for graph visualizers and search", () => {
        const adapter = getAdapter("teams");
        expect(adapter?.titleProperty).toBe("name");
    });

    it("verifies team adapter properties align with foreign key join properties on domain adapters", () => {
        const teamAdapter = getAdapter("teams");
        const userAdapter = getAdapter("users");
        const cycleAdapter = getAdapter("operational_cycles");

        expect(teamAdapter).toBeDefined();
        expect(userAdapter).toBeDefined();
        expect(cycleAdapter).toBeDefined();

        // Check join target properties
        expect(teamAdapter?.properties.id).toBe("integer");
        expect(teamAdapter?.properties.leadUserId).toBe("string");
        expect(userAdapter?.properties.id).toBe("string");
        expect(cycleAdapter?.properties.createdBy).toBeDefined();
    });
});
