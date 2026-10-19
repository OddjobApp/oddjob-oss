import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STUDIOS, STUDIO_KINDS, isToolMounted, type Studio } from "@shared/studio-registry.js";
import { RICH_PAYLOAD_TYPES, UNIVERSAL_PRESENTATION_TOOLS } from "@domain/crew/core/crew-tools.service.js";
import { getAgentTools } from "@domain/tools/v1/capabilities/index.js";
import { STUDIO_AGENT_TOOLS } from "@domain/crew/core/crew-studio-tools.js";

/**
 * Every studio, checked against the pieces it is actually made of.
 *
 * A studio is assembled from parts that live apart: a payload type in
 * RICH_PAYLOAD_TYPES, a mount tool in the capability registry, a grant in
 * UNIVERSAL_PRESENTATION_TOOLS, a card branch in TurnRow. Miss one and the
 * failure is silent in a way that reads as working -- an artifact reaching a
 * room as raw JSON, a mount notice with nothing behind it, a tool no speaker can
 * reach. Each of those has happened here.
 *
 * So this walks shared/studio-registry.ts rather than a list maintained beside
 * it. A studio added to the registry and nowhere else fails by name.
 */

const REPO_ROOT = resolve(__dirname, "../../../..");
const TURN_ROW = resolve(REPO_ROOT, "client/src/components/agent-chat/TurnRow.tsx");
const MOUNT_NOTICE = resolve(REPO_ROOT, "client/src/components/agent-chat/StudioMountNotice.tsx");
const CREW_STUDIOS = resolve(REPO_ROOT, "client/src/components/agent-chat/useCrewStudios.ts");
const PACKAGED = resolve(REPO_ROOT, "server/domain/core/ui/components/packaged");

/**
 * What is known to be missing today, and must not grow.
 *
 * Three studios mount only through mount_builder_pod, yet carry client branches
 * for mount_signal_studio, mount_project_studio and mount_computer_studio, none
 * of which exist server-side, and for payload types that are not registered.
 * Two Prediction Studio proposal types are registered but have no branch in
 * TurnRow, so a proposal would reach a room with nothing to draw it.
 *
 * Recorded rather than fixed here: this test has to land before the removals, so
 * that taking a branch out is something the test proves safe.
 */
const KNOWN_DIVERGENCES = {
  /** kind -> mount tools the client checks for that the server does not define. */
  deadMountToolChecks: {} as Record<string, string[]>,
  /**
   * Proposal types registered but with no TurnRow branch.
   *
   * Empty, and worth keeping so. Prediction Studio's two sat here until it had a
   * card to draw them: a type in RICH_PAYLOAD_TYPES with no branch reaches a
   * room and renders nothing at all.
   */
  proposalTypesWithNoCard: [] as string[],
  /**
   * Pods with no shim in the packaged registry.
   *
   * Empty, and worth keeping so. Signal, Flow and Prediction each lacked one
   * until this test named them: they still mounted in a room, because
   * StudioMountNotice and the rail intercept a studio artifact before
   * InstantAppRenderer sees it, so what they lost was a gallery preview and a
   * name InstantAppRenderer could resolve -- invisible either way.
   */
  podsWithoutPackagedShim: [] as string[],
};

const entries = Object.entries(STUDIOS) as [string, Studio][];
const turnRowSource = readFileSync(TURN_ROW, "utf8");
const mountNoticeSource = readFileSync(MOUNT_NOTICE, "utf8");
/**
 * Detection is split across two files: studioMountKind handles nine kinds, and
 * useCrewStudios recognises Scribe a level up before delegating. Searching both
 * asserts that some client module knows the studio, which is the real contract.
 */
const clientDetectionSource = mountNoticeSource + readFileSync(CREW_STUDIOS, "utf8");
const registry = getAgentTools();
describe('studio editing grants resolve to real tools', () => {
  for (const [studio, tools] of Object.entries(STUDIO_AGENT_TOOLS)) {
    it(studio, () => {
      for (const name of tools) expect(registry[name], `${studio}: ${name}`).toBeDefined();
    });
  }
});
const registrySource = readFileSync(resolve(PACKAGED, "registry.ts"), "utf8");

describe("every studio's payload type is registered", () => {
  for (const [kind, studio] of entries) {
    if (!isToolMounted(studio)) continue;
    it(`${kind}: ${studio.podType} is in RICH_PAYLOAD_TYPES`, () => {
      // Missing here, detectArtifact returns null and the mount envelope
      // reaches the room as prose instead of opening the studio.
      expect(RICH_PAYLOAD_TYPES.has(studio.podType)).toBe(true);
    });
  }
});

describe("every studio's mount tool exists and is reachable", () => {
  for (const [kind, studio] of entries) {
    if (!isToolMounted(studio)) continue;

    it(`${kind}: ${studio.mountTool} is a registered tool`, () => {
      expect(Object.keys(registry)).toContain(studio.mountTool);
    });

    it(`${kind}: ${studio.mountTool} is granted to every card`, () => {
      // No synced agent card declares a mount tool, so without the universal
      // grant no speaker in any room could ever open the studio.
      expect(UNIVERSAL_PRESENTATION_TOOLS).toContain(studio.mountTool);
    });
  }
});

describe("a builder-pod studio claims no mount tool the server lacks", () => {
  const builderPodStudios = entries.filter(([, studio]) => !isToolMounted(studio));
  if (builderPodStudios.length === 0) {
    it("all studios are first-class tool-mounted", () => {
      expect(builderPodStudios.length).toBe(0);
    });
  } else {
    for (const [kind] of builderPodStudios) {
      it(`${kind}: its client branches do not outrun the server`, () => {
        const expected = KNOWN_DIVERGENCES.deadMountToolChecks[kind] ?? [];
        const dead = expected.filter(
          (tool) => clientDetectionSource.includes(`'${tool}'`) && !Object.keys(registry).includes(tool),
        );
        // Equality, not "at most": a branch that gets fixed must be removed from
        // the baseline, and a new dead branch fails here rather than accumulating.
        expect(dead.sort()).toEqual([...expected].sort());
      });
    }
  }
});

describe("studioMountKind can find every studio", () => {
  for (const [kind, studio] of entries) {
    it(`${kind}: is recognised by the component or payload it mounts with`, () => {
      // Asserted against the source rather than by calling it: this file runs in
      // the server project and the function is a client module. The marker is
      // the discriminator each studio is actually matched on.
      const marker = isToolMounted(studio) ? studio.podType : studio.podComponent;
      expect(clientDetectionSource).toContain(marker);
    });

    it(`${kind}: is named from the registry rather than a second list`, () => {
      // The notice derives STUDIO_NAME from the registry, so the name is correct
      // by construction. What can still rot is the import -- reinstating a local
      // map here would silently reintroduce the drift this slice removed.
      expect(mountNoticeSource).toContain("STUDIO_NAMES");
      expect(mountNoticeSource).not.toMatch(/const STUDIO_NAME[^=]*=\s*\{/);
    });
  }
});

describe("every proposal type a studio emits can be rendered", () => {
  for (const [kind, studio] of entries) {
    for (const type of studio.proposalTypes ?? []) {
      const baselined = KNOWN_DIVERGENCES.proposalTypesWithNoCard.includes(type);

      it(`${kind}: ${type} is in RICH_PAYLOAD_TYPES`, () => {
        expect(RICH_PAYLOAD_TYPES.has(type)).toBe(true);
      });

      it(`${kind}: ${type} ${baselined ? "is known to have no card" : "has a card in TurnRow"}`, () => {
        // Source text, deliberately: a payload type with no branch renders
        // nothing, and there is no structural way to see that from here.
        const hasBranch = turnRowSource.includes(`p.type === '${type}'`);
        expect(hasBranch).toBe(!baselined);
      });
    }
  }
});

describe("the room's studio kinds come from the registry", () => {
  it("takes StudioMountKind from it rather than restating the union", () => {
    // This union used to list nine kinds by hand, one short of the registry and
    // with no way to notice. Aliasing it means a studio cannot exist in the room
    // without existing here.
    expect(mountNoticeSource).toMatch(/export type StudioMountKind = StudioKind/);
    expect(mountNoticeSource).toContain("@shared/studio-registry");
  });

  it("takes the tie-break order from it too", () => {
    const crewStudios = readFileSync(CREW_STUDIOS, "utf8");
    expect(crewStudios).toContain("STUDIO_KINDS");
    // A hand-ordered array here would silently disagree with the registry.
    expect(crewStudios).not.toMatch(/STUDIO_TIE_PRIORITY[^=]*=\s*\[\s*'/);
  });

  it("covers every kind the tie-break order can hold", () => {
    expect(STUDIO_KINDS.length).toBe(entries.length);
  });
});

describe("a studio pod the gallery previews has a shim in the packaged registry", () => {
  for (const [kind, studio] of entries) {
    const component = studio.podComponent;
    if (!component) continue;
    const baselined = KNOWN_DIVERGENCES.podsWithoutPackagedShim.includes(component);

    it(`${kind}: ${component} ${baselined ? "is known to have none" : "has one"}`, () => {
      // Both halves: a file to import, and a name the registry resolves. One
      // without the other renders "Component isn't available to render".
      const hasShim = existsSync(resolve(PACKAGED, `${component}.tsx`));
      const registered = registrySource.includes(`"${component}"`);
      expect(hasShim && registered).toBe(!baselined);
    });
  }
});
