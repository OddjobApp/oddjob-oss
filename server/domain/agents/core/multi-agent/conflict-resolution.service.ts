/**
 * Conflict Resolution Service
 * 
 * Detects and resolves conflicts between agents in multi-agent missions.
 * Implements multiple resolution strategies: negotiation, mediation,
 * arbitration, voting, and override.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { createLogger } from '../../../../utils/logger.js';
import {
  ConflictRecord,
  ResolutionStrategy,
  ResolveConflictRequest,
  AgentMeshNode,
  CoordinationTask
} from '../../../../../shared/schema/multi-agent.js';

const logger = createLogger('ConflictResolutionService');

interface ConflictContext {
  missionId: string;
  involvedAgents: AgentMeshNode[];
  task?: CoordinationTask;
  resources: string[];
  goals: string[];
}

type ConflictType = ConflictRecord['type'];
type Severity = ConflictRecord['severity'];
type ResolutionType = ResolutionStrategy['type'];

export class ConflictResolutionService extends EventEmitter {
  private conflicts: Map<string, ConflictRecord> = new Map();
  private strategies: Map<string, ResolutionStrategy> = new Map();
  private resolutionHistory: Map<string, ConflictRecord[]> = new Map(); // missionId -> conflicts

  constructor() {
    super();
    this.initializeDefaultStrategies();
  }

  /**
   * Initialize default resolution strategies
   */
  private initializeDefaultStrategies(): void {
    const defaultStrategies: ResolutionStrategy[] = [
      {
        id: 'negotiation',
        name: 'Agent Negotiation',
        type: 'negotiation',
        priority: 3,
        applicableTo: ['resource', 'goal', 'plan']
      },
      {
        id: 'mediation',
        name: 'Mediator Mediation',
        type: 'mediation',
        priority: 5,
        applicableTo: ['resource', 'goal', 'plan', 'belief']
      },
      {
        id: 'arbitration',
        name: 'Orchestrator Arbitration',
        type: 'arbitration',
        priority: 7,
        applicableTo: ['resource', 'goal', 'plan', 'belief', 'authority']
      },
      {
        id: 'voting',
        name: 'Democratic Voting',
        type: 'voting',
        priority: 4,
        applicableTo: ['goal', 'plan', 'belief'],
        config: { threshold: 0.5 }
      },
      {
        id: 'override',
        name: 'Lead Override',
        type: 'override',
        priority: 9,
        applicableTo: ['resource', 'goal', 'plan', 'belief', 'authority'],
        config: { requiresAuthorization: true }
      },
    ];

    defaultStrategies.forEach((s) => this.strategies.set(s.id, s));
  }

  /**
   * Detect conflicts between agents
   */
  async detectConflicts(context: ConflictContext): Promise<ConflictRecord[]> {
    const detectedConflicts: ConflictRecord[] = [];
    const agentIds = context.involvedAgents.map((a) => a.id);

    // Detect resource conflicts
    const resourceConflicts = this.detectResourceConflicts(context);
    detectedConflicts.push(...resourceConflicts);

    // Detect goal conflicts
    const goalConflicts = this.detectGoalConflicts(context);
    detectedConflicts.push(...goalConflicts);

    // Detect plan conflicts
    const planConflicts = this.detectPlanConflicts(context);
    detectedConflicts.push(...planConflicts);

    // Store detected conflicts
    detectedConflicts.forEach((conflict) => {
      this.conflicts.set(conflict.id, conflict);

      // Add to history
      if (!this.resolutionHistory.has(context.missionId)) {
        this.resolutionHistory.set(context.missionId, []);
      }
      this.resolutionHistory.get(context.missionId)!.push(conflict);
    });

    if (detectedConflicts.length > 0) {
      logger.info('Conflicts detected', {
        missionId: context.missionId,
        count: detectedConflicts.length,
        types: detectedConflicts.map((c) => c.type)
      });

      this.emit('conflicts:detected', {
        missionId: context.missionId,
        conflicts: detectedConflicts
      });
    }

    return detectedConflicts;
  }

  /**
   * Detect resource conflicts (competing for same resource)
   */
  private detectResourceConflicts(context: ConflictContext): ConflictRecord[] {
    const conflicts: ConflictRecord[] = [];
    const resourceClaims = new Map<string, string[]>();

    // Simulate resource claims from agents
    context.involvedAgents.forEach((agent) => {
      context.resources.forEach((resource) => {
        // Check if agent needs this resource (simulated)
        if (Math.random() > 0.7) {
          const claimants = resourceClaims.get(resource) || [];
          claimants.push(agent.id);
          resourceClaims.set(resource, claimants);
        }
      });
    });

    // Find conflicts (multiple agents claiming same resource)
    resourceClaims.forEach((claimants, resource) => {
      if (claimants.length > 1) {
        conflicts.push({
          id: randomUUID(),
          missionId: context.missionId,
          type: 'resource',
          severity: claimants.length > 3 ? 'high' : 'medium',
          involvedAgents: claimants,
          description: `Multiple agents competing for resource: ${resource}`,
          status: 'detected',
          detectedAt: new Date().toISOString()
        });
      }
    });

    return conflicts;
  }

  /**
   * Detect goal conflicts (incompatible objectives)
   */
  private detectGoalConflicts(context: ConflictContext): ConflictRecord[] {
    const conflicts: ConflictRecord[] = [];

    // Check for incompatible goals (simulated detection)
    const agentGoals = new Map<string, string[]>();

    context.involvedAgents.forEach((agent) => {
      agentGoals.set(agent.id, context.goals.slice(0, Math.floor(Math.random() * 3) + 1));
    });

    // Look for contradictory goals
    for (let i = 0; i < context.involvedAgents.length; i++) {
      for (let j = i + 1; j < context.involvedAgents.length; j++) {
        const agentA = context.involvedAgents[i];
        const agentB = context.involvedAgents[j];
        const goalsA = agentGoals.get(agentA.id) || [];
        const goalsB = agentGoals.get(agentB.id) || [];

        // Check for contradictions (simplified check)
        const contradictions = this.findContradictions(goalsA, goalsB);
        if (contradictions.length > 0) {
          conflicts.push({
            id: randomUUID(),
            missionId: context.missionId,
            type: 'goal',
            severity: 'high',
            involvedAgents: [agentA.id, agentB.id],
            description: `Goal conflict: ${contradictions.join(', ')}`,
            status: 'detected',
            detectedAt: new Date().toISOString()
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Find contradictions between two goal sets
   */
  private findContradictions(goalsA: string[], goalsB: string[]): string[] {
    const contradictions: string[] = [];

    // Define known contradictory pairs
    const contradictoryPairs: [string, string][] = [
      ['maximize-speed', 'maximize-accuracy'],
      ['minimize-cost', 'maximize-quality'],
      ['aggressive-expansion', 'risk-averse'],
      ['centralize', 'decentralize']
    ];

    goalsA.forEach((goalA) => {
      goalsB.forEach((goalB) => {
        contradictoryPairs.forEach(([a, b]) => {
          if ((goalA.includes(a) && goalB.includes(b)) || (goalA.includes(b) && goalB.includes(a))) {
            contradictions.push(`${a} vs ${b}`);
          }
        });
      });
    });

    return contradictions;
  }

  /**
   * Detect plan conflicts (overlapping or contradictory plans)
   */
  private detectPlanConflicts(context: ConflictContext): ConflictRecord[] {
    const conflicts: ConflictRecord[] = [];

    // Detect task dependency conflicts
    if (context.task?.dependencies) {
      const unmetDependencies = context.task.dependencies.filter(
        (dep) => Math.random() > 0.8 // Simulate some unmet dependencies
      );

      if (unmetDependencies.length > 0) {
        conflicts.push({
          id: randomUUID(),
          missionId: context.missionId,
          type: 'plan',
          severity: 'critical',
          involvedAgents: context.involvedAgents.map((a) => a.id),
          description: `Task dependencies not met: ${unmetDependencies.join(', ')}`,
          status: 'detected',
          detectedAt: new Date().toISOString()
        });
      }
    }

    return conflicts;
  }

  /**
   * Resolve a conflict using specified strategy
   */
  async resolveConflict(request: ResolveConflictRequest): Promise<ConflictRecord> {
    const conflict = this.conflicts.get(request.conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${request.conflictId} not found`);
    }

    const strategy = this.strategies.get(request.strategy);
    if (!strategy) {
      throw new Error(`Strategy ${request.strategy} not found`);
    }

    if (!strategy.applicableTo.includes(conflict.type)) {
      throw new Error(`Strategy ${request.strategy} not applicable to ${conflict.type} conflicts`);
    }

    // Apply resolution
    conflict.status = 'resolved';
    conflict.resolvedAt = new Date().toISOString();
    conflict.resolution = {
      strategy: request.strategy,
      outcome: request.resolution,
      winner: request.winner,
      appliedBy: 'conflict-resolution-service'
    };

    logger.info('Conflict resolved', {
      conflictId: request.conflictId,
      strategy: request.strategy,
      type: conflict.type
    });

    this.emit('conflict:resolved', { conflict, strategy });

    return conflict;
  }

  /**
   * Auto-resolve a conflict using best available strategy
   */
  async autoResolve(conflictId: string): Promise<ConflictRecord | null> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return null;

    // Find best applicable strategy
    const applicableStrategies = Array.from(this.strategies.values())
      .filter((s) => s.applicableTo.includes(conflict.type))
      .sort((a, b) => b.priority - a.priority);

    if (applicableStrategies.length === 0) return null;

    const bestStrategy = applicableStrategies[0];

    // Apply resolution logic based on strategy type
    let winner: string | undefined;
    let outcome: string;

    switch (bestStrategy.type) {
      case 'override':
        // Lead agent wins
        winner = conflict.involvedAgents[0];
        outcome = 'Resolved by lead agent override';
        break;

      case 'negotiation':
        // Agents negotiate compromise
        winner = undefined;
        outcome = 'Agents reached compromise through negotiation';
        break;

      case 'voting':
        // Simple majority (first agent wins in simulation)
        winner = conflict.involvedAgents[0];
        outcome = 'Resolved by democratic vote';
        break;

      case 'mediation':
        // Third-party mediation
        winner = conflict.involvedAgents[Math.floor(Math.random() * conflict.involvedAgents.length)];
        outcome = 'Resolved through third-party mediation';
        break;

      case 'arbitration':
        // Orchestrator decides
        winner = conflict.involvedAgents[0];
        outcome = 'Resolved by orchestrator arbitration';
        break;

      case 'merger':
        // Merge approaches
        winner = undefined;
        outcome = 'Conflicting approaches merged into unified solution';
        break;

      default:
        return null;
    }

    return this.resolveConflict({
      conflictId,
      strategy: bestStrategy.type,
      resolution: outcome,
      winner
    });
  }

  /**
   * Escalate unresolved conflict
   */
  async escalateConflict(conflictId: string, reason: string): Promise<void> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    conflict.status = 'escalated';
    conflict.severity = this.escalateSeverity(conflict.severity);

    logger.warn('Conflict escalated', {
      conflictId,
      newSeverity: conflict.severity,
      reason
    });

    this.emit('conflict:escalated', { conflict, reason });
  }

  /**
   * Escalate severity level
   */
  private escalateSeverity(current: Severity): Severity {
    const levels: Severity[] = ['low', 'medium', 'high', 'critical'];
    const currentIndex = levels.indexOf(current);
    return levels[Math.min(currentIndex + 1, levels.length - 1)];
  }

  /**
   * Get conflict by ID
   */
  getConflict(conflictId: string): ConflictRecord | undefined {
    return this.conflicts.get(conflictId);
  }

  /**
   * Get all conflicts
   */
  getAllConflicts(filters?: { missionId?: string; status?: string; type?: string }): ConflictRecord[] {
    let conflicts = Array.from(this.conflicts.values());

    if (filters?.missionId) {
      conflicts = conflicts.filter((c) => c.missionId === filters.missionId);
    }
    if (filters?.status) {
      conflicts = conflicts.filter((c) => c.status === filters.status);
    }
    if (filters?.type) {
      conflicts = conflicts.filter((c) => c.type === filters.type);
    }

    return conflicts;
  }

  /**
   * Get resolution strategies
   */
  getStrategies(type?: ConflictType): ResolutionStrategy[] {
    const strategies = Array.from(this.strategies.values());
    if (type) {
      return strategies.filter((s) => s.applicableTo.includes(type));
    }
    return strategies;
  }

  /**
   * Get conflict statistics for a mission
   */
  getMissionConflictStats(missionId: string): {
    total: number;
    resolved: number;
    escalated: number;
    byType: Record<ConflictType, number>;
    avgResolutionTime: number;
  } {
    const history = this.resolutionHistory.get(missionId) || [];
    const resolved = history.filter((c) => c.status === 'resolved');
    const escalated = history.filter((c) => c.status === 'escalated');

    const byType: Record<ConflictType, number> = {
      resource: 0,
      goal: 0,
      plan: 0,
      belief: 0,
      authority: 0
    };

    history.forEach((c) => {
      byType[c.type]++;
    });

    // Calculate average resolution time
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    resolved.forEach((c) => {
      if (c.resolvedAt && c.detectedAt) {
        const time = new Date(c.resolvedAt).getTime() - new Date(c.detectedAt).getTime();
        totalResolutionTime += time;
        resolvedCount++;
      }
    });

    const avgResolutionTime = resolvedCount > 0 ? totalResolutionTime / resolvedCount / 1000 : 0; // in seconds

    return {
      total: history.length,
      resolved: resolved.length,
      escalated: escalated.length,
      byType,
      avgResolutionTime
    };
  }

  /**
   * Add custom resolution strategy
   */
  addStrategy(strategy: ResolutionStrategy): void {
    this.strategies.set(strategy.id, strategy);
    logger.info('Added resolution strategy', { strategyId: strategy.id, name: strategy.name });
  }

  /**
   * Clear resolved conflicts older than threshold
   */
  cleanupOldConflicts(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleared = 0;

    this.conflicts.forEach((conflict, id) => {
      if (conflict.status === 'resolved' && conflict.resolvedAt) {
        const resolvedTime = new Date(conflict.resolvedAt).getTime();
        if (now - resolvedTime > maxAgeMs) {
          this.conflicts.delete(id);
          cleared++;
        }
      }
    });

    logger.info('Cleaned up old conflicts', { cleared });
    return cleared;
  }
}

export const conflictResolutionService = new ConflictResolutionService();
