/**
 * Agent Federation Service
 * 
 * Manages cross-organization agent federation for collaborative missions.
 * Handles federation agreements, trust scoring, federated agent discovery,
 * and secure inter-organization coordination.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { createLogger } from '../../../../utils/logger.js';
import {
  FederatedAgent,
  FederationAgreement,
  AgentMeshNode,
  AgentMesh,
  AgentTeam
} from '../../../../../shared/schema/multi-agent.js';

const logger = createLogger('AgentFederationService');

interface FederationRequest {
  fromOrg: string;
  toOrg: string;
  purpose: string;
  requestedAgents: string[];
  terms: {
    dataSharing: 'none' | 'minimal' | 'full';
    resourceSharing: 'none' | 'compute' | 'data' | 'full';
    duration: number; // days
  };
}

interface FederatedTask {
  id: string;
  missionId: string;
  requestingOrg: string;
  targetAgentId: string;
  type: string;
  input: Record<string, any>;
  status: 'pending' | 'assigned' | 'executing' | 'completed' | 'failed';
  result?: Record<string, any>;
  startedAt?: string;
  completedAt?: string;
}

export class AgentFederationService extends EventEmitter {
  private federatedAgents: Map<string, FederatedAgent> = new Map();
  private agreements: Map<string, FederationAgreement> = new Map();
  private orgTrustScores: Map<string, Map<string, number>> = new Map(); // orgA -> orgB -> score
  private federatedTasks: Map<string, FederatedTask> = new Map();

  /**
   * Create a federation agreement between organizations
   */
  async createAgreement(request: FederationRequest): Promise<FederationAgreement> {
    const agreementId = randomUUID();
    const now = new Date().toISOString();
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + request.terms.duration);

    const agreement: FederationAgreement = {
      id: agreementId,
      organizationA: request.fromOrg,
      organizationB: request.toOrg,
      purpose: request.purpose,
      terms: {
        dataSharing: request.terms.dataSharing,
        resourceSharing: request.terms.resourceSharing
      },
      status: 'draft',
      createdAt: now,
      validUntil: validUntil.toISOString()
    };

    this.agreements.set(agreementId, agreement);

    // Initialize trust score
    this.updateTrustScore(request.fromOrg, request.toOrg, 50); // Start neutral

    logger.info('Federation agreement created', {
      agreementId,
      fromOrg: request.fromOrg,
      toOrg: request.toOrg,
      purpose: request.purpose
    });

    this.emit('agreement:created', { agreementId, fromOrg: request.fromOrg, toOrg: request.toOrg });

    return agreement;
  }

  /**
   * Accept a federation agreement
   */
  async acceptAgreement(agreementId: string, acceptedBy: string): Promise<FederationAgreement> {
    const agreement = this.agreements.get(agreementId);
    if (!agreement) {
      throw new Error(`Agreement ${agreementId} not found`);
    }

    if (agreement.status !== 'draft' && agreement.status !== 'pending') {
      throw new Error(`Agreement cannot be accepted (status: ${agreement.status})`);
    }

    agreement.status = 'active';

    logger.info('Federation agreement accepted', {
      agreementId,
      acceptedBy,
      orgA: agreement.organizationA,
      orgB: agreement.organizationB
    });

    this.emit('agreement:accepted', { agreementId, organizationA: agreement.organizationA, organizationB: agreement.organizationB });

    return agreement;
  }

  /**
   * Register a federated agent from another organization
   */
  async registerFederatedAgent(
    localOrgId: string,
    externalAgent: {
      externalId: string;
      organizationId: string;
      organizationName: string;
      name: string;
      capabilities: string[];
      endpoint: string;
    },
    agreementId: string
  ): Promise<FederatedAgent> {
    // Verify agreement exists and is active
    const agreement = this.agreements.get(agreementId);
    if (!agreement || agreement.status !== 'active') {
      throw new Error('No active federation agreement found');
    }

    const trustScore = this.getTrustScore(localOrgId, externalAgent.organizationId);

    const federatedAgent: FederatedAgent = {
      id: randomUUID(),
      externalId: externalAgent.externalId,
      organizationId: externalAgent.organizationId,
      organizationName: externalAgent.organizationName,
      name: externalAgent.name,
      capabilities: externalAgent.capabilities,
      trustScore,
      federationAgreement: {
        agreementId,
        dataSharing: agreement.terms.dataSharing,
        resourceSharing: agreement.terms.resourceSharing,
        privacyLevel: this.mapDataSharingToPrivacy(agreement.terms.dataSharing),
        validUntil: agreement.validUntil
      },
      endpoint: externalAgent.endpoint,
      status: 'active'
    };

    this.federatedAgents.set(federatedAgent.id, federatedAgent);

    logger.info('Federated agent registered', {
      agentId: federatedAgent.id,
      externalId: externalAgent.externalId,
      org: externalAgent.organizationName,
      trustScore
    });

    this.emit('agent:federated', {
      agentId: federatedAgent.id,
      organization: externalAgent.organizationName,
      trustScore
    });

    return federatedAgent;
  }

  /**
   * Map data sharing level to privacy level
   */
  private mapDataSharingToPrivacy(
    dataSharing: 'none' | 'minimal' | 'full'
  ): 'public' | 'internal' | 'confidential' | 'restricted' {
    switch (dataSharing) {
      case 'none':
        return 'public';
      case 'minimal':
        return 'internal';
      case 'full':
        return 'confidential';
      default:
        return 'restricted';
    }
  }

  /**
   * Update trust score between organizations
   */
  async updateTrustScore(orgA: string, orgB: string, score: number): Promise<void> {
    const normalizedScore = Math.max(0, Math.min(100, score));

    if (!this.orgTrustScores.has(orgA)) {
      this.orgTrustScores.set(orgA, new Map());
    }
    if (!this.orgTrustScores.has(orgB)) {
      this.orgTrustScores.set(orgB, new Map());
    }

    this.orgTrustScores.get(orgA)!.set(orgB, normalizedScore);
    this.orgTrustScores.get(orgB)!.set(orgA, normalizedScore);

    logger.debug('Trust score updated', { orgA, orgB, score: normalizedScore });
  }

  /**
   * Get trust score between organizations
   */
  getTrustScore(orgA: string, orgB: string): number {
    return this.orgTrustScores.get(orgA)?.get(orgB) || 50;
  }

  /**
   * Adjust trust score based on interaction outcome
   */
  async adjustTrustScore(
    orgA: string,
    orgB: string,
    outcome: 'success' | 'failure' | 'violation',
    magnitude: number = 5
  ): Promise<number> {
    const currentScore = this.getTrustScore(orgA, orgB);
    let adjustment = 0;

    switch (outcome) {
      case 'success':
        adjustment = magnitude;
        break;
      case 'failure':
        adjustment = -magnitude;
        break;
      case 'violation':
        adjustment = -magnitude * 3; // Triple penalty for violations
        break;
    }

    const newScore = Math.max(0, Math.min(100, currentScore + adjustment));
    await this.updateTrustScore(orgA, orgB, newScore);

    logger.info('Trust score adjusted', {
      orgA,
      orgB,
      outcome,
      oldScore: currentScore,
      newScore,
      adjustment
    });

    return newScore;
  }

  /**
   * Discover available federated agents
   */
  async discoverAgents(
    localOrgId: string,
    filters?: {
      capabilities?: string[];
      minTrustScore?: number;
      dataSharing?: 'none' | 'minimal' | 'full';
    }
  ): Promise<FederatedAgent[]> {
    let agents = Array.from(this.federatedAgents.values()).filter(
      (a) => a.organizationId !== localOrgId && a.status === 'active'
    );

    // Filter by capabilities
    if (filters?.capabilities) {
      agents = agents.filter((a) =>
        filters.capabilities!.every((cap) => a.capabilities.includes(cap))
      );
    }

    // Filter by trust score
    if (filters?.minTrustScore !== undefined) {
      agents = agents.filter((a) => a.trustScore >= filters.minTrustScore!);
    }

    // Filter by data sharing level
    if (filters?.dataSharing) {
      const privacyLevel = this.mapDataSharingToPrivacy(filters.dataSharing);
      agents = agents.filter((a) => {
        const privacyRank = { public: 0, internal: 1, confidential: 2, restricted: 3 };
        return privacyRank[a.federationAgreement.privacyLevel] <= privacyRank[privacyLevel];
      });
    }

    // Sort by trust score
    agents.sort((a, b) => b.trustScore - a.trustScore);

    return agents;
  }

  /**
   * Delegate a task to a federated agent
   */
  async delegateTask(
    localOrgId: string,
    missionId: string,
    targetAgentId: string,
    task: {
      type: string;
      input: Record<string, any>;
    }
  ): Promise<FederatedTask> {
    const federatedAgent = this.federatedAgents.get(targetAgentId);
    if (!federatedAgent) {
      throw new Error(`Federated agent ${targetAgentId} not found`);
    }

    // Check trust score threshold
    const trustScore = this.getTrustScore(localOrgId, federatedAgent.organizationId);
    if (trustScore < 30) {
      throw new Error(
        `Trust score too low (${trustScore}) to delegate tasks to this agent`
      );
    }

    const federatedTask: FederatedTask = {
      id: randomUUID(),
      missionId,
      requestingOrg: localOrgId,
      targetAgentId,
      type: task.type,
      input: this.sanitizeInputForPrivacy(task.input, federatedAgent.federationAgreement.privacyLevel),
      status: 'pending',
      startedAt: new Date().toISOString()
    };

    this.federatedTasks.set(federatedTask.id, federatedTask);

    logger.info('Task delegated to federated agent', {
      taskId: federatedTask.id,
      missionId,
      targetAgent: targetAgentId,
      targetOrg: federatedAgent.organizationName
    });

    this.emit('task:delegated:federated', {
      taskId: federatedTask.id,
      missionId,
      targetAgentId,
      targetOrg: federatedAgent.organizationName
    });

    // Simulate async execution
    this.executeFederatedTask(federatedTask.id).catch((err) =>
      logger.error('Federated task execution failed', { taskId: federatedTask.id, error: err })
    );

    return federatedTask;
  }

  /**
   * Sanitize input based on privacy level
   */
  private sanitizeInputForPrivacy(
    input: Record<string, any>,
    privacyLevel: 'public' | 'internal' | 'confidential' | 'restricted'
  ): Record<string, any> {
    if (privacyLevel === 'public') {
      // Only allow completely anonymized data
      return { anonymized: true, hash: this.hashData(input) };
    }

    if (privacyLevel === 'internal') {
      // Remove PII but keep structure
      return this.removePII(input);
    }

    if (privacyLevel === 'confidential') {
      // Can share more but still sensitive
      return { ...input, _shared: true, _privacy: 'confidential' };
    }

    // restricted - no sharing
    return { error: 'Data sharing restricted' };
  }

  /**
   * Remove PII from data
   */
  private removePII(data: Record<string, any>): Record<string, any> {
    const piiFields = ['name', 'email', 'phone', 'address', 'ssn', 'dob'];
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (piiFields.some((f) => key.toLowerCase().includes(f))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.removePII(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Hash data for anonymization
   */
  private hashData(data: any): string {
    // Simple hash for demonstration
    return Buffer.from(JSON.stringify(data)).toString('base64').slice(0, 16);
  }

  /**
   * Execute federated task (simulated)
   */
  private async executeFederatedTask(taskId: string): Promise<void> {
    const task = this.federatedTasks.get(taskId);
    if (!task) return;

    task.status = 'executing';

    // Simulate execution time
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Simulate success/failure based on trust score
    const federatedAgent = this.federatedAgents.get(task.targetAgentId);
    const trustScore = federatedAgent
      ? this.getTrustScore(task.requestingOrg, federatedAgent.organizationId)
      : 50;

    const successProbability = trustScore / 100;
    const isSuccess = Math.random() < successProbability;

    if (isSuccess) {
      task.status = 'completed';
      task.result = {
        success: true,
        output: `Federated task ${task.type} completed by external agent`,
        trustMaintained: true
      };
      task.completedAt = new Date().toISOString();

      // Positive trust adjustment
      if (federatedAgent) {
        await this.adjustTrustScore(task.requestingOrg, federatedAgent.organizationId, 'success', 2);
      }

      this.emit('task:completed:federated', { taskId, success: true });
    } else {
      task.status = 'failed';
      task.result = {
        success: false,
        error: 'Federated agent failed to complete task'
      };

      // Negative trust adjustment
      if (federatedAgent) {
        await this.adjustTrustScore(task.requestingOrg, federatedAgent.organizationId, 'failure', 3);
      }

      this.emit('task:failed:federated', { taskId });
    }
  }

  /**
   * Get federated task status
   */
  getTaskStatus(taskId: string): FederatedTask | undefined {
    return this.federatedTasks.get(taskId);
  }

  /**
   * Get all federated agents
   */
  getFederatedAgents(localOrgId: string): FederatedAgent[] {
    return Array.from(this.federatedAgents.values()).filter(
      (a) => a.organizationId !== localOrgId
    );
  }

  /**
   * Get federation agreements
   */
  getAgreements(orgId?: string): FederationAgreement[] {
    const agreements = Array.from(this.agreements.values());
    if (orgId) {
      return agreements.filter(
        (a) => a.organizationA === orgId || a.organizationB === orgId
      );
    }
    return agreements;
  }

  /**
   * Suspend a federated agent
   */
  async suspendAgent(agentId: string, reason: string): Promise<void> {
    const agent = this.federatedAgents.get(agentId);
    if (!agent) {
      throw new Error(`Federated agent ${agentId} not found`);
    }

    agent.status = 'suspended';

    logger.warn('Federated agent suspended', { agentId, reason, org: agent.organizationName });
    this.emit('agent:suspended', { agentId, reason, organization: agent.organizationName });
  }

  /**
   * Terminate federation agreement
   */
  async terminateAgreement(agreementId: string, reason: string): Promise<void> {
    const agreement = this.agreements.get(agreementId);
    if (!agreement) {
      throw new Error(`Agreement ${agreementId} not found`);
    }

    agreement.status = 'terminated';

    // Suspend all federated agents under this agreement
    this.federatedAgents.forEach((agent) => {
      if (agent.federationAgreement.agreementId === agreementId) {
        agent.status = 'suspended';
      }
    });

    logger.info('Federation agreement terminated', {
      agreementId,
      reason,
      orgA: agreement.organizationA,
      orgB: agreement.organizationB
    });

    this.emit('agreement:terminated', { agreementId, reason });
  }

  /**
   * Get federation statistics
   */
  getFederationStats(orgId: string): {
    totalAgreements: number;
    activeAgreements: number;
    federatedAgents: number;
    avgTrustScore: number;
    completedTasks: number;
    failedTasks: number;
  } {
    const agreements = this.getAgreements(orgId);
    const agents = this.getFederatedAgents(orgId);
    const tasks = Array.from(this.federatedTasks.values()).filter(
      (t) => t.requestingOrg === orgId
    );

    const trustScores = agents.map((a) =>
      this.getTrustScore(orgId, a.organizationId)
    );
    const avgTrustScore = trustScores.length > 0
      ? trustScores.reduce((a, b) => a + b, 0) / trustScores.length
      : 0;

    return {
      totalAgreements: agreements.length,
      activeAgreements: agreements.filter((a) => a.status === 'active').length,
      federatedAgents: agents.length,
      avgTrustScore: Math.round(avgTrustScore),
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
      failedTasks: tasks.filter((t) => t.status === 'failed').length
    };
  }
}

export const federationService = new AgentFederationService();
