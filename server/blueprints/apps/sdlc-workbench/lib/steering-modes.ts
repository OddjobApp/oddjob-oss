import type { SteeringMode } from "../app/components/SteeringFormPanel";

export const planningSteeringModes: SteeringMode[] = [
  {
    id: "dependency-discovery",
    label: "Discover dependencies",
    description:
      "Collect upstream, downstream, technical, data, organizational, and operational dependencies.",
    intent:
      "Create a traceable dependency inventory and identify critical-path blockers.",
    outputArtifact: "dependency_inventory",
    fields: [
      {
        name: "outcome",
        label: "Requested outcome",
        type: "textarea",
        required: true,
      },
      {
        name: "systems",
        label: "Known upstream and downstream systems",
        type: "textarea",
      },
      {
        name: "resources",
        label: "Required resource types",
        type: "multiselect",
        options: [
          "API",
          "Database",
          "Event/topic",
          "File/feed",
          "Agent",
          "Workbench app",
          "Form Agent",
          "Pipeline output",
          "Human owner",
          "Environment",
        ],
      },
      {
        name: "constraints",
        label: "Version, security, timing, and availability constraints",
        type: "textarea",
      },
      {
        name: "fallback",
        label: "Fallback behavior if a dependency is unavailable",
        type: "textarea",
      },
      {
        name: "requiredBy",
        label: "Required-by phase or date",
        type: "text",
      },
    ],
  },
  {
    id: "integration-contract",
    label: "Define integration",
    description:
      "Turn an external dependency into an implementation-ready contract.",
    intent:
      "Prepare a versioned integration contract with failure and test behavior.",
    outputArtifact: "integration_contract",
    fields: [
      {
        name: "parties",
        label: "Provider and consumer",
        type: "text",
        required: true,
      },
      {
        name: "interface",
        label: "Protocol, endpoint, event, or file contract",
        type: "textarea",
        required: true,
      },
      {
        name: "schemas",
        label: "Request, response, or event schemas",
        type: "textarea",
      },
      {
        name: "auth",
        label: "Authentication and authorization",
        type: "textarea",
      },
      {
        name: "resilience",
        label: "Rate limits, timeout, retry, and idempotency",
        type: "textarea",
      },
      {
        name: "testing",
        label: "Sandbox, fixture, mock, and contract-test availability",
        type: "textarea",
      },
    ],
  },
  {
    id: "instant-app-intake",
    label: "Request instant app",
    description:
      "Determine whether the outcome needs an existing surface, temporary app, or permanent App Forge project.",
    intent: "Prepare a governed instant-app recommendation and app plan.",
    outputArtifact: "instant_app_request",
    fields: [
      {
        name: "outcome",
        label: "User outcome",
        type: "textarea",
        required: true,
      },
      {
        name: "users",
        label: "Users and roles",
        type: "text",
        required: true,
      },
      {
        name: "capabilities",
        label: "Required UI and workflow capabilities",
        type: "multiselect",
        options: [
          "Structured forms",
          "Review table",
          "Dashboard",
          "Queue",
          "Approval gate",
          "Search",
          "Report/export",
          "Copilot",
        ],
      },
      {
        name: "data",
        label: "Required records, data sources, and integrations",
        type: "textarea",
        required: true,
      },
      {
        name: "writes",
        label: "Data access",
        type: "select",
        required: true,
        options: [
          "Read-only",
          "Internal writes",
          "External writes",
          "Not yet known",
        ],
      },
      {
        name: "lifecycle",
        label: "Expected lifespan and success/promotion criteria",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "change-impact",
    label: "Assess change impact",
    description:
      "Identify blast radius, stale artifacts, required reviewers, and regression scope.",
    intent: "Prepare a change-impact and artifact-invalidation report.",
    outputArtifact: "change_impact_report",
    fields: [
      {
        name: "change",
        label: "Proposed change",
        type: "textarea",
        required: true,
      },
      {
        name: "areas",
        label: "Known affected areas",
        type: "multiselect",
        options: [
          "Requirements",
          "Architecture",
          "API",
          "Database",
          "Frontend",
          "Mobile",
          "Agents/prompts",
          "Tests",
          "Operations",
          "Documentation",
        ],
      },
      {
        name: "compatibility",
        label: "Compatibility and migration concerns",
        type: "textarea",
      },
      {
        name: "risk",
        label: "Reversibility, exposure, and failure impact",
        type: "textarea",
      },
    ],
  },
];

export const deliverySteeringModes: SteeringMode[] = [
  {
    id: "environment-readiness",
    label: "Check readiness",
    description:
      "Collect runtime, environment, configuration, access, and test prerequisites.",
    intent:
      "Prepare an environment-readiness report with verified gaps and owners.",
    outputArtifact: "environment_readiness_report",
    fields: [
      {
        name: "phase",
        label: "Target phase and environment",
        type: "text",
        required: true,
      },
      {
        name: "runtime",
        label: "Runtime, language, package manager, and build commands",
        type: "textarea",
      },
      {
        name: "configuration",
        label: "Configuration keys and secret references (never values)",
        type: "textarea",
      },
      {
        name: "access",
        label: "Database, integration, test-account, and network access",
        type: "textarea",
      },
      {
        name: "verification",
        label: "Required readiness checks and accountable owners",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "instant-app-governance",
    label: "Govern instant app",
    description:
      "Set permissions, expiry, ownership, cost, and promotion or retirement rules.",
    intent: "Prepare an instant-app governance decision for formal approval.",
    outputArtifact: "instant_app_governance_plan",
    fields: [
      {
        name: "app",
        label: "App request, plan, or artifact ID",
        type: "text",
        required: true,
      },
      {
        name: "scope",
        label: "Users, data scope, and allowed actions",
        type: "textarea",
        required: true,
      },
      {
        name: "environment",
        label: "Environment and deployment exposure",
        type: "select",
        required: true,
        options: ["Local preview", "Development", "Staging", "Production"],
      },
      {
        name: "controls",
        label: "Sensitive-data, audit, cost, and rollback controls",
        type: "textarea",
        required: true,
      },
      {
        name: "expiry",
        label: "Owner, expiration date, and retirement/promotion criteria",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "rollout-plan",
    label: "Plan rollout",
    description:
      "Define feature flags, cohorts, stages, health gates, and rollback.",
    intent: "Prepare a measurable, reversible rollout plan.",
    outputArtifact: "rollout_plan",
    fields: [
      {
        name: "artifact",
        label: "Release artifact or feature",
        type: "text",
        required: true,
      },
      {
        name: "stages",
        label: "Cohorts and rollout stages",
        type: "textarea",
        required: true,
      },
      {
        name: "health",
        label: "Health gates and success measures",
        type: "textarea",
        required: true,
      },
      {
        name: "abort",
        label: "Abort thresholds and rollback procedure",
        type: "textarea",
        required: true,
      },
      {
        name: "cleanup",
        label: "Flag expiry and cleanup owner",
        type: "text",
      },
    ],
  },
];

export const qualitySteeringModes: SteeringMode[] = [
  {
    id: "test-strategy",
    label: "Prepare test strategy",
    description:
      "Define risk-based coverage and release evidence for the exact change.",
    intent: "Prepare a traceable test and release-confidence strategy.",
    outputArtifact: "test_strategy",
    fields: [
      {
        name: "scope",
        label: "Change and acceptance scope",
        type: "textarea",
        required: true,
      },
      {
        name: "risks",
        label: "Critical user, security, data, and operational risks",
        type: "textarea",
        required: true,
      },
      {
        name: "coverage",
        label: "Required test types",
        type: "multiselect",
        options: [
          "Unit",
          "Contract",
          "Integration",
          "End-to-end",
          "Accessibility",
          "Security",
          "Performance",
          "Migration",
          "Smoke",
        ],
      },
      {
        name: "evidence",
        label: "Release-blocking evidence and residual-risk owner",
        type: "textarea",
        required: true,
      },
    ],
  },
];
