/**
 * Cycle Management Interface Types
 * 
 * Type definitions for the cycle management UI components
 */

export interface Cycle {
  id: number;
  name: string;
  description?: string;
  objective: string;
  icon?: string;
  status: CycleStatus;
  priority: number;
  budgetLimitUsd: number;
  tokenLimit?: number;
  requiresApproval: number;
  recurrence: RecurrenceType;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  successCriteria?: SuccessCriteria | null;
  metadata: CycleMetadata;
  outcomeMetrics?: OutcomeMetrics;
  executionPlan?: CycleExecutionPlan | null;
  executionPolicy?: { maxParallelMissions?: number; resourcePools?: Array<{ name: string; capacity: number; missions: string[] }> } | null;
  createdAt: string;
  updatedAt: string;
}

export type CycleStatus = 
  | 'active' 
  | 'running' 
  | 'paused' 
  | 'pending_approval'
  | 'reviewing'
  | 'closed'
  | 'cancelled'
  | 'failed';

export type RecurrenceType = 'once' | 'daily' | 'weekly' | 'monthly' | 'continuous' | 'interval' | 'custom';

export interface CycleMetadata {
  blueprints?: Blueprint[];
  blueprint_history?: BlueprintHistoryEntry[];
  resource_answers?: Record<string, Record<string, string>>;
  forecast?: CycleForecast;
  source?: string;
  version?: string;
  techStack?: any;
  portfolioClassification?: any;
}

export interface BlueprintHistoryEntry {
  changedAt: string;
  changedBy: string | number;
  reason?: string | null;
  cycleStatus: string;
  blueprints: Blueprint[];
}

export interface DataFlow {
  from: string;
  to: string;
  label?: string;
  type?: string;
}

export interface CycleForecast {
  totalEstimatedCost?: number;
  totalEstimatedTokens?: number;
  estimatedDuration?: number;
}

export interface OutcomeMetrics {
  successRate?: number;
  totalSpend?: number;
  totalTokens?: number;
  alignmentScore?: number;
  lastAuditAt?: string;
  auditLog?: string | null;
  summaryReport?: string | null;
  postMortem?: string | null;
}

export interface SuccessCriteria {
  stop_on?: string;
  min_confidence?: number;
  action?: string;
}

export interface Blueprint {
  name: string;
  objective: string;
  type: BlueprintType;
  dependencies?: Dependency[];
  branches?: BranchCondition[];
  pauseAtMilestone?: boolean;
  inputs?: string[];
  outputs?: string[];
  dataFlows?: DataFlow[];
  resources?: ResourceRequirement[];
  estimatedDays?: number;
  scheduledStart?: number;
  dependsOn?: string[];
  config?: BlueprintConfig;
  status?: AppStatus;
  currentStep?: number;
  totalSteps?: number;
  agentAssignment?: AgentAssignment;
  executionMetadata?: ExecutionMetadata;
  uiMetadata?: BlueprintUIMetadata;
  environment?: string;
  trigger?: any;
  appStep?: {
    appId: number | string;
    appName: string;
    deploymentId?: number;
    launchHref?: string;
    mode?: string;
    outputPortKey?: string;
  } | null;
  primary_agent?: string;
  sequence?: Step[];
  workbenchApps?: WorkbenchAppLink[];
  // CPM denorm (computed at launch by the orchestrator)
  waveIndex?: number | null;
  onCriticalPath?: boolean;
}

/** Topological + critical-path plan computed at cycle launch. */
export interface CycleExecutionPlanNode {
  waveIndex?: number | null;
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  float: number;
  onCriticalPath: boolean;
  durationMs: number;
}

export interface CycleExecutionPlan {
  waves: string[][];
  criticalPath: string[];
  projectDurationMs: number;
  computedAt: string;
  nodes: Record<string, CycleExecutionPlanNode>;
}

export interface WorkbenchAppLink {
  appId: number;
  deploymentId: number;
  name: string;
  sourceAppId: string;
  interactionModel?: string;
  publicPath?: string | null;
  externalPath?: string | null;
  editPath?: string;
  status?: string;
  /** Runtime liveness: 'unhealthy' = registry says running but the process is dead. */
  health?: 'healthy' | 'unhealthy' | 'unknown' | 'stopped';
  isPublished?: boolean;
  dependentMissionIds?: string[];
}

export type BlueprintType = 'mission' | 'milestone' | 'prediction';

export type AppStatus = 
  | 'pending'
  | 'waiting'
  | 'waiting_on_app'
  | 'active'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'paused';

export interface Dependency {
  blueprintName: string;
  type: DependencyType;
  offset?: DependencyOffset;
  lagMs?: number;
}

export type DependencyType = 
  | 'finish_to_start'
  | 'start_to_start'
  | 'finish_to_finish'
  | 'start_to_finish';

export interface DependencyOffset {
  value: number;
  unit: 'days' | 'weeks' | 'months' | 'years';
  direction: 'plus' | 'minus';
}

export interface BranchCondition {
  onOutcome: 'success' | 'failure';
  targetBlueprint: string;
}

export interface ResourceRequirement {
  id: string;
  label: string;
  type: ResourceType;
  description: string;
  placeholder?: string;
  required: boolean;
}

export type ResourceType = 
  | 'url_list'
  | 'dataset'
  | 'credential'
  | 'text'
  | 'number';

export interface AgentAssignment {
  agentId: string;
  agentName: string;
  agentRole: string;
  model: string;
  temperature: number;
}

export interface ExecutionMetadata {
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  cost?: number;
  tokensUsed?: number;
  error?: string;
  retryCount?: number;
  output?: any;
}

export interface BlueprintUIMetadata {
  icon?: string;
  color?: string;
  display_order?: number;
  category?: string;
  description?: string;
}

export interface BlueprintConfig {
  hf_dataset?: string;
  feature_mapping_string?: string;
  [key: string]: any;
}

export interface Step {
  id?: string;
  stepCode: string;
  action: string;
  description?: string;
  status: StepStatus;
  agent?: string;
  tool?: string;
  template?: string;
  requiresHuman?: boolean;
  formRef?: string;
  routing_channel?: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  output?: any;
  error?: string;
  estimated_duration_minutes?: number;
  ui_metadata?: StepUIMetadata;
  input?: string;
  on_fail?: any;
  on_reject?: any;
}

export type StepStatus = 
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting';

export interface StepUIMetadata {
  icon?: string;
  display_name?: string;
}

export interface AgentActivity {
  agentId: string;
  agentName: string;
  currentAction: string;
  reasoning?: string;
  toolUsage?: ToolUsage[];
  startTime: string;
  progress: number;
}

export interface ToolUsage {
  toolName: string;
  parameters: any;
  result?: any;
  duration: number;
  timestamp: string;
}

export interface CycleUIState {
  cycleId: number;
  activeAppIndex: number;
  expandedPanels: Set<string>;
  filterStatus?: AppStatus;
  sortBy?: 'name' | 'status' | 'duration';
  autoAdvance: boolean;
  soundEnabled: boolean;
  refreshInterval: number;
}

export interface NavigationState {
  currentIndex: number;
  previousIndex: number;
  navigationHistory: number[];
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PanelState {
  headerExpanded: boolean;
  navExpanded: boolean;
  detailExpanded: boolean;
  dependencyExpanded: boolean;
  panelSizes: {
    header: number;
    nav: number;
    detail: number;
    dependency: number;
  };
}
