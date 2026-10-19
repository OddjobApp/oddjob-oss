/**
 * Every studio the platform has, and the pieces each one is made of.
 *
 * A studio is a sustained work surface beside a CREW chat. Ten of them exist,
 * and until this file each was assembled from six or seven parts kept in
 * different places -- a payload type in RICH_PAYLOAD_TYPES, a mount tool in the
 * capability registry, a branch in studioMountKind, a name in STUDIO_NAME, a
 * position in the tie-break order, a card branch in TurnRow. Nothing held them
 * together, so every new studio re-derived the list and each one missed a
 * different part. Three studios currently carry client branches for mount tools
 * that do not exist, and two carry proposal types that reach a room with no
 * branch to render them.
 *
 * This is the source of truth for the parts that are pure data: the display
 * name, the tie-break order, and which studios can scope a message to a
 * selection. Those are derived from here rather than repeated, so a wrong entry
 * shows up in the UI. The parts that are structural -- is the payload type
 * registered, does the mount tool exist, is there a card branch -- cannot be
 * derived, so studio-conformance.test.ts asserts them against this list.
 *
 * Key order is the tie-break order: when two studios mount in one turn, the
 * earlier key wins. It is read with Object.keys, which preserves insertion
 * order for string keys.
 */

/** A studio with its own mount tool and payload type. */
export interface ToolMountedStudio {
  name: string;
  mountedVia: "tool";
  /** Payload type its mount emits. Must be in RICH_PAYLOAD_TYPES. */
  podType: string;
  /** Tool that mounts it. Must exist in the capability registry. */
  mountTool: string;
  /** Component name, where its payloads also carry one. */
  podComponent?: string;
  /** Whether a message can be scoped to something selected in it. */
  scoped: boolean;
  /** Types it emits as cards. Each needs a RICH_PAYLOAD_TYPES entry and a TurnRow branch. */
  proposalTypes?: readonly string[];
}

/**
 * A studio mounted through mount_builder_pod, identified by its component name.
 *
 * Deliberately a separate shape rather than a tool-mounted studio with missing
 * fields: these three have no mount tool and no payload type of their own, and
 * recording that honestly is the point. Their client branches checking for
 * mount_signal_studio, mount_project_studio and mount_computer_studio are dead
 * -- no such tools exist -- and the conformance test holds that as a known
 * divergence rather than letting it look like support.
 */
export interface BuilderPodStudio {
  name: string;
  mountedVia: "builder_pod";
  /** The podComponent value its mount carries. */
  podComponent: string;
  scoped: boolean;
  proposalTypes?: readonly string[];
}

export type Studio = ToolMountedStudio | BuilderPodStudio;

export const STUDIOS = {
  media: {
    name: "Media Studio",
    mountedVia: "tool",
    podType: "media_studio_pod",
    mountTool: "mount_media_studio",
    podComponent: "MediaStudioPod",
    scoped: true,
    proposalTypes: ["media_change_proposal", "media_story_proposal", "media_style_bible_proposal"],
  },
  form: {
    name: "Form Studio",
    mountedVia: "tool",
    podType: "form_studio_pod",
    mountTool: "mount_form_studio",
    podComponent: "FormStudioPod",
    scoped: true,
    proposalTypes: ["form_change_proposal", "form_create_proposal"],
  },
  flow: {
    name: "Flow Studio",
    mountedVia: "tool",
    podType: "flow_studio_pod",
    mountTool: "mount_flow_studio",
    podComponent: "FlowStudioPod",
    scoped: false,
    proposalTypes: ["flow_create_proposal", "flow_created"],
  },
  prediction: {
    name: "Prediction Studio",
    mountedVia: "tool",
    podType: "prediction_studio_pod",
    mountTool: "mount_prediction_studio",
    podComponent: "PredictionStudioPod",
    scoped: false,
    proposalTypes: ["prediction_model_proposal", "prediction_inference_result"],
  },
  app: {
    name: "App Studio",
    mountedVia: "tool",
    podType: "app_studio_pod",
    mountTool: "mount_app_studio",
    podComponent: "AppStudioPod",
    scoped: true,
  },
  scribe: {
    name: "Scribe Studio",
    mountedVia: "tool",
    // The one payload type not named after its studio. Renaming it would break
    // every room holding one, so the name is recorded rather than corrected.
    podType: "scribe_foundry_pod",
    mountTool: "mount_scribe_studio",
    podComponent: "ScribeStudioPod",
    scoped: false,
  },
  project: {
    name: "Project Studio",
    mountedVia: "tool",
    podType: "project_studio_pod",
    mountTool: "mount_project_studio",
    podComponent: "ProjectStudioPod",
    scoped: false,
  },
  computer: {
    name: "Computer Use Studio",
    mountedVia: "tool",
    podType: "computer_use_studio_pod",
    mountTool: "mount_computer_studio",
    podComponent: "ComputerUseStudioPod",
    scoped: false,
  },
  signal: {
    name: "Signal Studio",
    mountedVia: "tool",
    podType: "signal_studio_pod",
    mountTool: "mount_signal_studio",
    podComponent: "SignalStudioPod",
    scoped: false,
  },
  agent: {
    name: "Agent Studio",
    mountedVia: "tool",
    podType: "agent_studio_pod",
    mountTool: "mount_agent_studio",
    scoped: false,
    proposalTypes: ["agent_change_proposal"],
  },
} as const satisfies Record<string, Studio>;

export type StudioKind = keyof typeof STUDIOS;

/** Tie-break order when two studios mount in one turn: earlier wins. */
export const STUDIO_KINDS = Object.keys(STUDIOS) as StudioKind[];

/** Display names, keyed by kind. */
export const STUDIO_NAMES = Object.fromEntries(
  STUDIO_KINDS.map((kind) => [kind, STUDIOS[kind].name]),
) as Record<StudioKind, string>;

/** The kinds whose studios a message can be scoped to a selection in. */
type ScopedKind = { [K in StudioKind]: (typeof STUDIOS)[K]["scoped"] extends true ? K : never }[StudioKind];

/**
 * The name a scoped message carries, as a union rather than a string.
 *
 * Derived from the registry's `scoped` flags, so marking a studio scoped widens
 * this automatically and a typo in a scope prefix still fails to compile.
 */
export type ScopedStudioName = (typeof STUDIOS)[ScopedKind]["name"];

/** The studios a message can be scoped to a selection in. */
export const SCOPED_STUDIO_NAMES = STUDIO_KINDS
  .filter((kind) => STUDIOS[kind].scoped)
  .map((kind) => STUDIOS[kind].name) as ScopedStudioName[];

export function isToolMounted(studio: Studio): studio is ToolMountedStudio {
  return studio.mountedVia === "tool";
}
