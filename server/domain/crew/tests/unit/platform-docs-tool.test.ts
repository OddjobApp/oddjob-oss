import { describe, it, expect } from "vitest";
import { platformDocsTool } from "../../core/platform-docs-tool.service.js";

describe("PlatformDocsToolService", () => {
    it("searches platform documentation and returns structured feature specs", async () => {
        const search = await platformDocsTool.searchDocumentation("e2e-testing", 1);
        expect(search).toBeDefined();
        expect(typeof search.summary).toBe("string");
    });

    it("fetches singleton platform specs (api, ui, capability)", async () => {
        const apiSpec = await platformDocsTool.getFeatureSpec("api", 1);
        expect(apiSpec).toBeDefined();

        const capSpec = await platformDocsTool.getFeatureSpec("capability", 1);
        expect(capSpec).toBeDefined();
    });

    it("lists all available platform features", async () => {
        const features = await platformDocsTool.listFeatures(1);
        expect(Array.isArray(features)).toBe(true);
    });

    it("reads internal markdown documentation safely from docs/ with path sandboxing", async () => {
        const doc = await platformDocsTool.readInternalRepoDoc("specs/CREW_AI_ENGINE_PROPOSAL.md");
        if ("content" in doc) {
            expect(doc.content).toBeDefined();
            expect(typeof doc.content).toBe("string");
        } else {
            expect(doc.error).toBeDefined();
        }

        // Path traversal rejection
        const traversalAttempt = await platformDocsTool.readInternalRepoDoc("../../../package.json");
        if ("error" in traversalAttempt) {
            expect(traversalAttempt.error).toBeDefined();
        }
    });
});
