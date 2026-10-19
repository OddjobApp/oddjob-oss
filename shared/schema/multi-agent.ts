/**
 * Multi-Agent Orchestration Schema
 * 
 * Types and validation for agent mesh, teams, coordination, and federation.
 */

import { z } from 'zod';

/**
 * Agent Mesh Node - Represents an agent in the mesh topology
 */
export const AgentMeshNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['orchestrator', 'worker', 'specialist', 'coordinator']),
  capabilities: z.array(z.string()),
  endpoint: z.string().optional(),
  health: z.enum(['healthy', 'degraded', 'unhealthy', 'offline']).default('healthy'),
  load: z.number().min(0).max(100).default(0),
  lastHeartbeat: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

/**
 * Agent Mesh Edge - Communication channel between agents
 */
export const AgentMeshEdgeSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  protocol: z.enum(['http', 'grpc', 'websocket', 'sse', 'internal']).default('internal'),
  bidirectional: z.boolean().default(false),
  latency: z.number().optional(),
  capacity: z.number().optional(),
  active: z.boolean().default(true)
});

/**
 * Agent Mesh Topology
 */
export const AgentMeshSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(AgentMeshNodeSchema),
  edges: z.array(AgentMeshEdgeSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

/**
 * Agent Team - Hierarchical team structure
 */
export const AgentTeamMemberSchema = z.object({
  agentId: z.string(),
  role: z.enum(['lead', 'specialist', 'support', 'coordinator']),
  priority: z.number().min(1).max(10).default(5),
  responsibilities: z.array(z.string()),
  canDelegate: z.boolean().default(false),
  escalationTarget: z.string().optional()
});

export const AgentTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  missionId: z.string().optional(),
  members: z.array(AgentTeamMemberSchema),
  hierarchy: z.object({
    levels: z.number().min(1).max(10),
    maxSpanOfControl: z.number().min(1).max(50).default(10),
    reportingStructure: z.array(z.object({
      agentId: z.string(),
      reportsTo: z.string().optional()
    }))
  }),
  createdAt: z.string(),
  active: z.boolean().default(true)
});

/**
 * Coordination Task - Unit of work distributed to agents
 */
export const CoordinationTaskSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  parentId: z.string().optional(),
  type: z.enum(['analysis', 'synthesis', 'execution', 'decision', 'monitoring', 'coordination']),
  description: z.string(),
  input: z.record(z.any()),
  assignedTo: z.array(z.string()), // Agent IDs
  dependencies: z.array(z.string()).optional(), // Task IDs
  status: z.enum(['pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled']).default('pending'),
  priority: z.enum(['critical', 'high', 'normal', 'low']).default('normal'),
  result: z.record(z.any()).optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  deadline: z.string().optional()
});

/**
 * Coordination Protocol - How agents coordinate
 */
export const CoordinationProtocolSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['blackboard', 'contract_net', 'auction', 'consensus', 'hierarchical', 'swarm']),
  config: z.record(z.any()),
  active: z.boolean().default(true)
});

/**
 * Conflict Record - Tracked conflicts between agents
 */
export const ConflictRecordSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  type: z.enum(['resource', 'goal', 'plan', 'belief', 'authority']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  involvedAgents: z.array(z.string()),
  description: z.string(),
  status: z.enum(['detected', 'analyzing', 'resolving', 'resolved', 'escalated']).default('detected'),
  detectedAt: z.string(),
  resolvedAt: z.string().optional(),
  resolution: z.object({
    strategy: z.enum(['negotiation', 'mediation', 'arbitration', 'voting', 'override', 'merger']),
    winner: z.string().optional(),
    outcome: z.string(),
    appliedBy: z.string()
  }).optional()
});

/**
 * Resolution Strategy
 */
export const ResolutionStrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['negotiation', 'mediation', 'arbitration', 'voting', 'override', 'merger']),
  priority: z.number().min(1).max(10),
  applicableTo: z.array(z.enum(['resource', 'goal', 'plan', 'belief', 'authority'])),
  config: z.record(z.any()).optional()
});

/**
 * Federated Agent - Agent from another organization
 */
export const FederatedAgentSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  name: z.string(),
  capabilities: z.array(z.string()),
  trustScore: z.number().min(0).max(100),
  federationAgreement: z.object({
    agreementId: z.string(),
    dataSharing: z.enum(['none', 'minimal', 'full']),
    resourceSharing: z.enum(['none', 'compute', 'data', 'full']),
    privacyLevel: z.enum(['public', 'internal', 'confidential', 'restricted']),
    validUntil: z.string()
  }),
  endpoint: z.string(),
  status: z.enum(['active', 'suspended', 'terminated']).default('active')
});

/**
 * Federation Agreement
 */
export const FederationAgreementSchema = z.object({
  id: z.string(),
  organizationA: z.string(),
  organizationB: z.string(),
  purpose: z.string(),
  terms: z.object({
    dataSharing: z.enum(['none', 'minimal', 'full']),
    resourceSharing: z.enum(['none', 'compute', 'data', 'full']),
    revenueShare: z.number().min(0).max(100).optional(),
    liabilityCap: z.number().optional()
  }),
  status: z.enum(['draft', 'pending', 'active', 'suspended', 'terminated']).default('draft'),
  createdAt: z.string(),
  validUntil: z.string()
});

/**
 * Multi-Agent Mission
 */
export const MultiAgentMissionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  teamId: z.string(),
  meshId: z.string(),
  protocolId: z.string(),
  tasks: z.array(CoordinationTaskSchema),
  status: z.enum(['planning', 'active', 'paused', 'completed', 'failed', 'cancelled']).default('planning'),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  metrics: z.object({
    tasksCompleted: z.number(),
    tasksFailed: z.number(),
    conflictsResolved: z.number(),
    avgLatency: z.number().optional(),
    totalTokenUsage: z.number().optional()
  }).optional()
});

/**
 * Orchestration Request/Response
 */
export const CreateMeshRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  initialNodes: z.array(AgentMeshNodeSchema.omit({ id: true, health: true, load: true })).optional()
});

export const CreateTeamRequestSchema = z.object({
  name: z.string(),
  missionId: z.string().optional(),
  members: z.array(AgentTeamMemberSchema.omit({ agentId: true }).merge(z.object({ agentId: z.string() })))
});

export const CreateMissionRequestSchema = z.object({
  name: z.string(),
  description: z.string(),
  teamId: z.string(),
  meshId: z.string(),
  protocolType: z.enum(['blackboard', 'contract_net', 'auction', 'consensus', 'hierarchical', 'swarm']).default('hierarchical'),
  initialTasks: z.array(z.object({
    type: CoordinationTaskSchema.shape.type,
    description: z.string(),
    input: z.record(z.any()),
    priority: z.enum(['critical', 'high', 'normal', 'low']).default('normal')
  })).optional()
});

export const CoordinateRequestSchema = z.object({
  missionId: z.string(),
  taskId: z.string(),
  action: z.enum(['assign', 'delegate', 'escalate', 'merge', 'split']),
  targetAgents: z.array(z.string()),
  parameters: z.record(z.any()).optional()
});

export const ResolveConflictRequestSchema = z.object({
  conflictId: z.string(),
  strategy: z.enum(['negotiation', 'mediation', 'arbitration', 'voting', 'override', 'merger']),
  resolution: z.string(),
  winner: z.string().optional()
});

/**
 * Response Types
 */
export const MeshStatusResponseSchema = z.object({
  meshId: z.string(),
  health: z.object({
    overall: z.enum(['healthy', 'degraded', 'unhealthy']),
    healthyNodes: z.number(),
    totalNodes: z.number(),
    activeEdges: z.number()
  }),
  load: z.object({
    average: z.number(),
    max: z.number(),
    byNode: z.record(z.number())
  }),
  latency: z.object({
    average: z.number(),
    p95: z.number(),
    p99: z.number()
  })
});

export const CoordinationResultSchema = z.object({
  success: z.boolean(),
  taskId: z.string(),
  assignedAgents: z.array(z.string()),
  estimatedCompletion: z.string().optional(),
  conflicts: z.array(ConflictRecordSchema).optional()
});

/**
 * TypeScript Types
 */
export type AgentMeshNode = z.infer<typeof AgentMeshNodeSchema>;
export type AgentMeshEdge = z.infer<typeof AgentMeshEdgeSchema>;
export type AgentMesh = z.infer<typeof AgentMeshSchema>;
export type AgentTeamMember = z.infer<typeof AgentTeamMemberSchema>;
export type AgentTeam = z.infer<typeof AgentTeamSchema>;
export type CoordinationTask = z.infer<typeof CoordinationTaskSchema>;
export type CoordinationProtocol = z.infer<typeof CoordinationProtocolSchema>;
export type ConflictRecord = z.infer<typeof ConflictRecordSchema>;
export type ResolutionStrategy = z.infer<typeof ResolutionStrategySchema>;
export type FederatedAgent = z.infer<typeof FederatedAgentSchema>;
export type FederationAgreement = z.infer<typeof FederationAgreementSchema>;
export type MultiAgentMission = z.infer<typeof MultiAgentMissionSchema>;

export type CreateMeshRequest = z.infer<typeof CreateMeshRequestSchema>;
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;
export type CreateMissionRequest = z.infer<typeof CreateMissionRequestSchema>;
export type CoordinateRequest = z.infer<typeof CoordinateRequestSchema>;
export type ResolveConflictRequest = z.infer<typeof ResolveConflictRequestSchema>;

export type MeshStatusResponse = z.infer<typeof MeshStatusResponseSchema>;
export type CoordinationResult = z.infer<typeof CoordinationResultSchema>;


