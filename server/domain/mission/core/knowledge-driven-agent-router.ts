/**
 * Knowledge-Driven Agent Router
 *
 * Routes tasks to agents based on knowledge graph proximity and expertise clustering.
 * Uses the knowledge graph to identify which agents have relevant context for subtasks.
 *
 * Features:
 * - Knowledge proximity scoring for task-agent matching
 * - Expertise clustering based on knowledge graph structure
 * - Load balancing across knowledgeable agents
 * - Dynamic agent team composition
 * - Context-aware task delegation
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { missions, missionMembers } from "@shared/schema/missions/core.js";
import { jobs } from "@shared/schema/jobs/index.js";
import { pipelines } from "@shared/schema/pipelines/index.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";

const logger = createLogger("KnowledgeDrivenAgentRouter");

export interface Agent {
  id: string;
  name: string;
  role: string;
  missionId: number;
  capabilities: AgentCapabilities;
  status: "idle" | "working" | "reviewing" | "complete" | "error";
  currentTasks: string[];
  processedKnowledge: Set<number>; // Knowledge node IDs this agent has worked with
  expertiseAreas: string[]; // Derived from knowledge graph analysis
  currentLoad: number; // 0-1 load factor
  lastActiveAt: Date;
}

export interface AgentCapabilities {
  canAnalyze: boolean;
  canGenerate: boolean;
  canReview: boolean;
  canExecute: boolean;
  specialties: string[];
}

export interface Task {
  id: string;
  missionId: number;
  description: string;
  type: "analysis" | "generation" | "review" | "execution";
  requiredCapabilities: (keyof AgentCapabilities)[];
  relatedKnowledgeIds: number[]; // Knowledge nodes relevant to this task
  priority: number; // 1-10
  estimatedDuration: number; // minutes
  dependencies: string[]; // Task IDs this depends on
  assignedAgent?: string;
}

export interface RoutingDecision {
  taskId: string;
  assignedAgentId: string;
  reasoning: string;
  knowledgeProximity: number;
  loadFactor: number;
  expectedCompletion: number; // minutes
  confidence: number;
  alternativeAgents: string[];
}

export interface RoutingResult {
  decisions: RoutingDecision[];
  unassignedTasks: Task[];
  teamEfficiency: number;
  estimatedTotalDuration: number;
  knowledgeCoverage: number;
}

export interface ExpertiseCluster {
  domain: string;
  agentIds: string[];
  knowledgeNodes: number[];
  sharedContext: string[];
}

const AGENT_TTL_MS = 4 * 60 * 60 * 1000; // Evict agents idle for 4 hours

export const knowledgeDrivenAgentRouter = {
  // In-memory agent registry (populated per mission)
  agents: new Map<string, Agent>(),

  /**
   * Evict agents that haven't been active for AGENT_TTL_MS to prevent memory leak.
   * Called automatically on initializeMissionAgents.
   */
  evictStaleAgents() {
    const cutoff = Date.now() - AGENT_TTL_MS;
    for (const [id, agent] of this.agents) {
      if (agent.lastActiveAt.getTime() < cutoff && agent.status !== "working") {
        this.agents.delete(id);
      }
    }
  },

  /**
   * Initialize agents for a mission from mission members
   */
  async initializeMissionAgents(missionId: number): Promise<Agent[]> {
    this.evictStaleAgents();
    logger.info(`[AgentRouter] Initializing agents for mission ${missionId}`);

    // Get mission members
    const members = await db
      .select({
        entityType: missionMembers.entityType,
        entityId: missionMembers.entityId,
        role: missionMembers.role,
      })
      .from(missionMembers)
      .where(eq(missionMembers.missionId, missionId));

    const agents: Agent[] = [];

    for (const member of members) {
      if (member.entityType === "job") {
        // Create agent from job
        const [job] = await db
          .select({
            id: jobs.id,
            name: jobs.name,
            type: jobs.type,
            config: jobs.config,
          })
          .from(jobs)
          .where(eq(jobs.id, member.entityId))
          .limit(1);

        if (job) {
          const agent: Agent = {
            id: `agent_${job.id}_${Date.now()}`,
            name: job.name,
            role: member.role || "worker",
            missionId,
            capabilities: this.inferCapabilitiesFromJobType(job.type),
            status: "idle",
            currentTasks: [],
            processedKnowledge: new Set(),
            expertiseAreas: await this.inferExpertiseAreas(job.config),
            currentLoad: 0,
            lastActiveAt: new Date(),
          };

          this.agents.set(agent.id, agent);
          agents.push(agent);
        }
      }
    }

    // If no members defined, create default agent team
    if (agents.length === 0) {
      const defaultAgents = this.createDefaultAgentTeam(missionId);
      for (const agent of defaultAgents) {
        this.agents.set(agent.id, agent);
        agents.push(agent);
      }
    }

    // Analyze knowledge graph to enhance agent expertise
    await this.enhanceAgentExpertise(agents, missionId);

    logger.info(
      `[AgentRouter] Initialized ${agents.length} agents for mission ${missionId}`
    );
    return agents;
  },

  /**
   * Create default agent team when no mission members defined
   */
  createDefaultAgentTeam(missionId: number): Agent[] {
    const roles = [
      { name: "Coordinator", role: "primary_strategist" },
      { name: "Analyst", role: "member" },
      { name: "Researcher", role: "member" },
      { name: "Reviewer", role: "critic" },
    ];

    return roles.map((r, idx) => ({
      id: `default_agent_${missionId}_${idx}_${Date.now()}`,
      name: r.name,
      role: r.role,
      missionId,
      capabilities: {
        canAnalyze: true,
        canGenerate: r.name !== "Reviewer",
        canReview: r.name === "Reviewer" || r.name === "Coordinator",
        canExecute: r.name === "Analyst" || r.name === "Researcher",
        specialties: [r.name.toLowerCase()],
      },
      status: "idle",
      currentTasks: [],
      processedKnowledge: new Set(),
      expertiseAreas: [r.name.toLowerCase()],
      currentLoad: 0,
      lastActiveAt: new Date(),
    }));
  },

  /**
   * Infer agent capabilities from job type
   */
  inferCapabilitiesFromJobType(jobType: string): AgentCapabilities {
    const capabilityMap: Record<string, Partial<AgentCapabilities>> = {
      analysis: { canAnalyze: true, canReview: true },
      generation: { canGenerate: true, canExecute: true },
      extraction: { canAnalyze: true, canExecute: true },
      transformation: { canExecute: true, canAnalyze: true },
      validation: { canReview: true, canAnalyze: true },
      webhook: { canExecute: true },
      schedule: { canExecute: true },
      api: { canExecute: true, canAnalyze: true },
    };

    const caps = capabilityMap[jobType.toLowerCase()] || {};

    return {
      canAnalyze: caps.canAnalyze || false,
      canGenerate: caps.canGenerate || false,
      canReview: caps.canReview || false,
      canExecute: caps.canExecute || false,
      specialties: [jobType.toLowerCase()],
    };
  },

  /**
   * Infer expertise areas from job config
   */
  async inferExpertiseAreas(config: any): Promise<string[]> {
    const areas: string[] = [];

    if (config?.datasetId || config?.datasetIds) {
      areas.push("data_processing");
    }
    if (config?.tool) {
      areas.push(`tool_${config.tool}`);
    }
    if (config?.aiConfig || config?.model) {
      areas.push("ai_operations");
    }
    if (config?.webhookUrl) {
      areas.push("integrations");
    }

    return areas;
  },

  /**
   * Enhance agent expertise based on knowledge graph analysis
   */
  async enhanceAgentExpertise(agents: Agent[], missionId: number): Promise<void> {
    // Get mission's knowledge context
    const [mission] = await db
      .select({
        blackboard: missions.blackboard,
        organizationId: missions.organizationId,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission?.blackboard?.autoContext?.entities) {
      return;
    }

    const entities = mission.blackboard.autoContext.entities;
    const orgContext = { organizationId: mission.organizationId };

    // Analyze knowledge graph clusters
    const clusters = await this.identifyExpertiseClusters(
      entities.map((e: any) => e.id),
      orgContext
    );

    // Distribute expertise among agents
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const cluster = clusters[i % clusters.length];

      if (cluster) {
        agent.expertiseAreas.push(...cluster.domains);
        cluster.knowledgeNodes.forEach((id) => agent.processedKnowledge.add(id));
      }
    }
  },

  /**
   * Identify expertise clusters in knowledge graph
   */
  async identifyExpertiseClusters(
    knowledgeNodeIds: number[],
    orgContext: any
  ): Promise<
    { domains: string[]; knowledgeNodes: number[]; sharedContext: string[] }[]
  > {
    if (knowledgeNodeIds.length === 0) return [];

    // Get knowledge nodes with their labels
    const nodes = await graphService.getNodesByIds(knowledgeNodeIds, orgContext);

    // Group by label (type) as initial clustering
    const byLabel = new Map<string, typeof nodes>();
    for (const node of nodes) {
      if (!byLabel.has(node.label)) {
        byLabel.set(node.label, []);
      }
      byLabel.get(node.label)!.push(node);
    }

    // Create clusters
    const clusters: {
      domains: string[];
      knowledgeNodes: number[];
      sharedContext: string[];
    }[] = [];

    for (const [label, labelNodes] of byLabel) {
      clusters.push({
        domains: [label, `${label}_operations`],
        knowledgeNodes: labelNodes.map((n) => n.id),
        sharedContext: labelNodes.map((n) => n.name).slice(0, 5),
      });
    }

    return clusters;
  },

  /**
   * Route tasks to agents based on knowledge proximity
   */
  async routeTasks(tasks: Task[], missionId: number): Promise<RoutingResult> {
    logger.info(`[AgentRouter] Routing ${tasks.length} tasks for mission ${missionId}`);

    // Fetch mission to get organizationId
    const [mission] = await db
      .select({ organizationId: missions.organizationId })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    const orgContext = { organizationId: mission?.organizationId };

    // Ensure agents are initialized
    const missionAgents = Array.from(this.agents.values()).filter(
      (a) => a.missionId === missionId
    );

    if (missionAgents.length === 0) {
      await this.initializeMissionAgents(missionId);
    }

    const availableAgents = Array.from(this.agents.values()).filter(
      (a) => a.missionId === missionId && a.status !== "error"
    );

    const decisions: RoutingDecision[] = [];
    const unassignedTasks: Task[] = [];

    // Sort tasks by priority (high priority first)
    const sortedTasks = [...tasks].sort((a, b) => b.priority - a.priority);

    for (const task of sortedTasks) {
      const decision = await this.findBestAgent(task, availableAgents, orgContext);

      if (decision) {
        decisions.push(decision);

        // Update agent state
        const agent = this.agents.get(decision.assignedAgentId);
        if (agent) {
          agent.currentTasks.push(task.id);
          agent.currentLoad = Math.min(
            1,
            agent.currentLoad + task.estimatedDuration / 120
          ); // Assume 2hr capacity
          agent.status = "working";

          // Add task knowledge to agent's processed set
          task.relatedKnowledgeIds.forEach((id) =>
            agent.processedKnowledge.add(id)
          );
        }
      } else {
        unassignedTasks.push(task);
      }
    }

    // Calculate metrics
    const teamEfficiency = this.calculateTeamEfficiency(
      decisions,
      availableAgents
    );
    const estimatedTotalDuration = this.estimateTotalDuration(decisions);
    const knowledgeCoverage = this.calculateKnowledgeCoverage(
      tasks,
      availableAgents
    );

    return {
      decisions,
      unassignedTasks,
      teamEfficiency,
      estimatedTotalDuration,
      knowledgeCoverage,
    };
  },

  /**
   * Find best agent for a task based on knowledge proximity
   */
  async findBestAgent(
    task: Task,
    agents: Agent[],
    orgContext: any
  ): Promise<RoutingDecision | null> {
    if (agents.length === 0) return null;

    const scoredAgents = await Promise.all(
      agents.map(async (agent) => ({
        agent,
        score: await this.calculateAgentTaskScore(agent, task, orgContext),
      }))
    );

    // Sort by score descending
    scoredAgents.sort((a, b) => b.score.total - a.score.total);

    const best = scoredAgents[0];
    if (!best || best.score.total < 0.3) {
      return null; // No suitable agent found
    }

    // Get alternatives (2nd and 3rd best)
    const alternatives = scoredAgents.slice(1, 3).map((s) => s.agent.id);

    return {
      taskId: task.id,
      assignedAgentId: best.agent.id,
      reasoning: best.score.reasoning,
      knowledgeProximity: best.score.knowledgeScore,
      loadFactor: best.agent.currentLoad,
      expectedCompletion: this.estimateTaskDuration(task, best.agent),
      confidence: best.score.total,
      alternativeAgents: alternatives,
    };
  },

  /**
   * Calculate comprehensive score for agent-task match
   */
  async calculateAgentTaskScore(
    agent: Agent,
    task: Task,
    orgContext: any
  ): Promise<{
    total: number;
    knowledgeScore: number;
    capabilityScore: number;
    loadScore: number;
    reasoning: string;
  }> {
    // 1. Knowledge proximity score (40%)
    const knowledgeScore = await this.calculateKnowledgeProximity(
      agent,
      task,
      orgContext
    );

    // 2. Capability match score (30%)
    const capabilityScore = this.calculateCapabilityMatch(agent, task);

    // 3. Load balancing score (20%)
    const loadScore = 1 - agent.currentLoad; // Prefer less loaded agents

    // 4. Role appropriateness (10%)
    const roleScore = this.calculateRoleAppropriateness(agent, task);

    const total =
      knowledgeScore * 0.4 +
      capabilityScore * 0.3 +
      loadScore * 0.2 +
      roleScore * 0.1;

    const reasoning = this.generateRoutingReasoning(
      agent,
      task,
      knowledgeScore,
      capabilityScore,
      loadScore
    );

    return {
      total,
      knowledgeScore,
      capabilityScore,
      loadScore,
      reasoning,
    };
  },

  /**
   * Calculate knowledge proximity between agent and task
   */
  async calculateKnowledgeProximity(agent: Agent, task: Task, orgContext: any): Promise<number> {
    if (task.relatedKnowledgeIds.length === 0) return 0.5; // Neutral if no knowledge context

    // Direct overlap: agent has already processed relevant knowledge
    const directOverlap = task.relatedKnowledgeIds.filter((id) =>
      agent.processedKnowledge.has(id)
    ).length;

    // Calculate direct score
    const directScore =
      directOverlap / Math.max(task.relatedKnowledgeIds.length, 1);

    // Graph proximity: find shortest path from agent's knowledge to task knowledge
    const graphProximity = await this.calculateGraphProximity(
      Array.from(agent.processedKnowledge),
      task.relatedKnowledgeIds,
      orgContext
    );

    // Combine scores (70% direct, 30% graph proximity)
    return directScore * 0.7 + graphProximity * 0.3;
  },

  /**
   * Calculate graph-based proximity between knowledge sets
   */
  async calculateGraphProximity(
    agentKnowledge: number[],
    taskKnowledge: number[],
    orgContext: any
  ): Promise<number> {
    if (agentKnowledge.length === 0 || taskKnowledge.length === 0) return 0;

    // Find edges connecting agent knowledge to task knowledge
    const edges = await graphService.getNodeEdgesBatch(agentKnowledge, orgContext, "outgoing");
    
    // Filter edges that connect to task knowledge
    const filteredEdges = edges.filter((e) => taskKnowledge.includes(e.targetId));

    if (filteredEdges.length === 0) return 0;

    // Calculate average proximity based on edge weights
    const avgWeight =
      filteredEdges.reduce((sum, e) => sum + (e.weight || 5), 0) / filteredEdges.length;
    return Math.min(avgWeight / 10, 1); // Normalize to 0-1
  },

  /**
   * Calculate capability match score
   */
  calculateCapabilityMatch(agent: Agent, task: Task): number {
    if (task.requiredCapabilities.length === 0) return 0.5;

    const matches = task.requiredCapabilities.filter((cap) => {
      if (cap === "canAnalyze") return agent.capabilities.canAnalyze;
      if (cap === "canGenerate") return agent.capabilities.canGenerate;
      if (cap === "canReview") return agent.capabilities.canReview;
      if (cap === "canExecute") return agent.capabilities.canExecute;
      return false;
    }).length;

    return matches / task.requiredCapabilities.length;
  },

  /**
   * Calculate role appropriateness
   */
  calculateRoleAppropriateness(agent: Agent, task: Task): number {
    const roleTaskMap: Record<string, string[]> = {
      primary_strategist: ["coordination", "planning", "review"],
      member: ["analysis", "execution", "generation"],
      critic: ["review", "validation"],
      gatekeeper: ["validation", "approval"],
      observer: ["monitoring", "logging"],
    };

    const appropriateTasks = roleTaskMap[agent.role] || [];
    return appropriateTasks.includes(task.type) ? 1 : 0.5;
  },

  /**
   * Generate human-readable routing reasoning
   */
  generateRoutingReasoning(
    agent: Agent,
    task: Task,
    knowledgeScore: number,
    capabilityScore: number,
    loadScore: number
  ): string {
    const reasons: string[] = [];

    if (knowledgeScore > 0.7) {
      reasons.push(`Strong knowledge proximity (${(knowledgeScore * 100).toFixed(0)}%)`);
    } else if (knowledgeScore > 0.4) {
      reasons.push(`Moderate knowledge overlap`);
    }

    if (capabilityScore === 1) {
      reasons.push("Has all required capabilities");
    } else if (capabilityScore > 0.5) {
      reasons.push("Has most required capabilities");
    }

    if (loadScore > 0.7) {
      reasons.push("Low current workload");
    }

    if (agent.role === "primary_strategist" && task.type === "review") {
      reasons.push("Strategist role suitable for review tasks");
    }

    return reasons.join("; ") || "Default assignment";
  },

  /**
   * Estimate task duration for an agent
   */
  estimateTaskDuration(task: Task, agent: Agent): number {
    // Base duration
    let duration = task.estimatedDuration;

    // Adjust for knowledge proximity (higher = faster)
    const knowledgeFactor = 1 - (agent.processedKnowledge.size > 0 ? 0.3 : 0);

    // Adjust for current load (higher load = slower)
    const loadFactor = 1 + agent.currentLoad * 0.5;

    return Math.round(duration * knowledgeFactor * loadFactor);
  },

  /**
   * Calculate team efficiency metric
   */
  calculateTeamEfficiency(
    decisions: RoutingDecision[],
    agents: Agent[]
  ): number {
    if (decisions.length === 0) return 0;

    const avgConfidence =
      decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length;
    const avgLoad = agents.reduce((sum, a) => sum + a.currentLoad, 0) / agents.length;
    const loadBalance = 1 - Math.abs(avgLoad - 0.5) * 2; // Optimal at 50% load

    return avgConfidence * 0.6 + loadBalance * 0.4;
  },

  /**
   * Estimate total duration for all routing decisions
   */
  estimateTotalDuration(decisions: RoutingDecision[]): number {
    // Group by agent and calculate parallel execution
    const byAgent = new Map<string, RoutingDecision[]>();
    for (const d of decisions) {
      if (!byAgent.has(d.assignedAgentId)) {
        byAgent.set(d.assignedAgentId, []);
      }
      byAgent.get(d.assignedAgentId)!.push(d);
    }

    // Calculate max duration across all agents (parallel execution)
    let maxDuration = 0;
    for (const [agentId, agentDecisions] of byAgent) {
      const agentTotal = agentDecisions.reduce(
        (sum, d) => sum + d.expectedCompletion,
        0
      );
      maxDuration = Math.max(maxDuration, agentTotal);
    }

    return maxDuration;
  },

  /**
   * Calculate knowledge coverage metric
   */
  calculateKnowledgeCoverage(tasks: Task[], agents: Agent[]): number {
    const allTaskKnowledge = new Set(
      tasks.flatMap((t) => t.relatedKnowledgeIds)
    );
    if (allTaskKnowledge.size === 0) return 1;

    const coveredKnowledge = new Set<number>();
    for (const agent of agents) {
      for (const task of tasks) {
        if (agent.currentTasks.includes(task.id)) {
          task.relatedKnowledgeIds.forEach((id) => coveredKnowledge.add(id));
        }
      }
    }

    return coveredKnowledge.size / allTaskKnowledge.size;
  },

  /**
   * Update agent status after task completion
   */
  completeTask(agentId: string, taskId: string, success: boolean): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Remove task from current tasks
    agent.currentTasks = agent.currentTasks.filter((id) => id !== taskId);

    // Update load
    agent.currentLoad = Math.max(
      0,
      agent.currentLoad - 1 / (agent.currentTasks.length + 1)
    );

    // Update status
    if (agent.currentTasks.length === 0) {
      agent.status = "idle";
    }

    agent.lastActiveAt = new Date();

    if (!success) {
      agent.status = "error";
    }

    logger.info(
      `[AgentRouter] Task ${taskId} ${success ? "completed" : "failed"} by agent ${agentId}`
    );
  },

  /**
   * Get routing statistics for a mission
   */
  async getRoutingStats(missionId: number): Promise<{
    totalAgents: number;
    activeAgents: number;
    averageLoad: number;
    tasksRouted: number;
    averageKnowledgeProximity: number;
    teamEfficiency: number;
  }> {
    const missionAgents = Array.from(this.agents.values()).filter(
      (a) => a.missionId === missionId
    );

    return {
      totalAgents: missionAgents.length,
      activeAgents: missionAgents.filter((a) => a.status === "working").length,
      averageLoad:
        missionAgents.reduce((sum, a) => sum + a.currentLoad, 0) /
        missionAgents.length || 0,
      tasksRouted: missionAgents.reduce(
        (sum, a) => sum + a.currentTasks.length,
        0
      ),
      averageKnowledgeProximity: 0, // Would need historical tracking
      teamEfficiency: 0, // Would need historical tracking
    };
  },

  /**
   * Clear agents for a mission (cleanup)
   */
  clearMissionAgents(missionId: number): void {
    for (const [id, agent] of this.agents) {
      if (agent.missionId === missionId) {
        this.agents.delete(id);
      }
    }
    logger.info(`[AgentRouter] Cleared agents for mission ${missionId}`);
  },
};

export default knowledgeDrivenAgentRouter;
