export interface SynthesisContext {
  missionRunId: number;
  missionId: number;
  organizationId: number;
  objective: string;
  blackboard: Record<string, unknown>;
  executionTrace: ExecutionStep[];
  budgetUsed: number;
  budgetLimit: number;
  cycleCount: number;
  maxCycles: number;
}

export interface ExecutionStep {
  cycle: number;
  action: string;
  result: 'success' | 'failure' | 'partial';
  output?: unknown;
  error?: string;
  latencyMs: number;
  costUsd?: number;
}

export interface SynthesisAnalysis {
  objectiveMet: boolean;
  confidenceScore: number;
  performanceMetrics: {
    budgetEfficiency: number;
    timeEfficiency: number;
    qualityScore: number;
    completionPercentage: number;
  };
  executionTrace: ExecutionStep[];
  deviationAnalysis: Deviation[];
  blockerAnalysis?: BlockerAnalysis;
}

export interface Deviation {
  expected: string;
  actual: string;
  impact: 'low' | 'medium' | 'high';
  cause?: string;
}

export interface BlockerAnalysis {
  blockersEncountered: number;
  blockersResolved: number;
  unresolvedBlockers: string[];
  avgResolutionTime: number;
}

export interface SynthesisLearning {
  successfulStrategies: string[];
  failedApproaches: FailedApproach[];
  recommendedAdjustments: Adjustment[];
  detectedPatterns: Pattern[];
  keyInsights: Insight[];
}

export interface FailedApproach {
  strategy: string;
  reason: string;
  alternative?: string;
}

export interface Adjustment {
  target: string;
  change: string;
  rationale: string;
}

export interface Pattern {
  type: 'success' | 'failure' | 'efficiency' | 'risk';
  description: string;
  frequency: number;
  confidence: number;
}

export interface Insight {
  category: 'process' | 'technical' | 'domain' | 'strategic';
  statement: string;
  evidence: string[];
  confidence: number;
}

export interface KnowledgeCapture {
  newPatterns: MissionPattern[];
  institutionalMemory: {
    missionPattern: string;
    successFactors: string[];
    failureFactors: string[];
  };
  skillUpdates: SkillUpdate[];
}

export interface MissionPattern {
  name: string;
  triggerConditions: string[];
  successfulApproach: string;
  effectiveness: number;
  usageCount: number;
}

export interface SkillUpdate {
  skillId: string;
  improvement: number;
  newCapabilities?: string[];
}

export interface SynthesisConclusion {
  recommendation: 'continue' | 'retry' | 'conclude' | 'escalate';
  completionStatus: 'success' | 'partial' | 'failure';
  confidence: number;
  nextCycleAdjustments?: Adjustment[];
  finalOutputs?: unknown[];
  postMissionActions?: string[];
  reasoning: string;
}

export interface SynthesisResult {
  success: boolean;
  analysis: SynthesisAnalysis;
  learning: SynthesisLearning;
  knowledgeCapture: KnowledgeCapture;
  conclusion: SynthesisConclusion;
  latencyMs: number;
  timestamp: string;
}
