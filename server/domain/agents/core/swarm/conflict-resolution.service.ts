/**
 * Conflict Resolution Service
 * 
 * Provides automated conflict resolution for agent swarms when consensus
 * fails or agents disagree on critical decisions.
 * 
 * Strategies:
 * - Mediation: Find common ground through structured negotiation
 * - Arbitration: Third-party makes binding decision
 * - Compromise: Split the difference or merge alternatives
 * - Escalation: Hand off to human when automated resolution fails
 */

import { createLogger } from "@server/utils/logger.js";
import { Proposal, Vote, consensusService } from "./consensus.service.js";
import { swarmRoleManager, SwarmRole } from "./swarm-roles.js";
import { sharedBlackboardService } from "./shared-blackboard.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("ConflictResolutionService");

// Conflict types
export type ConflictType =
  | "proposal_disagreement"  // Agents disagree on proposal
  | "resource_contention"    // Agents compete for same resource
  | "deadlock"               // No clear winner in voting
  | "priority_dispute"       // Agents disagree on priorities
  | "approach_divergence";   // Different strategies proposed

// Resolution strategies
export type ResolutionStrategy =
  | "mediation"
  | "arbitration"
  | "compromise"
  | "vote_override"
  | "escalation";

// Conflict record
export interface Conflict {
  id: string;
  swarmId: string;
  type: ConflictType;
  proposalId?: string;
  agents: string[];  // Agents involved
  description: string;
  
  // Resolution state
  strategy: ResolutionStrategy;
  mediatorId?: string;  // Agent mediating/arbitrating
  status: "detected" | "mediating" | "resolved" | "escalated" | "failed";
  
  // Outcome
  resolution?: {
    decision: string;
    acceptedBy: string[];
    rejectedBy: string[];
    reasoning: string;
  };
  
  // Timing
  createdAt: Date;
  resolvedAt?: Date;
  escalationReason?: string;
}

// Mediation session
interface MediationSession {
  conflictId: string;
  rounds: Array<{
    round: number;
    positions: Record<string, { stance: string; priority: number }>;
    concessions: Record<string, string[]>;
  }>;
  currentRound: number;
  maxRounds: number;
}

export class ConflictResolutionService {
  private activeConflicts: Map<string, Conflict> = new Map();
  private mediationSessions: Map<string, MediationSession> = new Map();

  // ============================================================================
  // CONFLICT DETECTION
  // ============================================================================

  /**
   * Detect and register a conflict from a disputed proposal
   */
  detectFromProposal(proposal: Proposal): Conflict | null {
    if (proposal.status !== "disputed") return null;

    const swarmId = proposal.swarmId;
    const agents = Array.from(proposal.votes.keys());

    const conflict: Conflict = {
      id: `conflict-${proposal.id}`,
      swarmId,
      type: "proposal_disagreement",
      proposalId: proposal.id,
      agents,
      description: `Disagreement on proposal: ${proposal.type}`,
      strategy: this.selectStrategy(proposal, agents),
      status: "detected",
      createdAt: new Date(),
    };

    this.activeConflicts.set(conflict.id, conflict);

    logger.info(`[ConflictResolution] Detected conflict ${conflict.id} in swarm ${swarmId}`);

    eventStream.publish(
      "swarm.conflict.detected",
      {
        conflictId: conflict.id,
        swarmId,
        type: conflict.type,
        agents: agents.length,
      },
      { organizationId: 0, missionId: 0, swarmId },
      "conflict"
    ).catch(() => {});

    return conflict;
  }

  /**
   * Manually register a detected conflict
   */
  registerConflict(
    swarmId: string,
    type: ConflictType,
    agents: string[],
    description: string,
    proposalId?: string
  ): Conflict {
    const conflict: Conflict = {
      id: `conflict-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      swarmId,
      type,
      proposalId,
      agents,
      description,
      strategy: this.selectStrategyFromType(type, agents),
      status: "detected",
      createdAt: new Date(),
    };

    this.activeConflicts.set(conflict.id, conflict);
    return conflict;
  }

  // ============================================================================
  // STRATEGY SELECTION
  // ============================================================================

  private selectStrategy(proposal: Proposal, agents: string[]): ResolutionStrategy {
    // Small swarms -> mediation
    if (agents.length <= 3) return "mediation";

    // High priority disputes -> arbitration
    if (proposal.type === "escalation" || proposal.type === "critical_action") {
      return "arbitration";
    }

    // Deadlocked proposals -> compromise
    const yesVotes = Array.from(proposal.votes.values()).filter(v => v.value === "yes").length;
    const noVotes = Array.from(proposal.votes.values()).filter(v => v.value === "no").length;
    if (Math.abs(yesVotes - noVotes) <= 1) {
      return "compromise";
    }

    return "mediation";
  }

  private selectStrategyFromType(type: ConflictType, agents: string[]): ResolutionStrategy {
    switch (type) {
      case "proposal_disagreement":
        return agents.length <= 4 ? "mediation" : "arbitration";
      case "resource_contention":
        return "compromise";
      case "deadlock":
        return "vote_override";
      case "priority_dispute":
        return "mediation";
      case "approach_divergence":
        return "compromise";
      default:
        return "mediation";
    }
  }

  // ============================================================================
  // RESOLUTION EXECUTION
  // ============================================================================

  /**
   * Execute conflict resolution
   */
  async resolve(conflictId: string): Promise<Conflict> {
    const conflict = this.activeConflicts.get(conflictId);
    if (!conflict) throw new Error(`Conflict ${conflictId} not found`);
    if (conflict.status !== "detected") {
      throw new Error(`Conflict ${conflictId} already being resolved`);
    }

    conflict.status = "mediating";

    logger.info(`[ConflictResolution] Resolving ${conflict.id} using ${conflict.strategy}`);

    try {
      switch (conflict.strategy) {
        case "mediation":
          await this.executeMediation(conflict);
          break;
        case "arbitration":
          await this.executeArbitration(conflict);
          break;
        case "compromise":
          await this.executeCompromise(conflict);
          break;
        case "vote_override":
          await this.executeVoteOverride(conflict);
          break;
        case "escalation":
          await this.executeEscalation(conflict);
          break;
      }
    } catch (err: any) {
      logger.error(`[ConflictResolution] Resolution failed for ${conflict.id}:`, err);
      conflict.status = "failed";
      conflict.escalationReason = err.message;
    }

    return conflict;
  }

  // ============================================================================
  // MEDIATION
  // ============================================================================

  private async executeMediation(conflict: Conflict): Promise<void> {
    const session: MediationSession = {
      conflictId: conflict.id,
      rounds: [],
      currentRound: 0,
      maxRounds: 3,
    };
    this.mediationSessions.set(conflict.id, session);

    // Find a mediator (coordinator or neutral agent)
    const mediatorId = await this.findMediator(conflict.swarmId, conflict.agents);
    conflict.mediatorId = mediatorId;

    // Get positions from involved agents
    const blackboard = sharedBlackboardService.getOrCreate(conflict.swarmId, "conflict");
    const positions = await blackboard.readMany(
      conflict.agents.map(a => `position-${conflict.id}-${a}`),
      mediatorId
    );

    // Simulate mediation rounds
    for (let round = 1; round <= session.maxRounds; round++) {
      session.currentRound = round;
      
      logger.debug(`[ConflictResolution] Mediation round ${round} for ${conflict.id}`);

      // Identify common ground
      const commonPositions = this.findCommonGround(positions);
      
      // Check if consensus emerging
      if (commonPositions.length > 0 && round >= 2) {
        // Resolution achieved
        conflict.status = "resolved";
        conflict.resolvedAt = new Date();
        conflict.resolution = {
          decision: `Consensus through mediation: ${commonPositions.join("; ")}`,
          acceptedBy: conflict.agents,
          rejectedBy: [],
          reasoning: `Mediated by ${mediatorId} over ${round} rounds`,
        };

        await this.publishResolution(conflict);
        return;
      }
    }

    // Mediation exhausted - escalate to arbitration
    conflict.strategy = "arbitration";
    await this.executeArbitration(conflict);
  }

  private findCommonGround(positions: Record<string, any>): string[] {
    const common: string[] = [];
    const allPositions = Object.values(positions).filter(p => p !== undefined);
    
    if (allPositions.length === 0) return common;

    // Find shared key-value pairs
    const firstPosition = allPositions[0];
    for (const [key, value] of Object.entries(firstPosition)) {
      if (allPositions.every(p => p[key] === value)) {
        common.push(`${key}: ${value}`);
      }
    }

    return common;
  }

  // ============================================================================
  // ARBITRATION
  // ============================================================================

  private async executeArbitration(conflict: Conflict): Promise<void> {
    // Find arbiter (designated arbiter or highest-priority agent not in conflict)
    let arbiterId = conflict.mediatorId;
    
    if (!arbiterId) {
      arbiterId = await this.findArbiter(conflict.swarmId, conflict.agents);
    }
    conflict.mediatorId = arbiterId;

    logger.info(`[ConflictResolution] ${conflict.id} arbitrated by ${arbiterId}`);

    // Arbiter makes binding decision
    // In practice, this would involve the arbiter agent actually analyzing the conflict
    const decision = await this.simulateArbiterDecision(conflict, arbiterId);

    conflict.status = "resolved";
    conflict.resolvedAt = new Date();
    conflict.resolution = {
      decision: decision.decision,
      acceptedBy: conflict.agents,  // Arbitration is binding
      rejectedBy: [],
      reasoning: `Binding arbitration by ${arbiterId}: ${decision.reasoning}`,
    };

    await this.publishResolution(conflict);
  }

  private async simulateArbiterDecision(
    conflict: Conflict,
    arbiterId: string
  ): Promise<{ decision: string; reasoning: string }> {
    // Get proposal if available
    if (conflict.proposalId) {
      const proposal = consensusService.getProposal(conflict.proposalId);
      if (proposal) {
        const votes = Array.from(proposal.votes.values());
        const yesCount = votes.filter(v => v.value === "yes").length;
        const noCount = votes.filter(v => v.value === "no").length;

        // Arbiter breaks tie or chooses majority with justification
        if (yesCount > noCount) {
          return {
            decision: "ACCEPT",
            reasoning: `Majority vote (${yesCount} vs ${noCount}) with minor reservations addressed`,
          };
        } else {
          return {
            decision: "REJECT",
            reasoning: `Insufficient support (${yesCount} vs ${noCount}), concerns outweigh benefits`,
          };
        }
      }
    }

    // Generic decision
    return {
      decision: "COMPROMISE",
      reasoning: "Both sides have valid points; blended approach recommended",
    };
  }

  // ============================================================================
  // COMPROMISE
  // ============================================================================

  private async executeCompromise(conflict: Conflict): Promise<void> {
    logger.info(`[ConflictResolution] Seeking compromise for ${conflict.id}`);

    // For approach divergence, merge alternatives
    if (conflict.type === "approach_divergence" && conflict.proposalId) {
      const proposal = consensusService.getProposal(conflict.proposalId);
      if (proposal) {
        // Create merged proposal
        const mergedPayload = await this.mergeApproaches(proposal);
        
        conflict.status = "resolved";
        conflict.resolvedAt = new Date();
        conflict.resolution = {
          decision: "MERGED_APPROACH",
          acceptedBy: conflict.agents,
          rejectedBy: [],
          reasoning: `Compromise solution combining elements from all proposals: ${JSON.stringify(mergedPayload).slice(0, 100)}`,
        };

        await this.publishResolution(conflict);
        return;
      }
    }

    // For resource contention, split or sequence
    if (conflict.type === "resource_contention") {
      conflict.status = "resolved";
      conflict.resolvedAt = new Date();
      conflict.resolution = {
        decision: "SEQUENTIAL_ACCESS",
        acceptedBy: conflict.agents,
        rejectedBy: [],
        reasoning: "Agents will access resource in sequence (priority-based or round-robin)",
      };

      await this.publishResolution(conflict);
      return;
    }

    // Default: escalate
    await this.executeEscalation(conflict, "Could not find viable compromise");
  }

  private async mergeApproaches(proposal: any): Promise<any> {
    // Simplified merge: create object with all unique keys from alternatives
    const merged: any = {};
    
    // In practice, this would analyze the actual proposal payloads
    // and create a sensible combination
    if (proposal.payload) {
      Object.assign(merged, proposal.payload);
    }

    return merged;
  }

  // ============================================================================
  // VOTE OVERRIDE
  // ============================================================================

  private async executeVoteOverride(conflict: Conflict): Promise<void> {
    // When deadlocked, designated leader or coordinator makes final call
    const leader = await this.findCoordinator(conflict.swarmId);
    
    if (!leader) {
      await this.executeEscalation(conflict, "No coordinator available for override");
      return;
    }

    logger.info(`[ConflictResolution] Vote override by ${leader} for ${conflict.id}`);

    conflict.status = "resolved";
    conflict.resolvedAt = new Date();
    conflict.resolution = {
      decision: "LEADER_DECISION",
      acceptedBy: conflict.agents,
      rejectedBy: [],
      reasoning: `Deadlock broken by coordinator ${leader}`,
    };

    await this.publishResolution(conflict);
  }

  // ============================================================================
  // ESCALATION
  // ============================================================================

  private async executeEscalation(conflict: Conflict, reason?: string): Promise<void> {
    conflict.status = "escalated";
    conflict.resolvedAt = new Date();
    conflict.escalationReason = reason || "Automated resolution failed";

    logger.warn(`[ConflictResolution] ${conflict.id} escalated: ${conflict.escalationReason}`);

    await eventStream.publish(
      "swarm.conflict.escalated",
      {
        conflictId: conflict.id,
        swarmId: conflict.swarmId,
        reason: conflict.escalationReason,
        agents: conflict.agents,
      },
      { organizationId: 0, missionId: 0, swarmId: conflict.swarmId },
      "conflict"
    );
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private async findMediator(swarmId: string, excludedAgents: string[]): Promise<string> {
    // Look for coordinator not in conflict
    const coordinators = swarmRoleManager.getAgentsByRole(swarmId, "coordinator")
      .filter(id => !excludedAgents.includes(id));
    
    if (coordinators.length > 0) return coordinators[0];

    // Look for any neutral agent with high priority
    const allAgents = await this.getSwarmAgents(swarmId);
    const neutral = allAgents.find(id => !excludedAgents.includes(id));
    
    return neutral || "system-mediator";
  }

  private async findArbiter(swarmId: string, excludedAgents: string[]): Promise<string> {
    // Look for designated arbiter
    const arbiters = swarmRoleManager.getAgentsByRole(swarmId, "arbiter")
      .filter(id => !excludedAgents.includes(id));
    
    if (arbiters.length > 0) return arbiters[0];

    // Fallback to coordinator
    const coordinator = await this.findCoordinator(swarmId);
    return coordinator || "system-arbiter";
  }

  private async findCoordinator(swarmId: string): Promise<string | undefined> {
    const coordinators = swarmRoleManager.getAgentsByRole(swarmId, "coordinator");
    return coordinators[0];
  }

  private async getSwarmAgents(swarmId: string): Promise<string[]> {
    const composition = swarmRoleManager.getSwarmComposition(swarmId);
    // This is simplified - in practice would fetch from actual agent registry
    return [];
  }

  private async publishResolution(conflict: Conflict): Promise<void> {
    await eventStream.publish(
      "swarm.conflict.resolved",
      {
        conflictId: conflict.id,
        swarmId: conflict.swarmId,
        strategy: conflict.strategy,
        decision: conflict.resolution?.decision,
      },
      { organizationId: 0, missionId: 0, swarmId: conflict.swarmId },
      "conflict"
    );

    // Write to blackboard for swarm awareness
    const blackboard = sharedBlackboardService.getOrCreate(conflict.swarmId, "conflict");
    await blackboard.write(
      `resolution-${conflict.id}`,
      {
        conflict,
        timestamp: new Date(),
      },
      "conflict-resolution-service"
    );
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get active conflicts for a swarm
   */
  getSwarmConflicts(swarmId: string): Conflict[] {
    return Array.from(this.activeConflicts.values())
      .filter(c => c.swarmId === swarmId);
  }

  /**
   * Get conflict by ID
   */
  getConflict(conflictId: string): Conflict | undefined {
    return this.activeConflicts.get(conflictId);
  }

  /**
   * Get resolution statistics for a swarm
   */
  getSwarmStats(swarmId: string): {
    totalConflicts: number;
    resolved: number;
    escalated: number;
    failed: number;
    avgResolutionTimeMs: number;
  } {
    const conflicts = this.getSwarmConflicts(swarmId);
    const resolved = conflicts.filter(c => c.status === "resolved");
    
    const resolutionTimes = resolved
      .filter(c => c.resolvedAt && c.createdAt)
      .map(c => c.resolvedAt!.getTime() - c.createdAt.getTime());

    return {
      totalConflicts: conflicts.length,
      resolved: resolved.length,
      escalated: conflicts.filter(c => c.status === "escalated").length,
      failed: conflicts.filter(c => c.status === "failed").length,
      avgResolutionTimeMs: resolutionTimes.length > 0
        ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
        : 0,
    };
  }

  /**
   * Clean up resolved conflicts
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    
    for (const [id, conflict] of this.activeConflicts) {
      if (conflict.resolvedAt && conflict.resolvedAt.getTime() < cutoff) {
        this.activeConflicts.delete(id);
        this.mediationSessions.delete(id);
      }
    }
  }
}

export const conflictResolutionService = new ConflictResolutionService();
