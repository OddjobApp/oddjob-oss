/**
 * Liquid Neural Networks - Types and Interfaces
 * 
 * MIT Liquid Neural Networks (Hasani et al.) for real-time adaptive agents.
 * Continuous-time dynamics with Neural ODEs.
 */

/**
 * Liquid Neural Network Configuration
 */
export interface LNNConfig {
  /** Number of liquid neurons */
  numNeurons: number;
  
  /** Time constant (τ) - adaptation speed */
  timeConstant: number;
  
  /** Input dimension */
  inputDim: number;
  
  /** Output dimension */
  outputDim: number;
  
  /** Connection sparsity (0-1) */
  sparsity: number;
  
  /** Enable recurrent connections */
  recurrent: boolean;
  
  /** Solver method for ODE integration */
  solver: 'euler' | 'rk4' | 'dopri5';
  
  /** Time step for discretization */
  dt: number;
  
  /** Enable real-time adaptation */
  adaptative: boolean;
  
  /** Learning rate for adaptation */
  adaptationRate: number;
}

/**
 * Default LNN configuration
 */
export const DEFAULT_LNN_CONFIG: LNNConfig = {
  numNeurons: 64,
  timeConstant: 0.1,
  inputDim: 10,
  outputDim: 5,
  sparsity: 0.5,
  recurrent: true,
  solver: 'rk4',
  dt: 0.01,
  adaptative: true,
  adaptationRate: 0.001
};

/**
 * Liquid Neuron State
 */
export interface LiquidNeuronState {
  /** Membrane potential (voltage) */
  potential: number;
  
  /** Recovery variable (slow current) */
  recovery: number;
  
  /** Adaptive time constant */
  tau: number;
  
  /** Adaptation current */
  adaptation: number;
  
  /** Spike history (for refractory period) */
  lastSpikeTime: number;
  
  /** Firing rate */
  firingRate: number;
}

/**
 * LNN Network State
 */
export interface LNNState {
  /** Neuron states */
  neurons: LiquidNeuronState[];
  
  /** Synaptic weights (dynamic) */
  weights: number[][];
  
  /** Time-evolution trace */
  timeTrace: number;
  
  /** Hidden state for temporal memory */
  hiddenState: number[];
}

/**
 * Liquid Agent Configuration
 */
export interface LiquidAgent {
  /** Agent ID */
  id: string;
  
  /** Agent name */
  name: string;
  
  /** Base LNN configuration */
  config: LNNConfig;
  
  /** Initial state */
  initialState: LNNState;
  
  /** Task type */
  taskType: 'monitoring' | 'prediction' | 'control' | 'classification';
  
  /** Real-time adaptation enabled */
  realTimeAdaptation: boolean;
  
  /** Edge deployment optimized */
  edgeOptimized: boolean;
}

/**
 * Training Configuration
 */
export interface LNNTrainingConfig {
  /** Learning rate */
  learningRate: number;
  
  /** Batch size */
  batchSize: number;
  
  /** Number of epochs */
  epochs: number;
  
  /** Regularization strength */
  regularization: number;
  
  /** Curriculum learning enabled */
  curriculumLearning: boolean;
  
  /** Progressive training stages */
  trainingStages: TrainingStage[];
}

/**
 * Training Stage
 */
export interface TrainingStage {
  /** Stage number */
  stage: number;
  
  /** Stage name */
  name: string;
  
  /** Task complexity (0-1) */
  complexity: number;
  
  /** Duration (epochs) */
  duration: number;
  
  /** Learning rate for stage */
  lr: number;
}

/**
 * Real-time Adaptation Event
 */
export interface AdaptationEvent {
  /** Timestamp */
  timestamp: number;
  
  /** Input that triggered adaptation */
  input: number[];
  
  /** Target output (if supervised) */
  target?: number[];
  
  /** Prediction error */
  error?: number;
  
  /** State change magnitude */
  stateChange: number;
  
  /** Weight updates */
  weightUpdates: number[][];
}

/**
 * LNN Forward Pass Result
 */
export interface LNNForwardResult {
  /** Output values */
  output: number[];
  
  /** Neuron activations */
  activations: number[];
  
  /** New state after forward pass */
  nextState: LNNState;
  
  /** Computation time (ms) */
  computeTimeMs: number;
  
  /** Number of ODE steps taken */
  stepsTaken: number;
}

/**
 * Edge Deployment Profile
 */
export interface EdgeProfile {
  /** Target device */
  device: 'cpu' | 'mobile' | 'embedded' | 'browser';
  
  /** Memory budget (MB) */
  memoryBudget: number;
  
  /** Power budget (mW) */
  powerBudget: number;
  
  /** Latency requirement (ms) */
  latencyRequirement: number;
  
  /** Quantization bits */
  quantizationBits: 8 | 16 | 32;
  
  /** Pruning ratio */
  pruningRatio: number;
}

/**
 * Model Size Metrics
 */
export interface ModelSizeMetrics {
  /** Total parameters */
  parameters: number;
  
  /** Model size (bytes) */
  sizeBytes: number;
  
  /** FLOPs per inference */
  flops: number;
  
  /** Memory footprint (MB) */
  memoryMB: number;
  
  /** Compared to equivalent Transformer */
  vsTransformerRatio: number;
}

/**
 * Real-time Monitoring Config
 */
export interface RealTimeMonitoringConfig {
  /** Monitoring target */
  target: 'latency' | 'throughput' | 'error_rate' | 'pattern';
  
  /** Sampling rate (Hz) */
  samplingRate: number;
  
  /** Anomaly detection threshold */
  anomalyThreshold: number;
  
  /** Adaptive threshold enabled */
  adaptiveThreshold: boolean;
  
  /** Alert callback */
  onAnomaly?: (event: AdaptationEvent) => void;
}

/**
 * LNN Error Types
 */
export enum LNNErrorType {
  DIVERGENCE = 'divergence',
  INSTABILITY = 'instability',
  MEMORY_EXCEEDED = 'memory_exceeded',
  ADAPTATION_FAILED = 'adaptation_failed',
  INVALID_STATE = 'invalid_state',
  UNKNOWN = 'unknown'
}

/**
 * LNN Error
 */
export class LNNError extends Error {
  constructor(
    public type: LNNErrorType,
    message: string,
    public agentId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'LNNError';
  }
}

/**
 * Service Metrics
 */
export interface LNNMetrics {
  /** Active agents */
  activeAgents: number;
  
  /** Total inferences */
  totalInferences: number;
  
  /** Average inference time (ms) */
  avgInferenceTimeMs: number;
  
  /** Adaptation events processed */
  adaptationEvents: number;
  
  /** Divergence events */
  divergenceEvents: number;
  
  /** Average model size (MB) */
  avgModelSizeMB: number;
  
  /** Edge deployments */
  edgeDeployments: number;
}

/**
 * LNN Events
 */
export type LNNEvent =
  | { type: 'lnn.agent_created'; payload: { agentId: string; config: LNNConfig } }
  | { type: 'lnn.inference_complete'; payload: { agentId: string; latencyMs: number } }
  | { type: 'lnn.adaptation_occurred'; payload: { agentId: string; error: number } }
  | { type: 'lnn.divergence_detected'; payload: { agentId: string; magnitude: number } }
  | { type: 'lnn.edge_deployed'; payload: { agentId: string; device: string } };
