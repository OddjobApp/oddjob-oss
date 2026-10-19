import { describe, it, expect } from "vitest";
import {
    canonicalComponentKey,
    tutorialSnippetsForComponent,
} from "./component-index.js";
import { TUTORIAL_SNIPPETS } from "@shared/tutorials/registry.js";

/*
  component_index and the tutorial registry name the same component three
  different ways, and the gallery used to bridge them with
  `sourceFile.includes(componentName)` -- a match that could never fire, because
  an index name is title case with spaces and a file path has neither.

  These tests pin the canonical form that actually joins them.
*/
describe("component-index tutorial linkage", () => {
    it("reduces all three naming conventions for one component to the same key", () => {
        const fromIndexName = canonicalComponentKey("Platform Agent Swarm");
        const fromImportPath = canonicalComponentKey("@domain-ui/packaged/PlatformAgentSwarmBlock");
        const fromComponentId = canonicalComponentKey("platform-agent-swarm");
        const fromSourceFile = canonicalComponentKey(
            "server/domain/core/ui/components/packaged/PlatformAgentSwarmBlock.tsx"
        );

        expect(fromIndexName).toBe("platformagentswarm");
        expect(fromImportPath).toBe("platformagentswarm");
        expect(fromComponentId).toBe("platformagentswarm");
        expect(fromSourceFile).toBe("platformagentswarm");
    });

    it("keeps distinct components apart", () => {
        expect(canonicalComponentKey("Platform Agent Chat")).not.toBe(
            canonicalComponentKey("Platform Agent Swarm")
        );
        // "Pod" and "Block" are suffixes on the filename, not part of the name,
        // but they must not collapse two genuinely different components.
        expect(canonicalComponentKey("Mission Brief Pod")).toBe("missionbrief");
        expect(canonicalComponentKey("Mission Control Table")).toBe("missioncontroltable");
    });

    it("links a component to a snippet that names it, through either vocabulary", () => {
        // Driven off a real registry entry so it tracks the registry rather than
        // asserting against a fixture that can drift away from it.
        const snippet = TUTORIAL_SNIPPETS["snippet:discovery"];
        expect(snippet?.sourceFile, "snippet:discovery must declare a sourceFile").toBeTruthy();

        // Its sourceFile is .../CommandPalette.tsx, so an index row for that
        // component resolves to it from the display name and from the import path.
        expect(tutorialSnippetsForComponent("Command Palette", "")).toContain("snippet:discovery");
        expect(
            tutorialSnippetsForComponent("", "@domain-ui/shared/CommandPalette")
        ).toContain("snippet:discovery");
    });

    it("returns nothing for a component no snippet mentions", () => {
        expect(tutorialSnippetsForComponent("Totally Unrelated Widget", "@x/y/TotallyUnrelatedWidget"))
            .toEqual([]);
    });

    /*
      Today every packaged pod returns []. The index holds mountable blocks
      (@domain-ui/packaged/*) and all 11 snippets target app-shell pages and
      chrome, so the two sets are disjoint. That is a content gap, not a broken
      join -- this test records it so it is a deliberate state rather than a
      silent one, and it will fail the day a snippet is written against a pod.
    */
    it("documents that no snippet currently targets a packaged pod", () => {
        const pods = Object.values(TUTORIAL_SNIPPETS).filter((s) =>
            (s.sourceFile ?? "").includes("/packaged/")
        );
        expect(
            pods.map((s) => s.id),
            "a snippet now targets a packaged pod -- the gallery can surface it, so drop this test"
        ).toEqual([]);
    });
});
