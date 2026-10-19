/**
 * Federated Learning - Types and Interfaces
 * 
 * Privacy-preserving collaborative machine learning across organizations.
 * Agents learn collectively without sharing raw data.
 */

/**
 * Organization participating in federated learning
 */
export interface FederatedOrg {
  /** Organization ID (hashed/anonymous) */
  id: string;
  
  /** Organization name (display only) */
  name: string;
  
  /** Public key for secure aggregation */
  publicKey: string;
  
  /** Data characteristics (not raw data) */
  dataProfile: {
    sampleCount: number;
    featureCount: number;
    dataTypes: string[];
    quality: number;  // 0-1
  };
  
  /** Join date */
  joinedAt: Date;
  
  /** Last contribution */
  lastContributionAt?: Date;
  
  /** Status */
  status: 'active' | 'paused' | 'suspended';
  
  /** Reputation score */
  reputation: number;  // 0-1
}

/**
 * Federated Round - Training iteration
 */
export interface FederatedRound {
  /** Round ID */
  id: string;
  
  /** Round number */
  roundNumber: number;
  
  /** Participating orgs */
  participatingOrgs: string[];
  
  /** Global model before round */
  globalModelBefore: ModelVersion;
  
  /** Local updates from orgs */
  localUpdates: LocalModelUpdate[];
  
  /** Aggregated global update */
  globalUpdate: ModelDelta;
  
  /** Global model after round */
  globalModelAfter: ModelVersion;
  
  /** Aggregation method used */
  aggregationMethod: 'fedavg' | 'fedprox' | 'scaffold' | 'custom';
  
  /** Privacy parameters */
  privacyParams: PrivacyParams;
  
  /** Round timing */
  startedAt: Date;
  completedAt?: Date;
  
  /** Performance metrics */
  metrics: RoundMetrics;
}

/**
 * Model Version
 */
export interface ModelVersion {
  /** Version ID */
  id: string;
  
  /** Version number */
  version: number;
  
  /** Model architecture hash */
  architectureHash: string;
  
  /** Model weights hash */
  weightsHash: string;
  
  /** Performance on validation set */
  validationMetrics: {
    accuracy: number;
    loss: number;
    [metric: string]: number;
  };
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Parent versions */
  parents: string[];
}

/**
 * Local Model Update from one organization
 */
export interface LocalModelUpdate {
  /** Update ID */
  id: string;
  
  /** Organization ID (hashed) */
  orgId: string;
  
  /** Round ID */
  roundId: string;
  
  /** Base global model version */
  baseModelVersion: string;
  
  /** Model delta (weight changes) */
  delta: ModelDelta;
  
  /** Local training metrics */
  localMetrics: {
    samplesUsed: number;
    epochs: number;
    finalLoss: number;
    accuracy: number;
  };
  
  /** Differential privacy noise added */
  dpNoise: number;
  
  /** Submission timestamp */
  submittedAt: Date;
  
  /** Verification proof */
  proof?: string;
}

/**
 * Model Delta - Weight changes
 */
export interface ModelDelta {
  /** Delta ID */
  id: string;
  
  /** Layer-wise weight changes */
  layerDeltas: LayerDelta[];
  
  /** Compression method */
  compression: 'none' | 'quantization' | 'sparsification' | 'sketching';
  
  /** Size in bytes */
  sizeBytes: number;
  
  /** Checksum */
  checksum: string;
}

/**
 * Layer Delta
 */
export interface LayerDelta {
  /** Layer name */
  layerName: string;
  
  /** Weight deltas (flattened or compressed) */
  weights: number[] | Uint8Array;
  
  /** Shape */
  shape: number[];
  
  /** Sparsity pattern (if compressed) */
  sparsityMask?: boolean[];
}

/**
 * Privacy Parameters for Differential Privacy
 */
export interface PrivacyParams {
  /** Epsilon (privacy budget) */
  epsilon: number;
  
  /** Delta (failure probability) */
  delta: number;
  
  /** Max gradient norm for clipping */
  maxGradientNorm: number;
  
  /** Noise multiplier */
  noiseMultiplier: number;
  
  /** Minimum number of participants */
  minParticipants: number;
}

/**
 * Default privacy parameters (ε < 1 for strong privacy)
 */
export const DEFAULT_PRIVACY_PARAMS: PrivacyParams = {
  epsilon: 0.5,
  delta: 1e-5,
  maxGradientNorm: 1.0,
  noiseMultiplier: 1.1,
  minParticipants: 3
};

/**
 * Round Metrics
 */
export interface RoundMetrics {
  /** Number of participants */
  participantCount: number;
  
  /** Updates received */
  updatesReceived: number;
  
  /** Updates expected */
  updatesExpected: number;
  
  /** Average local training time */
  avgTrainingTimeMs: number;
  
  /** Aggregation time */
  aggregationTimeMs: number;
  
  /** Global model improvement */
  improvement: {
    accuracyDelta: number;
    lossDelta: number;
  };
  
  /** Byzantine/malicious updates detected */
  byzantineDetected: number;
}

/**
 * Training Job for Federated Learning
 */
export interface FederatedTrainingJob {
  /** Job ID */
  id: string;
  
  /** Job name */
  name: string;
  
  /** Description */
  description: string;
  
  /** Model type being trained */
  modelType: 'agent_policy' | 'classification' | 'prediction' | 'embedding';
  
  /** Target agent skills */
  targetSkills: string[];
  
  /** Current round */
  currentRound: number;
  
  /** Total planned rounds */
  totalRounds: number;
  
  /** Participating organizations */
  participants: FederatedOrg[];
  
  /** Current global model */
  currentModel: ModelVersion;
  
  /** History of rounds */
  rounds: FederatedRound[];
  
  /** Training configuration */
  config: FederatedConfig;
  
  /** Status */
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed';
  
  /** Created by */
  createdBy: string;
  
  /** Timestamps */
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Federated Learning Configuration
 */
export interface FederatedConfig {
  /** Rounds to run */
  rounds: number;
  
  /** Local epochs per round */
  localEpochs: number;
  
  /** Batch size for local training */
  batchSize: number;
  
  /** Learning rate */
  learningRate: number;
  
  /** Aggregation method */
  aggregationMethod: 'fedavg' | 'fedprox' | 'scaffold';
  
  /** Client fraction per round */
  clientFraction: number;  // 0-1
  
  /** Privacy parameters */
  privacy: PrivacyParams;
  
  /** Verification enabled */
  enableVerification: boolean;
  
  /** Byzantine fault tolerance */
  byzantineTolerance: number;  // 0-1
  
  /** Minimum participants */
  minParticipants: number;
  
  /** Timeout per round (ms) */
  roundTimeoutMs: number;
}

/**
 * Default federated config
 */
export const DEFAULT_FEDERATED_CONFIG: FederatedConfig = {
  rounds: 100,
  localEpochs: 5,
  batchSize: 32,
  learningRate: 0.01,
  aggregationMethod: 'fedavg',
  clientFraction: 0.8,
  privacy: DEFAULT_PRIVACY_PARAMS,
  enableVerification: true,
  byzantineTolerance: 0.2,
  minParticipants: 3,
  roundTimeoutMs: 300000  // 5 minutes
};

/**
 * Secure Aggregation - Cryptographic protocol
 */
export interface SecureAggregation {
  /** Protocol ID */
  id: string;
  
  /** Round ID */
  roundId: string;
  
  /** Masking seed (shared secret) */
  maskingSeed: string;
  
  /** Individual masks */
  masks: Map<string, string>;  // orgId -> mask
  
  /** Aggregated result (unmasked) */
  aggregatedResult?: ModelDelta;
  
  /** Protocol state */
  state: 'key_exchange' | 'masking' | 'unmasking' | 'complete';
  
  /** Dropout handling */
  dropoutOrgs: string[];
}

/**
 * Contribution Report for an Organization
 */
export interface ContributionReport {
  /** Org ID */
  orgId: string;
  
  /** Period */
  startDate: Date;
  endDate: Date;
  
  /** Rounds participated */
  roundsParticipated: number;
  
  /** Total samples contributed */
  totalSamples: number;
  
  /** Model improvements attributed */
  improvementScore: number;
  
  /** Reputation change */
  reputationDelta: number;
  
  /** Rewards earned */
  rewards: number;
}

/**
 * Federated Learning Error Types
 */
export enum FederatedErrorType {
  INSUFFICIENT_PARTICIPANTS = 'insufficient_participants',
  PRIVACY_BUDGET_EXCEEDED = 'privacy_budget_exceeded',
  BYZANTINE_UPDATE_DETECTED = 'byzantine_update_detected',
  AGGREGATION_FAILED = 'aggregation_failed',
  TIMEOUT = 'timeout',
  VERIFICATION_FAILED = 'verification_failed',
  ORG_NOT_FOUND = 'org_not_found',
  ROUND_NOT_FOUND = 'round_not_found',
  INVALID_UPDATE = 'invalid_update',
  UNKNOWN = 'unknown'
}

/**
 * Federated Learning Error
 */
export class FederatedError extends Error {
  constructor(
    public type: FederatedErrorType,
    message: string,
    public roundId?: string,
    public orgId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'FederatedError';
  }
}

/**
 * Service Metrics
 */
export interface FederatedMetrics {
  /** Total training jobs */
  totalJobs: number;
  
  /** Active jobs */
  activeJobs: number;
  
  /** Completed jobs */
  completedJobs: number;
  
  /** Total rounds executed */
  totalRounds: number;
  
  /** Total participating orgs */
  totalOrgs: number;
  
  /** Active orgs (last 30 days) */
  activeOrgs: number;
  
  /** Average model improvement */
  avgImprovement: number;
  
  /** Privacy budget consumed (avg) */
  avgPrivacyBudgetUsed: number;
  
  /** Byzantine attacks detected */
  byzantineDetected: number;
  
  /** Average round time */
  avgRoundTimeMs: number;
}

/**
 * Federation Events
 */
export type FederatedEvent =
  | { type: 'federated.job_created'; payload: { jobId: string; name: string } }
  | { type: 'federated.round_started'; payload: { roundId: string; roundNumber: number } }
  | { type: 'federated.update_received'; payload: { roundId: string; orgId: string } }
  | { type: 'federated.aggregation_complete'; payload: { roundId: string; durationMs: number } }
  | { type: 'federated.job_completed'; payload: { jobId: string; finalAccuracy: number } }
  | { type: 'federated.byzantine_detected'; payload: { roundId: string; orgId: string; reason: string } }
  | { type: 'federated.org_joined'; payload: { orgId: string; name: string } }
  | { type: 'federated.org_left'; payload: { orgId: string; reason?: string } };

/**
 * Agent Skill Transfer via Federated Learning
 */
export interface SkillTransfer {
  /** Source skill */
  sourceSkill: string;
  
  /** Target organizations */
  targetOrgs: string[];
  
  /** Transfer method */
  method: 'fine_tuning' | 'distillation' | 'adapter';
  
  /** Performance on source org */
  sourcePerformance: number;
  
  /** Expected performance on target */
  expectedPerformance: number;
  
  /** Actual performance after transfer */
  actualPerformance?: number;
  
  /** Transfer rounds */
  transferRounds: number;
}
