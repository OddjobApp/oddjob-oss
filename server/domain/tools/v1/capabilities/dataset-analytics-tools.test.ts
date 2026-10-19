import { describe, it, expect } from "vitest";
import { DATASET_ANALYTICS_TOOLS } from "./dataset-analytics-tools.js";
import { PLATFORM_DOCS_TOOLS } from "./platform-docs-tools.js";

/**
 * These two tool sets exist because the crew persona prompt named them while
 * nothing defined them. The point of this file is to make that failure loud:
 * the names the prompt tells agents to call must actually be registered, with a
 * schema, and must refuse to run without an organization.
 */
describe("crew analytics & docs tool registration", () => {
    const EXPECTED = [
        "get_dataset_items",
        "calculate_dataset_metric",
        "search_platform_documentation",
        "get_platform_feature_spec",
        "list_platform_features",
        "read_internal_repo_doc",
    ];

    const all = { ...DATASET_ANALYTICS_TOOLS, ...PLATFORM_DOCS_TOOLS };

    it("defines every tool name the crew prompt and allowlists reference", () => {
        for (const name of EXPECTED) {
            expect(all[name], `${name} is not defined`).toBeDefined();
        }
    });

    it("gives each tool a matching name, a description and a parameter schema", () => {
        for (const [key, def] of Object.entries(all)) {
            expect(def.name, `${key} name mismatch`).toBe(key);
            expect(def.description?.length ?? 0).toBeGreaterThan(20);
            expect(def.parameters, `${key} has no schema`).toBeDefined();
        }
    });

    it("refuses to run without an organization rather than defaulting to one", async () => {
        // The backing services default organizationId to 1. Reaching that default
        // from a tool call would serve another tenant's data, so the tool layer must
        // fail closed on an empty context.
        const orgScoped = [
            all.get_dataset_items,
            all.calculate_dataset_metric,
            all.search_platform_documentation,
            all.get_platform_feature_spec,
            all.list_platform_features,
        ];

        for (const tool of orgScoped) {
            const ctx = { named: {}, positional: {} } as any;
            const args = { datasetId: 1, query: "x", featureId: "api", numericField: "n", aggregation: "avg" };
            await expect(
                Promise.resolve().then(() => tool.execute(args as any, ctx)),
                `${tool.name} did not fail closed`,
            ).rejects.toThrow(/Organization context required/i);
        }
    });

    it("confines read_internal_repo_doc to the docs/ directory", async () => {
        const ctx = { named: {}, positional: {}, organizationId: 1 } as any;

        for (const docPath of [
            "../package.json",
            "../../etc/passwd",
            "docs/../../package.json",
            "/etc/passwd",
            "..\\..\\package.json",
        ]) {
            const out = await PLATFORM_DOCS_TOOLS.read_internal_repo_doc.execute({ docPath } as any, ctx);
            expect(String(out), `${docPath} was not refused`).toMatch(/Access denied|Only \.md|could not read/i);
        }
    });

    it("reads a real doc from docs/ when the path is legitimate", async () => {
        const ctx = { named: {}, positional: {}, organizationId: 1 } as any;
        const out = await PLATFORM_DOCS_TOOLS.read_internal_repo_doc.execute(
            { docPath: "specs/ONTOLOGY_SERVICE_DESIGN.md" } as any,
            ctx,
        );
        expect(String(out)).toContain("docs/specs/ONTOLOGY_SERVICE_DESIGN.md");
    });
});
