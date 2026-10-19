/**
 * Multi-Agent Orchestration Module
 * 
 * Central hub for coordinating multiple AI agents in collaborative missions.
 * Provides mesh topology, team management, conflict resolution, and federation.
 */

export { AgentMeshService, meshService } from './mesh.service.js';
export { AgentTeamService, teamService } from './team.service.js';
export { ConflictResolutionService, conflictResolutionService } from './conflict-resolution.service.js';
export { AgentFederationService, federationService } from './federation.service.js';
export { MultiAgentOrchestrator, multiAgentOrchestrator } from './orchestrator.service.js';
