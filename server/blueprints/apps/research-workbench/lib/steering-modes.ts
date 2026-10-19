import type { SteeringMode } from "../app/components/AgentChat";

export const researchSteeringModes: SteeringMode[] = [
  {
    id: "research-protocol",
    label: "Define protocol",
    description:
      "Set evidence boundaries and stopping conditions before collection.",
    intent: "Prepare a governed research protocol for user confirmation.",
    fields: [
      {
        name: "decision",
        label: "Decision or question supported",
        type: "textarea",
        required: true,
      },
      {
        name: "criteria",
        label: "Inclusion and exclusion criteria",
        type: "textarea",
        required: true,
      },
      {
        name: "sources",
        label: "Required source types",
        type: "multiselect",
        options: [
          "Primary sources",
          "Peer-reviewed papers",
          "Official documentation",
          "Standards/RFCs",
          "Independent benchmarks",
          "First-party engineering reports",
        ],
      },
      {
        name: "boundaries",
        label: "Date, jurisdiction, version, or domain boundaries",
        type: "text",
      },
      {
        name: "budget",
        label: "Source/token budget and stopping condition",
        type: "text",
      },
    ],
  },
  {
    id: "evidence-challenge",
    label: "Challenge finding",
    description:
      "Plan a bounded adversarial search without overwriting the original finding.",
    intent:
      "Find disconfirming evidence and alternative explanations for a selected claim.",
    fields: [
      {
        name: "claim",
        label: "Claim to challenge",
        type: "textarea",
        required: true,
      },
      {
        name: "challenge",
        label: "Challenge type",
        type: "select",
        required: true,
        options: [
          "Contradictory evidence",
          "Alternative explanation",
          "Outdated evidence",
          "Benchmark mismatch",
          "Missing primary source",
        ],
      },
      {
        name: "confidence",
        label: "Required confidence/evidence bar",
        type: "text",
      },
      {
        name: "sourceRules",
        label: "Sources to require or exclude",
        type: "textarea",
      },
    ],
  },
  {
    id: "matrix-curation",
    label: "Curate comparison",
    description:
      "Define options, dimensions, weights, and unknown-value treatment.",
    intent: "Prepare a consistent comparison-matrix specification.",
    fields: [
      {
        name: "options",
        label: "Options, including baseline/status quo",
        type: "textarea",
        required: true,
      },
      {
        name: "dimensions",
        label: "Evaluation dimensions and weights",
        type: "textarea",
        required: true,
      },
      {
        name: "constraints",
        label: "Non-negotiable constraints",
        type: "textarea",
      },
      {
        name: "unknowns",
        label: "Unknown-value treatment and decision threshold",
        type: "text",
      },
    ],
  },
];

export const draftSteeringModes: SteeringMode[] = [
  {
    id: "architecture-decision",
    label: "Frame decision",
    description:
      "Prepare an architecture decision for the formal Decision Panel.",
    intent: "Draft a reversible, evidence-linked architecture decision record.",
    fields: [
      {
        name: "option",
        label: "Selected or preferred option",
        type: "text",
        required: true,
      },
      {
        name: "evidence",
        label: "Evidence reviewed",
        type: "textarea",
        required: true,
      },
      {
        name: "constraints",
        label: "Constraints driving the choice",
        type: "textarea",
      },
      {
        name: "validation",
        label: "Validation and revisit trigger",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "feasibility-review",
    label: "Review feasibility",
    description: "Prepare conditions and evidence for PoC sign-off.",
    intent: "Review feasibility without granting approval.",
    fields: [
      {
        name: "decision",
        label: "Proposed disposition",
        type: "select",
        required: true,
        options: [
          "Approve conditionally",
          "Request changes",
          "Reject",
          "Need more evidence",
        ],
      },
      {
        name: "tests",
        label: "Required test evidence",
        type: "textarea",
        required: true,
      },
      {
        name: "risks",
        label: "Security, compatibility, and dependency concerns",
        type: "textarea",
      },
      {
        name: "rollback",
        label: "Migration and rollback requirements",
        type: "textarea",
      },
    ],
  },
  {
    id: "revision-direction",
    label: "Direct revision",
    description:
      "Create bounded, testable instructions for the next artifact version.",
    intent:
      "Prepare revision instructions while preserving evidence and decision history.",
    fields: [
      {
        name: "artifact",
        label: "Artifact and version",
        type: "text",
        required: true,
      },
      {
        name: "sections",
        label: "Sections requiring revision",
        type: "textarea",
        required: true,
      },
      {
        name: "preserve",
        label: "Content or decisions to preserve",
        type: "textarea",
      },
      {
        name: "acceptance",
        label: "Acceptance criteria for the revision",
        type: "textarea",
        required: true,
      },
    ],
  },
];

export const backlogSteeringModes: SteeringMode[] = [
  {
    id: "backlog-decomposition",
    label: "Steer decomposition",
    description:
      "Define task granularity, ownership, and readiness before synchronization.",
    intent: "Prepare an implementation-backlog decomposition plan.",
    fields: [
      {
        name: "phase",
        label: "Target implementation phase",
        type: "text",
        required: true,
      },
      {
        name: "boundaries",
        label: "Team and ownership boundaries",
        type: "textarea",
      },
      {
        name: "granularity",
        label: "Desired granularity",
        type: "select",
        required: true,
        options: [
          "Epic and stories",
          "Small vertical slices",
          "Engineering tasks",
          "Migration waves",
        ],
      },
      {
        name: "requiredWork",
        label: "Required work types",
        type: "multiselect",
        options: [
          "Testing",
          "Telemetry",
          "Security",
          "Migration",
          "Documentation",
          "Rollback",
          "Operational readiness",
        ],
      },
      {
        name: "done",
        label: "Definition of ready and done",
        type: "textarea",
        required: true,
      },
      { name: "duplicates", label: "Duplicate-handling policy", type: "text" },
    ],
  },
];
