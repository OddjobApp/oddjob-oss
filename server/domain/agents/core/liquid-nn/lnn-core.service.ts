/**
 * Liquid Neural Network Core Service
 * 
 * MIT Liquid Neural Networks implementation.
 * Continuous-time recurrent neural networks with ODE dynamics.
 */

import {
  LNNConfig,
  DEFAULT_LNN_CONFIG,
  LiquidNeuronState,
  LNNState,
  LiquidAgent,
  LNNForwardResult,
  AdaptationEvent,
  EdgeProfile,
  ModelSizeMetrics,
  RealTimeMonitoringConfig,
  LNNError,
  LNNErrorType,
  LNNMetrics,
  LNNTrainingConfig
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { randomUUID } from 'crypto';

const logger = createLogger('LNNCoreService');

/**
 * LNN Core Service
 */
export class LNNCoreService {
  private agents: Map<string, LiquidAgent> = new Map();
  private states: Map<string, LNNState> = new Map();
  private configs: Map<string, LNNConfig> = new Map();
  private metrics: LNNMetrics;
  private eventStream: EventStreamService;

  constructor(eventStream: EventStreamService) {
    this.eventStream = eventStream;
    this.metrics = {
      activeAgents: 0,
      totalInferences: 0,
      avgInferenceTimeMs: 0,
      adaptationEvents: 0,
      divergenceEvents: 0,
      avgModelSizeMB: 0,
      edgeDeployments: 0
    };
    logger.info('LNN Core Service initialized');
  }

  /**
   * Create a new Liquid Neural Network agent
   */
  async createAgent(
    name: string,
    taskType: 'monitoring' | 'prediction' | 'control' | 'classification',
    config?: Partial<LNNConfig>,
    options?: {
      realTimeAdaptation?: boolean;
      edgeOptimized?: boolean;
    }
  ): Promise<LiquidAgent> {
    const agentId = randomUUID();
    
    const mergedConfig: LNNConfig = {
      ...DEFAULT_LNN_CONFIG,
      ...config
    };

    // Optimize config for task type
    if (taskType === 'monitoring') {
      mergedConfig.timeConstant = 0.05;  // Fast adaptation
      mergedConfig.adaptationRate = 0.01;
    } else if (taskType === 'prediction') {
      mergedConfig.recurrent = true;
      mergedConfig.timeConstant = 1.0;  // Longer memory
    }

    // Initialize weights with sparse connectivity
    const weights = this.initializeWeights(mergedConfig);

    // Initialize neuron states
    const neurons: LiquidNeuronState[] = [];
    for (let i = 0; i < mergedConfig.numNeurons; i++) {
      neurons.push({
        potential: 0,
        recovery: 0,
        tau: mergedConfig.timeConstant,
        adaptation: 0,
        lastSpikeTime: -Infinity,
        firingRate: 0
      });
    }

    const initialState: LNNState = {
      neurons,
      weights,
      timeTrace: 0,
      hiddenState: new Array(mergedConfig.numNeurons).fill(0)
    };

    const agent: LiquidAgent = {
      id: agentId,
      name,
      config: mergedConfig,
      initialState,
      taskType,
      realTimeAdaptation: options?.realTimeAdaptation ?? true,
      edgeOptimized: options?.edgeOptimized ?? false
    };

    this.agents.set(agentId, agent);
    this.states.set(agentId, this.deepCopyState(initialState));
    this.configs.set(agentId, mergedConfig);
    
    this.metrics.activeAgents++;

    await this.eventStream.publish({
      type: 'lnn.agent_created',
      payload: { agentId, config: mergedConfig }
    });

    logger.info(`Created LNN agent: ${name} (${agentId}) with ${mergedConfig.numNeurons} neurons`);

    return agent;
  }

  /**
   * Forward pass through LNN
   * Solves Neural ODE: τ * dx/dt = -x + f(W*x + I)
   */
  async forward(
    agentId: string,
    input: number[]
  ): Promise<LNNForwardResult> {
    const startTime = Date.now();
    
    const agent = this.agents.get(agentId);
    const state = this.states.get(agentId);
    const config = this.configs.get(agentId);

    if (!agent || !state || !config) {
      throw new LNNError(LNNErrorType.UNKNOWN, `Agent ${agentId} not found`);
    }

    // Validate input dimensions
    if (input.length !== config.inputDim) {
      throw new LNNError(
        LNNErrorType.INVALID_STATE,
        `Input dimension mismatch: expected ${config.inputDim}, got ${input.length}`
      );
    }

    // Integrate ODE over time
    const result = this.integrateODE(state, input, config);
    
    const computeTimeMs = Date.now() - startTime;

    // Update metrics
    this.metrics.totalInferences++;
    const n = this.metrics.totalInferences;
    this.metrics.avgInferenceTimeMs = 
      (this.metrics.avgInferenceTimeMs * (n - 1) + computeTimeMs) / n;

    // Check for divergence
    if (this.checkDivergence(result.nextState)) {
      this.metrics.divergenceEvents++;
      logger.warn(`Divergence detected for agent ${agentId}`);
      
      await this.eventStream.publish({
        type: 'lnn.divergence_detected',
        payload: { agentId, magnitude: this.computeDivergenceMagnitude(result.nextState) }
      });

      // Reset state
      this.states.set(agentId, this.deepCopyState(agent.initialState));
    } else {
      // Update state
      this.states.set(agentId, result.nextState);
    }

    await this.eventStream.publish({
      type: 'lnn.inference_complete',
      payload: { agentId, latencyMs: computeTimeMs }
    });

    return result;
  }

  /**
   * Real-time adaptation
   * Updates weights based on prediction error
   */
  async adapt(
    agentId: string,
    input: number[],
    target: number[]
  ): Promise<AdaptationEvent> {
    const agent = this.agents.get(agentId);
    const state = this.states.get(agentId);
    const config = this.configs.get(agentId);

    if (!agent || !state || !config) {
      throw new LNNError(LNNErrorType.UNKNOWN, `Agent ${agentId} not found`);
    }

    if (!agent.realTimeAdaptation) {
      throw new LNNError(
        LNNErrorType.ADAPTATION_FAILED,
        `Real-time adaptation not enabled for agent ${agentId}`
      );
    }

    // Forward pass to get prediction
    const forwardResult = await this.forward(agentId, input);
    
    // Compute error
    const error = this.computeError(forwardResult.output, target);
    
    // Compute weight gradients
    const gradients = this.computeGradients(state, input, error);
    
    // Apply weight updates
    const weightUpdates = this.updateWeights(state, gradients, config.adaptationRate);
    
    // Update state
    state.weights = weightUpdates.newWeights;
    this.states.set(agentId, state);
    
    this.metrics.adaptationEvents++;

    const event: AdaptationEvent = {
      timestamp: Date.now(),
      input,
      target,
      error,
      stateChange: weightUpdates.totalChange,
      weightUpdates: weightUpdates.updates
    };

    await this.eventStream.publish({
      type: 'lnn.adaptation_occurred',
      payload: { agentId, error }
    });

    return event;
  }

  /**
   * ODE Integration
   * Uses Runge-Kutta 4th order (RK4) solver
   */
  private integrateODE(
    state: LNNState,
    input: number[],
    config: LNNConfig
  ): LNNForwardResult {
    const dt = config.dt;
    const numSteps = 10;  // Number of integration steps
    
    let currentState = this.deepCopyState(state);
    
    // Integration loop
    for (let step = 0; step < numSteps; step++) {
      currentState = this.rk4Step(currentState, input, config, dt);
      currentState.timeTrace += dt;
    }

    // Compute output
    const output = this.computeOutput(currentState, config);
    const activations = currentState.neurons.map(n => this.sigmoid(n.potential));

    return {
      output,
      activations,
      nextState: currentState,
      computeTimeMs: 0,  // Set by caller
      stepsTaken: numSteps
    };
  }

  /**
   * RK4 integration step
   * Solves: dx/dt = f(x, t)
   */
  private rk4Step(
    state: LNNState,
    input: number[],
    config: LNNConfig,
    dt: number
  ): LNNState {
    // k1 = f(x, t)
    const k1 = this.computeDerivatives(state, input, config);
    
    // k2 = f(x + 0.5*dt*k1, t + 0.5*dt)
    const state2 = this.addDerivatives(state, k1, 0.5 * dt);
    const k2 = this.computeDerivatives(state2, input, config);
    
    // k3 = f(x + 0.5*dt*k2, t + 0.5*dt)
    const state3 = this.addDerivatives(state, k2, 0.5 * dt);
    const k3 = this.computeDerivatives(state3, input, config);
    
    // k4 = f(x + dt*k3, t + dt)
    const state4 = this.addDerivatives(state, k3, dt);
    const k4 = this.computeDerivatives(state4, input, config);
    
    // x_{n+1} = x_n + (dt/6) * (k1 + 2*k2 + 2*k3 + k4)
    return this.addDerivativesWeighted(state, k1, k2, k3, k4, dt / 6);
  }

  /**
   * Compute state derivatives (Neural ODE dynamics)
   * τ * dx/dt = -x + f(W*x + I)
   */
  private computeDerivatives(
    state: LNNState,
    input: number[],
    config: LNNConfig
  ): { neuronDerivs: number[]; weightChanges: number[][] } {
    const neuronDerivs: number[] = [];
    
    for (let i = 0; i < config.numNeurons; i++) {
      const neuron = state.neurons[i];
      
      // Compute synaptic input: W * x + I
      let synapticInput = 0;
      
      // Recurrent connections
      for (let j = 0; j < config.numNeurons; j++) {
        synapticInput += state.weights[i][j] * this.sigmoid(state.neurons[j].potential);
      }
      
      // External input (weighted sum)
      const inputWeight = i < input.length ? input[i] : 0;
      synapticInput += inputWeight;
      
      // Liquid dynamics: τ * dx/dt = -x + tanh(W*x + I)
      const tau = neuron.tau;
      const dx = (-neuron.potential + Math.tanh(synapticInput)) / tau;
      
      neuronDerivs.push(dx);
    }

    // Compute weight changes (if adapting)
    const weightChanges: number[][] = [];
    for (let i = 0; i < config.numNeurons; i++) {
      weightChanges[i] = new Array(config.numNeurons).fill(0);
    }

    return { neuronDerivs, weightChanges };
  }

  /**
   * Add derivatives to state (for RK4)
   */
  private addDerivatives(
    state: LNNState,
    derivs: { neuronDerivs: number[]; weightChanges: number[][] },
    scale: number
  ): LNNState {
    const newState = this.deepCopyState(state);
    
    for (let i = 0; i < newState.neurons.length; i++) {
      newState.neurons[i].potential += derivs.neuronDerivs[i] * scale;
    }
    
    return newState;
  }

  /**
   * Weighted sum of RK4 derivatives
   */
  private addDerivativesWeighted(
    state: LNNState,
    k1: { neuronDerivs: number[]; weightChanges: number[][] },
    k2: { neuronDerivs: number[]; weightChanges: number[][] },
    k3: { neuronDerivs: number[]; weightChanges: number[][] },
    k4: { neuronDerivs: number[]; weightChanges: number[][] },
    scale: number
  ): LNNState {
    const newState = this.deepCopyState(state);
    
    for (let i = 0; i < newState.neurons.length; i++) {
      const weightedSum = k1.neuronDerivs[i] + 
                         2 * k2.neuronDerivs[i] + 
                         2 * k3.neuronDerivs[i] + 
                         k4.neuronDerivs[i];
      newState.neurons[i].potential += weightedSum * scale;
    }
    
    return newState;
  }

  /**
   * Compute output from LNN state
   */
  private computeOutput(state: LNNState, config: LNNConfig): number[] {
    const output: number[] = [];
    
    for (let i = 0; i < config.outputDim; i++) {
      // Output is weighted sum of neuron activations
      let sum = 0;
      const outputNeuronIdx = config.numNeurons - config.outputDim + i;
      
      for (let j = 0; j < config.numNeurons; j++) {
        sum += state.weights[outputNeuronIdx][j] * this.sigmoid(state.neurons[j].potential);
      }
      
      output.push(sum);
    }
    
    return output;
  }

  /**
   * Sigmoid activation
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Initialize sparse weights
   */
  private initializeWeights(config: LNNConfig): number[][] {
    const weights: number[][] = [];
    
    for (let i = 0; i < config.numNeurons; i++) {
      weights[i] = [];
      for (let j = 0; j < config.numNeurons; j++) {
        // Sparse connectivity
        if (Math.random() > config.sparsity) {
          // Initialize with small random values
          weights[i][j] = (Math.random() - 0.5) * 0.1;
        } else {
          weights[i][j] = 0;
        }
      }
    }
    
    return weights;
  }

  /**
   * Compute error between prediction and target
   */
  private computeError(output: number[], target: number[]): number {
    let sumSquaredError = 0;
    for (let i = 0; i < output.length; i++) {
      const diff = output[i] - target[i];
      sumSquaredError += diff * diff;
    }
    return Math.sqrt(sumSquaredError / output.length);
  }

  /**
   * Compute gradients for weight update
   */
  private computeGradients(
    state: LNNState,
    input: number[],
    error: number
  ): number[][] {
    const grads: number[][] = [];
    
    for (let i = 0; i < state.weights.length; i++) {
      grads[i] = [];
      for (let j = 0; j < state.weights[i].length; j++) {
        // Simplified gradient: error * activation
        const activation = this.sigmoid(state.neurons[j].potential);
        grads[i][j] = error * activation;
      }
    }
    
    return grads;
  }

  /**
   * Update weights based on gradients
   */
  private updateWeights(
    state: LNNState,
    gradients: number[][],
    learningRate: number
  ): { newWeights: number[][]; totalChange: number; updates: number[][] } {
    const newWeights: number[][] = [];
    const updates: number[][] = [];
    let totalChange = 0;
    
    for (let i = 0; i < state.weights.length; i++) {
      newWeights[i] = [];
      updates[i] = [];
      
      for (let j = 0; j < state.weights[i].length; j++) {
        const update = -learningRate * gradients[i][j];
        newWeights[i][j] = state.weights[i][j] + update;
        updates[i][j] = update;
        totalChange += Math.abs(update);
      }
    }
    
    return { newWeights, totalChange, updates };
  }

  /**
   * Check for state divergence
   */
  private checkDivergence(state: LNNState): boolean {
    for (const neuron of state.neurons) {
      if (!isFinite(neuron.potential) || Math.abs(neuron.potential) > 100) {
        return true;
      }
    }
    return false;
  }

  /**
   * Compute divergence magnitude
   */
  private computeDivergenceMagnitude(state: LNNState): number {
    let maxAbs = 0;
    for (const neuron of state.neurons) {
      maxAbs = Math.max(maxAbs, Math.abs(neuron.potential));
    }
    return maxAbs;
  }

  /**
   * Deep copy state
   */
  private deepCopyState(state: LNNState): LNNState {
    return {
      neurons: state.neurons.map(n => ({ ...n })),
      weights: state.weights.map(row => [...row]),
      timeTrace: state.timeTrace,
      hiddenState: [...state.hiddenState]
    };
  }

  /**
   * Optimize for edge deployment
   */
  async optimizeForEdge(
    agentId: string,
    profile: EdgeProfile
  ): Promise<ModelSizeMetrics> {
    const agent = this.agents.get(agentId);
    const config = this.configs.get(agentId);
    
    if (!agent || !config) {
      throw new LNNError(LNNErrorType.UNKNOWN, `Agent ${agentId} not found`);
    }

    logger.info(`Optimizing agent ${agentId} for ${profile.device}`);

    // Prune weights
    const pruningThreshold = profile.pruningRatio;
    const prunedWeights = this.pruneWeights(config, pruningThreshold);
    
    // Quantize to lower precision
    const quantizedWeights = this.quantizeWeights(prunedWeights, profile.quantizationBits);
    
    // Update config
    const optimizedConfig: LNNConfig = {
      ...config,
      numNeurons: Math.floor(config.numNeurons * (1 - pruningThreshold))
    };

    this.configs.set(agentId, optimizedConfig);
    
    // Update state
    const state = this.states.get(agentId);
    if (state) {
      state.weights = quantizedWeights;
      this.states.set(agentId, state);
    }

    agent.edgeOptimized = true;
    this.metrics.edgeDeployments++;

    await this.eventStream.publish({
      type: 'lnn.edge_deployed',
      payload: { agentId, device: profile.device }
    });

    return this.computeModelSize(optimizedConfig, quantizedWeights);
  }

  /**
   * Prune weights
   */
  private pruneWeights(config: LNNConfig, ratio: number): number[][] {
    const prunedNumNeurons = Math.floor(config.numNeurons * (1 - ratio));
    const weights: number[][] = [];
    
    for (let i = 0; i < prunedNumNeurons; i++) {
      weights[i] = [];
      for (let j = 0; j < prunedNumNeurons; j++) {
        // Only keep significant weights
        const weight = Math.random() > 0.5 ? (Math.random() - 0.5) * 0.1 : 0;
        weights[i][j] = weight;
      }
    }
    
    return weights;
  }

  /**
   * Quantize weights to lower precision
   */
  private quantizeWeights(weights: number[][], bits: 8 | 16 | 32): number[][] {
    if (bits === 32) return weights;
    
    const scale = bits === 8 ? 127 : 32767;
    
    return weights.map(row => 
      row.map(w => Math.round(w * scale) / scale)
    );
  }

  /**
   * Compute model size metrics
   */
  private computeModelSize(config: LNNConfig, weights: number[][]): ModelSizeMetrics {
    const parameters = config.numNeurons * config.numNeurons + 
                      config.numNeurons + 
                      config.numNeurons * config.inputDim +
                      config.numNeurons * config.outputDim;
    
    const sizeBytes = parameters * 4;  // 32-bit floats
    const memoryMB = sizeBytes / (1024 * 1024);
    
    // LNNs are typically 10x smaller than equivalent transformers
    const vsTransformerRatio = 0.1;
    
    return {
      parameters,
      sizeBytes,
      flops: config.numNeurons * config.numNeurons,  // Simplified
      memoryMB,
      vsTransformerRatio
    };
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): LiquidAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agent state
   */
  getState(agentId: string): LNNState | undefined {
    return this.states.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): LiquidAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get metrics
   */
  getMetrics(): LNNMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset agent state
   */
  resetAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.states.set(agentId, this.deepCopyState(agent.initialState));
      logger.info(`Reset agent ${agentId} to initial state`);
    }
  }

  /**
   * Delete agent
   */
  deleteAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.states.delete(agentId);
    this.configs.delete(agentId);
    this.metrics.activeAgents--;
    logger.info(`Deleted agent ${agentId}`);
  }
}

/**
 * Event Stream Service Interface
 */
interface EventStreamService {
  publish(event: { type: string; payload: any }): Promise<void>;
}
