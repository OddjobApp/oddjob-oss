/**
 * Xray Composition Types
 *
 * Higher-level entity graph sitting above code symbols:
 * screens, APIs, components, jobs, pipelines, missions, datasets, knowledge, ontology.
 */

export type CompositionNodeType =
  | "screen"
  | "api_endpoint"
  | "ui_component"
  | "job_definition"
  | "pipeline"
  | "mission"
  | "dataset"
  | "knowledge_cluster"
  | "npm_module"
  | "operational_cycle"
  | "program"        // kept for backward compat — rendered as operational_cycle
  | "agent"
  | "supervisor"
  | "skill"
  | "e2e_test"
  | "ui_behavior"
  | "ontology_object_type"
  | "ontology_action"
  | "ontology_link_type";

export type EdgeRelation =
  | "RENDERS"
  | "CALLS_API"
  | "TRIGGERS"
  | "READS_FROM"
  | "WRITES_TO"
  | "NAVIGATES_TO"
  | "OWNED_BY"
  | "DEPENDS_ON"
  | "MEMBER_OF"
  | "PART_OF"
  | "HAS_SKILL"
  | "BELONGS_TO"
  | "VERIFIED_BY"
  | "COVERS"
  | "ACTS_ON"
  | "DEFINES_FORWARD"
  | "DEFINES_REVERSE"
  | "TARGETS_OBJECT_TYPE"
  | "BACKED_BY"
  | "BRIDGES_KG"
  | "PASSES_DATA_TO";

export interface CompositionNode {
  id: string;
  type: CompositionNodeType;
  label: string;
  description?: string;
  filePath?: string;
  dbId?: number;
  metadata?: Record<string, unknown>;
  group?: string;
}

export interface CompositionEdge {
  id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
  label: string;
}

export interface CompositionScope {
  id: string;
  name: string;
  type: "platform" | "forged_app";
  icon?: string;
  appId?: number;
}

export interface CompositionGraph {
  scope: CompositionScope;
  nodes: CompositionNode[];
  edges: CompositionEdge[];
  indexedAt: string;
  error?: string;
}
