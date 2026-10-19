import { describe, it, expect } from "vitest";
import { ONTOLOGY_ADAPTERS, getAdapter } from "../../core/ontology-adapters.js";

// SCOPE: these assert the adapter's DECLARED SHAPE only — registration and the
// `properties` map. They execute no SQL, so they cannot catch a column that exists
// in the Drizzle schema but not in the database (which is exactly how the squad
// columns shipped dark). They lived under tests/integration/ and were named as
// integration tests, which implied a coverage they never had. A real integration
// test for this belongs under tests/integration/ and must call list()/get()
// against a provisioned database.


describe("User Ontology Virtual Adapter", () => {
    it("registers 'users' virtual adapter in ONTOLOGY_ADAPTERS dictionary", () => {
        const adapter = getAdapter("users");
        expect(adapter).toBeDefined();
        expect(ONTOLOGY_ADAPTERS.users).toBe(adapter);
    });

    it("surfaces non-sensitive semantic properties and strictly excludes auth secrets", () => {
        const adapter = getAdapter("users");
        expect(adapter).toBeDefined();
        if (!adapter) return;

        const propKeys = Object.keys(adapter.properties);

        // Required public/semantic properties
        expect(propKeys).toContain("id");
        expect(propKeys).toContain("username");
        expect(propKeys).toContain("email");
        expect(propKeys).toContain("displayName");
        expect(propKeys).toContain("defaultOrgId");
        expect(propKeys).toContain("slackHandle");
        expect(propKeys).toContain("quietHoursEnabled");
        expect(propKeys).toContain("quietHoursTimezone");

        // Zero-trust boundary: MUST NOT expose credentials
        expect(propKeys).not.toContain("password");
        expect(propKeys).not.toContain("pin");
        expect(propKeys).not.toContain("salt");
        expect(propKeys).not.toContain("token");
        expect(propKeys).not.toContain("mfaSecret");
    });

    it("declares 'displayName' as titleProperty for graph visualizers and search", () => {
        const adapter = getAdapter("users");
        expect(adapter?.titleProperty).toBe("displayName");
    });

    it("verifies user adapter properties align with foreign key join properties on domain adapters", () => {
        const userAdapter = getAdapter("users");
        const scheduledJobAdapter = getAdapter("scheduled_jobs");
        const cycleAdapter = getAdapter("operational_cycles");
        const spatialAdapter = getAdapter("spatial_regions");

        expect(userAdapter).toBeDefined();
        expect(scheduledJobAdapter).toBeDefined();
        expect(cycleAdapter).toBeDefined();
        expect(spatialAdapter).toBeDefined();

        // Check join target properties
        expect(userAdapter?.properties.id).toBe("string");
        expect(scheduledJobAdapter?.properties.createdBy).toBeDefined();
        expect(cycleAdapter?.properties.createdBy).toBeDefined();
        expect(spatialAdapter?.properties.createdBy).toBeDefined();
    });
});
