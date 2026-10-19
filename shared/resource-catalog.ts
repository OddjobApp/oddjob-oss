export const RESOURCE_TYPES = [
  "cycle",
  "cycle_blueprint",
  "mission",
  "mission_run",
  "agent",
  "agent_deployment",
  "agent_session",
  "agent_run",
  "agent_state",
  "crew_room",
  "pipeline",
  "pipeline_step",
  "job",
  "tool",
  "tool_call",
  "capability",
  "connector_action",
  "mcp_server",
  "dataset",
  "memory",
  "context_packet",
  "retrieval_result",
  "knowledge_topic",
  "knowledge_document",
  "knowledge_source",
  "claim",
  "fact",
  "contradiction",
  "document_template",
  "hil_form",
  "approval_request",
  "policy",
  "policy_pack",
  "risk_control",
  "approval_policy",
  "app",
  "app_deployment",
  "app_release",
  "artifact",
  "report",
  "evidence_bundle",
  "trace",
  "trace_event",
  "eval_dataset",
  "eval_run",
  "eval_gate",
  "schedule",
  "credential",
  "slack_workspace",
  "user",
  "team",
  "role",
  "stakeholder",
  "owner_group",
  "incident",
  "alert",
  "failure_pattern",
  "remediation",
  "runbook",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_LIFECYCLES = [
  "draft",
  "active",
  "paused",
  "waiting",
  "failed",
  "completed",
  "archived",
  "deleted",
  "unknown",
] as const;

export type ResourceLifecycle = (typeof RESOURCE_LIFECYCLES)[number];

export type ResourceRiskLevel = "low" | "medium" | "high" | "critical";
export type ResourceActionRisk = ResourceRiskLevel;
export type ResourceActionSideEffect =
  | "none"
  | "read"
  | "write"
  | "delete"
  | "external_api"
  | "notification"
  | "credential_use"
  | "deployment"
  | "human_approval"
  | "cost";

export const RESOURCE_RELATION_TYPES = [
  "contains",
  "contained_by",
  "depends_on",
  "triggers",
  "uses",
  "writes_to",
  "reads_from",
  "governed_by",
  "owned_by",
  "derived_from",
  "publishes",
  "deploys",
  "approves",
  "scheduled_by",
  "executed_by",
  "produced",
  "consumed",
  "observed",
  "validated_by",
  "failed_due_to",
  "remediated_by",
  "authorized_by",
  "blocked_by",
  "cites",
  "supersedes",
  "version_of",
  "instantiates",
] as const;

export type ResourceRelationType = (typeof RESOURCE_RELATION_TYPES)[number];

export interface ResourceActionParamField {
  name: string;
  /** "json" is for dynamic/free-form payloads whose shape is defined by the resource itself (e.g. a HIL form's own schema), not statically known here. */
  type: "string" | "number" | "boolean" | "enum" | "string[]" | "json";
  label?: string;
  required?: boolean;
  enumValues?: string[];
  maxLength?: number;
  /** A statically-known value for this field on this specific action (e.g. approve's decision is always "approved"). A required field without a defaultValue can't be one-click-confirmed by a generic caller — it needs a real input form. */
  defaultValue?: string | number | boolean;
}

export interface ResourceActionParamSchema {
  location?: "body" | "query";
  fields: ResourceActionParamField[];
}

export interface ResourceActionIOContract {
  schema?: unknown;
  contentType?: string;
  description?: string;
  fields?: ResourceActionParamField[];
}

export interface ResourceActionPolicyRequirement {
  policyId?: string;
  policyPackId?: string;
  requiresApproval?: boolean;
  requiredRole?: string;
  dataClassification?: string;
  reason?: string;
}

export interface ResourceActionDryRunContract {
  supported: boolean;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  href?: string;
  description?: string;
}

export interface ResourceActionRollbackContract {
  supported: boolean;
  actionId?: string;
  href?: string;
  automatic?: boolean;
  description?: string;
}

export interface ResourceActionEvalHook {
  id: string;
  label?: string;
  datasetKey?: string;
  metric?: string;
  when?: "pre" | "post" | "continuous";
}

export interface ResourceActionContract {
  inputs?: ResourceActionIOContract;
  outputs?: ResourceActionIOContract;
  sideEffects: ResourceActionSideEffect[];
  risk: ResourceActionRisk;
  dryRun?: ResourceActionDryRunContract;
  rollback?: ResourceActionRollbackContract;
  policyRequirements?: ResourceActionPolicyRequirement[];
  evalHooks?: ResourceActionEvalHook[];
  idempotency?: "idempotent" | "dedupe_key" | "non_idempotent" | "unknown";
  costProfile?: {
    unit?: "free" | "low" | "medium" | "high" | "unknown";
    estimatedUsd?: number;
    meteredBy?: string;
  };
}

export interface ResourceAction {
  id: string;
  label: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  href?: string;
  capability?: string;
  destructive?: boolean;
  /** Request body/query shape, when known, so a generic UI can render a form before invoking the action. Omitted when the action takes no body or the body shape isn't staticly known. */
  params?: ResourceActionParamSchema;
  contract?: ResourceActionContract;
}

export interface ResourceRelation {
  type: ResourceRelationType;
  targetType: ResourceType;
  targetId: string;
  targetKey: string;
  label?: string;
  metadata?: Record<string, unknown>;
  /** "derived" relations are computed at read time; "persisted" relations come from the curated resource_edges table. */
  source?: "derived" | "persisted";
}

export interface ResourceSchemaSummary {
  input?: unknown;
  output?: unknown;
  fields?: string[];
  validation?: unknown;
}

export interface ResourceHealth {
  state: "healthy" | "warning" | "error" | "unknown";
  message?: string;
  lastCheckedAt?: string;
}

export interface ResourceGovernance {
  requiresApproval?: boolean;
  policyId?: string;
  dataClassification?: string;
  sensitive?: boolean;
}

export interface PlatformResource {
  key: string;
  type: ResourceType;
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  lifecycle: ResourceLifecycle;
  riskLevel: ResourceRiskLevel;
  organizationId?: number | null;
  ownerId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
  tags: string[];
  capabilities: string[];
  actions: ResourceAction[];
  relations: ResourceRelation[];
  schema?: ResourceSchemaSummary;
  health?: ResourceHealth;
  governance?: ResourceGovernance;
  metadata?: Record<string, unknown>;
}

export interface ResourceTypeDefinition {
  type: ResourceType;
  label: string;
  pluralLabel: string;
  description: string;
  canonicalRoute: string;
  defaultActions: string[];
  relationHints: ResourceRelationType[];
}

export type ResourceTypeDefinitions = Record<ResourceType, ResourceTypeDefinition>;

export interface ResourceCatalogQuery {
  types?: ResourceType[];
  search?: string;
  lifecycle?: ResourceLifecycle;
  status?: string;
  /**
   * Service-side collector cap. Unlike `limit`, this does not slice the
   * merged result set after filtering.
   */
  perTypeLimit?: number;
  limit?: number;
}

export interface ResourceCatalogSummary {
  total: number;
  byType: Partial<Record<ResourceType, number>>;
  byLifecycle: Partial<Record<ResourceLifecycle, number>>;
  byRisk: Partial<Record<ResourceRiskLevel, number>>;
}

export interface ResourceCatalogResponse {
  resources: PlatformResource[];
  summary: ResourceCatalogSummary;
  definitions: ResourceTypeDefinitions;
  generatedAt: string;
}

export interface ResourceGraphNode {
  resource: PlatformResource;
  depth: number;
  isRoot: boolean;
}

export interface ResourceGraphEdge {
  id: string;
  fromKey: string;
  toKey: string;
  relationType: ResourceRelationType;
  source: "derived" | "persisted";
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface ResourceGraphResponse {
  root: PlatformResource;
  nodes: ResourceGraphNode[];
  edges: ResourceGraphEdge[];
  maxDepth: number;
  truncated: boolean;
  generatedAt: string;
}

export type ResourceActionBrokerStatus =
  | "matched"
  | "ambiguous"
  | "needs_input"
  | "needs_confirmation"
  | "dry_run"
  | "executed"
  | "blocked";

export interface ResourceActionBrokerRequest {
  query?: string;
  resourceKey?: string;
  actionId?: string;
  input?: Record<string, unknown>;
  confirm?: boolean;
  dryRun?: boolean;
  surface?: "internal" | "agent_deployment" | "app_deployment" | "api" | "embed";
  surfaceId?: string | number;
}

export interface ResourceActionBrokerDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  policyRequirements: ResourceActionPolicyRequirement[];
}

export interface ResourceActionBrokerResponse {
  status: ResourceActionBrokerStatus;
  query?: string;
  resource?: PlatformResource;
  action?: ResourceAction;
  confidence?: number;
  alternatives?: Array<{ resource: PlatformResource; action: ResourceAction; confidence: number }>;
  missingFields?: ResourceActionParamField[];
  decision?: ResourceActionBrokerDecision;
  blastRadius?: { impactedCount: number; truncated: boolean };
  execution?: { href?: string; method?: string; executionId?: string | number; result?: unknown };
  audit?: { eventId?: string | number; generatedAt: string };
  generatedAt: string;
}

export interface ResourceStudioResponse {
  root: PlatformResource;
  graph: ResourceGraphResponse;
  impact: {
    downstreamCount: number;
    truncated: boolean;
  };
  bindings: {
    forms: PlatformResource[];
    schemas: PlatformResource[];
    policies: ResourceActionPolicyRequirement[];
    pipelines: PlatformResource[];
    jobs: PlatformResource[];
  };
  generatedAt: string;
}

export interface AcceleratorManifestResourceRef {
  key?: string;
  type: ResourceType;
  id?: string;
  name?: string;
  required?: boolean;
}

export interface AcceleratorManifest {
  manifestVersion: "1.0";
  id: string;
  name: string;
  version: string;
  description?: string;
  resources: AcceleratorManifestResourceRef[];
  schemas: unknown[];
  forms: AcceleratorManifestResourceRef[];
  policies: string[];
  evals: string[];
  credentials: AcceleratorManifestResourceRef[];
  installChecks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail?: string }>;
  generatedAt: string;
}

export interface PolicyPackManifest {
  manifestVersion: "1.0";
  id: string;
  name: string;
  version: string;
  description?: string;
  policies: Array<{ id: string; name: string; type: string; definition: unknown }>;
  appliesTo: ResourceType[];
  installChecks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail?: string }>;
  generatedAt: string;
}

export interface AuditExportPack {
  manifestVersion: "1.0";
  id: string;
  resourceKey: string;
  resource?: PlatformResource;
  graph: ResourceGraphResponse;
  impact: { downstreamCount: number; truncated: boolean };
  policyRequirements: ResourceActionPolicyRequirement[];
  actions: ResourceAction[];
  evidence: Array<{ id: string; type: string; summary: string; payload?: unknown }>;
  checksum: string;
  generatedAt: string;
}

export interface AgentOpsScorecard {
  resourceKey: string;
  resource?: PlatformResource;
  traces: { count: number; recent: Array<Record<string, unknown>> };
  evals: { datasets: string[]; experiments: string[] };
  scorecard: {
    reliability: number;
    policyCleanliness: number;
    observability: number;
    costEfficiency: number;
    overall: number;
  };
  generatedAt: string;
}

export const RESOURCE_TYPE_DEFINITIONS: ResourceTypeDefinitions = {
  cycle: {
    type: "cycle",
    label: "Operational Cycle",
    pluralLabel: "Operational Cycles",
    description: "Recurring or time-boxed operating loops that coordinate missions, budgets, metrics, and review gates.",
    canonicalRoute: "/api/cycles",
    defaultActions: ["view", "resume", "pause"],
    relationHints: ["contains", "depends_on", "governed_by"],
  },
  cycle_blueprint: {
    type: "cycle_blueprint",
    label: "Cycle Blueprint",
    pluralLabel: "Cycle Blueprints",
    description: "The tactical mission/report/sweep nodes inside an operational cycle execution plan.",
    canonicalRoute: "/api/cycles",
    defaultActions: ["view"],
    relationHints: ["contained_by", "depends_on", "derived_from"],
  },
  mission: {
    type: "mission",
    label: "Mission",
    pluralLabel: "Missions",
    description: "Goal-directed workspaces that coordinate agents, jobs, pipelines, schedules, memory, and human steering.",
    canonicalRoute: "/api/missions",
    defaultActions: ["view", "run", "activity"],
    relationHints: ["contains", "contained_by", "uses", "governed_by", "scheduled_by", "derived_from"],
  },
  mission_run: {
    type: "mission_run",
    label: "Mission Run",
    pluralLabel: "Mission Runs",
    description: "Durable execution instances for missions, including checkpoints, resume conditions, and pipeline sequence state.",
    canonicalRoute: "/api/mission-runs",
    defaultActions: ["view", "resume"],
    relationHints: ["derived_from", "contained_by", "contains", "uses"],
  },
  agent: {
    type: "agent",
    label: "Agent",
    pluralLabel: "Agents",
    description: "Autonomous or assisted worker definitions with instructions, memory bindings, tools, policies, and evaluation gates.",
    canonicalRoute: "/api/agents",
    defaultActions: ["view"],
    relationHints: ["uses", "governed_by", "owned_by", "contains"],
  },
  agent_deployment: {
    type: "agent_deployment",
    label: "Agent Deployment",
    pluralLabel: "Agent Deployments",
    description: "Published agent runtime surfaces with channel configuration, permissions, budgets, and release history.",
    canonicalRoute: "/api/agents/deployments",
    defaultActions: ["view"],
    relationHints: ["deploys", "version_of", "authorized_by", "governed_by"],
  },
  agent_session: {
    type: "agent_session",
    label: "Agent Session",
    pluralLabel: "Agent Sessions",
    description: "Conversation or task sessions that preserve context, user intent, tool access, and execution continuity.",
    canonicalRoute: "/api/agents/sessions",
    defaultActions: ["view"],
    relationHints: ["contained_by", "uses", "executed_by", "observed"],
  },
  agent_run: {
    type: "agent_run",
    label: "Agent Run",
    pluralLabel: "Agent Runs",
    description: "Concrete agent execution attempts with inputs, tool calls, state transitions, traces, outputs, and eval outcomes.",
    canonicalRoute: "/api/agents/runs",
    defaultActions: ["view"],
    relationHints: ["derived_from", "executed_by", "uses", "produced", "validated_by"],
  },
  agent_state: {
    type: "agent_state",
    label: "Agent State",
    pluralLabel: "Agent States",
    description: "Serializable planning, memory, context, and tool-state snapshots for resumable agent execution.",
    canonicalRoute: "/api/agents/state",
    defaultActions: ["view"],
    relationHints: ["contained_by", "derived_from", "uses", "observed"],
  },
  crew_room: {
    type: "crew_room",
    label: "CREW Room",
    pluralLabel: "CREW Rooms",
    description: "Multi-agent deliberation rooms that host governed surfaces: mounted apps, bound approvals, decisions, claims, and commitments.",
    canonicalRoute: "/api/crew",
    defaultActions: ["view"],
    relationHints: ["contains", "contained_by", "derived_from", "uses"],
  },
  pipeline: {
    type: "pipeline",
    label: "Pipeline",
    pluralLabel: "Pipelines",
    description: "Versioned multi-step automations triggered manually, by schedule, webhook, or event.",
    canonicalRoute: "/api/pipelines",
    defaultActions: ["view", "run", "versions"],
    relationHints: ["contains", "uses", "governed_by", "triggers"],
  },
  pipeline_step: {
    type: "pipeline_step",
    label: "Pipeline Step",
    pluralLabel: "Pipeline Steps",
    description: "Ordered pipeline execution units with retry, condition, fallback, tool, forge, and data contract metadata.",
    canonicalRoute: "/api/pipelines",
    defaultActions: ["view", "edit"],
    relationHints: ["contained_by", "depends_on", "uses", "writes_to"],
  },
  job: {
    type: "job",
    label: "Job",
    pluralLabel: "Jobs",
    description: "Reusable executable capabilities such as AI calls, integrations, scripts, flows, forms, and data processing.",
    canonicalRoute: "/api/jobs",
    defaultActions: ["view", "test"],
    relationHints: ["uses", "writes_to", "governed_by"],
  },
  tool: {
    type: "tool",
    label: "Tool",
    pluralLabel: "Tools",
    description: "Callable platform or external capabilities with typed input/output contracts, side effects, and policy requirements.",
    canonicalRoute: "/api/tools",
    defaultActions: ["view"],
    relationHints: ["uses", "reads_from", "writes_to", "governed_by", "authorized_by"],
  },
  tool_call: {
    type: "tool_call",
    label: "Tool Call",
    pluralLabel: "Tool Calls",
    description: "Individual typed invocations of tools, including arguments, results, errors, evidence, and trace correlation.",
    canonicalRoute: "/api/tools/calls",
    defaultActions: ["view"],
    relationHints: ["uses", "executed_by", "produced", "authorized_by", "blocked_by"],
  },
  capability: {
    type: "capability",
    label: "Capability",
    pluralLabel: "Capabilities",
    description: "Named abilities that agents, apps, jobs, connectors, and policy packs can advertise, require, or restrict.",
    canonicalRoute: "/api/capabilities",
    defaultActions: ["view"],
    relationHints: ["contained_by", "uses", "governed_by"],
  },
  connector_action: {
    type: "connector_action",
    label: "Connector Action",
    pluralLabel: "Connector Actions",
    description: "Provider-specific integration operations with scopes, credentials, schemas, and external side effects.",
    canonicalRoute: "/api/connectors/actions",
    defaultActions: ["view"],
    relationHints: ["uses", "authorized_by", "reads_from", "writes_to"],
  },
  mcp_server: {
    type: "mcp_server",
    label: "MCP Server",
    pluralLabel: "MCP Servers",
    description: "Model Context Protocol servers exposing tools, resources, prompts, authentication, and runtime health.",
    canonicalRoute: "/api/mcp/servers",
    defaultActions: ["view"],
    relationHints: ["contains", "uses", "authorized_by", "observed"],
  },
  dataset: {
    type: "dataset",
    label: "Dataset",
    pluralLabel: "Datasets",
    description: "Structured records with schema mappings, validation rules, and knowledge extraction configuration.",
    canonicalRoute: "/api/datasets",
    defaultActions: ["view", "export", "validate", "extract"],
    relationHints: ["reads_from", "writes_to", "derived_from"],
  },
  memory: {
    type: "memory",
    label: "Memory",
    pluralLabel: "Memories",
    description: "Persisted user, team, mission, or agent memory records with provenance, retention, and retrieval metadata.",
    canonicalRoute: "/api/memory",
    defaultActions: ["view"],
    relationHints: ["derived_from", "cites", "governed_by", "owned_by"],
  },
  context_packet: {
    type: "context_packet",
    label: "Context Packet",
    pluralLabel: "Context Packets",
    description: "Bounded context bundles assembled for model calls, agent runs, tools, or human review.",
    canonicalRoute: "/api/context-packets",
    defaultActions: ["view"],
    relationHints: ["contains", "derived_from", "consumed", "cites"],
  },
  retrieval_result: {
    type: "retrieval_result",
    label: "Retrieval Result",
    pluralLabel: "Retrieval Results",
    description: "Ranked search or retrieval outputs with source references, scores, snippets, and uncertainty metadata.",
    canonicalRoute: "/api/retrieval/results",
    defaultActions: ["view"],
    relationHints: ["derived_from", "cites", "consumed", "validated_by"],
  },
  knowledge_topic: {
    type: "knowledge_topic",
    label: "Knowledge Topic",
    pluralLabel: "Knowledge Topics",
    description: "Semantic topic spaces used to organize documents, concepts, constraints, and mission context.",
    canonicalRoute: "/api/knowledge",
    defaultActions: ["view"],
    relationHints: ["contains", "contained_by", "derived_from"],
  },
  knowledge_document: {
    type: "knowledge_document",
    label: "Knowledge Document",
    pluralLabel: "Knowledge Documents",
    description: "Uploaded, linked, generated, or integration-synced source material available to RAG and graph extraction.",
    canonicalRoute: "/api/knowledge/documents",
    defaultActions: ["view"],
    relationHints: ["derived_from", "reads_from"],
  },
  knowledge_source: {
    type: "knowledge_source",
    label: "Knowledge Source",
    pluralLabel: "Knowledge Sources",
    description: "Canonical origin records for imported, linked, scraped, generated, or connector-synced knowledge.",
    canonicalRoute: "/api/knowledge/sources",
    defaultActions: ["view"],
    relationHints: ["contains", "reads_from", "owned_by", "governed_by"],
  },
  claim: {
    type: "claim",
    label: "Claim",
    pluralLabel: "Claims",
    description: "Atomic assertions extracted or generated from evidence, with confidence, provenance, and review status.",
    canonicalRoute: "/api/knowledge/claims",
    defaultActions: ["view"],
    relationHints: ["derived_from", "cites", "validated_by", "blocked_by"],
  },
  fact: {
    type: "fact",
    label: "Fact",
    pluralLabel: "Facts",
    description: "Accepted claims that have passed validation, source checks, or human review for reuse in automation.",
    canonicalRoute: "/api/knowledge/facts",
    defaultActions: ["view"],
    relationHints: ["derived_from", "cites", "validated_by", "supersedes"],
  },
  contradiction: {
    type: "contradiction",
    label: "Contradiction",
    pluralLabel: "Contradictions",
    description: "Detected conflicts between claims, facts, sources, outputs, or policy interpretations that need resolution.",
    canonicalRoute: "/api/knowledge/contradictions",
    defaultActions: ["view"],
    relationHints: ["cites", "blocked_by", "validated_by", "remediated_by"],
  },
  document_template: {
    type: "document_template",
    label: "Document Template",
    pluralLabel: "Document Templates",
    description: "Reusable output standards for generated markdown, PDF, Excel, image, Word, and Google Doc deliverables.",
    canonicalRoute: "/api/document-templates",
    defaultActions: ["view"],
    relationHints: ["uses", "derived_from"],
  },
  hil_form: {
    type: "hil_form",
    label: "HIL Form",
    pluralLabel: "HIL Forms",
    description: "Human-in-the-loop form definitions and instances with schema, security, status, and submitted data.",
    canonicalRoute: "/api/forms",
    defaultActions: ["view", "submit"],
    relationHints: ["approves", "uses"],
  },
  approval_request: {
    type: "approval_request",
    label: "Approval Request",
    pluralLabel: "Approval Requests",
    description: "Human approval gates tied to job execution, missions, external approvers, and evolutionary workflows.",
    canonicalRoute: "/api/approvals",
    defaultActions: ["view", "approve", "reject"],
    relationHints: ["approves", "uses"],
  },
  policy: {
    type: "policy",
    label: "Policy",
    pluralLabel: "Policies",
    description: "Executable or reference governance rules for permissions, model use, data handling, approvals, and risk posture.",
    canonicalRoute: "/api/policies",
    defaultActions: ["view"],
    relationHints: ["governed_by", "authorized_by", "blocked_by", "supersedes"],
  },
  policy_pack: {
    type: "policy_pack",
    label: "Policy Pack",
    pluralLabel: "Policy Packs",
    description: "Versioned bundles of policies, controls, approval rules, and installation checks for reusable governance.",
    canonicalRoute: "/api/policy-packs",
    defaultActions: ["view"],
    relationHints: ["contains", "governed_by", "version_of", "supersedes"],
  },
  risk_control: {
    type: "risk_control",
    label: "Risk Control",
    pluralLabel: "Risk Controls",
    description: "Mitigations, guardrails, monitors, and enforcement points mapped to risk classes and resource actions.",
    canonicalRoute: "/api/risk-controls",
    defaultActions: ["view"],
    relationHints: ["governed_by", "validated_by", "blocked_by", "remediated_by"],
  },
  approval_policy: {
    type: "approval_policy",
    label: "Approval Policy",
    pluralLabel: "Approval Policies",
    description: "Rules that determine when human authorization is required and which roles or stakeholders can grant it.",
    canonicalRoute: "/api/approval-policies",
    defaultActions: ["view"],
    relationHints: ["approves", "authorized_by", "governed_by", "blocked_by"],
  },
  app: {
    type: "app",
    label: "App",
    pluralLabel: "Apps",
    description: "Forged or marketplace application definitions with blueprints, runtime metadata, plans, and mission links.",
    canonicalRoute: "/api/apps",
    defaultActions: ["view", "deploy", "audit"],
    relationHints: ["deploys", "derived_from", "uses"],
  },
  app_deployment: {
    type: "app_deployment",
    label: "App Deployment",
    pluralLabel: "App Deployments",
    description: "Organization-scoped installed and published app runtime configuration, access, budgets, memory, and chaining.",
    canonicalRoute: "/api/apps/deployments",
    defaultActions: ["view", "publish"],
    relationHints: ["publishes", "uses", "triggers"],
  },
  app_release: {
    type: "app_release",
    label: "App Release",
    pluralLabel: "App Releases",
    description: "Versioned app build outputs with changelogs, artifacts, verification results, and deployment eligibility.",
    canonicalRoute: "/api/apps/releases",
    defaultActions: ["view"],
    relationHints: ["version_of", "produced", "validated_by", "supersedes"],
  },
  artifact: {
    type: "artifact",
    label: "Artifact",
    pluralLabel: "Artifacts",
    description: "Generated files, bundles, screenshots, datasets, reports, packages, or deployable outputs from platform work.",
    canonicalRoute: "/api/artifacts",
    defaultActions: ["view"],
    relationHints: ["produced", "derived_from", "cites", "contained_by"],
  },
  report: {
    type: "report",
    label: "Report",
    pluralLabel: "Reports",
    description: "Human-readable generated summaries, audits, analyses, scorecards, and operational deliverables.",
    canonicalRoute: "/api/reports",
    defaultActions: ["view"],
    relationHints: ["produced", "derived_from", "cites", "validated_by"],
  },
  evidence_bundle: {
    type: "evidence_bundle",
    label: "Evidence Bundle",
    pluralLabel: "Evidence Bundles",
    description: "Collected supporting traces, sources, artifacts, decisions, and checks for audit, review, or promotion gates.",
    canonicalRoute: "/api/evidence-bundles",
    defaultActions: ["view"],
    relationHints: ["contains", "cites", "validated_by", "produced"],
  },
  trace: {
    type: "trace",
    label: "Trace",
    pluralLabel: "Traces",
    description: "Execution trace records spanning agents, jobs, tools, pipelines, model calls, and external systems.",
    canonicalRoute: "/api/traces",
    defaultActions: ["view"],
    relationHints: ["observed", "executed_by", "contains", "cites"],
  },
  trace_event: {
    type: "trace_event",
    label: "Trace Event",
    pluralLabel: "Trace Events",
    description: "Canonical span, log, decision, model, tool, or policy events inside an execution trace.",
    canonicalRoute: "/api/traces/events",
    defaultActions: ["view"],
    relationHints: ["contained_by", "observed", "cites"],
  },
  eval_dataset: {
    type: "eval_dataset",
    label: "Eval Dataset",
    pluralLabel: "Eval Datasets",
    description: "Curated prompts, scenarios, fixtures, labels, and expected behaviors used to evaluate platform work.",
    canonicalRoute: "/api/evals/datasets",
    defaultActions: ["view"],
    relationHints: ["contains", "derived_from", "governed_by", "version_of"],
  },
  eval_run: {
    type: "eval_run",
    label: "Eval Run",
    pluralLabel: "Eval Runs",
    description: "Evaluation executions with metrics, regressions, failures, approvals, and promotion evidence.",
    canonicalRoute: "/api/evals/runs",
    defaultActions: ["view"],
    relationHints: ["uses", "validated_by", "produced", "blocked_by"],
  },
  eval_gate: {
    type: "eval_gate",
    label: "Eval Gate",
    pluralLabel: "Eval Gates",
    description: "Runtime or release gates that compare evidence and metrics against thresholds before allowing progress.",
    canonicalRoute: "/api/evals/gates",
    defaultActions: ["view"],
    relationHints: ["validated_by", "blocked_by", "uses", "produced"],
  },
  schedule: {
    type: "schedule",
    label: "Schedule",
    pluralLabel: "Schedules",
    description: "Reusable time patterns and scheduled job, pipeline, or mission triggers.",
    canonicalRoute: "/api/schedules",
    defaultActions: ["view", "enable", "disable"],
    relationHints: ["triggers", "scheduled_by"],
  },
  credential: {
    type: "credential",
    label: "Credential",
    pluralLabel: "Credentials",
    description: "Sensitive integration, provider, database, SMTP, and platform connection handles.",
    canonicalRoute: "/api/credentials",
    defaultActions: ["view", "test"],
    relationHints: ["uses"],
  },
  slack_workspace: {
    type: "slack_workspace",
    label: "Slack Workspace",
    pluralLabel: "Slack Workspaces",
    description: "Connected Slack workspaces used for slash commands, interactive actions, and notification delivery.",
    canonicalRoute: "/api/integrations/slack/workspaces",
    defaultActions: ["view", "configure", "disconnect"],
    relationHints: ["uses"],
  },
  user: {
    type: "user",
    label: "User",
    pluralLabel: "Users",
    description: "Human platform identities that own, authorize, approve, run, or receive work across Oddjob.",
    canonicalRoute: "/api/users",
    defaultActions: ["view"],
    relationHints: ["owned_by", "authorized_by", "executed_by"],
  },
  team: {
    type: "team",
    label: "Team",
    pluralLabel: "Teams",
    description: "Groups of users that own resources, policies, credentials, missions, and operational responsibilities.",
    canonicalRoute: "/api/teams",
    defaultActions: ["view"],
    relationHints: ["contains", "owned_by", "authorized_by"],
  },
  role: {
    type: "role",
    label: "Role",
    pluralLabel: "Roles",
    description: "Permission and responsibility roles used by policy, approval, ownership, and access-control decisions.",
    canonicalRoute: "/api/roles",
    defaultActions: ["view"],
    relationHints: ["governed_by", "authorized_by"],
  },
  stakeholder: {
    type: "stakeholder",
    label: "Stakeholder",
    pluralLabel: "Stakeholders",
    description: "People or groups with review, approval, notification, ownership, or business-accountability interests.",
    canonicalRoute: "/api/stakeholders",
    defaultActions: ["view"],
    relationHints: ["owned_by", "approves", "authorized_by"],
  },
  owner_group: {
    type: "owner_group",
    label: "Owner Group",
    pluralLabel: "Owner Groups",
    description: "Named ownership pools used for escalation, routing, stewardship, and operational accountability.",
    canonicalRoute: "/api/owner-groups",
    defaultActions: ["view"],
    relationHints: ["contains", "owned_by", "authorized_by"],
  },
  incident: {
    type: "incident",
    label: "Incident",
    pluralLabel: "Incidents",
    description: "Operational failures or risk events with impact, affected resources, evidence, ownership, and resolution status.",
    canonicalRoute: "/api/incidents",
    defaultActions: ["view"],
    relationHints: ["failed_due_to", "observed", "owned_by", "remediated_by"],
  },
  alert: {
    type: "alert",
    label: "Alert",
    pluralLabel: "Alerts",
    description: "Signals emitted by monitors, eval gates, traces, policies, or integrations that require attention or routing.",
    canonicalRoute: "/api/alerts",
    defaultActions: ["view"],
    relationHints: ["observed", "triggers", "blocked_by", "owned_by"],
  },
  failure_pattern: {
    type: "failure_pattern",
    label: "Failure Pattern",
    pluralLabel: "Failure Patterns",
    description: "Recurring failure signatures detected across traces, incidents, evals, jobs, tools, or agent runs.",
    canonicalRoute: "/api/failure-patterns",
    defaultActions: ["view"],
    relationHints: ["derived_from", "failed_due_to", "cites", "remediated_by"],
  },
  remediation: {
    type: "remediation",
    label: "Remediation",
    pluralLabel: "Remediations",
    description: "Corrective actions, patches, mitigations, or playbook executions tied to incidents and failure patterns.",
    canonicalRoute: "/api/remediations",
    defaultActions: ["view"],
    relationHints: ["remediated_by", "uses", "validated_by", "produced"],
  },
  runbook: {
    type: "runbook",
    label: "Runbook",
    pluralLabel: "Runbooks",
    description: "Operational procedures for diagnosing, escalating, remediating, and validating known platform states.",
    canonicalRoute: "/api/runbooks",
    defaultActions: ["view"],
    relationHints: ["uses", "governed_by", "remediated_by", "cites"],
  },
};

export function isResourceType(value: string): value is ResourceType {
  return RESOURCE_TYPES.includes(value as ResourceType);
}

export function isResourceRelationType(value: string): value is ResourceRelationType {
  return RESOURCE_RELATION_TYPES.includes(value as ResourceRelationType);
}

export function makeResourceKey(type: ResourceType, id: string | number): string {
  return `${type}:${String(id)}`;
}

export function summarizeCatalogResources(resources: PlatformResource[]): ResourceCatalogSummary {
  const summary: ResourceCatalogSummary = {
    total: resources.length,
    byType: {},
    byLifecycle: {},
    byRisk: {},
  };

  for (const resource of resources) {
    summary.byType[resource.type] = (summary.byType[resource.type] ?? 0) + 1;
    summary.byLifecycle[resource.lifecycle] = (summary.byLifecycle[resource.lifecycle] ?? 0) + 1;
    summary.byRisk[resource.riskLevel] = (summary.byRisk[resource.riskLevel] ?? 0) + 1;
  }

  return summary;
}

export type ResourceHealthState = ResourceHealth["state"];

export interface ResourceHealthSummary {
  byHealthState: Partial<Record<ResourceHealthState, number>>;
  needsAttentionCount: number;
}

/** A resource needs attention if it is unhealthy or independently flagged high/critical risk. */
export function isAttentionWorthy(resource: PlatformResource): boolean {
  const state = resource.health?.state;
  return state === "warning" || state === "error" || resource.riskLevel === "high" || resource.riskLevel === "critical";
}

export function summarizeResourceHealth(resources: PlatformResource[]): ResourceHealthSummary {
  const byHealthState: Partial<Record<ResourceHealthState, number>> = {};
  let needsAttentionCount = 0;

  for (const resource of resources) {
    const state = resource.health?.state ?? "unknown";
    byHealthState[state] = (byHealthState[state] ?? 0) + 1;
    if (isAttentionWorthy(resource)) needsAttentionCount++;
  }

  return { byHealthState, needsAttentionCount };
}

export function filterCatalogResources(
  resources: PlatformResource[],
  query: ResourceCatalogQuery,
): PlatformResource[] {
  let results = resources;

  if (query.types?.length) {
    const typeSet = new Set(query.types);
    results = results.filter((resource) => typeSet.has(resource.type));
  }

  if (query.lifecycle) {
    results = results.filter((resource) => resource.lifecycle === query.lifecycle);
  }

  if (query.status) {
    const status = query.status.toLowerCase();
    results = results.filter((resource) => resource.status?.toLowerCase() === status);
  }

  if (query.search?.trim()) {
    const needle = query.search.trim().toLowerCase();
    results = results.filter((resource) => {
      const haystack = [
        resource.key,
        resource.type,
        resource.name,
        resource.description,
        resource.status,
        ...resource.tags,
        ...resource.capabilities,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }

  if (query.limit && query.limit > 0) {
    results = results.slice(0, query.limit);
  }

  return results;
}
