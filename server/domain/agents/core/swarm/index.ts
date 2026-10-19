/**
 * Multi-Agent Swarming System
 * 
 * Provides decentralized coordination for agent collectives with:
 * - Consensus-based decision making
 * - Specialized agent roles
 * - Shared blackboard memory
 * - Automatic conflict resolution
 * 
 * @example
 * ```typescript
 * import { swarmCoordinator, ConsensusAlgorithm } from "@domain/agents/core/swarm";
 * 
 * // Create a swarm
 * const swarm = await swarmCoordinator.createSwarm({
 *   name: "Code Review Squad",
 *   organizationId: 1,
 *   goal: "Review and improve code quality"
 * });
 * 
 * // Add agents with roles
 * await swarmCoordinator.joinSwarm(swarm.id, "agent-1", { 
 *   role: "critic", 
 *   autoAssignRole: false 
 * });
 * await swarmCoordinator.joinSwarm(swarm.id, "agent-2", { 
 *   autoAssignRole: true 
 * });
 * 
 * // Propose a decision
 * const proposal = await swarmCoordinator.propose(
 *   swarm.id,
 *   "agent-1",
 *   "code_change",
 *   { file: "src/main.ts", change: "refactor" },
 *   { algorithm: "confidence_weighted" }
 * );
 * 
 * // Agents vote
 * await swarmCoordinator.vote(swarm.id, "agent-1", proposal.id, "yes", 0.9);
 * await swarmCoordinator.vote(swarm.id, "agent-2", proposal.id, "yes", 0.8);
 * 
 * // Check result
 * const result = consensusService.getProposal(proposal.id);
 * console.log(result?.status); // "accepted" or "rejected"
 * ```
 */

// Core services
export { 
  consensusService, 
  ConsensusService,
  type Proposal,
  type Vote,
  type ProposalStatus,
  type ConsensusAlgorithm,
  type ConsensusConfig,
} from "./consensus.service.js";

// Swarm coordination
export {
  swarmCoordinator,
  SwarmCoordinatorService,
  type SwarmState,
  type SwarmConfig,
  type TaskAssignment,
} from "./swarm-coordinator.service.js";

// Roles
export {
  swarmRoleManager,
  SwarmRoleManager,
  ROLE_DEFINITIONS,
  type SwarmRole,
  type RoleConfig,
  type RoleCapabilities,
  type AgentRoleAssignment,
} from "./swarm-roles.js";

// Blackboard
export {
  sharedBlackboardService,
  SwarmBlackboard,
  SharedBlackboardService,
  type BlackboardEntry,
  type BlackboardEntryMeta,
  type Permission,
  type BlackboardUpdateHandler,
} from "./shared-blackboard.service.js";

// Conflict resolution
export {
  conflictResolutionService,
  ConflictResolutionService,
  type Conflict,
  type ConflictType,
  type ResolutionStrategy,
} from "./conflict-resolution.service.js";
