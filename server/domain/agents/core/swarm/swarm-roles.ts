/**
 * Swarm Roles & Specialized Agent System
 * 
 * Defines specialized roles for agents in a swarm with specific responsibilities,
 * capabilities, and behavioral patterns. Each role has a unique contribution
 * to the collective swarm intelligence.
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SwarmRoles");

// ============================================================================
// ROLE DEFINITIONS
// ============================================================================

export type SwarmRole = 
  | "coordinator"    // Orchestrates swarm activities, manages consensus
  | "strategist"     // Long-term planning, goal decomposition
  | "executor"       // Carries out actions, tool usage
  | "critic"         // Quality assurance, identifies issues
  | "researcher"     // Information gathering, fact checking
  | "innovator"      // Creative problem solving, novel approaches
  | "communicator"   // Interfaces with humans, clarifies requirements
  | "monitor"        // Tracks progress, detects anomalies
  | "arbiter";       // Conflict resolution, tie-breaking

export interface RoleCapabilities {
  canPropose: boolean;
  canVote: boolean;
  canExecute: boolean;
  canCritique: boolean;
  canEscalate: boolean;
  priorityWeight: number;  // Higher = more influential in conflicts
}

export interface RoleConfig {
  role: SwarmRole;
  name: string;
  description: string;
  capabilities: RoleCapabilities;
  specializationPrompt: string;  // Added to agent system prompt
  typicalTools: string[];        // Tools this role typically uses
  votingStrategy: "cautious" | "moderate" | "optimistic";
  maxActiveProposals: number;   // How many proposals this role can have open
}

// Role definitions with capabilities
export const ROLE_DEFINITIONS: Record<SwarmRole, RoleConfig> = {
  coordinator: {
    role: "coordinator",
    name: "Swarm Coordinator",
    description: "Manages swarm coordination, facilitates consensus, and ensures smooth collaboration",
    capabilities: {
      canPropose: true,
      canVote: true,
      canExecute: false,
      canCritique: true,
      canEscalate: true,
      priorityWeight: 1.2,
    },
    specializationPrompt: `You are the Swarm Coordinator. Your role is to:
- Facilitate consensus and resolve conflicts between agents
- Monitor swarm health and intervene when coordination breaks down
- Propose high-level coordination strategies
- Ensure all agents have clear direction and aren't duplicating work
- Escalate to human when swarm reaches deadlock`,
    typicalTools: ["consensus", "broadcast", "status_check"],
    votingStrategy: "moderate",
    maxActiveProposals: 5,
  },

  strategist: {
    role: "strategist",
    name: "Strategic Planner",
    description: "Decomposes complex goals into actionable plans and coordinates long-term strategy",
    capabilities: {
      canPropose: true,
      canVote: true,
      canExecute: false,
      canCritique: true,
      canEscalate: false,
      priorityWeight: 1.1,
    },
    specializationPrompt: `You are the Strategic Planner. Your role is to:
- Break down complex goals into manageable sub-goals
- Identify dependencies and critical paths
- Propose execution strategies that optimize for success
- Anticipate risks and propose mitigation plans
- Focus on the "big picture" while respecting ground-level constraints`,
    typicalTools: ["planning", "dependency_analysis", "risk_assessment"],
    votingStrategy: "cautious",
    maxActiveProposals: 3,
  },

  executor: {
    role: "executor",
    name: "Task Executor",
    description: "Carries out concrete actions, uses tools, and produces deliverables",
    capabilities: {
      canPropose: true,
      canVote: true,
      canExecute: true,
      canCritique: false,
      canEscalate: true,
      priorityWeight: 1.0,
    },
    specializationPrompt: `You are a Task Executor. Your role is to:
- Execute approved plans using available tools
- Report progress and results clearly
- Ask for clarification when requirements are ambiguous
- Flag blockers immediately when encountered
- Focus on reliable, efficient execution`,
    typicalTools: ["code_execution", "file_ops", "api_calls", "database", "search"],
    votingStrategy: "optimistic",
    maxActiveProposals: 10,
  },

  critic: {
    role: "critic",
    name: "Quality Critic",
    description: "Reviews work for quality, correctness, and alignment with goals",
    capabilities: {
      canPropose: false,
      canVote: true,
      canExecute: false,
      canCritique: true,
      canEscalate: true,
      priorityWeight: 1.15,
    },
    specializationPrompt: `You are a Quality Critic. Your role is to:
- Review proposals and outputs for correctness and quality
- Identify logical flaws, inconsistencies, and risks
- Ask challenging questions to stress-test plans
- Provide constructive feedback with specific improvement suggestions
- Protect the swarm from groupthink and premature consensus`,
    typicalTools: ["review", "test", "validate", "check"],
    votingStrategy: "cautious",
    maxActiveProposals: 2,
  },

  researcher: {
    role: "researcher",
    name: "Information Researcher",
    description: "Gathers information, verifies facts, and provides knowledge",
    capabilities: {
      canPropose: true,
      canVote: true,
      canExecute: true,
      canCritique: false,
      canEscalate: false,
      priorityWeight: 1.0,
    },
    specializationPrompt: `You are an Information Researcher. Your role is to:
- Gather relevant information to inform swarm decisions
- Verify claims and cross-reference sources
- Identify knowledge gaps that need filling
- Provide factual context for proposals
- Cite sources and acknowledge uncertainty`,
    typicalTools: ["search", "retrieve", "verify", "browse"],
    votingStrategy: "moderate",
    maxActiveProposals: 4,
  },

  innovator: {
    role: "innovator",
    name: "Creative Innovator",
    description: "Brings novel solutions, challenges assumptions, and finds creative approaches",
    capabilities: {
      canPropose: true,
      canVote: true,
      canExecute: false,
      canCritique: true,
      canEscalate: false,
      priorityWeight: 0.9,
    },
    specializationPrompt: `You are a Creative Innovator. Your role is to:
- Propose novel approaches to problems
- Challenge assumptions and status quo
- Connect seemingly unrelated ideas
- Suggest "out of the box" solutions when stuck
- Balance creativity with feasibility`,
    typicalTools: ["brainstorm", "ideate", "explore", "combine"],
    votingStrategy: "optimistic",
    maxActiveProposals: 5,
  },

  communicator: {
    role: "communicator",
    name: "Human Communicator",
    description: "Interfaces with humans, clarifies requirements, and reports results",
    capabilities: {
      canPropose: true,
      canVote: true,
      canExecute: false,
      canCritique: true,
      canEscalate: true,
      priorityWeight: 1.0,
    },
    specializationPrompt: `You are the Human Communicator. Your role is to:
- Clarify ambiguous requirements with stakeholders
- Translate technical details to human-friendly language
- Report swarm progress and results comprehensibly
- Escalate human decisions when needed
- Ensure swarm stays aligned with human intent`,
    typicalTools: ["chat", "report", "summarize", "clarify"],
    votingStrategy: "moderate",
    maxActiveProposals: 3,
  },

  monitor: {
    role: "monitor",
    name: "Progress Monitor",
    description: "Tracks execution progress, detects anomalies, and raises alerts",
    capabilities: {
      canPropose: true,
      canVote: true,
      canExecute: false,
      canCritique: true,
      canEscalate: true,
      priorityWeight: 1.05,
    },
    specializationPrompt: `You are the Progress Monitor. Your role is to:
- Track execution progress against plans
- Detect anomalies, deviations, and potential failures
- Propose course corrections when off-track
- Monitor swarm health and resource usage
- Alert when attention is needed`,
    typicalTools: ["monitor", "track", "alert", "measure"],
    votingStrategy: "cautious",
    maxActiveProposals: 3,
  },

  arbiter: {
    role: "arbiter",
    name: "Conflict Arbiter",
    description: "Resolves conflicts and breaks ties when consensus fails",
    capabilities: {
      canPropose: false,
      canVote: true,
      canExecute: false,
      canCritique: true,
      canEscalate: true,
      priorityWeight: 1.25,
    },
    specializationPrompt: `You are the Conflict Arbiter. Your role is to:
- Break ties when swarm reaches deadlock
- Propose fair compromises in disputes
- Ensure minority voices are heard and considered
- Make binding decisions when consensus is impossible
- Escalate to human for high-stakes conflicts`,
    typicalTools: ["mediate", "decide", "compromise", "escalate"],
    votingStrategy: "cautious",
    maxActiveProposals: 1,
  },
};

// ============================================================================
// AGENT ROLE ASSIGNMENT
// ============================================================================

export interface AgentRoleAssignment {
  agentId: string;
  role: SwarmRole;
  assignedAt: Date;
  confidence: number;      // How well this agent performs this role
  performance: {
    successfulProposals: number;
    acceptedProposals: number;
    correctVotes: number;
    totalVotes: number;
    successfulExecutions: number;
    failedExecutions: number;
  };
}

export class SwarmRoleManager {
  private assignments: Map<string, AgentRoleAssignment> = new Map();
  private swarmRoles: Map<string, Map<string, SwarmRole>> = new Map(); // swarmId -> agentId -> role

  /**
   * Assign a role to an agent in a swarm
   */
  assignRole(
    swarmId: string,
    agentId: string,
    role: SwarmRole,
    initialConfidence: number = 0.5
  ): AgentRoleAssignment {
    const assignment: AgentRoleAssignment = {
      agentId,
      role,
      assignedAt: new Date(),
      confidence: initialConfidence,
      performance: {
        successfulProposals: 0,
        acceptedProposals: 0,
        correctVotes: 0,
        totalVotes: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
      },
    };

    // Store in both indexes
    this.assignments.set(agentId, assignment);
    
    if (!this.swarmRoles.has(swarmId)) {
      this.swarmRoles.set(swarmId, new Map());
    }
    this.swarmRoles.get(swarmId)!.set(agentId, role);

    logger.info(`[SwarmRoles] Assigned ${role} to ${agentId} in swarm ${swarmId}`);

    return assignment;
  }

  /**
   * Get an agent's role assignment
   */
  getAssignment(agentId: string): AgentRoleAssignment | undefined {
    return this.assignments.get(agentId);
  }

  /**
   * Get an agent's role in a specific swarm
   */
  getRole(swarmId: string, agentId: string): SwarmRole | undefined {
    return this.swarmRoles.get(swarmId)?.get(agentId);
  }

  /**
   * Get all agents with a specific role in a swarm
   */
  getAgentsByRole(swarmId: string, role: SwarmRole): string[] {
    const swarm = this.swarmRoles.get(swarmId);
    if (!swarm) return [];

    return Array.from(swarm.entries())
      .filter(([_, r]) => r === role)
      .map(([agentId, _]) => agentId);
  }

  /**
   * Get role configuration
   */
  getRoleConfig(role: SwarmRole): RoleConfig {
    return ROLE_DEFINITIONS[role];
  }

  /**
   * Update performance metrics for an agent
   */
  recordPerformance(
    agentId: string,
    metric: keyof AgentRoleAssignment["performance"],
    success: boolean
  ): void {
    const assignment = this.assignments.get(agentId);
    if (!assignment) return;

    assignment.performance[metric]++;

    // Update confidence based on recent performance
    if (metric === "acceptedProposals" || metric === "correctVotes") {
      this.updateConfidence(agentId);
    }
  }

  /**
   * Calculate agent's role confidence score
   */
  private updateConfidence(agentId: string): void {
    const assignment = this.assignments.get(agentId);
    if (!assignment) return;

    const { 
      acceptedProposals, 
      successfulProposals,
      correctVotes, 
      totalVotes,
      successfulExecutions,
      failedExecutions,
    } = assignment.performance;

    // Weighted confidence calculation
    let confidence = 0.5; // Base

    // Proposal success rate (30%)
    if (successfulProposals > 0) {
      confidence += 0.3 * (acceptedProposals / successfulProposals);
    }

    // Voting accuracy (30%)
    if (totalVotes > 0) {
      confidence += 0.3 * (correctVotes / totalVotes);
    }

    // Execution success (40%)
    const totalExecutions = successfulExecutions + failedExecutions;
    if (totalExecutions > 0) {
      confidence += 0.4 * (successfulExecutions / totalExecutions);
    }

    assignment.confidence = Math.min(1.0, confidence);
  }

  /**
   * Recommend the best role for an agent based on their performance history
   */
  recommendRole(agentId: string): { role: SwarmRole; confidence: number } | null {
    const assignment = this.assignments.get(agentId);
    if (!assignment) return null;

    // Currently only returns current role with confidence
    // In future, could analyze which role type the agent performs best in
    return {
      role: assignment.role,
      confidence: assignment.confidence,
    };
  }

  /**
   * Get swarm composition
   */
  getSwarmComposition(swarmId: string): {
    totalAgents: number;
    roleDistribution: Record<SwarmRole, number>;
    avgConfidence: number;
  } {
    const swarm = this.swarmRoles.get(swarmId);
    if (!swarm) {
      return { totalAgents: 0, roleDistribution: {} as any, avgConfidence: 0 };
    }

    const distribution: Partial<Record<SwarmRole, number>> = {};
    let totalConfidence = 0;
    let count = 0;

    for (const [agentId, role] of swarm.entries()) {
      distribution[role] = (distribution[role] || 0) + 1;
      
      const assignment = this.assignments.get(agentId);
      if (assignment) {
        totalConfidence += assignment.confidence;
        count++;
      }
    }

    return {
      totalAgents: swarm.size,
      roleDistribution: distribution as Record<SwarmRole, number>,
      avgConfidence: count > 0 ? totalConfidence / count : 0,
    };
  }

  /**
   * Check if swarm has healthy role distribution
   */
  checkSwarmHealth(swarmId: string): {
    healthy: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const composition = this.getSwarmComposition(swarmId);
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for minimum viable swarm
    if (composition.totalAgents < 3) {
      issues.push("Swarm too small for robust consensus");
      recommendations.push("Add at least 2 more agents");
    }

    // Check role distribution
    const hasCoordinator = (composition.roleDistribution.coordinator || 0) > 0;
    const hasCritic = (composition.roleDistribution.critic || 0) > 0;
    const hasExecutor = (composition.roleDistribution.executor || 0) > 0;

    if (!hasCoordinator) {
      issues.push("No coordinator assigned - swarm may lack direction");
      recommendations.push("Assign a coordinator agent");
    }

    if (!hasCritic) {
      issues.push("No critic assigned - swarm may have quality blind spots");
      recommendations.push("Assign a critic agent");
    }

    if (!hasExecutor) {
      issues.push("No executor assigned - swarm cannot carry out actions");
      recommendations.push("Assign at least one executor agent");
    }

    // Check for role concentration
    for (const [role, count] of Object.entries(composition.roleDistribution)) {
      if (count > composition.totalAgents * 0.6) {
        issues.push(`Too many ${role}s - swarm lacks diversity`);
        recommendations.push(`Add agents with different roles`);
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
      recommendations,
    };
  }

  /**
   * Get agent capabilities based on role
   */
  getCapabilities(agentId: string): RoleCapabilities | null {
    const assignment = this.assignments.get(agentId);
    if (!assignment) return null;

    return ROLE_DEFINITIONS[assignment.role].capabilities;
  }

  /**
   * Check if agent has a specific capability
   */
  hasCapability(agentId: string, capability: keyof RoleCapabilities): boolean {
    const caps = this.getCapabilities(agentId);
    if (!caps) return false;
    return caps[capability] as boolean;
  }

  /**
   * Get the priority weight for conflict resolution
   */
  getPriorityWeight(agentId: string): number {
    const caps = this.getCapabilities(agentId);
    return caps?.priorityWeight || 1.0;
  }

  /**
   * Suggest optimal role assignments for a new swarm
   */
  suggestOptimalRoles(agentIds: string[]): Array<{ agentId: string; role: SwarmRole; reason: string }> {
    const suggestions: Array<{ agentId: string; role: SwarmRole; reason: string }> = [];
    
    // First agent is coordinator
    if (agentIds.length > 0) {
      suggestions.push({
        agentId: agentIds[0],
        role: "coordinator",
        reason: "First agent typically takes coordination role",
      });
    }

    // Second agent is strategist
    if (agentIds.length > 1) {
      suggestions.push({
        agentId: agentIds[1],
        role: "strategist",
        reason: "Strategic planning complements coordination",
      });
    }

    // Assign critics and executors alternately
    for (let i = 2; i < agentIds.length; i++) {
      if (i % 2 === 0) {
        suggestions.push({
          agentId: agentIds[i],
          role: "executor",
          reason: "Balanced execution capacity",
        });
      } else {
        suggestions.push({
          agentId: agentIds[i],
          role: "critic",
          reason: "Quality assurance for executors",
        });
      }
    }

    // Add specialist roles if swarm is large enough
    if (agentIds.length >= 5) {
      suggestions.push({
        agentId: agentIds[4],
        role: "researcher",
        reason: "Information gathering for larger swarms",
      });
    }

    if (agentIds.length >= 6) {
      suggestions.push({
        agentId: agentIds[5],
        role: "monitor",
        reason: "Progress tracking for complex operations",
      });
    }

    return suggestions;
  }
}

export const swarmRoleManager = new SwarmRoleManager();
