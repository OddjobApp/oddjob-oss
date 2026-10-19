import { describe, it, expect } from "vitest";
import { requireOrg, validateActionParams } from "../../core/ontology.service.js";
import { ForbiddenError, BadRequestError } from "@server/utils/errors.js";

// The DB-backed OntologyService (list/get/execute) needs a live, migrated DB and is
// covered by integration tests. Here we lock the security-critical PURE logic that
// gates every call: org isolation and param validation.

describe("OntologyService.requireOrg (tenant isolation gate)", () => {
    it("returns the org id when present", () => {
        expect(requireOrg({ organizationId: 42 })).toBe(42);
    });

    it("refuses a missing/invalid org context rather than defaulting", () => {
        expect(() => requireOrg({} as any)).toThrow(ForbiddenError);
        expect(() => requireOrg(undefined as any)).toThrow(ForbiddenError);
        expect(() => requireOrg({ organizationId: "7" } as any)).toThrow(ForbiddenError);
        expect(() => requireOrg({ organizationId: null } as any)).toThrow(ForbiddenError);
    });
});

describe("OntologyService.validateActionParams", () => {
    const schema = { ticketId: "integer", technicianName: "string" };

    it("passes when all required params are present and well-typed", () => {
        expect(() => validateActionParams(schema, { ticketId: 1, technicianName: "smith" }, "assign")).not.toThrow();
    });

    it("throws on a missing required param", () => {
        expect(() => validateActionParams(schema, { ticketId: 1 }, "assign")).toThrow(/Missing required parameter 'technicianName'/);
    });

    it("throws on a null param", () => {
        expect(() => validateActionParams(schema, { ticketId: null, technicianName: "x" }, "assign")).toThrow(BadRequestError);
    });

    it("throws when an integer param is not an integer", () => {
        expect(() => validateActionParams(schema, { ticketId: "nope", technicianName: "x" }, "assign")).toThrow(/must be an integer/);
    });

    it("accepts numeric strings for integer params", () => {
        expect(() => validateActionParams(schema, { ticketId: "5", technicianName: "x" }, "assign")).not.toThrow();
    });

    it("is a no-op for an empty schema", () => {
        expect(() => validateActionParams({}, {}, "noop")).not.toThrow();
    });
});

/**
 * Query as an ontology primitive.
 *
 * The registration is what makes a saved query discoverable beside Missions,
 * Pipelines and Datasets. These lock the parts that are wrong-by-construction if
 * they drift: a default type naming an adapter that does not exist would seed a
 * type nothing can read, and publishing `cypherQuery` would advertise a string
 * this platform has no engine to execute.
 */
describe("Query ontology primitive", () => {
    it("registers Query against an adapter that exists", async () => {
        const { OntologyService } = await import("../../core/ontology.service.js");
        const { ONTOLOGY_ADAPTERS } = await import("../../core/ontology-adapters.js");

        const queryType = OntologyService.DEFAULT_VIRTUAL_TYPES.find((t) => t.name === "Query");
        expect(queryType, "Query must be a seeded default type").toBeDefined();
        expect(ONTOLOGY_ADAPTERS[queryType!.adapter], `no adapter "${queryType!.adapter}"`).toBeDefined();
    });

    it("names an existing adapter for every default type, not just Query", async () => {
        const { OntologyService } = await import("../../core/ontology.service.js");
        const { ONTOLOGY_ADAPTERS } = await import("../../core/ontology-adapters.js");

        const dangling = OntologyService.DEFAULT_VIRTUAL_TYPES
            .filter((t) => !ONTOLOGY_ADAPTERS[t.adapter])
            .map((t) => `${t.name} → ${t.adapter}`);
        expect(dangling, `types with no adapter: ${dangling.join(", ")}`).toEqual([]);
    });

    it("does not publish cypherQuery as a property of the primitive", async () => {
        const { ONTOLOGY_ADAPTERS } = await import("../../core/ontology-adapters.js");
        const adapter = ONTOLOGY_ADAPTERS["saved_queries"];

        // There is no Cypher engine here: the string is built for the builder's
        // preview and executed by nothing. Surfacing it as a property would
        // invite agents and templates to treat it as runnable.
        expect(Object.keys(adapter.properties)).not.toContain("cypherQuery");
        expect(Object.keys(adapter.properties)).toEqual(
            expect.arrayContaining(["id", "name", "description", "runCount", "lastRunAt"]),
        );
        expect(adapter.titleProperty).toBe("name");
        // A title property that is not a property would render blank rows.
        expect(Object.keys(adapter.properties)).toContain(adapter.titleProperty);
    });

    it("declares a title property that every adapter actually exposes", async () => {
        const { ONTOLOGY_ADAPTERS } = await import("../../core/ontology-adapters.js");
        const broken = Object.entries(ONTOLOGY_ADAPTERS)
            .filter(([, a]) => !Object.keys(a.properties).includes(a.titleProperty))
            .map(([k, a]) => `${k}.titleProperty="${a.titleProperty}"`);
        expect(broken, `title properties not in the property map: ${broken.join(", ")}`).toEqual([]);
    });
});
