import { describe, expect, it } from "vitest";
import { resolveBoundResource } from "../saas-adapter-inventory.service.js";

/**
 * The bound resource is the whole point of scoping an adapter to a project: it
 * is what makes "this project syncs to the ENG space" different from "the org
 * has Confluence". The key names are historical and differ per platform, so the
 * precedence is pinned here rather than rediscovered.
 */
describe("resolveBoundResource", () => {
    it("reads a Confluence space under any of its historical config keys", () => {
        expect(resolveBoundResource("confluence", { defaultSpace: "ENG" }))
            .toEqual({ kind: "Confluence space", value: "ENG" });
        expect(resolveBoundResource("confluence", { space_key: "OPS" }))
            .toEqual({ kind: "Confluence space", value: "OPS" });
        expect(resolveBoundResource("confluence", { spaceKey: "DOCS" }))
            .toEqual({ kind: "Confluence space", value: "DOCS" });
    });

    it("prefers defaultSpace when more than one key is present", () => {
        // Matches getConfluenceDefaultSpace in atlassian-connector-bridge.ts —
        // if these disagreed, the surface would name a different space than the
        // one the sync actually writes to.
        expect(resolveBoundResource("confluence", { spaceKey: "OLD", defaultSpace: "ENG" }))
            .toEqual({ kind: "Confluence space", value: "ENG" });
    });

    it("reads a Jira project key, and labels it as a Jira project", () => {
        expect(resolveBoundResource("jira", { defaultProjectKey: "PROJ" }))
            .toEqual({ kind: "Jira project", value: "PROJ" });
        expect(resolveBoundResource("jira", { project_key: "OPS" }))
            .toEqual({ kind: "Jira project", value: "OPS" });
    });

    it("reports nothing bound rather than guessing", () => {
        expect(resolveBoundResource("confluence", {})).toBeNull();
        expect(resolveBoundResource("confluence", null)).toBeNull();
        expect(resolveBoundResource("unknown_platform", { defaultSpace: "ENG" })).toBeNull();
        // Whitespace is not a binding.
        expect(resolveBoundResource("jira", { defaultProjectKey: "   " })).toBeNull();
    });
});
