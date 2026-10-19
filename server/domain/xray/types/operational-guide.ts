import type { CompositionNodeType, EdgeRelation } from "./composition.js";

export const XRAY_OPERATIONAL_GUIDE_SCHEMA_VERSION = "1.0.0";

export type EvidenceClassification = "observed" | "configured" | "inferred" | "runtime";
export type EnforcementMode = "advisory" | "acknowledgement_required" | "blocking";
export type OperationalSeverity = "info" | "warning" | "high" | "critical";

export interface OperationalProvenance {
  classification: EvidenceClassification;
  source: string;
  indexedAt: string;
  confidence: number;
}

export interface OperationalGap {
  id: string;
  /** "quality" covers defects in the graph's own content (e.g. duplicate mission
   *  titles) as opposed to something missing from it. */
  category: "ownership" | "coverage" | "relationship" | "evidence" | "quality";
  severity: OperationalSeverity;
  message: string;
  affectedNodeIds: string[];
  recommendedAction: string;
}

export interface OperationalGuardrail {
  id: string;
  description: string;
  enforcement: EnforcementMode;
  appliesTo: Array<CompositionNodeType | EdgeRelation | "graph">;
  condition: string;
  requiredEvidence: string[];
  exceptionPolicy: {
    requiresOwner: true;
    requiresReason: true;
    expires: true;
  };
}

export interface OperationalEventDefinition {
  id: string;
  description: string;
  severity: OperationalSeverity;
  subjects: Array<CompositionNodeType | "graph" | "cycle">;
  deduplicationKey: string;
  requiredContext: string[];
}

export interface NotificationRule {
  id: string;
  event: string;
  severity: OperationalSeverity;
  recipientRoles: string[];
  channel: "action_inbox";
  cooldownMinutes: number;
  escalationAfterMinutes: number;
  copilotObjective: string;
  closureCriteria: string[];
}

export interface OperationalCycleStage {
  id: string;
  objective: string;
  entryConditions: string[];
  requiredEvidence: string[];
  allowedActions: string[];
  exitConditions: string[];
}

export interface OperationalCycleDefinition {
  id: string;
  name: string;
  objective: string;
  stages: OperationalCycleStage[];
}

export interface CopilotOperatingContract {
  role: string;
  workflow: string[];
  may: string[];
  requiresApproval: string[];
  mustNever: string[];
  responseContract: string[];
  contextPolicy: {
    maxGraphHops: number;
    include: string[];
    excludeByDefault: string[];
  };
}

export interface SupervisorOperatingContract {
  responsibilities: string[];
  decisionInputs: string[];
  actions: string[];
  escalationTriggers: string[];
}

export interface OperationalResourceContract {
  id: "form_agent" | "instant_app";
  definition: string;
  durableDefinition: boolean;
  runtimeEvidence: string[];
  lifecycle: string[];
  guardrails: string[];
  relationships: string[];
}

export interface OperationalPromptAction {
  id: string;
  label: string;
  authority: "allowed" | "approval_required" | "informational";
}

export interface UserOperationalPrompt {
  id: string;
  stage?: string;
  condition: string;
  message: string;
  actions: OperationalPromptAction[];
}

export interface QuestionEnginePolicy {
  principles: string[];
  askWhen: string[];
  doNotAskWhen: string[];
  structuredInputResource: "form_agent";
}

export interface OperationalQuestion {
  id: string;
  reason: string;
  prompt: string;
  source: "unresolved_node" | "missing_evidence" | "guardrail" | "authority" | "conflicting_evidence";
  blocks: string[];
}

export interface XrayBusinessDefinition {
  purpose: string;
  valueProposition: string;
  goals: Array<{
    id: string;
    objective: string;
    completionSignal: string;
    accountableRole: string;
  }>;
  stakeholders: string[];
  businessCapabilities: string[];
  desiredOutcomes: string[];
  operatingBoundaries: string[];
  successMeasures: string[];
  provenance: OperationalProvenance;
}

export interface XrayOperationalGuide {
  schemaVersion: string;
  scope: {
    id: string;
    name: string;
  };
  generatedAt: string;
  graphIndexedAt: string;
  provenance: OperationalProvenance;
  readiness: {
    mode: EnforcementMode;
    score: number;
    summary: string;
  };
  businessDefinition: XrayBusinessDefinition;
  inventory: Record<string, number>;
  gaps: OperationalGap[];
  guardrails: OperationalGuardrail[];
  events: OperationalEventDefinition[];
  notifications: NotificationRule[];
  cycles: OperationalCycleDefinition[];
  resources: OperationalResourceContract[];
  userPrompts: UserOperationalPrompt[];
  questionEngine: QuestionEnginePolicy;
  copilot: CopilotOperatingContract;
  supervisor: SupervisorOperatingContract;
}

export interface XrayContextNode {
  id: string;
  type: CompositionNodeType;
  label: string;
  description?: string;
  filePath?: string;
  owner?: string;
}

export interface XrayContextEdge {
  source: string;
  target: string;
  relation: EdgeRelation;
  label: string;
}

export interface XrayCopilotContextPackage {
  schemaVersion: string;
  scope: {
    id: string;
    name: string;
  };
  task: string;
  generatedAt: string;
  selection: {
    seedNodeIds: string[];
    maxGraphHops: number;
    truncated: boolean;
  };
  nodes: XrayContextNode[];
  edges: XrayContextEdge[];
  guardrails: OperationalGuardrail[];
  gaps: OperationalGap[];
  operatingInstructions: string[];
  suggestedPrompts: UserOperationalPrompt[];
  questions: OperationalQuestion[];
  unknowns: string[];
}

export interface XrayEventEvaluation {
  schemaVersion: string;
  scope: {
    id: string;
    name: string;
  };
  evaluatedAt: string;
  event: OperationalEventDefinition;
  subjectNodeId?: string;
  evidence: Record<string, unknown>;
  notification?: NotificationRule;
  context: XrayCopilotContextPackage;
  disposition: {
    mode: EnforcementMode;
    action: "observe" | "notify" | "escalate";
    requiresHumanReview: boolean;
    rationale: string;
  };
}
