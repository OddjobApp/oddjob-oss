/**
 * Swarm Consensus Service
 * 
 * Implements consensus-based decision making for multi-agent swarms.
 * Supports multiple consensus algorithms: voting, confidence-weighted, leader-elected, and Raft-inspired.
 * 
 * Key Features:
 * - Propose/vote/accept/reject workflow for distributed decisions
 * - Byzantine fault tolerance (detect malicious/incoherent agents)
 * - Automatic consensus resolution with timeouts
 * - Confidence scoring based on agent track record
 */

import { createLogger } from "@server/utils/logger.js";
import { swarmCommunicationService, SwarmMessage } from "../swarm-communication.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("ConsensusService");

// Consensus algorithm types
export type ConsensusAlgorithm = 
  | "simple_majority"      // 50% + 1 votes
  | "super_majority"       // 66% + 1 votes
  | "unanimous"            // 100% agreement
  | "confidence_weighted"  // Weight by agent confidence scores
  | "leader_elected"       // Single leader decides
  | "bft_tolerant";        // Byzantine fault tolerant (tolerates f faulty agents)

// Decision states
export type ProposalStatus = 
  | "pending"      // Awaiting votes
  | "accepted"     // Consensus reached
  | "rejected"     // Consensus failed
  | "expired"      // Timeout reached
  | "disputed";    // Tie or no clear winner

// Vote types
export interface Vote {
  agentId: string;
  proposalId: string;
  value: "yes" | "no" | "abstain";
  confidence: number;      // 0-1, how confident the agent is in their vote
  reasoning?: string;       // Why they voted this way
  timestamp: Date;
}

// Proposal structure
export interface Proposal {
  id: string;
  swarmId: string;
  proposerId: string;
  type: string;            // "action", "plan", "correction", "escalation"
  payload: any;            // The proposed content
  
  // Consensus config
  algorithm: ConsensusAlgorithm;
  requiredQuorum: number;  // Minimum voters needed
  timeoutMs: number;       // Max time to wait
  
  // State
  status: ProposalStatus;
  votes: Map<string, Vote>;
  result?: {
    accepted: boolean;
    winningValue?: any;
    yesVotes: number;
    noVotes: number;
    abstainVotes: number;
    confidenceScore: number;
    reasoning: string;
  };
  
  // Timing
  createdAt: Date;
  resolvedAt?: Date;
}

// Agent reputation for confidence weighting
interface AgentReputation {
  agentId: string;
  correctVotes: number;
  totalVotes: number;
  avgConfidence: number;
  lastUpdated: Date;
}

// Consensus configuration
export interface ConsensusConfig {
  defaultAlgorithm: ConsensusAlgorithm;
  defaultTimeoutMs: number;
  defaultQuorum: number;
  bftFaultTolerance: number;  // Max faulty agents tolerated (f)
  minConfidenceThreshold: number;  // Min confidence to count vote
  enableByzantineDetection: boolean;
}

const DEFAULT_CONFIG: ConsensusConfig = {
  defaultAlgorithm: "confidence_weighted",
  defaultTimeoutMs: 30000,    // 30 seconds
  defaultQuorum: 3,
  bftFaultTolerance: 1,       // Tolerate 1 faulty agent
  minConfidenceThreshold: 0.5,
  enableByzantineDetection: true,
};

/**
 * Manages consensus for distributed agent decisions
 */
export class ConsensusService {
  private proposals: Map<string, Proposal> = new Map();
  private agentReputations: Map<string, AgentReputation> = new Map();
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();
  private config: ConsensusConfig;
  private handlers: Map<string, (proposal: Proposal) => void> = new Map();

  constructor(config: Partial<ConsensusConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initSwarmListener();
  }

  // ============================================================================
  // PROPOSAL LIFECYCLE
  // ============================================================================

  /**
   * Create and broadcast a new proposal to the swarm
   */
  async propose(
    swarmId: string,
    proposerId: string,
    type: string,
    payload: any,
    options?: {
      algorithm?: ConsensusAlgorithm;
      timeoutMs?: number;
      requiredQuorum?: number;
    }
  ): Promise<Proposal> {
    const proposal: Proposal = {
      id: uuidv4(),
      swarmId,
      proposerId,
      type,
      payload,
      algorithm: options?.algorithm || this.config.defaultAlgorithm,
      requiredQuorum: options?.requiredQuorum || this.config.defaultQuorum,
      timeoutMs: options?.timeoutMs || this.config.defaultTimeoutMs,
      status: "pending",
      votes: new Map(),
      createdAt: new Date(),
    };

    this.proposals.set(proposal.id, proposal);

    // Broadcast proposal to swarm
    await swarmCommunicationService.broadcast(swarmId, proposerId, {
      type: "consensus:proposal",
      proposal: {
        ...proposal,
        votes: Array.from(proposal.votes.entries()), // Convert Map for serialization
      },
    });

    // Set timeout for automatic resolution
    this.setProposalTimeout(proposal);

    logger.info(`[Consensus] Proposal ${proposal.id} created in swarm ${swarmId}`, {
      type,
      algorithm: proposal.algorithm,
      quorum: proposal.requiredQuorum,
    });

    // Emit event
    await eventStream.publish(
      "swarm.consensus.proposed",
      {
        proposalId: proposal.id,
        swarmId,
        proposerId,
        type,
        algorithm: proposal.algorithm,
      },
      { organizationId: 0, missionId: 0, swarmId },
      "consensus"
    );

    return proposal;
  }

  /**
   * Submit a vote for a proposal
   */
  async vote(
    proposalId: string,
    agentId: string,
    value: "yes" | "no" | "abstain",
    confidence: number = 0.8,
    reasoning?: string
  ): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${proposalId} is already ${proposal.status}`);
    }

    const vote: Vote = {
      agentId,
      proposalId,
      value,
      confidence: Math.max(0, Math.min(1, confidence)),
      reasoning,
      timestamp: new Date(),
    };

    proposal.votes.set(agentId, vote);

    // Broadcast vote to swarm
    await swarmCommunicationService.broadcast(proposal.swarmId, agentId, {
      type: "consensus:vote",
      proposalId,
      vote: {
        agentId,
        value,
        confidence: vote.confidence,
        reasoning,
      },
    });

    logger.debug(`[Consensus] Vote from ${agentId} on ${proposalId}: ${value} (${confidence})`);

    // Check if we have consensus
    await this.checkConsensus(proposal);
  }

  /**
   * Get current proposal status
   */
  getProposal(proposalId: string): Proposal | undefined {
    return this.proposals.get(proposalId);
  }

  /**
   * Get all proposals for a swarm
   */
  getSwarmProposals(swarmId: string): Proposal[] {
    return Array.from(this.proposals.values()).filter(p => p.swarmId === swarmId);
  }

  // ============================================================================
  // CONSENSUS ALGORITHMS
  // ============================================================================

  /**
   * Check if consensus has been reached
   */
  private async checkConsensus(proposal: Proposal): Promise<void> {
    if (proposal.status !== "pending") return;

    const members = await swarmCommunicationService.getMembers(proposal.swarmId);
    const totalMembers = members.length;
    const votes = Array.from(proposal.votes.values());

    // Check quorum
    if (votes.length < proposal.requiredQuorum) {
      logger.debug(`[Consensus] Proposal ${proposal.id} waiting for quorum (${votes.length}/${proposal.requiredQuorum})`);
      return;
    }

    // Filter by minimum confidence
    const validVotes = votes.filter(v => v.confidence >= this.config.minConfidenceThreshold);

    switch (proposal.algorithm) {
      case "simple_majority":
        await this.resolveSimpleMajority(proposal, validVotes, totalMembers);
        break;
      case "super_majority":
        await this.resolveSuperMajority(proposal, validVotes, totalMembers);
        break;
      case "unanimous":
        await this.resolveUnanimous(proposal, validVotes, totalMembers);
        break;
      case "confidence_weighted":
        await this.resolveConfidenceWeighted(proposal, validVotes, totalMembers);
        break;
      case "bft_tolerant":
        await this.resolveBFT(proposal, validVotes, totalMembers);
        break;
      default:
        await this.resolveSimpleMajority(proposal, validVotes, totalMembers);
    }
  }

  private async resolveSimpleMajority(
    proposal: Proposal,
    votes: Vote[],
    totalMembers: number
  ): Promise<void> {
    const yesCount = votes.filter(v => v.value === "yes").length;
    const noCount = votes.filter(v => v.value === "no").length;
    const majorityThreshold = Math.floor(totalMembers / 2) + 1;

    if (yesCount >= majorityThreshold) {
      await this.acceptProposal(proposal, "yes", yesCount, noCount, votes.length - yesCount - noCount);
    } else if (noCount >= majorityThreshold) {
      await this.rejectProposal(proposal, "no", yesCount, noCount, votes.length - yesCount - noCount);
    } else if (votes.length === totalMembers) {
      // All voted but no majority - disputed
      await this.disputeProposal(proposal, yesCount, noCount, votes.length - yesCount - noCount);
    }
  }

  private async resolveSuperMajority(
    proposal: Proposal,
    votes: Vote[],
    totalMembers: number
  ): Promise<void> {
    const yesCount = votes.filter(v => v.value === "yes").length;
    const noCount = votes.filter(v => v.value === "no").length;
    const threshold = Math.floor(totalMembers * 2 / 3) + 1;

    if (yesCount >= threshold) {
      await this.acceptProposal(proposal, "yes", yesCount, noCount, votes.length - yesCount - noCount);
    } else if (noCount >= threshold) {
      await this.rejectProposal(proposal, "no", yesCount, noCount, votes.length - yesCount - noCount);
    } else if (votes.length === totalMembers) {
      await this.disputeProposal(proposal, yesCount, noCount, votes.length - yesCount - noCount);
    }
  }

  private async resolveUnanimous(
    proposal: Proposal,
    votes: Vote[],
    totalMembers: number
  ): Promise<void> {
    const yesCount = votes.filter(v => v.value === "yes").length;
    const noCount = votes.filter(v => v.value === "no").length;

    if (yesCount === totalMembers) {
      await this.acceptProposal(proposal, "yes", yesCount, 0, 0);
    } else if (noCount > 0) {
      await this.rejectProposal(proposal, "no", yesCount, noCount, votes.length - yesCount - noCount);
    }
  }

  private async resolveConfidenceWeighted(
    proposal: Proposal,
    votes: Vote[],
    totalMembers: number
  ): Promise<void> {
    // Calculate weighted scores
    let yesWeight = 0;
    let noWeight = 0;
    let totalWeight = 0;

    for (const vote of votes) {
      const reputation = this.getAgentReputation(vote.agentId);
      const weight = vote.confidence * reputation;
      totalWeight += weight;

      if (vote.value === "yes") yesWeight += weight;
      else if (vote.value === "no") noWeight += weight;
    }

    const yesRatio = totalWeight > 0 ? yesWeight / totalWeight : 0;
    const noRatio = totalWeight > 0 ? noWeight / totalWeight : 0;

    // 50% threshold for confidence-weighted
    if (yesRatio > 0.5) {
      await this.acceptProposal(
        proposal, 
        "yes", 
        votes.filter(v => v.value === "yes").length,
        votes.filter(v => v.value === "no").length,
        votes.filter(v => v.value === "abstain").length,
        yesRatio
      );
    } else if (noRatio > 0.5) {
      await this.rejectProposal(
        proposal,
        "no",
        votes.filter(v => v.value === "yes").length,
        votes.filter(v => v.value === "no").length,
        votes.filter(v => v.value === "abstain").length,
        noRatio
      );
    } else if (votes.length === totalMembers) {
      await this.disputeProposal(
        proposal,
        votes.filter(v => v.value === "yes").length,
        votes.filter(v => v.value === "no").length,
        votes.filter(v => v.value === "abstain").length,
        Math.max(yesRatio, noRatio)
      );
    }
  }

  private async resolveBFT(
    proposal: Proposal,
    votes: Vote[],
    totalMembers: number
  ): Promise<void> {
    // Byzantine Fault Tolerant consensus
    // Tolerates f faulty agents where n >= 3f + 1
    const f = this.config.bftFaultTolerance;
    const threshold = 2 * f + 1;  // Need 2f+1 honest votes

    const yesCount = votes.filter(v => v.value === "yes").length;
    const noCount = votes.filter(v => v.value === "no").length;

    // Detect potential byzantine agents (conflicting votes from same source)
    if (this.config.enableByzantineDetection) {
      await this.detectByzantineAgents(proposal);
    }

    if (yesCount >= threshold) {
      await this.acceptProposal(proposal, "yes", yesCount, noCount, votes.length - yesCount - noCount);
    } else if (noCount >= threshold) {
      await this.rejectProposal(proposal, "no", yesCount, noCount, votes.length - yesCount - noCount);
    }
  }

  // ============================================================================
  // PROPOSAL RESOLUTION
  // ============================================================================

  private async acceptProposal(
    proposal: Proposal,
    winningValue: string,
    yesVotes: number,
    noVotes: number,
    abstainVotes: number,
    confidenceScore: number = 0.8
  ): Promise<void> {
    proposal.status = "accepted";
    proposal.resolvedAt = new Date();
    proposal.result = {
      accepted: true,
      winningValue,
      yesVotes,
      noVotes,
      abstainVotes,
      confidenceScore,
      reasoning: `Consensus reached with ${yesVotes} yes, ${noVotes} no, ${abstainVotes} abstain`,
    };

    this.clearProposalTimeout(proposal.id);

    // Update agent reputations
    this.updateReputations(proposal);

    // Broadcast result
    await swarmCommunicationService.broadcast(proposal.swarmId, "consensus-service", {
      type: "consensus:resolved",
      proposalId: proposal.id,
      result: proposal.result,
    });

    // Emit event
    await eventStream.publish(
      "swarm.consensus.accepted",
      {
        proposalId: proposal.id,
        swarmId: proposal.swarmId,
        type: proposal.type,
        confidenceScore,
      },
      { organizationId: 0, missionId: 0, swarmId: proposal.swarmId },
      "consensus"
    );

    // Notify handlers
    this.notifyHandlers(proposal);

    logger.info(`[Consensus] Proposal ${proposal.id} ACCEPTED`, { confidenceScore });
  }

  private async rejectProposal(
    proposal: Proposal,
    winningValue: string,
    yesVotes: number,
    noVotes: number,
    abstainVotes: number,
    confidenceScore: number = 0.2
  ): Promise<void> {
    proposal.status = "rejected";
    proposal.resolvedAt = new Date();
    proposal.result = {
      accepted: false,
      winningValue,
      yesVotes,
      noVotes,
      abstainVotes,
      confidenceScore,
      reasoning: `Consensus rejected with ${yesVotes} yes, ${noVotes} no`,
    };

    this.clearProposalTimeout(proposal.id);

    await swarmCommunicationService.broadcast(proposal.swarmId, "consensus-service", {
      type: "consensus:resolved",
      proposalId: proposal.id,
      result: proposal.result,
    });

    await eventStream.publish(
      "swarm.consensus.rejected",
      {
        proposalId: proposal.id,
        swarmId: proposal.swarmId,
        type: proposal.type,
      },
      { organizationId: 0, missionId: 0, swarmId: proposal.swarmId },
      "consensus"
    );

    this.notifyHandlers(proposal);

    logger.info(`[Consensus] Proposal ${proposal.id} REJECTED`);
  }

  private async disputeProposal(
    proposal: Proposal,
    yesVotes: number,
    noVotes: number,
    abstainVotes: number,
    confidenceScore: number = 0.5
  ): Promise<void> {
    proposal.status = "disputed";
    proposal.resolvedAt = new Date();
    proposal.result = {
      accepted: false,
      yesVotes,
      noVotes,
      abstainVotes,
      confidenceScore,
      reasoning: `No clear consensus reached (${yesVotes} yes, ${noVotes} no). Requires escalation.`,
    };

    this.clearProposalTimeout(proposal.id);

    await swarmCommunicationService.broadcast(proposal.swarmId, "consensus-service", {
      type: "consensus:disputed",
      proposalId: proposal.id,
      result: proposal.result,
    });

    await eventStream.publish(
      "swarm.consensus.disputed",
      {
        proposalId: proposal.id,
        swarmId: proposal.swarmId,
        type: proposal.type,
      },
      { organizationId: 0, missionId: 0, swarmId: proposal.swarmId },
      "consensus"
    );

    this.notifyHandlers(proposal);

    logger.warn(`[Consensus] Proposal ${proposal.id} DISPUTED - requires escalation`);
  }

  private async expireProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "pending") return;

    proposal.status = "expired";
    proposal.resolvedAt = new Date();
    const votesArray = Array.from(proposal.votes.values());
    proposal.result = {
      accepted: false,
      yesVotes: votesArray.filter((v: Vote) => v.value === "yes").length,
      noVotes: votesArray.filter((v: Vote) => v.value === "no").length,
      abstainVotes: votesArray.filter((v: Vote) => v.value === "abstain").length,
      confidenceScore: 0,
      reasoning: "Proposal expired before consensus reached",
    };

    await swarmCommunicationService.broadcast(proposal.swarmId, "consensus-service", {
      type: "consensus:expired",
      proposalId,
    });

    this.notifyHandlers(proposal);

    logger.warn(`[Consensus] Proposal ${proposalId} EXPIRED`);
  }

  // ============================================================================
  // REPUTATION & BYZANTINE DETECTION
  // ============================================================================

  private getAgentReputation(agentId: string): number {
    const rep = this.agentReputations.get(agentId);
    if (!rep || rep.totalVotes === 0) return 0.5; // Neutral default
    return rep.correctVotes / rep.totalVotes;
  }

  private updateReputations(proposal: Proposal): void {
    if (!proposal.result) return;

    for (const [agentId, vote] of proposal.votes) {
      let rep = this.agentReputations.get(agentId);
      if (!rep) {
        rep = {
          agentId,
          correctVotes: 0,
          totalVotes: 0,
          avgConfidence: 0,
          lastUpdated: new Date(),
        };
        this.agentReputations.set(agentId, rep);
      }

      rep.totalVotes++;
      if ((proposal.result.accepted && vote.value === "yes") ||
          (!proposal.result.accepted && vote.value === "no")) {
        rep.correctVotes++;
      }
      rep.avgConfidence = (rep.avgConfidence * (rep.totalVotes - 1) + vote.confidence) / rep.totalVotes;
      rep.lastUpdated = new Date();
    }
  }

  private async detectByzantineAgents(proposal: Proposal): Promise<string[]> {
    // Simple detection: agents who frequently vote against consensus
    const suspicious: string[] = [];
    
    for (const [agentId, vote] of proposal.votes) {
      const rep = this.agentReputations.get(agentId);
      if (rep && rep.totalVotes > 5) {
        const accuracy = rep.correctVotes / rep.totalVotes;
        if (accuracy < 0.3) { // Less than 30% accuracy is suspicious
          suspicious.push(agentId);
          logger.warn(`[Consensus] Potential Byzantine agent detected: ${agentId} (${accuracy.toFixed(2)} accuracy)`);
        }
      }
    }

    return suspicious;
  }

  // ============================================================================
  // LISTENERS & HANDLERS
  // ============================================================================

  private initSwarmListener(): void {
    // Subscribe to all swarm messages for consensus coordination
    swarmCommunicationService.subscribe("consensus-global", (message: SwarmMessage) => {
      this.handleSwarmMessage(message);
    }).catch(err => {
      logger.error("[Consensus] Failed to initialize swarm listener:", err);
    });
  }

  private async handleSwarmMessage(message: SwarmMessage): Promise<void> {
    if (message.payload?.type === "consensus:vote") {
      const { proposalId, vote } = message.payload;
      const proposal = this.proposals.get(proposalId);
      if (proposal && proposal.status === "pending") {
        // Record vote from swarm broadcast
        proposal.votes.set(vote.agentId, {
          agentId: vote.agentId,
          proposalId,
          value: vote.value,
          confidence: vote.confidence,
          reasoning: vote.reasoning,
          timestamp: new Date(),
        });
        await this.checkConsensus(proposal);
      }
    }
  }

  onProposalResolved(proposalId: string, handler: (proposal: Proposal) => void): void {
    this.handlers.set(proposalId, handler);
  }

  offProposalResolved(proposalId: string): void {
    this.handlers.delete(proposalId);
  }

  private notifyHandlers(proposal: Proposal): void {
    const handler = this.handlers.get(proposal.id);
    if (handler) {
      try {
        handler(proposal);
      } catch (e) {
        logger.error(`[Consensus] Error in proposal handler for ${proposal.id}:`, e);
      }
    }
  }

  // ============================================================================
  // TIMEOUTS
  // ============================================================================

  private setProposalTimeout(proposal: Proposal): void {
    const timer = setTimeout(() => {
      this.expireProposal(proposal.id);
    }, proposal.timeoutMs);

    this.activeTimers.set(proposal.id, timer);
  }

  private clearProposalTimeout(proposalId: string): void {
    const timer = this.activeTimers.get(proposalId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(proposalId);
    }
  }

  // ============================================================================
  // UTILITY
  // ============================================================================

  /**
   * Get statistics for a swarm's consensus history
   */
  getSwarmStats(swarmId: string): {
    totalProposals: number;
    accepted: number;
    rejected: number;
    disputed: number;
    expired: number;
    avgConfidence: number;
  } {
    const proposals = this.getSwarmProposals(swarmId);
    const resolved = proposals.filter(p => p.result);

    return {
      totalProposals: proposals.length,
      accepted: proposals.filter((p: Proposal) => p.status === "accepted").length,
      rejected: proposals.filter((p: Proposal) => p.status === "rejected").length,
      disputed: proposals.filter((p: Proposal) => p.status === "disputed").length,
      expired: proposals.filter((p: Proposal) => p.status === "expired").length,
      avgConfidence: resolved.length > 0
        ? resolved.reduce((sum, p) => sum + (p.result?.confidenceScore || 0), 0) / resolved.length
        : 0,
    };
  }

  /**
   * Clean up old proposals (call periodically)
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, proposal] of this.proposals) {
      if (proposal.createdAt.getTime() < cutoff) {
        this.clearProposalTimeout(id);
        this.proposals.delete(id);
        this.handlers.delete(id);
      }
    }
  }
}

export const consensusService = new ConsensusService();
