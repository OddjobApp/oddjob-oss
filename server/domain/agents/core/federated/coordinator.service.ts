/**
 * Federated Learning Coordinator Service
 * 
 * Manages federated training rounds, secure aggregation, and privacy.
 * Coordinates model updates across participating organizations.
 */

import {
  FederatedTrainingJob,
  FederatedRound,
  FederatedOrg,
  ModelVersion,
  LocalModelUpdate,
  ModelDelta,
  FederatedConfig,
  DEFAULT_FEDERATED_CONFIG,
  PrivacyParams,
  DEFAULT_PRIVACY_PARAMS,
  RoundMetrics,
  ContributionReport,
  FederatedMetrics,
  FederatedError,
  FederatedErrorType,
  FederatedEvent,
  SkillTransfer
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const logger = createLogger('FederatedCoordinator');

/**
 * Federated Coordinator Service
 */
export class FederatedCoordinatorService {
  private jobs: Map<string, FederatedTrainingJob> = new Map();
  private rounds: Map<string, FederatedRound> = new Map();
  private orgs: Map<string, FederatedOrg> = new Map();
  private models: Map<string, ModelVersion> = new Map();
  private updates: Map<string, LocalModelUpdate> = new Map();
  private metrics: FederatedMetrics;
  private eventStream: EventStreamService;

  constructor(eventStream: EventStreamService) {
    this.eventStream = eventStream;
    this.metrics = {
      totalJobs: 0,
      activeJobs: 0,
      completedJobs: 0,
      totalRounds: 0,
      totalOrgs: 0,
      activeOrgs: 0,
      avgImprovement: 0,
      avgPrivacyBudgetUsed: 0,
      byzantineDetected: 0,
      avgRoundTimeMs: 0
    };
    logger.info('Federated Coordinator Service initialized');
  }

  /**
   * Create a new federated training job
   */
  async createJob(
    name: string,
    description: string,
    modelType: 'agent_policy' | 'classification' | 'prediction' | 'embedding',
    targetSkills: string[],
    participants: string[],
    config?: Partial<FederatedConfig>,
    createdBy?: string
  ): Promise<FederatedTrainingJob> {
    const jobId = randomUUID();
    
    logger.info(`Creating federated job: ${name} (${jobId})`);

    // Validate participants
    const validParticipants: FederatedOrg[] = [];
    for (const orgId of participants) {
      const org = this.orgs.get(orgId);
      if (org && org.status === 'active') {
        validParticipants.push(org);
      }
    }

    if (validParticipants.length < (config?.minParticipants || DEFAULT_FEDERATED_CONFIG.minParticipants)) {
      throw new FederatedError(
        FederatedErrorType.INSUFFICIENT_PARTICIPANTS,
        `Only ${validParticipants.length} valid participants, minimum ${config?.minParticipants || DEFAULT_FEDERATED_CONFIG.minParticipants} required`
      );
    }

    // Create initial model version
    const initialModel: ModelVersion = {
      id: `model-${randomUUID()}`,
      version: 0,
      architectureHash: this.hashArchitecture(modelType),
      weightsHash: 'initial',
      validationMetrics: { accuracy: 0, loss: 0 },
      createdAt: new Date(),
      parents: []
    };
    this.models.set(initialModel.id, initialModel);

    const job: FederatedTrainingJob = {
      id: jobId,
      name,
      description,
      modelType,
      targetSkills,
      currentRound: 0,
      totalRounds: config?.rounds || DEFAULT_FEDERATED_CONFIG.rounds,
      participants: validParticipants,
      currentModel: initialModel,
      rounds: [],
      config: { ...DEFAULT_FEDERATED_CONFIG, ...config },
      status: 'pending',
      createdBy: createdBy || 'system',
      createdAt: new Date()
    };

    this.jobs.set(jobId, job);
    this.metrics.totalJobs++;
    this.metrics.activeJobs++;

    // Emit event
    await this.eventStream.publish({
      type: 'federated.job_created',
      payload: { jobId, name }
    });

    logger.info(`Federated job created: ${jobId} with ${validParticipants.length} participants`);

    return job;
  }

  /**
   * Start training job
   */
  async startJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new FederatedError(FederatedErrorType.UNKNOWN, `Job ${jobId} not found`);
    }

    if (job.status !== 'pending') {
      throw new FederatedError(FederatedErrorType.UNKNOWN, `Job ${jobId} cannot be started (status: ${job.status})`);
    }

    logger.info(`Starting federated job: ${jobId}`);
    job.status = 'active';
    job.startedAt = new Date();

    // Start first round
    await this.executeRound(jobId);
  }

  /**
   * Execute a training round
   */
  private async executeRound(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'active') {
      return;
    }

    const roundNumber = job.currentRound + 1;
    const roundId = `round-${jobId}-${roundNumber}`;
    
    logger.info(`Starting round ${roundNumber} for job ${jobId}`);

    // Select participants for this round (subset for efficiency)
    const selectedOrgs = this.selectParticipants(job.participants, job.config.clientFraction);

    // Create round
    const round: FederatedRound = {
      id: roundId,
      roundNumber,
      participatingOrgs: selectedOrgs.map(o => o.id),
      globalModelBefore: job.currentModel,
      localUpdates: [],
      globalUpdate: {
        id: `delta-${randomUUID()}`,
        layerDeltas: [],
        compression: 'none',
        sizeBytes: 0,
        checksum: ''
      },
      globalModelAfter: job.currentModel,  // Will be updated after aggregation
      aggregationMethod: job.config.aggregationMethod,
      privacyParams: job.config.privacy,
      startedAt: new Date(),
      metrics: {
        participantCount: selectedOrgs.length,
        updatesReceived: 0,
        updatesExpected: selectedOrgs.length,
        avgTrainingTimeMs: 0,
        aggregationTimeMs: 0,
        improvement: { accuracyDelta: 0, lossDelta: 0 },
        byzantineDetected: 0
      }
    };

    this.rounds.set(roundId, round);
    job.rounds.push(round);

    // Emit event
    await this.eventStream.publish({
      type: 'federated.round_started',
      payload: { roundId, roundNumber }
    });

    // Wait for updates (in production, this would be async with callbacks)
    // For now, simulate the round lifecycle
    logger.info(`Round ${roundNumber} initialized, waiting for updates from ${selectedOrgs.length} orgs`);
  }

  /**
   * Submit local model update from an organization
   */
  async submitUpdate(
    roundId: string,
    orgId: string,
    delta: ModelDelta,
    localMetrics: {
      samplesUsed: number;
      epochs: number;
      finalLoss: number;
      accuracy: number;
    }
  ): Promise<void> {
    const round = this.rounds.get(roundId);
    if (!round) {
      throw new FederatedError(FederatedErrorType.ROUND_NOT_FOUND, `Round ${roundId} not found`);
    }

    // Check round timeout
    const elapsed = Date.now() - round.startedAt.getTime();
    if (elapsed > (round.globalModelBefore.createdAt.getTime() || 300000)) {
      throw new FederatedError(FederatedErrorType.TIMEOUT, `Round ${roundId} has timed out`);
    }

    // Verify org is participating
    if (!round.participatingOrgs.includes(orgId)) {
      throw new FederatedError(
        FederatedErrorType.ORG_NOT_FOUND,
        `Organization ${orgId} is not participating in round ${roundId}`
      );
    }

    logger.info(`Received update from ${orgId} for round ${roundId}`);

    // Add differential privacy noise
    const dpNoise = this.addDifferentialPrivacy(delta, round.privacyParams);

    // Create update
    const update: LocalModelUpdate = {
      id: `update-${randomUUID()}`,
      orgId,
      roundId,
      baseModelVersion: round.globalModelBefore.id,
      delta,
      localMetrics,
      dpNoise,
      submittedAt: new Date()
    };

    // Verify update (basic sanity checks)
    if (!this.verifyUpdate(update, round)) {
      throw new FederatedError(
        FederatedErrorType.BYZANTINE_UPDATE_DETECTED,
        `Update from ${orgId} failed verification`,
        roundId,
        orgId
      );
    }

    this.updates.set(update.id, update);
    round.localUpdates.push(update);
    round.metrics.updatesReceived++;

    // Update org last contribution
    const org = this.orgs.get(orgId);
    if (org) {
      org.lastContributionAt = new Date();
    }

    // Emit event
    await this.eventStream.publish({
      type: 'federated.update_received',
      payload: { roundId, orgId }
    });

    // Check if we can aggregate
    if (round.metrics.updatesReceived >= Math.ceil(round.metrics.updatesExpected * 0.6)) {
      // 60% quorum
      await this.aggregateRound(roundId);
    }
  }

  /**
   * Aggregate updates into global model
   */
  private async aggregateRound(roundId: string): Promise<void> {
    const round = this.rounds.get(roundId);
    if (!round || round.localUpdates.length === 0) {
      return;
    }

    const aggregationStart = Date.now();
    logger.info(`Aggregating round ${roundId} with ${round.localUpdates.length} updates`);

    try {
      // Apply aggregation method
      let aggregatedDelta: ModelDelta;
      
      switch (round.aggregationMethod) {
        case 'fedavg':
          aggregatedDelta = this.federatedAveraging(round.localUpdates);
          break;
        case 'fedprox':
          aggregatedDelta = this.federatedProx(round.localUpdates, round.globalModelBefore);
          break;
        default:
          aggregatedDelta = this.federatedAveraging(round.localUpdates);
      }

      round.globalUpdate = aggregatedDelta;

      // Create new model version
      const newModel: ModelVersion = {
        id: `model-${randomUUID()}`,
        version: round.globalModelBefore.version + 1,
        architectureHash: round.globalModelBefore.architectureHash,
        weightsHash: this.hashDelta(aggregatedDelta),
        validationMetrics: this.estimateMetrics(round),
        createdAt: new Date(),
        parents: [round.globalModelBefore.id]
      };

      this.models.set(newModel.id, newModel);
      round.globalModelAfter = newModel;

      // Update round metrics
      round.metrics.aggregationTimeMs = Date.now() - aggregationStart;
      round.metrics.improvement = {
        accuracyDelta: newModel.validationMetrics.accuracy - round.globalModelBefore.validationMetrics.accuracy,
        lossDelta: round.globalModelBefore.validationMetrics.loss - newModel.validationMetrics.loss
      };
      round.completedAt = new Date();

      // Update job
      const job = Array.from(this.jobs.values()).find(j => 
        j.rounds.some(r => r.id === roundId)
      );
      
      if (job) {
        job.currentModel = newModel;
        job.currentRound = round.roundNumber;

        // Check completion
        if (job.currentRound >= job.totalRounds) {
          await this.completeJob(job.id);
        } else {
          // Start next round
          setTimeout(() => this.executeRound(job.id), 1000);
        }
      }

      // Update global metrics
      this.metrics.totalRounds++;
      this.metrics.avgRoundTimeMs = 
        (this.metrics.avgRoundTimeMs * (this.metrics.totalRounds - 1) + 
         (round.completedAt.getTime() - round.startedAt.getTime())) / 
        this.metrics.totalRounds;

      // Emit event
      await this.eventStream.publish({
        type: 'federated.aggregation_complete',
        payload: { 
          roundId, 
          durationMs: round.metrics.aggregationTimeMs,
          accuracy: newModel.validationMetrics.accuracy
        }
      });

      logger.info(`Round ${roundId} aggregated: accuracy ${newModel.validationMetrics.accuracy.toFixed(4)}`);

    } catch (error) {
      logger.error(`Aggregation failed for round ${roundId}:`, error);
      throw new FederatedError(
        FederatedErrorType.AGGREGATION_FAILED,
        `Aggregation failed: ${(error as Error).message}`,
        roundId
      );
    }
  }

  /**
   * Federated Averaging (FedAvg)
   */
  private federatedAveraging(updates: LocalModelUpdate[]): ModelDelta {
    if (updates.length === 0) {
      throw new FederatedError(FederatedErrorType.AGGREGATION_FAILED, 'No updates to aggregate');
    }

    const totalSamples = updates.reduce((sum, u) => sum + u.localMetrics.samplesUsed, 0);
    
    // Weighted average by sample count
    const weightedDeltas = updates.map(u => ({
      delta: u.delta,
      weight: u.localMetrics.samplesUsed / totalSamples
    }));

    // Aggregate layer by layer
    const aggregatedLayers = weightedDeltas[0].delta.layerDeltas.map((_, layerIdx) => {
      const layerName = weightedDeltas[0].delta.layerDeltas[layerIdx].layerName;
      
      // Weighted sum of weights
      const aggregatedWeights = weightedDeltas.reduce((sum, wd) => {
        const layerDelta = wd.delta.layerDeltas[layerIdx];
        const weights = layerDelta.weights instanceof Uint8Array 
          ? Array.from(layerDelta.weights) 
          : layerDelta.weights;
        
        return weights.map((w, i) => (sum[i] || 0) + w * wd.weight);
      }, [] as number[]);

      return {
        layerName,
        weights: aggregatedWeights,
        shape: weightedDeltas[0].delta.layerDeltas[layerIdx].shape
      };
    });

    return {
      id: `aggregated-${randomUUID()}`,
      layerDeltas: aggregatedLayers,
      compression: 'none',
      sizeBytes: aggregatedLayers.reduce((sum, l) => sum + l.weights.length * 4, 0),
      checksum: this.hashDelta({ id: '', layerDeltas: aggregatedLayers, compression: 'none', sizeBytes: 0, checksum: '' })
    };
  }

  /**
   * Federated Proximal (FedProx)
   * Adds proximal term to handle system heterogeneity
   */
  private federatedProx(updates: LocalModelUpdate[], globalModel: ModelVersion): ModelDelta {
    // For simplicity, falls back to FedAvg
    // Full implementation would add proximal term
    return this.federatedAveraging(updates);
  }

  /**
   * Add differential privacy noise
   */
  private addDifferentialPrivacy(delta: ModelDelta, params: PrivacyParams): number {
    const noiseScale = params.noiseMultiplier * params.maxGradientNorm;
    
    // Add Gaussian noise to each weight
    for (const layer of delta.layerDeltas) {
      if (layer.weights instanceof Array) {
        for (let i = 0; i < layer.weights.length; i++) {
          const noise = this.gaussianNoise(0, noiseScale);
          layer.weights[i] += noise;
        }
      }
    }

    return noiseScale;
  }

  /**
   * Gaussian noise generator
   */
  private gaussianNoise(mean: number, std: number): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * std + mean;
  }

  /**
   * Verify local update
   */
  private verifyUpdate(update: LocalModelUpdate, round: FederatedRound): boolean {
    // Check update size (too large = potential attack)
    if (update.delta.sizeBytes > 100 * 1024 * 1024) {  // 100MB limit
      logger.warn(`Update from ${update.orgId} exceeds size limit`);
      this.metrics.byzantineDetected++;
      return false;
    }

    // Check for NaN/Inf weights
    for (const layer of update.delta.layerDeltas) {
      const weights = layer.weights instanceof Array ? layer.weights : Array.from(layer.weights);
      for (const w of weights) {
        if (!isFinite(w)) {
          logger.warn(`Update from ${update.orgId} contains non-finite values`);
          this.metrics.byzantineDetected++;
          return false;
        }
      }
    }

    // Check local metrics sanity
    if (update.localMetrics.accuracy < 0 || update.localMetrics.accuracy > 1) {
      logger.warn(`Update from ${update.orgId} has invalid accuracy`);
      return false;
    }

    return true;
  }

  /**
   * Select participants for a round
   */
  private selectParticipants(orgs: FederatedOrg[], fraction: number): FederatedOrg[] {
    const count = Math.max(1, Math.ceil(orgs.length * fraction));
    
    // Shuffle and select
    const shuffled = [...orgs].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * Complete a training job
   */
  private async completeJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    logger.info(`Completing federated job: ${jobId}`);
    
    job.status = 'completed';
    job.completedAt = new Date();

    this.metrics.activeJobs--;
    this.metrics.completedJobs++;
    this.metrics.avgImprovement = 
      (this.metrics.avgImprovement * (this.metrics.completedJobs - 1) + 
       (job.currentModel.validationMetrics.accuracy - 0)) / 
      this.metrics.completedJobs;

    // Emit event
    await this.eventStream.publish({
      type: 'federated.job_completed',
      payload: { 
        jobId, 
        finalAccuracy: job.currentModel.validationMetrics.accuracy 
      }
    });

    logger.info(`Federated job ${jobId} completed: accuracy ${job.currentModel.validationMetrics.accuracy.toFixed(4)}`);
  }

  /**
   * Register organization
   */
  async registerOrg(
    id: string,
    name: string,
    publicKey: string,
    dataProfile: {
      sampleCount: number;
      featureCount: number;
      dataTypes: string[];
      quality: number;
    }
  ): Promise<FederatedOrg> {
    const org: FederatedOrg = {
      id,
      name,
      publicKey,
      dataProfile,
      joinedAt: new Date(),
      status: 'active',
      reputation: 1.0
    };

    this.orgs.set(id, org);
    this.metrics.totalOrgs++;

    await this.eventStream.publish({
      type: 'federated.org_joined',
      payload: { orgId: id, name }
    });

    logger.info(`Organization registered: ${name} (${id})`);
    return org;
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): FederatedTrainingJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get round by ID
   */
  getRound(roundId: string): FederatedRound | undefined {
    return this.rounds.get(roundId);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): FederatedTrainingJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get active jobs
   */
  getActiveJobs(): FederatedTrainingJob[] {
    return Array.from(this.jobs.values()).filter(j => j.status === 'active');
  }

  /**
   * Get metrics
   */
  getMetrics(): FederatedMetrics {
    return { ...this.metrics };
  }

  /**
   * Generate contribution report for an org
   */
  generateContributionReport(orgId: string, startDate: Date, endDate: Date): ContributionReport {
    const org = this.orgs.get(orgId);
    if (!org) {
      throw new FederatedError(FederatedErrorType.ORG_NOT_FOUND, `Org ${orgId} not found`);
    }

    const relevantRounds = Array.from(this.rounds.values()).filter(r => 
      r.participatingOrgs.includes(orgId) &&
      r.startedAt >= startDate &&
      r.startedAt <= endDate
    );

    const totalSamples = relevantRounds.reduce((sum, r) => {
      const update = r.localUpdates.find(u => u.orgId === orgId);
      return sum + (update?.localMetrics.samplesUsed || 0);
    }, 0);

    return {
      orgId,
      startDate,
      endDate,
      roundsParticipated: relevantRounds.length,
      totalSamples,
      improvementScore: this.calculateImprovementScore(orgId, relevantRounds),
      reputationDelta: 0,  // Would calculate based on behavior
      rewards: this.calculateRewards(orgId, totalSamples)
    };
  }

  /**
   * Calculate improvement score
   */
  private calculateImprovementScore(orgId: string, rounds: FederatedRound[]): number {
    if (rounds.length === 0) return 0;
    
    return rounds.reduce((sum, r) => {
      const update = r.localUpdates.find(u => u.orgId === orgId);
      if (!update) return sum;
      return sum + (update.localMetrics.accuracy - 0.5);  // Improvement over baseline
    }, 0) / rounds.length;
  }

  /**
   * Calculate rewards
   */
  private calculateRewards(orgId: string, samples: number): number {
    // Simple reward function: 1 token per 1000 samples
    return samples / 1000;
  }

  /**
   * Helper: Hash model architecture
   */
  private hashArchitecture(modelType: string): string {
    return createHash('sha256').update(modelType).digest('hex').substring(0, 16);
  }

  /**
   * Helper: Hash model delta
   */
  private hashDelta(delta: ModelDelta): string {
    const data = JSON.stringify(delta.layerDeltas.map(l => l.weights));
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Estimate model metrics after aggregation
   */
  private estimateMetrics(round: FederatedRound): { accuracy: number; loss: number } {
    // Weighted average of local metrics
    const totalSamples = round.localUpdates.reduce((sum, u) => sum + u.localMetrics.samplesUsed, 0);
    
    const weightedAccuracy = round.localUpdates.reduce((sum, u) => 
      sum + u.localMetrics.accuracy * (u.localMetrics.samplesUsed / totalSamples), 0
    );
    
    const weightedLoss = round.localUpdates.reduce((sum, u) => 
      sum + u.localMetrics.finalLoss * (u.localMetrics.samplesUsed / totalSamples), 0
    );

    return {
      accuracy: weightedAccuracy,
      loss: weightedLoss
    };
  }
}

/**
 * Event Stream Service Interface
 */
interface EventStreamService {
  publish(event: { type: string; payload: any }): Promise<void>;
}
