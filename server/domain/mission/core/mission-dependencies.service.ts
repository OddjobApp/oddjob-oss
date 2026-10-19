/**
 * Mission Dependencies Service
 * 
 * Manages dependencies between missions for complex multi-mission workflows.
 * Supports sequential execution, fan-out, fan-in, and dependency graphs.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { missionCorrelationService } from "./mission-correlation.service.js";
import { db } from "@server/database_service.js";
import { missions, missionRuns } from "@shared/schema/index.js";
import { eq, and, inArray, desc } from "drizzle-orm";

const logger = createLogger("MissionDependencies");

export type DependencyType = 'sequential' | 'fan_out' | 'fan_in' | 'any_of' | 'all_of';
export type DependencyCondition = 'completed' | 'succeeded' | 'failed' | 'any';

export interface MissionDependency {
    id: string;
    sourceMissionId: number;      // The mission that triggers/waits
    targetMissionId: number;      // The mission being depended on
    type: DependencyType;
    condition: DependencyCondition;
    createdAt: Date;
    metadata?: Record<string, any>;
}

export interface DependencyGraph {
    missions: Array<{
        missionId: number;
        name: string;
        status: string;
        dependencies: string[];      // dependency IDs
        dependents: string[];        // missions depending on this
    }>;
    edges: Array<{
        id: string;
        source: number;
        target: number;
        type: DependencyType;
        condition: DependencyCondition;
    }>;
    cycles: string[][];            // detected cycles (empty if acyclic)
}

export interface TriggerResult {
    triggered: boolean;
    reason?: string;
    dependentMissionId?: number;
    newRuns?: Array<{
        missionId: number;
        runId: number;
    }>;
}

// In-memory dependency cache (could be Redis in production)
const dependencies = new Map<string, MissionDependency>();
const missionTriggers = new Map<number, string[]>(); // missionId -> dependencyIds

export const missionDependenciesService = {
    /**
     * Add a dependency between two missions
     */
    async addDependency(
        sourceMissionId: number,
        targetMissionId: number,
        type: DependencyType = 'sequential',
        condition: DependencyCondition = 'completed',
        metadata?: Record<string, any>
    ): Promise<MissionDependency> {
        // Prevent self-dependency
        if (sourceMissionId === targetMissionId) {
            throw new Error('A mission cannot depend on itself');
        }

        const id = `dep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const dependency: MissionDependency = {
            id,
            sourceMissionId,
            targetMissionId,
            type,
            condition,
            createdAt: new Date(),
            metadata,
        };

        dependencies.set(id, dependency);
        
        // Track triggers
        const triggers = missionTriggers.get(sourceMissionId) || [];
        triggers.push(id);
        missionTriggers.set(sourceMissionId, triggers);

        const correlationId = missionCorrelationService.getCorrelationId();
        
        logger.info(`[MissionDependencies] Added ${type} dependency: ${sourceMissionId} → ${targetMissionId}`, {
            dependencyId: id,
            condition,
            correlationId,
        });

        await eventStream.publish('mission.dependency_added', {
            dependencyId: id,
            sourceMissionId,
            targetMissionId,
            type,
            condition,
            correlationId,
        }, {
            correlationId,
            subject: `mission:${sourceMissionId}`,
        }, 'mission-dependencies');

        return dependency;
    },

    /**
     * Remove a dependency
     */
    async removeDependency(dependencyId: string): Promise<boolean> {
        const dep = dependencies.get(dependencyId);
        if (!dep) return false;

        dependencies.delete(dependencyId);

        // Update triggers
        const triggers = missionTriggers.get(dep.sourceMissionId) || [];
        const index = triggers.indexOf(dependencyId);
        if (index > -1) {
            triggers.splice(index, 1);
        }

        logger.info(`[MissionDependencies] Removed dependency ${dependencyId}`);
        
        await eventStream.publish('mission.dependency_removed', {
            dependencyId,
            sourceMissionId: dep.sourceMissionId,
            targetMissionId: dep.targetMissionId,
        }, {
            correlationId: missionCorrelationService.getCorrelationId(),
            subject: `mission:${dep.sourceMissionId}`,
        }, 'mission-dependencies');

        return true;
    },

    /**
     * Get dependencies for a mission (what it depends on)
     */
    getDependencies(missionId: number): MissionDependency[] {
        return Array.from(dependencies.values())
            .filter(d => d.sourceMissionId === missionId);
    },

    /**
     * Get dependents of a mission (what depends on it)
     */
    getDependents(missionId: number): MissionDependency[] {
        return Array.from(dependencies.values())
            .filter(d => d.targetMissionId === missionId);
    },

    /**
     * Check if all dependencies are satisfied for a mission
     */
    async checkDependenciesSatisfied(missionId: number): Promise<{
        satisfied: boolean;
        blocking: MissionDependency[];
        details: Array<{
            dependency: MissionDependency;
            targetStatus: string;
            satisfied: boolean;
        }>;
    }> {
        const deps = this.getDependencies(missionId);
        const results = [];
        const blocking = [];
        let allSatisfied = true;

        for (const dep of deps) {
            // Get latest run status of target mission
            const [latestRun] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.missionId, dep.targetMissionId))
                .orderBy(desc(missionRuns.id))
                .limit(1);

            const targetStatus = latestRun?.status || 'never_run';
            const isSatisfied = this.isConditionSatisfied(targetStatus, dep.condition);

            results.push({
                dependency: dep,
                targetStatus,
                satisfied: isSatisfied,
            });

            if (!isSatisfied) {
                blocking.push(dep);
                allSatisfied = false;
            }
        }

        return {
            satisfied: allSatisfied,
            blocking,
            details: results,
        };
    },

    /**
     * Trigger dependent missions when this mission completes
     */
    async triggerDependents(
        completedMissionId: number,
        completedRunId: number,
        completionStatus: string
    ): Promise<TriggerResult[]> {
        const dependents = this.getDependents(completedMissionId);
        const results: TriggerResult[] = [];

        for (const dep of dependents) {
            const result = await this.evaluateTrigger(dep, completedMissionId, completionStatus);
            
            if (result.triggered) {
                logger.info(`[MissionDependencies] Triggered mission ${dep.sourceMissionId} from ${completedMissionId}`);
                
                await eventStream.publish('mission.dependency_triggered', {
                    dependencyId: dep.id,
                    sourceMissionId: dep.sourceMissionId,
                    triggeredBy: completedMissionId,
                    runId: completedRunId,
                    correlationId: missionCorrelationService.getCorrelationId(),
                }, {
                    correlationId: missionCorrelationService.getCorrelationId(),
                    subject: `mission:${dep.sourceMissionId}`,
                }, 'mission-dependencies');
            }

            results.push(result);
        }

        return results;
    },

    /**
     * Build dependency graph for visualization
     */
    async buildDependencyGraph(missionIds?: number[]): Promise<DependencyGraph> {
        const allDeps = Array.from(dependencies.values());
        const relevantDeps = missionIds 
            ? allDeps.filter(d => 
                missionIds.includes(d.sourceMissionId) || 
                missionIds.includes(d.targetMissionId)
              )
            : allDeps;

        // Get mission details from DB
        const involvedMissionIds = new Set<number>();
        relevantDeps.forEach(d => {
            involvedMissionIds.add(d.sourceMissionId);
            involvedMissionIds.add(d.targetMissionId);
        });

        const missionDetails = await db.select()
            .from(missions)
            .where(inArray(missions.id, Array.from(involvedMissionIds)));

        const missionStatus = await Promise.all(
            Array.from(involvedMissionIds).map(async (id) => {
                const [latestRun] = await db.select()
                    .from(missionRuns)
                    .where(eq(missionRuns.missionId, id))
                    .orderBy(desc(missionRuns.id))
                    .limit(1);
                return { missionId: id, status: latestRun?.status || 'never_run' };
            })
        );

        const missionMap = new Map(missionDetails.map(m => [m.id, m]));
        const statusMap = new Map(missionStatus.map(s => [s.missionId, s.status]));

        // Build nodes
        const nodes = Array.from(involvedMissionIds).map(id => {
            const mission = missionMap.get(id);
            const deps = this.getDependencies(id);
            const dependents = this.getDependents(id);
            
            return {
                missionId: id,
                name: mission?.name || `Mission ${id}`,
                status: statusMap.get(id) || 'unknown',
                dependencies: deps.map(d => d.id),
                dependents: dependents.map(d => d.id),
            };
        });

        // Build edges
        const edges = relevantDeps.map(d => ({
            id: d.id,
            source: d.sourceMissionId,
            target: d.targetMissionId,
            type: d.type,
            condition: d.condition,
        }));

        // Detect cycles
        const cycles = this.detectCycles(nodes, edges);

        return {
            missions: nodes,
            edges,
            cycles,
        };
    },

    /**
     * Detect cycles in the dependency graph
     */
    detectCycles(
        nodes: DependencyGraph['missions'],
        edges: DependencyGraph['edges']
    ): string[][] {
        const cycles: string[][] = [];
        const visited = new Set<number>();
        const recursionStack = new Set<number>();
        const path: number[] = [];

        const dfs = (nodeId: number): boolean => {
            visited.add(nodeId);
            recursionStack.add(nodeId);
            path.push(nodeId);

            const outgoingEdges = edges.filter(e => e.source === nodeId);
            
            for (const edge of outgoingEdges) {
                const targetId = edge.target;

                if (!visited.has(targetId)) {
                    if (dfs(targetId)) {
                        return true;
                    }
                } else if (recursionStack.has(targetId)) {
                    // Found a cycle
                    const cycleStart = path.indexOf(targetId);
                    const cycle = path.slice(cycleStart).map(id => 
                        nodes.find(n => n.missionId === id)?.name || String(id)
                    );
                    cycles.push(cycle);
                    return true;
                }
            }

            path.pop();
            recursionStack.delete(nodeId);
            return false;
        };

        for (const node of nodes) {
            if (!visited.has(node.missionId)) {
                dfs(node.missionId);
            }
        }

        return cycles;
    },

    /**
     * Get execution order for missions (topological sort)
     */
    getExecutionOrder(missionIds: number[]): {
        order: number[];
        possible: boolean;
        blocking: Array<{ missionId: number; reason: string }>;
    } {
        const deps = Array.from(dependencies.values())
            .filter(d => 
                missionIds.includes(d.sourceMissionId) && 
                missionIds.includes(d.targetMissionId)
            );

        // Build adjacency list
        const graph = new Map<number, Set<number>>();
        const inDegree = new Map<number, number>();

        // Initialize
        missionIds.forEach(id => {
            graph.set(id, new Set());
            inDegree.set(id, 0);
        });

        // Build graph
        deps.forEach(d => {
            graph.get(d.targetMissionId)?.add(d.sourceMissionId);
            inDegree.set(d.sourceMissionId, (inDegree.get(d.sourceMissionId) || 0) + 1);
        });

        // Find nodes with no dependencies
        const queue = missionIds.filter(id => (inDegree.get(id) || 0) === 0);
        const order: number[] = [];
        const processed = new Set<number>();

        while (queue.length > 0) {
            const node = queue.shift()!;
            order.push(node);
            processed.add(node);

            const neighbors = graph.get(node) || new Set();
            for (const neighbor of neighbors) {
                if (!processed.has(neighbor)) {
                    const newDegree = (inDegree.get(neighbor) || 1) - 1;
                    inDegree.set(neighbor, newDegree);
                    
                    if (newDegree === 0) {
                        queue.push(neighbor);
                    }
                }
            }
        }

        // Check if all missions were processed
        const unprocessed = missionIds.filter(id => !processed.has(id));
        
        if (unprocessed.length > 0) {
            return {
                order: [],
                possible: false,
                blocking: unprocessed.map(id => ({
                    missionId: id,
                    reason: 'Circular dependency or missing dependency',
                })),
            };
        }

        return {
            order,
            possible: true,
            blocking: [],
        };
    },

    /**
     * Bulk create dependencies for complex workflows
     */
    async createWorkflow(
        name: string,
        definition: Array<{
            missionId: number;
            dependsOn?: number[];
            type?: DependencyType;
            condition?: DependencyCondition;
        }>
    ): Promise<{
        workflowId: string;
        dependencies: MissionDependency[];
        graph: DependencyGraph;
    }> {
        const workflowId = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const createdDeps: MissionDependency[] = [];

        for (const step of definition) {
            if (step.dependsOn) {
                for (const depId of step.dependsOn) {
                    const dep = await this.addDependency(
                        step.missionId,
                        depId,
                        step.type || 'sequential',
                        step.condition || 'completed',
                        { workflowId, workflowName: name }
                    );
                    createdDeps.push(dep);
                }
            }
        }

        const graph = await this.buildDependencyGraph(
            definition.map(d => d.missionId)
        );

        logger.info(`[MissionDependencies] Created workflow ${name} with ${createdDeps.length} dependencies`);

        return {
            workflowId,
            dependencies: createdDeps,
            graph,
        };
    },

    /**
     * Remove all dependencies for a mission
     */
    async clearMissionDependencies(missionId: number): Promise<number> {
        const deps = [
            ...this.getDependencies(missionId),
            ...this.getDependents(missionId),
        ];

        let removed = 0;
        for (const dep of deps) {
            if (await this.removeDependency(dep.id)) {
                removed++;
            }
        }

        return removed;
    },

    // Private helpers
    isConditionSatisfied(status: string, condition: DependencyCondition): boolean {
        switch (condition) {
            case 'completed':
                return ['completed', 'succeeded', 'failed'].includes(status);
            case 'succeeded':
                return status === 'succeeded' || status === 'completed';
            case 'failed':
                return status === 'failed';
            case 'any':
                return status !== 'never_run' && status !== 'pending';
            default:
                return false;
        }
    },

    async evaluateTrigger(
        dep: MissionDependency,
        completedMissionId: number,
        completionStatus: string
    ): Promise<TriggerResult> {
        // Check if this specific dependency condition is met
        if (!this.isConditionSatisfied(completionStatus, dep.condition)) {
            return {
                triggered: false,
                reason: `Condition ${dep.condition} not met by status ${completionStatus}`,
                dependentMissionId: dep.sourceMissionId,
            };
        }

        // For fan_in, check if all dependencies are satisfied
        if (dep.type === 'fan_in' || dep.type === 'all_of') {
            const check = await this.checkDependenciesSatisfied(dep.sourceMissionId);
            
            if (!check.satisfied) {
                return {
                    triggered: false,
                    reason: `Waiting for ${check.blocking.length} more dependencies`,
                    dependentMissionId: dep.sourceMissionId,
                };
            }
        }

        // Trigger the mission
        return {
            triggered: true,
            reason: `Dependency ${dep.condition} satisfied by ${completedMissionId}`,
            dependentMissionId: dep.sourceMissionId,
        };
    },

    /**
     * Get all workflows (grouped by workflowId in metadata)
     */
    getWorkflows(): Array<{
        workflowId: string;
        name: string;
        missions: number[];
        dependencies: MissionDependency[];
    }> {
        const workflowMap = new Map<string, {
            workflowId: string;
            name: string;
            missions: Set<number>;
            dependencies: MissionDependency[];
        }>();

        for (const dep of dependencies.values()) {
            const workflowId = dep.metadata?.workflowId;
            const workflowName = dep.metadata?.workflowName;
            
            if (workflowId) {
                if (!workflowMap.has(workflowId)) {
                    workflowMap.set(workflowId, {
                        workflowId,
                        name: workflowName || workflowId,
                        missions: new Set(),
                        dependencies: [],
                    });
                }
                
                const wf = workflowMap.get(workflowId)!;
                wf.missions.add(dep.sourceMissionId);
                wf.missions.add(dep.targetMissionId);
                wf.dependencies.push(dep);
            }
        }

        return Array.from(workflowMap.values()).map(wf => ({
            ...wf,
            missions: Array.from(wf.missions),
        }));
    },
    /**
     * Clear all dependencies (mainly for testing)
     */
    clearAll(): void {
        dependencies.clear();
        missionTriggers.clear();
    },
};
