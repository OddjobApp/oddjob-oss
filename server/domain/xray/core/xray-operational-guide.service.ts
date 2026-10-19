import type {
  CompositionGraph,
  CompositionNode,
  CompositionNodeType,
} from "../types/composition.js";
import {
  XRAY_OPERATIONAL_GUIDE_SCHEMA_VERSION,
  type NotificationRule,
  type OperationalCycleDefinition,
  type OperationalEventDefinition,
  type OperationalGap,
  type OperationalGuardrail,
  type XrayOperationalGuide,
} from "../types/operational-guide.js";

const PRODUCTION_NODE_TYPES = new Set<CompositionNodeType>([
  "screen",
  "api_endpoint",
  "job_definition",
  "pipeline",
  "mission",
  "operational_cycle",
  "agent",
  "supervisor",
]);

function hasOwner(node: CompositionNode): boolean {
  const metadata = node.metadata ?? {};
  return Boolean(
    metadata.owner ||
    metadata.ownerId ||
    metadata.ownerRole ||
    metadata.operationalOwner
  );
}

function inventoryFor(graph: CompositionGraph): Record<string, number> {
  const inventory: Record<string, number> = {};
  for (const node of graph.nodes) {
    inventory[node.type] = (inventory[node.type] ?? 0) + 1;
  }
  return inventory;
}

function buildGaps(graph: CompositionGraph, inventory: Record<string, number>): OperationalGap[] {
  const gaps: OperationalGap[] = [];
  const productionNodes = graph.nodes.filter(node => PRODUCTION_NODE_TYPES.has(node.type));
  const nodesWithoutOwners = productionNodes.filter(node => !hasOwner(node));
  const connected = new Set(graph.edges.flatMap(edge => [edge.source, edge.target]));
  const orphanNodes = productionNodes.filter(node => !connected.has(node.id));

  // Detect duplicate mission titles
  const missionNodes = graph.nodes.filter(node => node.type === "mission");
  const labelCounts = new Map<string, number>();
  missionNodes.forEach(node => {
    const label = node.label.toLowerCase().trim();
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  });
  // Map.get returns `number | undefined`; the comparison silently coerced.
  const duplicateMissions = missionNodes.filter(node =>
    (labelCounts.get(node.label.toLowerCase().trim()) ?? 0) > 1
  );

  if (duplicateMissions.length > 0) {
    gaps.push({
      id: "duplicate-missions-detected",
      category: "quality",
      severity: "warning",
      message: `${duplicateMissions.length} missions have duplicate or near-identical titles.`,
      affectedNodeIds: duplicateMissions.map(node => node.id),
      recommendedAction: "Consolidate duplicate missions or rename them to reflect distinct purposes. Check for variations like [CRISIS RECOVERY] prefixes.",
    });
  }

  if (nodesWithoutOwners.length > 0) {
    gaps.push({
      id: "production-ownership-missing",
      category: "ownership",
      severity: "high",
      message: `${nodesWithoutOwners.length} production-relevant nodes do not declare an owner.`,
      affectedNodeIds: nodesWithoutOwners.map(node => node.id),
      recommendedAction: "Assign ownerRole and operationalOwner metadata before enabling blocking guardrails.",
    });
  }

  if (orphanNodes.length > 0) {
    gaps.push({
      id: "production-nodes-orphaned",
      category: "relationship",
      severity: "warning",
      message: `${orphanNodes.length} production-relevant nodes have no indexed relationships.`,
      affectedNodeIds: orphanNodes.map(node => node.id),
      recommendedAction: "Verify the collector coverage or explicitly mark intentionally isolated nodes. For missions/pipelines, ensure they have TRIGGERS edges to execution components.",
    });
  }

  const missingCoverage: Array<[CompositionNodeType, string]> = [
    ["dataset", "Index evaluation, training, and runtime datasets."],
    ["npm_module", "Index domain-module boundaries and imports."],
    ["ui_component", "Index reusable UI components used by application screens."],
    ["ui_behavior", "Link user-visible behavior contracts to their screens."],
    ["e2e_test", "Link critical behavior contracts to executable verification evidence."],
  ];

  for (const [type, recommendedAction] of missingCoverage) {
    if (!inventory[type]) {
      gaps.push({
        id: `coverage-missing-${type}`,
        category: "coverage",
        severity: type === "e2e_test" || type === "dataset" ? "high" : "warning",
        message: `No ${type} nodes are indexed for this scope.`,
        affectedNodeIds: [],
        recommendedAction,
      });
    }
  }

  if (graph.nodes.length > 1 && graph.edges.length < graph.nodes.length - 1) {
    gaps.push({
      id: "relationship-density-low",
      category: "relationship",
      severity: "warning",
      message: `The graph has ${graph.edges.length} relationships across ${graph.nodes.length} nodes.`,
      affectedNodeIds: [],
      recommendedAction: "Add evidence-backed API, data, pipeline-step, ownership, and verification relationships.",
    });
  }

  return gaps;
}

function buildBusinessDefinition(
  graph: CompositionGraph,
  inventory: Record<string, number>,
): XrayOperationalGuide["businessDefinition"] {
  const primaryScreen = graph.nodes.find(node => node.type === "screen");
  const cycleNode = graph.nodes.find(node => node.type === "operational_cycle");
  
  // Extract purpose from cycle description if available, otherwise screen description, then fallback
  const purpose = cycleNode?.description?.trim() || 
    primaryScreen?.description?.trim() ||
    `${graph.scope.name} coordinates the application capabilities and operational workflows represented by this X-Ray scope.`;

  // Validate capabilities align with purpose by checking for actual execution relationships
  const missionNodes = graph.nodes.filter(node => node.type === "mission");
  const pipelineNodes = graph.nodes.filter(node => node.type === "pipeline");
  const agentNodes = graph.nodes.filter(node => node.type === "agent" || node.type === "supervisor");
  
  // Only include capabilities that have actual execution edges (not orphaned)
  const connectedMissions = missionNodes.filter(m => 
    graph.edges.some(e => (e.source === m.id || e.target === m.id))
  );
  const connectedPipelines = pipelineNodes.filter(p => 
    graph.edges.some(e => (e.source === p.id || e.target === p.id))
  );
  const connectedAgents = agentNodes.filter(a => 
    graph.edges.some(e => (e.source === a.id || e.target === a.id))
  );

  const capabilityLabels = [...connectedMissions, ...connectedPipelines, ...connectedAgents]
    .map(node => node.label)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 8);
    
  const apiCapabilities = graph.nodes
    .filter(node => node.type === "api_endpoint")
    .map(node => node.label.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+\/api\//, "").replace(/[-/]+/g, " "))
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 6);

  // Add validation warning if capabilities don't align with purpose
  const hasCapabilityPurposeAlignment = capabilityLabels.length > 0 || apiCapabilities.length > 0;

  return {
    purpose,
    valueProposition: `Provide a governed operating surface for ${graph.scope.name} that connects user intent, automated execution, evidence, and accountable decisions.`,
    goals: [
      {
        id: "deliver-application-objective",
        objective: `Deliver the declared purpose of ${graph.scope.name}.`,
        completionSignal: "The active operational cycle satisfies its configured success criteria with traceable evidence.",
        accountableRole: "application-owner",
      },
      {
        id: "maintain-safe-automation",
        objective: "Keep automated actions within ownership, authority, and approval boundaries.",
        completionSignal: "No protected action executes without the required evidence and approval.",
        accountableRole: "operations-supervisor",
      },
      {
        id: "improve-operational-quality",
        objective: "Detect material failures and improve performance without unacceptable regression.",
        completionSignal: "Configured benchmarks, regression checks, and production verification meet their thresholds.",
        accountableRole: "capability-owner",
      },
      {
        id: "preserve-operational-traceability",
        objective: "Maintain an explainable record of decisions, evidence, notifications, and outcomes.",
        completionSignal: "Every consequential transition can be traced to its event, evidence, owner, and decision.",
        accountableRole: "application-supervisor",
      },
    ],
    stakeholders: [
      "Business and application owners",
      "Operations supervisors and approvers",
      "Agent, pipeline, and data owners",
      "End users relying on the application outcome",
    ],
    businessCapabilities: capabilityLabels.length > 0
      ? capabilityLabels
      : apiCapabilities.length > 0
        ? apiCapabilities
        : ["Application workflow coordination", "Operational evidence and decision support"],
    desiredOutcomes: [
      "Complete the application objective with traceable evidence",
      "Reduce time from signal or request to a safe operational decision",
      "Keep automated actions within configured ownership and approval boundaries",
      "Make failures, missing evidence, and next actions visible to responsible operators",
    ],
    operatingBoundaries: [
      "X-Ray describes and guides operations; it does not grant authority by itself",
      "Production deployment, rollback, policy exceptions, and sensitive mutations require configured approval",
      "Inferred relationships remain advisory until supported by observed or configured evidence",
      "Structured, sensitive, or attested human input must use a governed Form Agent",
      ...(hasCapabilityPurposeAlignment ? [] : ["WARNING: Business capabilities may not align with stated purpose - review mission/pipeline connections"]),
    ],
    successMeasures: [
      "Required production components have accountable owners",
      "Critical workflows have evidence-backed relationships and verification",
      "Cycle stages close only after their required evidence is satisfied",
      "Operational notifications reach the correct owner without duplicate alert noise",
      `Architecture coverage remains current across ${graph.nodes.length} indexed components and ${graph.edges.length} relationships`,
      ...(hasCapabilityPurposeAlignment ? [] : ["Business capabilities are connected to execution flows"]),
    ],
    provenance: {
      classification: cycleNode?.description ? "configured" : primaryScreen?.description ? "configured" : "inferred",
      source: cycleNode?.id || primaryScreen?.filePath || primaryScreen?.id || "xray-composition-graph",
      indexedAt: graph.indexedAt,
      confidence: cycleNode?.description ? 0.95 : primaryScreen?.description ? 0.9 : 0.7,
    },
  };
}

const guardrails: OperationalGuardrail[] = [
  {
    id: "mission-requires-pipeline",
    description: "Every production mission must resolve to an indexed pipeline.",
    enforcement: "advisory",
    appliesTo: ["mission", "pipeline", "TRIGGERS"],
    condition: "mission.environment == production AND no outgoing TRIGGERS edge to pipeline",
    requiredEvidence: ["mission definition", "pipeline relationship"],
    exceptionPolicy: { requiresOwner: true, requiresReason: true, expires: true },
  },
  {
    id: "pipeline-steps-must-resolve",
    description: "Every production pipeline step must reference an active agent or job.",
    enforcement: "advisory",
    appliesTo: ["pipeline", "agent", "job_definition", "TRIGGERS"],
    condition: "pipeline step target is absent or inactive",
    requiredEvidence: ["pipeline definition", "resolved step target"],
    exceptionPolicy: { requiresOwner: true, requiresReason: true, expires: true },
  },
  {
    id: "deployment-requires-evaluation",
    description: "Agent promotion requires evaluation, regression, approval, and rollback evidence.",
    enforcement: "advisory",
    appliesTo: ["agent", "supervisor", "pipeline"],
    condition: "promotion requested AND required deployment evidence is incomplete",
    requiredEvidence: ["evaluation result", "regression result", "approval", "rollback target"],
    exceptionPolicy: { requiresOwner: true, requiresReason: true, expires: true },
  },
  {
    id: "architecture-change-requires-reindex",
    description: "Architecture-affecting changes must regenerate and compare the X-Ray graph.",
    enforcement: "advisory",
    appliesTo: ["graph"],
    condition: "architecture source changed after graph.indexedAt",
    requiredEvidence: ["pre-change fingerprint", "post-change fingerprint"],
    exceptionPolicy: { requiresOwner: true, requiresReason: true, expires: true },
  },
  {
    id: "production-components-require-owners",
    description: "Production-relevant components must declare accountable owners.",
    enforcement: "advisory",
    appliesTo: ["graph"],
    condition: "production node owner metadata is absent",
    requiredEvidence: ["owner role", "operational owner", "escalation policy"],
    exceptionPolicy: { requiresOwner: true, requiresReason: true, expires: true },
  },
];

const events: OperationalEventDefinition[] = [
  {
    id: "architecture_changed",
    description: "The indexed node or relationship fingerprint changed.",
    severity: "warning",
    subjects: ["graph"],
    deduplicationKey: "scope+graphFingerprint",
    requiredContext: ["changed nodes", "changed relationships", "affected owners"],
  },
  {
    id: "undocumented_dependency_detected",
    description: "Runtime or source analysis found a dependency absent from the declared graph.",
    severity: "high",
    subjects: ["graph"],
    deduplicationKey: "scope+source+target+relation",
    requiredContext: ["source node", "target node", "relationship evidence"],
  },
  {
    id: "benchmark_regressed",
    description: "An agent candidate performed below its configured baseline or threshold.",
    severity: "high",
    subjects: ["agent"],
    deduplicationKey: "agent+candidateVersion+benchmark",
    requiredContext: ["candidate version", "baseline version", "benchmark result", "recent changes"],
  },
  {
    id: "guardrail_violated",
    description: "An operation failed an applicable X-Ray guardrail.",
    severity: "high",
    subjects: ["graph", "cycle"],
    deduplicationKey: "cycleInstance+guardrail",
    requiredContext: ["guardrail", "evidence", "missing requirements", "owner"],
  },
  {
    id: "documentation_stale",
    description: "The graph is older than its configured freshness objective.",
    severity: "warning",
    subjects: ["graph"],
    deduplicationKey: "scope+indexedAt",
    requiredContext: ["indexed timestamp", "freshness objective", "changed sources"],
  },
  {
    id: "copilot_clarification_required",
    description: "Copilot cannot safely select the next action without a focused user decision.",
    severity: "info",
    subjects: ["cycle", "graph"],
    deduplicationKey: "cycle+questionId+blockingStage",
    requiredContext: ["question", "reason", "blocked transitions", "available evidence"],
  },
  {
    id: "required_input_missing",
    description: "A cycle or pipeline cannot continue until required structured input is supplied.",
    severity: "warning",
    subjects: ["cycle", "pipeline"],
    deduplicationKey: "cycle+stage+inputContract",
    requiredContext: ["input contract", "recommended Form Agent", "timeout", "owner"],
  },
  {
    id: "instant_app_policy_violated",
    description: "An Instant App render or action failed its component, permission, or side-effect policy.",
    severity: "high",
    subjects: ["graph"],
    deduplicationKey: "conversation+component+policy",
    requiredContext: ["component", "requested action", "policy", "user authority"],
  },
  {
    id: "form_agent_validation_failed",
    description: "A Form Agent submission did not satisfy its versioned input contract.",
    severity: "warning",
    subjects: ["cycle", "pipeline"],
    deduplicationKey: "formRequest+schemaVersion+failureClass",
    requiredContext: ["form request", "schema version", "validation errors", "mission run"],
  },
];

const notifications: NotificationRule[] = [
  {
    id: "notify-architecture-drift",
    event: "architecture_changed",
    severity: "warning",
    recipientRoles: ["application-owner"],
    channel: "action_inbox",
    cooldownMinutes: 30,
    escalationAfterMinutes: 240,
    copilotObjective: "Explain the graph delta, blast radius, and required validation.",
    closureCriteria: ["delta reviewed", "owners acknowledged", "X-Ray regenerated"],
  },
  {
    id: "notify-undocumented-dependency",
    event: "undocumented_dependency_detected",
    severity: "high",
    recipientRoles: ["component-owner", "architecture-supervisor"],
    channel: "action_inbox",
    cooldownMinutes: 15,
    escalationAfterMinutes: 60,
    copilotObjective: "Locate dependency evidence and propose registration or removal.",
    closureCriteria: ["dependency documented or removed", "graph revalidated"],
  },
  {
    id: "notify-benchmark-regression",
    event: "benchmark_regressed",
    severity: "high",
    recipientRoles: ["agent-owner", "training-cycle-supervisor"],
    channel: "action_inbox",
    cooldownMinutes: 30,
    escalationAfterMinutes: 60,
    copilotObjective: "Compare candidate and baseline evidence and recommend the next safe action.",
    closureCriteria: ["regression explained", "candidate rejected, repaired, or exception approved"],
  },
  {
    id: "notify-guardrail-violation",
    event: "guardrail_violated",
    severity: "high",
    recipientRoles: ["operation-owner", "application-supervisor"],
    channel: "action_inbox",
    cooldownMinutes: 15,
    escalationAfterMinutes: 60,
    copilotObjective: "Explain the blocker, missing evidence, and permitted resolution paths.",
    closureCriteria: ["guardrail satisfied or time-bound exception approved"],
  },
  {
    id: "notify-documentation-stale",
    event: "documentation_stale",
    severity: "warning",
    recipientRoles: ["application-owner"],
    channel: "action_inbox",
    cooldownMinutes: 1440,
    escalationAfterMinutes: 2880,
    copilotObjective: "Identify changed sources and request a focused X-Ray re-index.",
    closureCriteria: ["X-Ray re-indexed", "freshness objective restored"],
  },
];

const cycles: OperationalCycleDefinition[] = [
  {
    id: "agent-improvement",
    name: "Agent Improvement and Promotion",
    objective: "Improve an agent and safely promote a validated version.",
    stages: [
      {
        id: "observe",
        objective: "Detect meaningful performance or behavior changes.",
        entryConditions: ["performance evidence available"],
        requiredEvidence: ["agent version", "baseline metrics", "current metrics"],
        allowedActions: ["inspect evidence", "correlate events"],
        exitConditions: ["signal classified as actionable or dismissed with evidence"],
      },
      {
        id: "diagnose",
        objective: "Identify likely failure patterns and affected dependencies.",
        entryConditions: ["actionable signal confirmed"],
        requiredEvidence: ["failure examples", "relevant X-Ray subgraph", "recent changes"],
        allowedActions: ["compare versions", "cluster failures", "trace impact"],
        exitConditions: ["root-cause hypothesis recorded with confidence and unknowns"],
      },
      {
        id: "improve",
        objective: "Create a candidate change with traceable lineage.",
        entryConditions: ["improvement plan approved when required"],
        requiredEvidence: ["candidate version", "change rationale", "training data lineage"],
        allowedActions: ["prepare candidate", "generate evaluation plan"],
        exitConditions: ["candidate and evaluation plan registered"],
      },
      {
        id: "validate",
        objective: "Verify improvement without unacceptable regression.",
        entryConditions: ["candidate and evaluation plan available"],
        requiredEvidence: ["benchmark result", "regression result", "shadow result"],
        allowedActions: ["run evaluation", "run shadow validation", "summarize evidence"],
        exitConditions: ["all configured validation thresholds evaluated"],
      },
      {
        id: "approve",
        objective: "Confirm authority and evidence before production change.",
        entryConditions: ["validation completed"],
        requiredEvidence: ["approval", "rollback target", "deployment plan"],
        allowedActions: ["request approval", "explain blockers"],
        exitConditions: ["authorized approval or explicit rejection recorded"],
      },
      {
        id: "deploy",
        objective: "Promote the approved candidate through the authorized mechanism.",
        entryConditions: ["approval and rollback target recorded"],
        requiredEvidence: ["deployment record", "deployed version"],
        allowedActions: ["execute pre-authorized deployment", "monitor deployment"],
        exitConditions: ["deployment completed or rolled back"],
      },
      {
        id: "verify",
        objective: "Confirm production health and close the improvement cycle.",
        entryConditions: ["deployment record available"],
        requiredEvidence: ["health check", "production comparison", "cycle summary"],
        allowedActions: ["compare production metrics", "recommend rollback", "record evidence"],
        exitConditions: ["production outcome accepted or rollback completed"],
      },
    ],
  },
];

const resources = [
  {
    id: "form_agent" as const,
    definition: "A durable job definition that collects, validates, and routes structured human input into a pipeline or operational cycle.",
    durableDefinition: true,
    runtimeEvidence: ["form request", "schema version", "submission", "validation result", "mission-run resume"],
    lifecycle: ["configured", "requested", "waiting_for_input", "submitted", "validated", "accepted", "expired", "cancelled"],
    guardrails: [
      "required fields map to declared outputs",
      "submission records the schema version",
      "sensitive fields declare classification and retention",
      "approval attestations cannot be invented or bypassed",
      "active requests do not silently adopt schema changes",
    ],
    relationships: [
      "pipeline TRIGGERS form_agent",
      "cycle REQUIRES_INPUT_FROM form_agent",
      "form_agent WRITES_TO dataset",
      "form_submission RESUMES mission_run",
      "form_agent RENDERED_BY instant_app",
    ],
  },
  {
    id: "instant_app" as const,
    definition: "An ephemeral, no-build UI surface assembled from registered components and rendered within a Copilot interaction.",
    durableDefinition: false,
    runtimeEvidence: ["render request", "resolved components", "policy result", "interaction events", "expiry or promotion decision"],
    lifecycle: ["requested", "components_resolved", "policy_validated", "rendered", "interacted", "expired", "promoted_or_discarded"],
    guardrails: [
      "components come from the approved registry",
      "props satisfy component contracts",
      "data access follows user permissions",
      "mutating actions declare side effects and approvals",
      "sensitive inputs are not retained by default",
    ],
    relationships: [
      "copilot RENDERS instant_app",
      "instant_app COMPOSES ui_component",
      "instant_app MAY_RENDER form_agent",
      "instant_app promotion CREATES forged_app proposal",
    ],
  },
];

const userPrompts = [
  {
    id: "prompt-observe-regression",
    stage: "observe",
    condition: "performance regression confirmed",
    message: "A material regression is confirmed. Choose a focused diagnostic next step.",
    actions: [
      { id: "analyze_failure_clusters", label: "Analyze failure clusters", authority: "allowed" as const },
      { id: "compare_agent_versions", label: "Compare agent versions", authority: "allowed" as const },
      { id: "start_improvement_cycle", label: "Start improvement cycle", authority: "approval_required" as const },
    ],
  },
  {
    id: "prompt-collect-structured-input",
    condition: "required structured or sensitive evidence is missing",
    message: "Required evidence is missing. Use the configured Form Agent to collect it safely.",
    actions: [
      { id: "open_form_agent", label: "Open evidence form", authority: "allowed" as const },
      { id: "review_required_fields", label: "Review required evidence", authority: "informational" as const },
    ],
  },
  {
    id: "prompt-run-shadow-validation",
    stage: "validate",
    condition: "benchmark passed AND shadow result missing",
    message: "Candidate evaluation passed. Shadow validation is the next required step.",
    actions: [
      { id: "start_shadow_run", label: "Start shadow validation", authority: "allowed" as const },
      { id: "inspect_benchmark", label: "Review benchmark evidence", authority: "informational" as const },
    ],
  },
  {
    id: "prompt-request-approval",
    stage: "approve",
    condition: "technical evidence complete AND supervisor approval missing",
    message: "Technical evidence is complete. Supervisor approval remains required.",
    actions: [
      { id: "prepare_approval_packet", label: "Prepare approval packet", authority: "allowed" as const },
      { id: "request_supervisor_approval", label: "Request supervisor approval", authority: "approval_required" as const },
    ],
  },
];

const questionEngine = {
  principles: [
    "Retrieve existing X-Ray and cycle evidence before asking the user.",
    "Ask only when the answer changes the next safe action.",
    "Ask one focused question at a time and explain why it matters.",
    "Present evidence-backed options when available.",
    "Never request information already available in the graph or run evidence.",
    "Use a Form Agent for structured, sensitive, or attested input.",
  ],
  askWhen: [
    "the target component or scope cannot be resolved",
    "multiple active cycles could satisfy the request",
    "required evidence depends on human judgment",
    "authority or approval routing is unresolved",
    "conflicting evidence selects materially different actions",
  ],
  doNotAskWhen: [
    "the next action is read-only diagnosis",
    "configured policy supplies the answer",
    "the evidence is already present",
    "a safe reversible default is explicitly permitted",
    "the answer would not change the next action",
  ],
  structuredInputResource: "form_agent" as const,
};

export class XrayOperationalGuideService {
  buildGuide(graph: CompositionGraph): XrayOperationalGuide {
    const inventory = inventoryFor(graph);
    const gaps = buildGaps(graph, inventory);
    const highSeverityGaps = gaps.filter(gap => gap.severity === "high" || gap.severity === "critical");
    const score = Math.max(0, Math.round(100 - gaps.length * 8 - highSeverityGaps.length * 4));

    return {
      schemaVersion: XRAY_OPERATIONAL_GUIDE_SCHEMA_VERSION,
      scope: { id: graph.scope.id, name: graph.scope.name },
      generatedAt: new Date().toISOString(),
      graphIndexedAt: graph.indexedAt,
      provenance: {
        classification: "inferred",
        source: "xray-composition-graph",
        indexedAt: graph.indexedAt,
        confidence: 0.8,
      },
      readiness: {
        mode: "advisory",
        score,
        summary: gaps.length === 0
          ? "The graph has no automatically detected readiness gaps; human policy review is still required."
          : `${gaps.length} readiness gaps detected. Keep guardrails advisory until high-severity gaps are resolved.`,
      },
      businessDefinition: buildBusinessDefinition(graph, inventory),
      inventory,
      gaps,
      guardrails,
      events,
      notifications,
      cycles,
      resources,
      userPrompts,
      questionEngine,
      copilot: {
        role: "Operate as the scoped cycle coordinator for this X-Ray application.",
        workflow: [
          "Identify the active cycle, stage, and triggering event.",
          "Retrieve only the relevant one- or two-hop X-Ray subgraph.",
          "Evaluate applicable guardrails and required evidence.",
          "Separate observed facts, configured policy, inference, and unknowns.",
          "Select the smallest safe next action.",
          "Record evidence and stop at approval boundaries.",
          "Verify exit conditions before recommending cycle closure.",
        ],
        may: [
          "inspect architecture and operational evidence",
          "explain impact",
          "recommend next actions",
          "run approved diagnostics and evaluations",
          "update cycle evidence",
        ],
        requiresApproval: [
          "production deployment",
          "production rollback",
          "guardrail exception",
          "notification recipient or authority changes",
          "production data mutation",
        ],
        mustNever: [
          "invent missing evidence",
          "bypass a blocking guardrail",
          "treat notification delivery as resolution",
          "close a cycle without satisfying exit conditions",
        ],
        responseContract: [
          "current stage",
          "triggering event",
          "affected components",
          "applicable guardrails",
          "evidence and unknowns",
          "recommended next action",
          "approval requirement",
          "completion criteria",
        ],
        contextPolicy: {
          maxGraphHops: 2,
          include: ["task-relevant nodes", "connecting edges", "applicable guardrails", "active cycle evidence"],
          excludeByDefault: ["unrelated nodes", "raw logs", "complete source files", "resolved notifications"],
        },
      },
      supervisor: {
        responsibilities: [
          "review blocked and high-risk cycles",
          "resolve ownership and authority gaps",
          "approve or reject protected transitions",
          "monitor exception age and operational drift",
        ],
        decisionInputs: [
          "cycle state and missing evidence",
          "affected X-Ray subgraph",
          "guardrail result",
          "owner acknowledgement",
          "recommended action and alternatives",
        ],
        actions: [
          "assign ownership",
          "request evidence",
          "approve or reject a transition",
          "grant a time-bound exception",
          "pause or escalate a cycle",
        ],
        escalationTriggers: [
          "critical notification unacknowledged",
          "blocking evidence cannot be produced",
          "exception expired",
          "production regression persists",
        ],
      },
    };
  }

  toMarkdown(guide: XrayOperationalGuide): string {
    const gapRows = guide.gaps.length
      ? guide.gaps.map(gap =>
          `| \`${gap.id}\` | ${gap.severity} | ${gap.message} | ${gap.recommendedAction} |`,
        ).join("\n")
      : "| — | info | No automatically detected readiness gaps. | Continue policy review. |";
    const guardrailRows = guide.guardrails.map(rule =>
      `| \`${rule.id}\` | ${rule.enforcement} | ${rule.description} | ${rule.requiredEvidence.join(", ")} |`,
    ).join("\n");
    const eventRows = guide.events.map(event =>
      `| \`${event.id}\` | ${event.severity} | ${event.description} |`,
    ).join("\n");
    const notificationRows = guide.notifications.map(rule =>
      `| \`${rule.id}\` | \`${rule.event}\` | ${rule.recipientRoles.join(", ")} | ${rule.cooldownMinutes} min |`,
    ).join("\n");
    const resourceSections = guide.resources.map(resource => `### ${resource.id === "form_agent" ? "Form Agents" : "Instant Apps"}

${resource.definition}

- **Durable definition:** ${resource.durableDefinition ? "Yes" : "No — runtime evidence only"}
- **Lifecycle:** ${resource.lifecycle.map(stage => `\`${stage}\``).join(" → ")}
- **Runtime evidence:** ${resource.runtimeEvidence.join(", ")}
- **Key guardrails:** ${resource.guardrails.join("; ")}
- **X-Ray relationships:** ${resource.relationships.join("; ")}`).join("\n\n");
    const cycleSections = guide.cycles.map(cycle => `### ${cycle.name}

${cycle.objective}

| Stage | Objective | Required evidence | Exit condition |
| :--- | :--- | :--- | :--- |
${cycle.stages.map(stage =>
  `| \`${stage.id}\` | ${stage.objective} | ${stage.requiredEvidence.join(", ")} | ${stage.exitConditions.join("; ")} |`,
).join("\n")}`).join("\n\n");
    const promptRows = guide.userPrompts.map(prompt =>
      `| \`${prompt.id}\` | ${prompt.stage ?? "any"} | ${prompt.condition} | ${prompt.message} |`,
    ).join("\n");

    return `## 5. Operational Intelligence Guide

> Schema \`${guide.schemaVersion}\`. Generated from the X-Ray graph in **${guide.readiness.mode}** mode. Readiness score: **${guide.readiness.score}/100**.

${guide.readiness.summary}

### 5.1 Readiness Gaps

| Gap | Severity | Finding | Recommended action |
| :--- | :--- | :--- | :--- |
${gapRows}

### 5.2 Advisory Guardrails

| Guardrail | Enforcement | Contract | Required evidence |
| :--- | :--- | :--- | :--- |
${guardrailRows}

### 5.3 Operational Events

| Event | Severity | Meaning |
| :--- | :--- | :--- |
${eventRows}

### 5.4 Notification Rules

| Rule | Event | Recipient roles | Cooldown |
| :--- | :--- | :--- | :--- |
${notificationRows}

### 5.5 Cycle Operations

${cycleSections}

### 5.6 Form Agent and Instant App Contracts

${resourceSections}

### 5.7 Copilot Operating Contract

Copilot must:
${guide.copilot.workflow.map(step => `- ${step}`).join("\n")}

Copilot requires approval for:
${guide.copilot.requiresApproval.map(action => `- ${action}`).join("\n")}

Copilot must never:
${guide.copilot.mustNever.map(rule => `- ${rule}`).join("\n")}

Context retrieval is limited to **${guide.copilot.contextPolicy.maxGraphHops} graph hops** by default and excludes ${guide.copilot.contextPolicy.excludeByDefault.join(", ")}.

### 5.8 User Guidance and Question Engine

| Prompt | Stage | Condition | User guidance |
| :--- | :--- | :--- | :--- |
${promptRows}

Question-engine principles:
${guide.questionEngine.principles.map(principle => `- ${principle}`).join("\n")}

Use a **Form Agent** whenever structured, sensitive, or attested input is required.

### 5.9 Supervisor Contract

Supervisor responsibilities:
${guide.supervisor.responsibilities.map(item => `- ${item}`).join("\n")}

Escalate when:
${guide.supervisor.escalationTriggers.map(item => `- ${item}`).join("\n")}
`;
  }

  businessDefinitionToMarkdown(guide: XrayOperationalGuide): string {
    const definition = guide.businessDefinition;
    return `## 0. Business Definition

### Purpose
${definition.purpose}

### Business Value
${definition.valueProposition}

### Business Goals
| Goal | Objective | Completion signal | Accountable role |
| :--- | :--- | :--- | :--- |
${definition.goals.map(goal =>
  `| \`${goal.id}\` | ${goal.objective} | ${goal.completionSignal} | \`${goal.accountableRole}\` |`,
).join("\n")}

### Stakeholders
${definition.stakeholders.map(item => `- ${item}`).join("\n")}

### Business Capabilities
${definition.businessCapabilities.map(item => `- ${item}`).join("\n")}

### Desired Outcomes
${definition.desiredOutcomes.map(item => `- ${item}`).join("\n")}

### Operating Boundaries
${definition.operatingBoundaries.map(item => `- ${item}`).join("\n")}

### Success Measures
${definition.successMeasures.map(item => `- ${item}`).join("\n")}

> **Definition provenance:** \`${definition.provenance.classification}\` from \`${definition.provenance.source}\` with confidence **${Math.round(definition.provenance.confidence * 100)}%**.
`;
  }
}

export const xrayOperationalGuideService = new XrayOperationalGuideService();
