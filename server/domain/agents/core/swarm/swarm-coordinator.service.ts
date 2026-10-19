/**
 * Swarm Coordinator Service
 * 
 * Central orchestration for multi-agent swarms. Manages swarm lifecycle,
 * coordinates agent roles, facilitates consensus, and resolves conflicts.
 * 
 * This is the high-level API for swarm management - the "mission control"
 * for decentralized agent collectives.
 */

import { createLogger } from "@server/utils/logger.js";
import { swarmCommunicationService } from "../swarm-communication.service.js";
import { consensusService, Proposal, ConsensusAlgorithm } from "./consensus.service.js";
import { swarmRoleManager, SwarmRole, ROLE_DEFINITIONS } from "./swarm-roles.js";
import { sharedBlackboardService, SwarmBlackboard } from "./shared-blackboard.service.js";
import { conflictResolutionService, Conflict } from "./conflict-resolution.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("SwarmCoordinator");

// Swarm state
export interface SwarmState {
  id: string;
  name: string;
  organizationId: number;
  missionId?: number;
  
  // Agents
  agents: Array<{
    id: string;
    role: SwarmRole;
    status: "active" | "idle" | "busy" | "offline";
    joinedAt: Date;
    lastHeartbeat: Date;
  }>;
  
  // State
  status: "forming" | "active" | "paused" | "dissolving" | "dissolved";
  goal?: string;
  
  // Coordination
  activeProposals: string[];
  activeConflicts: string[];
  
  // Metrics
  metrics: {
    totalProposals: number;
    acceptedProposals: number;
    resolvedConflicts: number;
    escalatedConflicts: number;
    avgConsensusTimeMs: number;
  };
  
  // Timing
  createdAt: Date;
  lastActivityAt: Date;
  dissolvedAt?: Date;
}

// Swarm configuration
export interface SwarmConfig {
  name: string;
  organizationId: number;
  missionId?: number;
  goal?: string;
  defaultConsensusAlgorithm?: ConsensusAlgorithm;
  minAgents?: number;
  maxAgents?: number;
  autoAssignRoles?: boolean;
}

// Agent task assignment
export interface TaskAssignment {
  taskId: string;
  description: string;
  assignedTo: string;
  priority: number;
  dependencies: string[];
  status: "pending" | "in_progress" | "completed" | "blocked";
  proposedAt: Date;
  deadline?: Date;
}

/**
 * High-level swarm coordination service
 */
export class SwarmCoordinatorService {
  private swarms: Map<string, SwarmState> = new Map();
  private taskAssignments: Map<string, TaskAssignment> = new Map();

  // ============================================================================
  // SWARM LIFECYCLE
  // ============================================================================

  /**
   * Create a new swarm
   */
  async createSwarm(config: SwarmConfig): Promise<SwarmState> {
    const swarmId = uuidv4();
    
    const swarm: SwarmState = {
      id: swarmId,
      name: config.name,
      organizationId: config.organizationId,
      missionId: config.missionId,
      agents: [],
      status: "forming",
      goal: config.goal,
      activeProposals: [],
      activeConflicts: [],
      metrics: {
        totalProposals: 0,
        acceptedProposals: 0,
        resolvedConflicts: 0,
        escalatedConflicts: 0,
        avgConsensusTimeMs: 0,
      },
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.swarms.set(swarmId, swarm);

    // Initialize blackboard
    const blackboard = sharedBlackboardService.getOrCreate(swarmId, "coordination");
    await blackboard.write("config", config, "swarm-coordinator");
    await blackboard.write("state", swarm, "swarm-coordinator");

    logger.info(`[SwarmCoordinator] Created swarm ${swarmId}: ${config.name}`);

    await eventStream.publish(
      "swarm.created",
      {
        swarmId,
        name: config.name,
        organizationId: config.organizationId,
        missionId: config.missionId,
      },
      { organizationId: config.organizationId, missionId: config.missionId, swarmId },
      "swarm"
    );

    return swarm;
  }

  /**
   * Add an agent to a swarm
   */
  async joinSwarm(
    swarmId: string,
    agentId: string,
    options?: {
      role?: SwarmRole;
      autoAssignRole?: boolean;
    }
  ): Promise<SwarmState> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm ${swarmId} not found`);
    if (swarm.status === "dissolved") throw new Error(`Swarm ${swarmId} is dissolved`);

    // Determine role
    let role = options?.role;
    if (!role && options?.autoAssignRole !== false) {
      const suggestions = swarmRoleManager.suggestOptimalRoles(
        [...swarm.agents.map(a => a.id), agentId]
      );
      const suggestion = suggestions.find(s => s.agentId === agentId);
      role = suggestion?.role || "executor";
    }
    role = role || "executor";

    // Assign role
    swarmRoleManager.assignRole(swarmId, agentId, role);

    // Add to swarm
    const now = new Date();
    swarm.agents.push({
      id: agentId,
      role,
      status: "active",
      joinedAt: now,
      lastHeartbeat: now,
    });

    // Update status if now viable
    if (swarm.status === "forming" && swarm.agents.length >= 3) {
      swarm.status = "active";
    }

    // Register with communication service
    await swarmCommunicationService.heartbeat(swarmId, agentId);

    // Grant blackboard access
    const blackboard = sharedBlackboardService.getOrCreate(swarmId, "shared");
    blackboard.grantAccess(agentId, ["read", "write"], "swarm-coordinator");

    logger.info(`[SwarmCoordinator] Agent ${agentId} joined swarm ${swarmId} as ${role}`);

    await eventStream.publish(
      "swarm.agent_joined",
      {
        swarmId,
        agentId,
        role,
        totalAgents: swarm.agents.length,
      },
      { organizationId: swarm.organizationId, missionId: swarm.missionId, swarmId },
      "swarm"
    );

    return swarm;
  }

  /**
   * Remove an agent from a swarm
   */
  async leaveSwarm(swarmId: string, agentId: string): Promise<SwarmState> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm ${swarmId} not found`);

    const idx = swarm.agents.findIndex(a => a.id === agentId);
    if (idx === -1) throw new Error(`Agent ${agentId} not in swarm ${swarmId}`);

    swarm.agents.splice(idx, 1);

    // Revoke blackboard access
    const blackboard = sharedBlackboardService.getOrCreate(swarmId, "shared");
    blackboard.revokeAccess(agentId, "swarm-coordinator");

    logger.info(`[SwarmCoordinator] Agent ${agentId} left swarm ${swarmId}`);

    await eventStream.publish(
      "swarm.agent_left",
      {
        swarmId,
        agentId,
        remainingAgents: swarm.agents.length,
      },
      { organizationId: swarm.organizationId, missionId: swarm.missionId, swarmId },
      "swarm"
    );

    return swarm;
  }

  /**
   * Dissolve a swarm
   */
  async dissolveSwarm(swarmId: string, reason?: string): Promise<void> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return;

    swarm.status = "dissolved";
    swarm.dissolvedAt = new Date();

    // Cleanup
    sharedBlackboardService.remove(swarmId, "coordination");
    sharedBlackboardService.remove(swarmId, "shared");
    sharedBlackboardService.remove(swarmId, "conflict");

    logger.info(`[SwarmCoordinator] Dissolved swarm ${swarmId}: ${reason || "no reason given"}`);

    await eventStream.publish(
      "swarm.dissolved",
      {
        swarmId,
        reason,
        lifetimeMs: Date.now() - swarm.createdAt.getTime(),
      },
      { organizationId: swarm.organizationId, missionId: swarm.missionId, swarmId },
      "swarm"
    );
  }

  // ============================================================================
  // COORDINATION API
  // ============================================================================

  /**
   * Propose a collective decision to the swarm
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
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm ${swarmId} not found`);

    // Check if proposer has capability
    const caps = swarmRoleManager.getCapabilities(proposerId);
    if (!caps?.canPropose) {
      throw new Error(`Agent ${proposerId} cannot propose`);
    }

    const proposal = await consensusService.propose(
      swarmId,
      proposerId,
      type,
      payload,
      options
    );

    swarm.activeProposals.push(proposal.id);
    swarm.metrics.totalProposals++;

    // Set up automatic conflict detection on dispute
    consensusService.onProposalResolved(proposal.id, (resolved) => {
      if (resolved.status === "disputed") {
        const conflict = conflictResolutionService.detectFromProposal(resolved);
        if (conflict) {
          swarm.activeConflicts.push(conflict.id);
          conflictResolutionService.resolve(conflict.id).catch(() => {});
        }
      }
      
      // Update metrics
      if (resolved.status === "accepted") {
        swarm.metrics.acceptedProposals++;
      }
      if (resolved.resolvedAt && resolved.createdAt) {
        const timeMs = resolved.resolvedAt.getTime() - resolved.createdAt.getTime();
        swarm.metrics.avgConsensusTimeMs = 
          (swarm.metrics.avgConsensusTimeMs * (swarm.metrics.totalProposals - 1) + timeMs) 
          / swarm.metrics.totalProposals;
      }
      
      // Remove from active
      swarm.activeProposals = swarm.activeProposals.filter(id => id !== proposal.id);
    });

    return proposal;
  }

  /**
   * Vote on a proposal
   */
  async vote(
    swarmId: string,
    agentId: string,
    proposalId: string,
    value: "yes" | "no" | "abstain",
    confidence?: number,
    reasoning?: string
  ): Promise<void> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm ${swarmId} not found`);

    const caps = swarmRoleManager.getCapabilities(agentId);
    if (!caps?.canVote) {
      throw new Error(`Agent ${agentId} cannot vote`);
    }

    // Adjust vote based on role confidence
    const assignment = swarmRoleManager.getAssignment(agentId);
    const weightedConfidence = confidence || assignment?.confidence || 0.5;

    await consensusService.vote(proposalId, agentId, value, weightedConfidence, reasoning);

    // Record performance
    swarmRoleManager.recordPerformance(agentId, "totalVotes", true);
  }

  /**
   * Execute an accepted proposal
   */
  async execute(
    swarmId: string,
    agentId: string,
    proposalId: string
  ): Promise<{ success: boolean; result?: any }> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm ${swarmId} not found`);

    const caps = swarmRoleManager.getCapabilities(agentId);
    if (!caps?.canExecute) {
      throw new Error(`Agent ${agentId} cannot execute`);
    }

    const proposal = consensusService.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status !== "accepted") {
      throw new Error(`Proposal ${proposalId} not accepted (status: ${proposal.status})`);
    }

    // Mark agent as busy
    const agent = swarm.agents.find(a => a.id === agentId);
    if (agent) agent.status = "busy";

    try {
      // Execution would happen here - for now simulate
      logger.info(`[SwarmCoordinator] Agent ${agentId} executing proposal ${proposalId}`);

      // Record success
      swarmRoleManager.recordPerformance(agentId, "successfulExecutions", true);
      if (agent) agent.status = "active";

      return { success: true, result: { executed: true, proposalId } };
    } catch (err: any) {
      // Record failure
      swarmRoleManager.recordPerformance(agentId, "failedExecutions", true);
      if (agent) agent.status = "active";

      return { success: false, result: { error: err.message } };
    }
  }

  /**
   * Write to shared blackboard
   */
  async writeToBlackboard(
    swarmId: string,
    agentId: string,
    key: string,
    value: any
  ): Promise<{ version: number }> {
    const blackboard = sharedBlackboardService.getOrCreate(swarmId, "shared");
    const result = await blackboard.write(key, value, agentId);
    return { version: result.version };
  }

  /**
   * Read from shared blackboard
   */
  async readFromBlackboard(swarmId: string, agentId: string, key: string): Promise<any> {
    const blackboard = sharedBlackboardService.getOrCreate(swarmId, "shared");
    return blackboard.read(key, agentId);
  }

  // ============================================================================
  // QUERY API
  // ============================================================================

  /**
   * Get swarm state
   */
  getSwarm(swarmId: string): SwarmState | undefined {
    return this.swarms.get(swarmId);
  }

  /**
   * List all swarms
   */
  listSwarms(organizationId?: number): SwarmState[] {
    const swarms = Array.from(this.swarms.values());
    if (organizationId) {
      return swarms.filter(s => s.organizationId === organizationId);
    }
    return swarms;
  }

  /**
   * Get swarm health
   */
  getSwarmHealth(swarmId: string): {
    healthy: boolean;
    issues: string[];
    recommendations: string[];
    roleHealth: ReturnType<typeof swarmRoleManager.checkSwarmHealth>;
  } {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) {
      return {
        healthy: false,
        issues: ["Swarm not found"],
        recommendations: [],
        roleHealth: { healthy: false, issues: [], recommendations: [] },
      };
    }

    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check swarm size
    if (swarm.agents.length < 3) {
      issues.push("Swarm has fewer than 3 agents");
      recommendations.push("Add more agents for robust consensus");
    }

    // Check active agents
    const activeAgents = swarm.agents.filter(a => a.status === "active").length;
    if (activeAgents < swarm.agents.length / 2) {
      issues.push("Less than 50% of agents are active");
      recommendations.push("Check for failed agents or network issues");
    }

    // Check for stale proposals
    if (swarm.activeProposals.length > 10) {
      issues.push("Too many active proposals - potential coordination bottleneck");
      recommendations.push("Consider batching or prioritizing proposals");
    }

    // Check role distribution
    const roleHealth = swarmRoleManager.checkSwarmHealth(swarmId);

    return {
      healthy: issues.length === 0 && roleHealth.healthy,
      issues: [...issues, ...roleHealth.issues],
      recommendations: [...recommendations, ...roleHealth.recommendations],
      roleHealth,
    };
  }

  /**
   * Get swarm metrics
   */
  getSwarmMetrics(swarmId: string): {
    consensus: ReturnType<typeof consensusService.getSwarmStats>;
    conflicts: ReturnType<typeof conflictResolutionService.getSwarmStats>;
    composition: ReturnType<typeof swarmRoleManager.getSwarmComposition>;
    blackboards: Array<{ namespace: string; stats: any }>;
  } | undefined {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return undefined;

    return {
      consensus: consensusService.getSwarmStats(swarmId),
      conflicts: conflictResolutionService.getSwarmStats(swarmId),
      composition: swarmRoleManager.getSwarmComposition(swarmId),
      blackboards: sharedBlackboardService.list(swarmId),
    };
  }

  /**
   * Get active conflicts
   */
  getActiveConflicts(swarmId: string): Conflict[] {
    return conflictResolutionService.getSwarmConflicts(swarmId);
  }

  /**
   * Get blackboard for a swarm
   */
  getBlackboard(swarmId: string, namespace: string = "shared"): SwarmBlackboard {
    return sharedBlackboardService.getOrCreate(swarmId, namespace);
  }

  // ============================================================================
  // MAINTENANCE
  // ============================================================================

  /**
   * Cleanup old data
   */
  cleanup(): void {
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
    const cutoff = Date.now() - maxAgeMs;

    // Remove dissolved swarms
    for (const [id, swarm] of this.swarms) {
      if (swarm.status === "dissolved" && swarm.dissolvedAt && swarm.dissolvedAt.getTime() < cutoff) {
        this.swarms.delete(id);
      }
    }

    // Cleanup services
    consensusService.cleanup(maxAgeMs);
    conflictResolutionService.cleanup(maxAgeMs);
  }

  /**
   * Perform heartbeat for an agent
   */
  async heartbeat(swarmId: string, agentId: string): Promise<void> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return;

    const agent = swarm.agents.find(a => a.id === agentId);
    if (agent) {
      agent.lastHeartbeat = new Date();
    }

    await swarmCommunicationService.heartbeat(swarmId, agentId);
  }
}

export const swarmCoordinator = new SwarmCoordinatorService();
