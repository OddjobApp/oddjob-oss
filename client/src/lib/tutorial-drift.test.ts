import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  TUTORIAL_SNIPPETS,
  TUTORIAL_CHAINS,
  TutorialSnippet,
  getLaunchableTutorialIds,
  startTutorial,
} from "./tutorial-engine";
import { DISCOVERY_TOOLS } from "../../../server/domain/tools/v1/capabilities/discovery";

describe("Tutorial Architectural Linkage & Drift Detection", () => {
  const snippets = Object.values(TUTORIAL_SNIPPETS);

  it("verifies all tutorial snippets have physical source files that exist on disk", () => {
    expect(snippets.length).toBeGreaterThan(0);

    for (const snippet of snippets) {
      expect(snippet.sourceFile, `Snippet ${snippet.id} must define a sourceFile`).toBeDefined();
      const fullPath = path.resolve(process.cwd(), snippet.sourceFile!);
      const exists = fs.existsSync(fullPath);
      expect(exists, `sourceFile for ${snippet.id} not found: ${snippet.sourceFile}`).toBe(true);
    }
  });

  it("verifies all tutorial snippets define valid componentIds, behaviorIds, and docSlugs", () => {
    const behaviorRegex = /^[a-z0-9-_]+(\.[a-z0-9-_]+){2,}$/;

    for (const snippet of snippets) {
      expect(snippet.componentId, `Snippet ${snippet.id} must define componentId`).toBeTruthy();
      expect(snippet.docSlug, `Snippet ${snippet.id} must define docSlug`).toBeTruthy();
      expect(snippet.behaviorId, `Snippet ${snippet.id} must define behaviorId`).toBeTruthy();
      expect(
        behaviorRegex.test(snippet.behaviorId!),
        `behaviorId "${snippet.behaviorId}" in ${snippet.id} must follow 'domain.subdomain.action' format`
      ).toBe(true);
    }
  });

  it("verifies all tutorial steps define non-empty targets and valid S.C.O.R.E. dimensions", () => {
    const validDimensions = new Set(["S", "C", "O", "R", "E"]);

    for (const snippet of snippets) {
      expect(validDimensions.has(snippet.scoreDimension)).toBe(true);
      expect(snippet.steps.length).toBeGreaterThan(0);

      for (const step of snippet.steps) {
        expect(step.target.trim().length).toBeGreaterThan(0);
        expect(validDimensions.has(step.scoreDimension)).toBe(true);
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("verifies chained playlists reference only valid, registered snippet IDs", () => {
    const registeredIds = new Set(Object.keys(TUTORIAL_SNIPPETS));

    for (const [chainId, chain] of Object.entries(TUTORIAL_CHAINS)) {
      expect(chain.snippetIds.length).toBeGreaterThan(0);
      for (const snippetId of chain.snippetIds) {
        expect(
          registeredIds.has(snippetId),
          `Playlist chain "${chainId}" references non-existent snippet "${snippetId}"`
        ).toBe(true);
      }
    }
  });

  /*
    Two entry points hand an id straight to startTutorial: the component
    gallery's "Live Demo" button, and the "Start Walkthrough" button on the
    launch_tutorial card the agent emits. Neither validates the id -- an
    unresolvable one console.warns and the button silently does nothing.

    Both were broken. startTutorial only looked in CANONICAL_CHAINS and
    CANONICAL_TUTORIALS, so every "snippet:*" id the gallery passes fell
    through; and launch_score_tutorial advertised five track ids to the model
    ('operations-hub', 'decision-inbox', 'app-forge', 'analytics-engine',
    'score-full-tour') that have never existed in any registry.

    These two tests are what stops that drifting apart again.
  */
  it("verifies every launchable id actually starts a tutorial instead of warning", () => {
    const dispatch = vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      // The gallery hands startTutorial a bare "snippet:*" id, so those must be
      // launchable individually. Checked explicitly, because a regression that
      // dropped snippets from BOTH the list and the resolver would otherwise
      // agree with itself and pass.
      const launchable = new Set(getLaunchableTutorialIds());
      for (const snippetId of Object.keys(TUTORIAL_SNIPPETS)) {
        expect(
          launchable.has(snippetId),
          `Snippet "${snippetId}" is offered by the gallery's Live Demo button but is not listed as launchable`
        ).toBe(true);
      }

      // The list is only a claim until startTutorial honours it: an id it
      // cannot resolve warns to the console and dispatches nothing, which
      // reaches a user as a button that does nothing at all.
      for (const id of launchable) {
        dispatch.mockClear();
        warn.mockClear();
        startTutorial(id);
        expect(warn, `startTutorial("${id}") warned instead of starting`).not.toHaveBeenCalled();
        expect(dispatch, `startTutorial("${id}") dispatched nothing`).toHaveBeenCalledTimes(1);
      }
    } finally {
      dispatch.mockRestore();
      warn.mockRestore();
    }
  });

  it("verifies every tutorial id the launch_score_tutorial tool advertises actually resolves", () => {
    const tool = DISCOVERY_TOOLS.launch_score_tutorial;
    expect(tool, "launch_score_tutorial must be registered in DISCOVERY_TOOLS").toBeDefined();

    // Everything the model is shown: the tool description plus the trackId
    // parameter's. Any single-quoted token in either is treated as an id it is
    // being told to use, so quoting one that does not resolve fails here.
    const shape = (tool.parameters as any)?.shape?.trackId;
    const advertised = [tool.description, shape?.description ?? ""].join(" ");
    const quoted = [...advertised.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(quoted.length, "the tool should name at least one concrete track id").toBeGreaterThan(0);

    const launchable = new Set(getLaunchableTutorialIds());
    for (const id of quoted) {
      expect(
        launchable.has(id),
        `launch_score_tutorial tells the model to use "${id}", which startTutorial cannot resolve`
      ).toBe(true);
    }
  });
});
