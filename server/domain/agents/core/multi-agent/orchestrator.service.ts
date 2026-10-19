/**
 * Multi-Agent Orchestrator Service
 * 
 * Central coordination service that brings together:
 * - Agent Mesh (topology and communication)
 * - Agent Teams (hierarchical organization)
 * - Conflict Resolution (dispute handling)
 * - Federation (cross-org collaboration)
 * 
 * Manages multi-agent missions from planning through execution.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { createLogger } from '../../../../utils/logger.js';
import {
  MultiAgentMission,
  CoordinationTask,
  CoordinationProtocol,
  AgentMesh,
  AgentTeam,
  CreateMissionRequest,
  CoordinateRequest,
  CoordinationResult,
  ConflictRecord
} from '../../../../../shared/schema/multi-agent.js';
import { meshService, AgentMeshService } from './mesh.service.js';
import { teamService, AgentTeamService } from './team.service.js';
import { conflictResolutionService, ConflictResolutionService } from './conflict-resolution.service.js';
import { federationService, AgentFederationService } from './federation.service.js';

const logger = createLogger('MultiAgentOrchestrator');

interface MissionContext {
  mission: MultiAgentMission;
  mesh: AgentMesh;
  team: AgentTeam;
  activeTasks: Map<string, CoordinationTask>;
  completedTasks: Map<string, CoordinationTask>;
}

/**
 * A well-formed ConflictRecord for a delegation that could not proceed.
 *
 * These were being built as `{ id, taskId, reason }` — a shape the record type
 * does not have, missing the missionId, type, severity, involvedAgents,
 * description and detectedAt that every consumer of a conflict reads. Anything
 * downstream inspecting a returned conflict found none of the fields it
 * expected.
 */
function delegationConflict(params: {
  missionId: string;
  involvedAgents: string[];
  description: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}): ConflictRecord {
  return {
    id: randomUUID(),
    missionId: params.missionId,
    type: 'authority',
    severity: params.severity ?? 'high',
    involvedAgents: params.involvedAgents,
    description: params.description,
    status: 'detected',
    detectedAt: new Date().toISOString(),
  };
}

export class MultiAgentOrchestrator extends EventEmitter {
  public static readonly MAX_DELEGATION_DEPTH = 5;
  private missions: Map<string, MultiAgentMission> = new Map();
  private contexts: Map<string, MissionContext> = new Map();
  private protocols: Map<string, CoordinationProtocol> = new Map();
  private delegationEdges: Map<string, Set<string>> = new Map();
  private taskDelegationDepth: Map<string, number> = new Map();

  /**
   * Detects whether adding an edge (fromAgentId -> toAgentId) forms a directed cycle.
   * Performs DFS traversal from toAgentId to check if fromAgentId is reachable.
   */
  detectDelegationCycle(
    fromAgentId: string,
    toAgentId: string
  ): { hasCycle: boolean; cyclePath?: string[] } {
    if (fromAgentId === toAgentId) {
      return { hasCycle: true, cyclePath: [fromAgentId, toAgentId] };
    }

    const visited = new Set<string>();
    const path: string[] = [fromAgentId, toAgentId];

    const dfs = (current: string): boolean => {
      if (current === fromAgentId) {
        return true;
      }
      visited.add(current);
      const neighbors = this.delegationEdges.get(current);
      if (!neighbors) return false;

      for (const neighbor of neighbors) {
        if (neighbor === fromAgentId) {
          path.push(neighbor);
          return true;
        }
        if (!visited.has(neighbor)) {
          path.push(neighbor);
          if (dfs(neighbor)) return true;
          path.pop();
        }
      }
      return false;
    };

    const hasCycle = dfs(toAgentId);
    return hasCycle ? { hasCycle: true, cyclePath: path } : { hasCycle: false };
  }

  /**
   * Finds a fallback specialist agent when a circular deadlock is intercepted.
   */
  findFallbackSpecialist(
    context: MissionContext,
    excludedAgentIds: string[]
  ): string | null {
    const candidates = context.mesh.nodes.filter(
      (node) => !excludedAgentIds.includes(node.id) && node.health === 'healthy'
    );
    if (candidates.length > 0) {
      return candidates[0].id;
    }
    // A team has no leadAgentId field; the lead is the member holding that
    // role. Reading the absent field made this fallback always return null, so
    // an escalation that should have gone to the lead went nowhere.
    return context.team.members.find((m) => m.role === "lead")?.agentId ?? null;
  }

  /**
   * Clears delegation tracking for a completed or terminated task.
   */
  clearDelegationState(taskId: string): void {
    this.taskDelegationDepth.delete(taskId);
  }

  constructor(
    private meshSvc: AgentMeshService = meshService,
    private teamSvc: AgentTeamService = teamService,
    private conflictSvc: ConflictResolutionService = conflictResolutionService,
    private federationSvc: AgentFederationService = federationService
  ) {
    super();
    this.initializeDefaultProtocols();
  }

  /**
   * Initialize default coordination protocols
   */
  private initializeDefaultProtocols(): void {
    const protocols: CoordinationProtocol[] = [
      {
        id: 'hierarchical',
        name: 'Hierarchical Command',
        type: 'hierarchical',
        active: true,
        config: {
          decisionMode: 'top-down',
          delegationEnabled: true,
          escalationEnabled: true
        }
      },
      {
        id: 'blackboard',
        name: 'Shared Blackboard',
        type: 'blackboard',
        active: true,
        config: {
          visibility: 'all',
          writePermissions: 'all',
          conflictResolution: 'first-write-wins'
        }
      },
      {
        id: 'contract_net',
        name: 'Contract Net Protocol',
        type: 'contract_net',
        active: true,
        config: {
          announcementStrategy: 'broadcast',
          bidTimeout: 5000,
          selectionStrategy: 'best-bid'
        }
      },
      {
        id: 'consensus',
        name: 'Consensus Building',
        type: 'consensus',
        active: true,
        config: {
          votingThreshold: 0.66,
          maxRounds: 10,
          fallbackStrategy: 'lead-decision'
        }
      },
      {
        id: 'swarm',
        name: 'Swarm Intelligence',
        type: 'swarm',
        active: true,
        config: {
          emergentBehavior: true,
          localRules: 'stigmergy',
          convergenceCriteria: 'stable-for-3-rounds'
        }
      }
    ];

    protocols.forEach((p) => this.protocols.set(p.id, p));
  }

  /**
   * Create and launch a multi-agent mission
   */
  async createMission(request: CreateMissionRequest): Promise<MultiAgentMission> {
    const missionId = randomUUID();
    const now = new Date().toISOString();

    // Verify mesh and team exist
    const mesh = this.meshSvc.getMesh(request.meshId);
    if (!mesh) {
      throw new Error(`Mesh ${request.meshId} not found`);
    }

    const team = this.teamSvc.getTeam(request.teamId);
    if (!team) {
      throw new Error(`Team ${request.teamId} not found`);
    }

    // Get protocol
    const protocol = this.protocols.get(request.protocolType);
    if (!protocol) {
      throw new Error(`Protocol ${request.protocolType} not found`);
    }

    // Create initial tasks
    const tasks: CoordinationTask[] = request.initialTasks?.map((t, index) => ({
      id: randomUUID(),
      missionId,
      type: t.type,
      description: t.description,
      input: t.input,
      assignedTo: [],
      status: 'pending',
      priority: t.priority
    })) || [];

    const mission: MultiAgentMission = {
      id: missionId,
      name: request.name,
      description: request.description,
      teamId: request.teamId,
      meshId: request.meshId,
      protocolId: request.protocolType,
      tasks,
      status: 'planning',
      createdAt: now,
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        conflictsResolved: 0
      }
    };

    this.missions.set(missionId, mission);

    // Initialize mission context
    const context: MissionContext = {
      mission,
      mesh,
      team,
      activeTasks: new Map(),
      completedTasks: new Map()
    };

    this.contexts.set(missionId, context);

    logger.info('Multi-agent mission created', {
      missionId,
      name: request.name,
      teamSize: team.members.length,
      meshSize: mesh.nodes.length,
      protocol: request.protocolType
    });

    this.emit('mission:created', { missionId, name: request.name, teamId: request.teamId });

    return mission;
  }

  /**
   * Start mission execution
   */
  async startMission(missionId: string): Promise<void> {
    const mission = this.missions.get(missionId);
    if (!mission) {
      throw new Error(`Mission ${missionId} not found`);
    }

    if (mission.status !== 'planning') {
      throw new Error(`Mission cannot be started (status: ${mission.status})`);
    }

    mission.status = 'active';
    mission.startedAt = new Date().toISOString();

    // Initialize tasks based on protocol
    const context = this.contexts.get(missionId)!;
    await this.initializeTasksForProtocol(mission, context);

    logger.info('Multi-agent mission started', {
      missionId,
      taskCount: mission.tasks.length,
      protocol: mission.protocolId
    });

    this.emit('mission:started', { missionId, taskCount: mission.tasks.length });

    // Begin coordination
    this.executeCoordinationLoop(missionId).catch((err) =>
      logger.error('Coordination loop failed', { missionId, error: err })
    );
  }

  /**
   * Initialize tasks based on coordination protocol
   */
  private async initializeTasksForProtocol(
    mission: MultiAgentMission,
    context: MissionContext
  ): Promise<void> {
    const protocol = this.protocols.get(mission.protocolId)!;

    switch (protocol.type) {
      case 'hierarchical':
        await this.initializeHierarchicalTasks(mission, context);
        break;
      case 'blackboard':
        await this.initializeBlackboardTasks(mission, context);
        break;
      case 'contract_net':
        await this.initializeContractNetTasks(mission, context);
        break;
      case 'consensus':
        await this.initializeConsensusTasks(mission, context);
        break;
      case 'swarm':
        await this.initializeSwarmTasks(mission, context);
        break;
    }
  }

  /**
   * Initialize tasks for hierarchical protocol
   */
  private async initializeHierarchicalTasks(
    mission: MultiAgentMission,
    context: MissionContext
  ): Promise<void> {
    // Assign tasks to lead agents, who can delegate
    const leads = context.team.members.filter((m) => m.role === 'lead');

    mission.tasks.forEach((task, index) => {
      const lead = leads[index % leads.length];
      if (lead) {
        task.assignedTo = [lead.agentId];
        task.status = 'assigned';
        context.activeTasks.set(task.id, task);
      }
    });
  }

  /**
   * Initialize tasks for blackboard protocol
   */
  private async initializeBlackboardTasks(
    mission: MultiAgentMission,
    context: MissionContext
  ): Promise<void> {
    // All tasks posted to shared blackboard, agents self-select
    mission.tasks.forEach((task) => {
      task.assignedTo = []; // Self-assignment
      task.status = 'pending';
      context.activeTasks.set(task.id, task);
    });
  }

  /**
   * Initialize tasks for contract net protocol
   */
  private async initializeContractNetTasks(
    mission: MultiAgentMission,
    context: MissionContext
  ): Promise<void> {
    // Announce tasks, wait for bids, assign to best bidders
    mission.tasks.forEach((task) => {
      task.assignedTo = [];
      task.status = 'pending';
      context.activeTasks.set(task.id, task);
    });

    // Simulate contract net: find best agents for each task
    for (const task of mission.tasks) {
      const bestAgent = this.meshSvc.findBestAgent(
        mission.meshId,
        this.inferRequiredCapabilities(task)
      );

      if (bestAgent) {
        task.assignedTo = [bestAgent.id];
        task.status = 'assigned';
      }
    }
  }

  /**
   * Initialize tasks for consensus protocol
   */
  private async initializeConsensusTasks(
    mission: MultiAgentMission,
    context: MissionContext
  ): Promise<void> {
    // All agents work on all tasks, then vote on results
    const allAgentIds = context.team.members.map((m) => m.agentId);

    mission.tasks.forEach((task) => {
      task.assignedTo = allAgentIds;
      task.status = 'assigned';
      context.activeTasks.set(task.id, task);
    });
  }

  /**
   * Initialize tasks for swarm protocol
   */
  private async initializeSwarmTasks(
    mission: MultiAgentMission,
    context: MissionContext
  ): Promise<void> {
    // Emergent task assignment based on stigmergy
    mission.tasks.forEach((task) => {
      task.assignedTo = [];
      task.status = 'pending';
      context.activeTasks.set(task.id, task);
    });
  }

  /**
   * Main coordination loop
   */
  private async executeCoordinationLoop(missionId: string): Promise<void> {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    const context = this.contexts.get(missionId)!;

    while (mission.status === 'active') {
      // Execute active tasks
      for (const [taskId, task] of context.activeTasks) {
        if (task.status === 'assigned' || task.status === 'in_progress') {
          await this.executeTask(missionId, taskId);
        }
      }

      // Check for conflicts
      const conflicts = await this.conflictSvc.detectConflicts({
        missionId,
        involvedAgents: context.mesh.nodes.filter((n) => n.health === 'healthy'),
        resources: ['compute', 'data', 'network'],
        goals: mission.tasks.map((t) => t.description)
      });

      // Auto-resolve conflicts if possible
      for (const conflict of conflicts) {
        if (conflict.severity !== 'critical') {
          await this.conflictSvc.autoResolve(conflict.id);
          mission.metrics!.conflictsResolved++;
        }
      }

      // Check completion
      const allCompleted = mission.tasks.every(
        (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
      );

      if (allCompleted) {
        mission.status = 'completed';
        mission.completedAt = new Date().toISOString();
        mission.metrics!.tasksCompleted = mission.tasks.filter((t) => t.status === 'completed').length;
        mission.metrics!.tasksFailed = mission.tasks.filter((t) => t.status === 'failed').length;

        logger.info('Multi-agent mission completed', {
          missionId,
          tasksCompleted: mission.metrics!.tasksCompleted,
          tasksFailed: mission.metrics!.tasksFailed,
          conflictsResolved: mission.metrics!.conflictsResolved
        });

        this.emit('mission:completed', {
          missionId,
          tasksCompleted: mission.metrics!.tasksCompleted,
          tasksFailed: mission.metrics!.tasksFailed
        });

        break;
      }

      // Brief pause between coordination cycles
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(missionId: string, taskId: string): Promise<void> {
    const context = this.contexts.get(missionId)!;
    const task = context.activeTasks.get(taskId);
    if (!task) return;

    task.status = 'in_progress';
    task.startedAt = new Date().toISOString();

    // Simulate task execution
    const executionTime = 1000 + Math.random() * 3000;
    await new Promise((resolve) => setTimeout(resolve, executionTime));

    // Simulate success/failure (95% success rate)
    const success = Math.random() > 0.05;

    if (success) {
      task.status = 'completed';
      task.result = {
        output: `Task ${task.type} completed successfully`,
        executionTime,
        agentId: task.assignedTo[0]
      };
      task.completedAt = new Date().toISOString();

      context.completedTasks.set(taskId, task);
      context.activeTasks.delete(taskId);

      logger.debug('Task completed', { missionId, taskId, executionTime });
      this.emit('task:completed', { missionId, taskId, agentId: task.assignedTo[0] });
    } else {
      task.status = 'failed';
      task.result = { error: 'Task execution failed' };

      logger.warn('Task failed', { missionId, taskId });
      this.emit('task:failed', { missionId, taskId });

      // Try to reassign or escalate
      await this.handleTaskFailure(missionId, task);
    }
  }

  /**
   * Handle task failure with reassignment or escalation
   */
  private async handleTaskFailure(missionId: string, task: CoordinationTask): Promise<void> {
    const mission = this.missions.get(missionId)!;
    const context = this.contexts.get(missionId)!;

    // Try to find another agent
    const availableAgents = context.mesh.nodes.filter(
      (n) => n.health === 'healthy' && !task.assignedTo.includes(n.id)
    );

    if (availableAgents.length > 0) {
      // Reassign to another agent
      const newAgent = availableAgents[0];
      task.assignedTo.push(newAgent.id);
      task.status = 'assigned';

      logger.info('Task reassigned after failure', {
        missionId,
        taskId: task.id,
        newAgentId: newAgent.id
      });
    } else if (task.assignedTo.length > 0) {
      // Escalate to team lead
      const leadId = this.teamSvc.findEscalationTarget(mission.teamId, task.assignedTo[0]);
      if (leadId) {
        await this.teamSvc.escalateTask(mission.teamId, task.id, task.assignedTo[0], 'Task failed, needs escalation');
        task.assignedTo = [leadId];
        task.status = 'assigned';
      }
    }
  }

  /**
   * Coordinate a specific action
   */
  async coordinate(request: CoordinateRequest): Promise<CoordinationResult> {
    const mission = this.missions.get(request.missionId);
    if (!mission) {
      throw new Error(`Mission ${request.missionId} not found`);
    }

    const context = this.contexts.get(request.missionId)!;

    switch (request.action) {
      case 'assign':
        return this.coordinateAssign(request, mission, context);
      case 'delegate':
        return this.coordinateDelegate(request, mission, context);
      case 'escalate':
        return this.coordinateEscalate(request, mission, context);
      case 'merge':
        return this.coordinateMerge(request, mission, context);
      case 'split':
        return this.coordinateSplit(request, mission, context);
      default:
        throw new Error(`Unknown coordination action: ${request.action}`);
    }
  }

  /**
   * Coordinate task assignment
   */
  private coordinateAssign(
    request: CoordinateRequest,
    mission: MultiAgentMission,
    context: MissionContext
  ): CoordinationResult {
    const task = context.activeTasks.get(request.taskId);
    if (!task) {
      throw new Error(`Task ${request.taskId} not found`);
    }

    // Verify agents are available
    const availableAgents = context.mesh.nodes.filter(
      (n) => request.targetAgents.includes(n.id) && n.health === 'healthy'
    );

    if (availableAgents.length === 0) {
      return {
        success: false,
        taskId: request.taskId,
        assignedAgents: [],
        conflicts: []
      };
    }

    // Find best agent
    const bestAgent = this.meshSvc.findBestAgent(
      mission.meshId,
      this.inferRequiredCapabilities(task)
    );

    if (bestAgent && availableAgents.find((a) => a.id === bestAgent.id)) {
      task.assignedTo = [bestAgent.id];
      task.status = 'assigned';

      return {
        success: true,
        taskId: request.taskId,
        assignedAgents: [bestAgent.id],
        estimatedCompletion: new Date(Date.now() + 5000).toISOString()
      };
    }

    return {
      success: false,
      taskId: request.taskId,
      assignedAgents: [],
      conflicts: []
    };
  }

  /**
   * Coordinate task delegation with Level 5 cycle detection and deadlock guardrails
   */
  private coordinateDelegate(
    request: CoordinateRequest,
    mission: MultiAgentMission,
    context: MissionContext
  ): CoordinationResult {
    const task = context.activeTasks.get(request.taskId);
    if (!task || task.assignedTo.length === 0) {
      throw new Error(`Task ${request.taskId} not found or unassigned`);
    }

    const fromAgentId = task.assignedTo[0];
    const toAgentId = request.targetAgents[0];

    // 1. Check max delegation depth guardrail (Level 5)
    const currentDepth = this.taskDelegationDepth.get(request.taskId) || 0;
    if (currentDepth >= MultiAgentOrchestrator.MAX_DELEGATION_DEPTH) {
      logger.warn(`[MultiAgentOrchestrator] Task ${request.taskId} exceeded max delegation depth (${MultiAgentOrchestrator.MAX_DELEGATION_DEPTH}). Rerouting to fallback specialist.`);
      const fallbackAgent = this.findFallbackSpecialist(context, [fromAgentId, toAgentId]);
      if (fallbackAgent) {
        task.assignedTo = [fallbackAgent];
        this.emit('delegation:max_depth_exceeded', { taskId: request.taskId, depth: currentDepth, fallbackAgent });
        return {
          success: true,
          taskId: request.taskId,
          assignedAgents: [fallbackAgent],
          conflicts: [delegationConflict({
            missionId: request.missionId,
            involvedAgents: [fromAgentId, toAgentId, fallbackAgent],
            description: `Max delegation depth exceeded for task ${request.taskId} — assigned to fallback specialist`,
          })]
        };
      }
    }

    // 2. Check for circular delegation deadlock (Level 5)
    const cycleCheck = this.detectDelegationCycle(fromAgentId, toAgentId);
    if (cycleCheck.hasCycle) {
      const cycleStr = cycleCheck.cyclePath?.join(' -> ') || `${fromAgentId} -> ${toAgentId}`;
      logger.warn(`[MultiAgentOrchestrator] Circular deadlock detected: ${cycleStr}. Breaking loop and rerouting.`);

      const fallbackAgent = this.findFallbackSpecialist(context, cycleCheck.cyclePath || [fromAgentId, toAgentId]);
      if (fallbackAgent) {
        task.assignedTo = [fallbackAgent];
        this.emit('delegation:deadlock', {
          taskId: request.taskId,
          cyclePath: cycleCheck.cyclePath,
          fallbackAgent,
        });

        return {
          success: true,
          taskId: request.taskId,
          assignedAgents: [fallbackAgent],
          conflicts: [delegationConflict({
            missionId: request.missionId,
            involvedAgents: [fromAgentId, toAgentId, fallbackAgent],
            description: `Deadlock loop intercepted for task ${request.taskId}: ${cycleStr}`,
          })]
        };
      }

      return {
        success: false,
        taskId: request.taskId,
        assignedAgents: [],
        conflicts: [delegationConflict({
          missionId: request.missionId,
          involvedAgents: [fromAgentId, toAgentId],
          severity: 'critical',
          description: `Deadlock loop intercepted for task ${request.taskId} and no fallback agent available: ${cycleStr}`,
        })]
      };
    }

    // 3. Register delegation graph edge
    if (!this.delegationEdges.has(fromAgentId)) {
      this.delegationEdges.set(fromAgentId, new Set());
    }
    this.delegationEdges.get(fromAgentId)!.add(toAgentId);
    this.taskDelegationDepth.set(request.taskId, currentDepth + 1);

    this.teamSvc.delegateTask(mission.teamId, request.taskId, fromAgentId, toAgentId, request.parameters?.reason);

    task.assignedTo = [toAgentId];

    return {
      success: true,
      taskId: request.taskId,
      assignedAgents: [toAgentId]
    };
  }

  /**
   * Coordinate task escalation
   */
  private coordinateEscalate(
    request: CoordinateRequest,
    mission: MultiAgentMission,
    context: MissionContext
  ): CoordinationResult {
    const task = context.activeTasks.get(request.taskId);
    if (!task || task.assignedTo.length === 0) {
      throw new Error(`Task ${request.taskId} not found or unassigned`);
    }

    const fromAgentId = task.assignedTo[0];
    const escalationTarget = this.teamSvc.findEscalationTarget(mission.teamId, fromAgentId);

    if (escalationTarget) {
      this.teamSvc.escalateTask(mission.teamId, request.taskId, fromAgentId, request.parameters?.reason);
      task.assignedTo = [escalationTarget];

      return {
        success: true,
        taskId: request.taskId,
        assignedAgents: [escalationTarget]
      };
    }

    return {
      success: false,
      taskId: request.taskId,
      assignedAgents: []
    };
  }

  /**
   * Coordinate task merge
   */
  private coordinateMerge(
    request: CoordinateRequest,
    mission: MultiAgentMission,
    context: MissionContext
  ): CoordinationResult {
    // Merge multiple tasks into one
    const targetTaskIds = request.parameters?.taskIds || [];
    const mergedTask: CoordinationTask = {
      id: randomUUID(),
      missionId: request.missionId,
      parentId: targetTaskIds[0],
      type: 'coordination',
      description: `Merged task from ${targetTaskIds.length} subtasks`,
      input: {},
      assignedTo: request.targetAgents,
      status: 'pending',
      priority: 'normal'
    };

    mission.tasks.push(mergedTask);
    context.activeTasks.set(mergedTask.id, mergedTask);

    return {
      success: true,
      taskId: mergedTask.id,
      assignedAgents: request.targetAgents
    };
  }

  /**
   * Coordinate task split
   */
  private coordinateSplit(
    request: CoordinateRequest,
    mission: MultiAgentMission,
    context: MissionContext
  ): CoordinationResult {
    // Split a task into multiple subtasks
    const originalTask = context.activeTasks.get(request.taskId);
    if (!originalTask) {
      throw new Error(`Task ${request.taskId} not found`);
    }

    const subtaskCount = request.parameters?.count || 2;
    const subtaskIds: string[] = [];

    for (let i = 0; i < subtaskCount; i++) {
      const subtask: CoordinationTask = {
        id: randomUUID(),
        missionId: request.missionId,
        parentId: request.taskId,
        type: originalTask.type,
        description: `${originalTask.description} (Part ${i + 1}/${subtaskCount})`,
        input: { ...originalTask.input, part: i + 1 },
        assignedTo: request.targetAgents[i] ? [request.targetAgents[i]] : [],
        status: 'pending',
        priority: originalTask.priority
      };

      mission.tasks.push(subtask);
      context.activeTasks.set(subtask.id, subtask);
      subtaskIds.push(subtask.id);
    }

    // Cancel original task
    originalTask.status = 'cancelled';
    context.activeTasks.delete(request.taskId);

    return {
      success: true,
      taskId: subtaskIds[0],
      assignedAgents: request.targetAgents
    };
  }

  /**
   * Infer required capabilities from task type
   */
  private inferRequiredCapabilities(task: CoordinationTask): string[] {
    const capabilityMap: Record<string, string[]> = {
      analysis: ['llm', 'data-processing', 'inference'],
      synthesis: ['llm', 'aggregation', 'summarization'],
      execution: ['integration', 'action', 'api-call'],
      decision: ['llm', 'reasoning', 'neuro-symbolic'],
      monitoring: ['observability', 'alerting', 'streaming'],
      coordination: ['orchestration', 'planning', 'communication']
    };

    return capabilityMap[task.type] || ['llm'];
  }

  /**
   * Get mission status
   */
  getMission(missionId: string): MultiAgentMission | undefined {
    return this.missions.get(missionId);
  }

  /**
   * Get all missions
   */
  getAllMissions(filters?: { status?: string; teamId?: string }): MultiAgentMission[] {
    let missions = Array.from(this.missions.values());

    if (filters?.status) {
      missions = missions.filter((m) => m.status === filters.status);
    }
    if (filters?.teamId) {
      missions = missions.filter((m) => m.teamId === filters.teamId);
    }

    return missions;
  }

  /**
   * Pause a mission
   */
  async pauseMission(missionId: string): Promise<void> {
    const mission = this.missions.get(missionId);
    if (!mission) {
      throw new Error(`Mission ${missionId} not found`);
    }

    mission.status = 'paused';
    logger.info('Mission paused', { missionId });
    this.emit('mission:paused', { missionId });
  }

  /**
   * Resume a mission
   */
  async resumeMission(missionId: string): Promise<void> {
    const mission = this.missions.get(missionId);
    if (!mission) {
      throw new Error(`Mission ${missionId} not found`);
    }

    if (mission.status !== 'paused') {
      throw new Error(`Mission cannot be resumed (status: ${mission.status})`);
    }

    mission.status = 'active';
    logger.info('Mission resumed', { missionId });
    this.emit('mission:resumed', { missionId });

    // Restart coordination loop
    this.executeCoordinationLoop(missionId).catch((err) =>
      logger.error('Coordination loop failed after resume', { missionId, error: err })
    );
  }

  /**
   * Cancel a mission
   */
  async cancelMission(missionId: string, reason: string): Promise<void> {
    const mission = this.missions.get(missionId);
    if (!mission) {
      throw new Error(`Mission ${missionId} not found`);
    }

    mission.status = 'cancelled';

    // Cancel all active tasks
    const context = this.contexts.get(missionId);
    if (context) {
      context.activeTasks.forEach((task) => {
        task.status = 'cancelled';
      });
    }

    logger.info('Mission cancelled', { missionId, reason });
    this.emit('mission:cancelled', { missionId, reason });
  }

  /**
   * Get mission statistics
   */
  getMissionStats(missionId: string): {
    totalTasks: number;
    completed: number;
    failed: number;
    active: number;
    progress: number;
    conflictsResolved: number;
  } | null {
    const mission = this.missions.get(missionId);
    if (!mission) return null;

    const completed = mission.tasks.filter((t) => t.status === 'completed').length;
    const failed = mission.tasks.filter((t) => t.status === 'failed').length;
    const active = mission.tasks.filter(
      (t) => t.status === 'in_progress' || t.status === 'assigned'
    ).length;

    return {
      totalTasks: mission.tasks.length,
      completed,
      failed,
      active,
      progress: mission.tasks.length > 0 ? Math.round((completed / mission.tasks.length) * 100) : 0,
      conflictsResolved: mission.metrics?.conflictsResolved || 0
    };
  }
}

export const multiAgentOrchestrator = new MultiAgentOrchestrator();
