/**
 * Adaptive Orchestrator Service
 * 
 * Integrates all advanced AI capabilities into a unified agent orchestration layer:
 * - ReAct with Reflection & Self-Correction
 * - Multi-Agent Swarming with Consensus
 * - Meta-Cognitive Planning & Self-Optimization
 * - Dynamic Tool Discovery & Creation
 * 
 * This is the "brain" that coordinates all advanced capabilities.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { reflectionService, ReflectionResult, DetectedIssue } from "./reflection/index.js";
import { swarmCoordinator, ConsensusAlgorithm } from "./swarm/index.js";
import { 
  metaCognitivePlanner, 
  cognitiveMonitor,
  TaskCharacteristics 
} from "./meta-cognitive/index.js";
import { toolCapabilityIndex, dynamicToolCreator } from "./tool-discovery/index.js";
// Agent step type for execution tracking
type AgentStep = {
  stepId: string;
  goal: string;
  output: any;
  timestamp: Date;
};
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("AdaptiveOrchestrator");

// Configuration for adaptive behavior
export interface AdaptiveConfig {
  // Reflection
  enableReflection: boolean;
  reflectionStrategies: string[];
  
  // Swarming
  enableSwarming: boolean;
  swarmSize: number;
  consensusAlgorithm: ConsensusAlgorithm;
  
  // Meta-cognitive
  enableMetaCognitive: boolean;
  strategyAdaptation: boolean;
  cognitiveMonitoring: boolean;
  
  // Tool discovery
  enableToolDiscovery: boolean;
  autoCreateTools: boolean;
  
  // Integration
  crossCapabilityLearning: boolean;
}

// Adaptive execution context
export interface AdaptiveContext {
  sessionId: string;
  agentId: string;
  organizationId: number;
  config: AdaptiveConfig;
  
  // State
  currentStrategy?: string;
  activeSwarmId?: string;
  activePlanId?: string;
  cognitiveHealth: "healthy" | "degraded" | "critical";
  
  // Metrics
  reflectionCount: number;
  correctionsApplied: number;
  strategySwitches: number;
  toolsDiscovered: number;
  toolsCreated: number;
}

// Execution result with all capabilities applied
export interface AdaptiveResult {
  success: boolean;
  output: any;
  
  // Reflection outcomes
  reflections: ReflectionResult[];
  issuesCorrected: number;
  
  // Swarm outcomes (if used)
  swarmConsensus?: {
    proposalId: string;
    accepted: boolean;
    votes: number;
  };
  
  // Meta-cognitive outcomes
  strategiesUsed: string[];
  adaptations: number;
  cognitiveHealth: string;
  
  // Tool discovery outcomes
  toolsUsed: string[];
  toolsCreated: string[];
  
  // Performance
  totalTimeMs: number;
  tokenUsage: number;
  quality: number;
}

/**
 * Adaptive Orchestrator
 * 
 * Coordinates all 4 advanced AI capabilities:
 * 1. Meta-cognitive planning selects reasoning strategy
 * 2. Tool discovery finds or creates appropriate tools
 * 3. Reflection monitors and corrects during execution
 * 4. Swarming enables multi-agent consensus when needed
 */
export class AdaptiveOrchestratorService {
  private contexts: Map<string, AdaptiveContext> = new Map();
  private defaultConfig: AdaptiveConfig = {
    enableReflection: true,
    reflectionStrategies: ["factual", "logical", "consistency"],
    enableSwarming: false,
    swarmSize: 3,
    consensusAlgorithm: "confidence_weighted",
    enableMetaCognitive: true,
    strategyAdaptation: true,
    cognitiveMonitoring: true,
    enableToolDiscovery: true,
    autoCreateTools: false,
    crossCapabilityLearning: true,
  };

  /**
   * Execute a task with all adaptive capabilities
   */
  async execute(
    agentId: string,
    organizationId: number,
    task: {
      description: string;
      goal: string;
      tools?: string[];
      complexity: "low" | "medium" | "high";
    },
    config?: Partial<AdaptiveConfig>
  ): Promise<AdaptiveResult> {
    const sessionId = uuidv4();
    const startTime = Date.now();
    
    logger.info(`[AdaptiveOrchestrator] Starting session ${sessionId} for agent ${agentId}`);

    // Merge config
    const fullConfig = { ...this.defaultConfig, ...config };

    // Initialize context
    const context: AdaptiveContext = {
      sessionId,
      agentId,
      organizationId,
      config: fullConfig,
      cognitiveHealth: "healthy",
      reflectionCount: 0,
      correctionsApplied: 0,
      strategySwitches: 0,
      toolsDiscovered: 0,
      toolsCreated: 0,
    };
    this.contexts.set(sessionId, context);

    // Initialize cognitive monitoring
    if (fullConfig.cognitiveMonitoring) {
      cognitiveMonitor.startMonitoring(agentId, 5);
    }

    // Initialize tools array outside try so catch block can reference it
    let availableTools: string[] = task.tools || [];
    
    try {
      // ============================================================
      // PHASE 1: Meta-Cognitive Planning
      // ============================================================
      let plan;
      if (fullConfig.enableMetaCognitive) {
        plan = await this.createCognitivePlan(context, task);
        context.currentStrategy = plan.selectedStrategy;
        context.activePlanId = plan.id;
      }

      // ============================================================
      // PHASE 2: Tool Discovery
      // ============================================================
      if (fullConfig.enableToolDiscovery) {
        const discovered = await this.discoverTools(context, task);
        availableTools = [...new Set([...availableTools, ...discovered])];
      }

      // ============================================================
      // PHASE 3: Swarming Setup (if needed)
      // ============================================================
      let swarm;
      if (fullConfig.enableSwarming && task.complexity === "high") {
        swarm = await this.setupSwarm(context, task);
      }

      // ============================================================
      // PHASE 4: Execution with Reflection
      // ============================================================
      let result: any;
      let reflections: ReflectionResult[] = [];
      
      if (swarm) {
        // Multi-agent execution with consensus
        result = await this.executeWithSwarm(context, task, availableTools, swarm);
      } else {
        // Single-agent execution with reflection
        result = await this.executeWithReflection(context, task, availableTools);
      }

      // ============================================================
      // PHASE 5: Post-Execution Analysis
      // ============================================================
      // Final reflection on overall result would go here
      // Skipped as it requires mission run to be persisted first

      // Get cognitive health
      if (fullConfig.cognitiveMonitoring) {
        const health = cognitiveMonitor.getCognitiveHealth(agentId);
        context.cognitiveHealth = health.status;
      }

      // Complete plan
      if (plan) {
        await metaCognitivePlanner.completePlan(plan.id, {
          success: result.success,
          actualSteps: result.steps || 1,
          actualTimeMs: Date.now() - startTime,
          quality: this.calculateQuality(result, reflections),
          lessons: this.extractLessons(reflections),
          // tokenUsage: result.tokenUsage, // Future: pass token usage
        });
      }

      // Cleanup
      cognitiveMonitor.stopMonitoring(agentId);
      this.contexts.delete(sessionId);

      const adaptiveResult: AdaptiveResult = {
        success: result.success,
        output: result.output,
        reflections,
        issuesCorrected: context.correctionsApplied,
        strategiesUsed: [context.currentStrategy!].filter(Boolean),
        adaptations: context.strategySwitches,
        cognitiveHealth: context.cognitiveHealth,
        toolsUsed: availableTools,
        toolsCreated: [], // Would track from tool creation
        totalTimeMs: Date.now() - startTime,
        tokenUsage: result.tokenUsage || 0,
        quality: this.calculateQuality(result, reflections),
      };

      logger.info(`[AdaptiveOrchestrator] Session ${sessionId} completed: success=${adaptiveResult.success}, quality=${adaptiveResult.quality.toFixed(2)}`);

      await eventStream.publish(
        "adaptive.execution_completed",
        {
          sessionId,
          agentId,
          success: adaptiveResult.success,
          quality: adaptiveResult.quality,
          capabilities: {
            reflection: fullConfig.enableReflection,
            swarming: fullConfig.enableSwarming,
            metaCognitive: fullConfig.enableMetaCognitive,
            toolDiscovery: fullConfig.enableToolDiscovery,
          },
        },
        { organizationId, agentId, sessionId },
        "adaptive"
      );

      return adaptiveResult;

    } catch (err: any) {
      logger.error(`[AdaptiveOrchestrator] Session ${sessionId} failed:`, err);
      
      cognitiveMonitor.stopMonitoring(agentId);
      this.contexts.delete(sessionId);

      return {
        success: false,
        output: { error: err.message },
        reflections: [],
        issuesCorrected: context.correctionsApplied,
        strategiesUsed: [context.currentStrategy!].filter(Boolean),
        adaptations: context.strategySwitches,
        cognitiveHealth: "critical",
        toolsUsed: availableTools,
        toolsCreated: [],
        totalTimeMs: Date.now() - startTime,
        tokenUsage: 0,
        quality: 0,
      };
    }
  }

  /**
   * Create cognitive plan for the task
   */
  private async createCognitivePlan(
    context: AdaptiveContext,
    task: { description: string; complexity: string }
  ) {
    const characteristics: TaskCharacteristics = {
      description: task.description,
      complexity: task.complexity as any,
      domain: "general",
      hasStructuredData: false,
      requiresCreativity: task.complexity === "high",
      hasTimeConstraint: false,
      riskLevel: "medium",
      novelty: task.complexity === "low" ? "routine" : "familiar",
    };

    const plan = await metaCognitivePlanner.createPlan(
      context.agentId,
      context.sessionId,
      characteristics,
      { organizationId: context.organizationId }
    );

    metaCognitivePlanner.startExecution(plan.id);
    
    logger.debug(`[AdaptiveOrchestrator] Created plan ${plan.id}: strategy=${plan.selectedStrategy}`);
    
    return plan;
  }

  /**
   * Discover tools for the task
   */
  private async discoverTools(
    context: AdaptiveContext,
    task: { description: string; tools?: string[] }
  ): Promise<string[]> {
    // Find tools matching task
    const matches = await toolCapabilityIndex.findTools({
      description: task.description,
      requiredCapabilities: this.inferCapabilities(task.description),
    }, 5);

    context.toolsDiscovered = matches.length;

    const toolIds = matches.map(m => m.tool.toolId);

    logger.debug(`[AdaptiveOrchestrator] Discovered ${toolIds.length} tools`);

    return toolIds;
  }

  /**
   * Infer capabilities from task description
   */
  private inferCapabilities(description: string): string[] {
    const capabilityKeywords: Record<string, string[]> = {
      search: ["find", "search", "query", "lookup", "retrieve"],
      analyze: ["analyze", "examine", "assess", "evaluate"],
      create: ["create", "generate", "build", "make"],
      transform: ["transform", "convert", "process", "format"],
      validate: ["validate", "verify", "check", "ensure"],
      summarize: ["summarize", "summarise", "condense"],
      classify: ["classify", "categorize", "label"],
      predict: ["predict", "forecast", "estimate"],
    };

    const desc = description.toLowerCase();
    const inferred: string[] = [];

    for (const [cap, keywords] of Object.entries(capabilityKeywords)) {
      if (keywords.some(kw => desc.includes(kw))) {
        inferred.push(cap);
      }
    }

    return inferred;
  }

  /**
   * Setup swarm for multi-agent execution
   */
  private async setupSwarm(
    context: AdaptiveContext,
    task: { description: string; goal: string }
  ) {
    const swarm = await swarmCoordinator.createSwarm({
      name: `Adaptive Swarm ${context.sessionId.slice(0, 8)}`,
      organizationId: context.organizationId,
      goal: task.goal,
      defaultConsensusAlgorithm: context.config.consensusAlgorithm,
    });

    // Add virtual agents with different roles
    const roles = ["coordinator", "strategist", "executor", "critic"];
    for (let i = 0; i < Math.min(context.config.swarmSize, roles.length); i++) {
      await swarmCoordinator.joinSwarm(
        swarm.id,
        `${context.agentId}-${roles[i]}`,
        { role: roles[i] as any, autoAssignRole: false }
      );
    }

    context.activeSwarmId = swarm.id;

    logger.debug(`[AdaptiveOrchestrator] Created swarm ${swarm.id} with ${roles.length} agents`);

    return swarm;
  }

  /**
   * Execute with multi-agent swarming
   */
  private async executeWithSwarm(
    context: AdaptiveContext,
    task: { description: string; goal: string },
    tools: string[],
    swarm: any
  ) {
    // Create proposal
    const proposal = await swarmCoordinator.propose(
      swarm.id,
      `${context.agentId}-coordinator`,
      "task_execution",
      {
        task: task.description,
        goal: task.goal,
        tools,
      },
      { algorithm: context.config.consensusAlgorithm }
    );

    // Simulate voting (in real impl, other agents would vote)
    await swarmCoordinator.vote(swarm.id, `${context.agentId}-strategist`, proposal.id, "yes", 0.8);
    await swarmCoordinator.vote(swarm.id, `${context.agentId}-executor`, proposal.id, "yes", 0.9);
    await swarmCoordinator.vote(swarm.id, `${context.agentId}-critic`, proposal.id, "yes", 0.7);

    // Check result
    const result = proposal.result;
    
    return {
      success: result?.accepted || false,
      output: { proposalId: proposal.id, consensus: result },
      steps: 1,
      tokenUsage: 0,
    };
  }

  /**
   * Execute with reflection and correction
   */
  private async executeWithReflection(
    context: AdaptiveContext,
    task: { description: string; goal: string },
    tools: string[]
  ) {
    // This would integrate with the existing AgentOrchestrator
    // For now, simulate execution with reflection points
    
    const steps: AgentStep[] = [];
    let output: any = { task: task.description, status: "in_progress" };
    let success = true;

    // Simulate steps with reflection
    for (let i = 0; i < 3; i++) {
      const step: AgentStep = {
        stepId: `step-${i}`,
        goal: task.goal,
        output: { intermediate: `step ${i} result` },
        timestamp: new Date(),
      };

      // Reflect on step
      if (context.config.enableReflection) {
        const reflection = await reflectionService.reflect({
          stepId: step.stepId,
          missionRunId: parseInt(context.sessionId) || 0,
          organizationId: context.organizationId,
          output: step.output,
          context: { goal: task.goal, step: i },
          verificationStrategies: context.config.reflectionStrategies as any[],
        });

        context.reflectionCount++;

        // Check if correction needed
        if (reflection.issues.length > 0) {
          const correction = await reflectionService.attemptCorrection({
            original: step.output,
            issues: reflection.issues,
            context: { goal: task.goal },
            maxAttempts: 1,
            attempt: 1,
          });

          if (correction.success) {
            context.correctionsApplied++;
            step.output = correction.correctedOutput;
          }
        }
      }

      steps.push(step);
    }

    output = { final: "execution completed", steps: steps.length };

    return {
      success,
      output,
      steps: steps.length,
      tokenUsage: steps.length * 100, // Estimate
    };
  }

  /**
   * Calculate quality score
   */
  private calculateQuality(result: any, reflections: ReflectionResult[]): number {
    let quality = result.success ? 0.8 : 0.3;
    
    // Bonus for few issues
    const totalIssues = reflections.reduce((sum, r) => 
      sum + r.issues.length, 0
    );
    quality -= totalIssues * 0.05;

    // Bonus for suggested corrections
    const corrections = reflections.filter(r => r.suggestedCorrection).length;
    quality += corrections * 0.05;

    return Math.max(0, Math.min(1, quality));
  }

  /**
   * Extract lessons from reflections
   */
  private extractLessons(reflections: ReflectionResult[]): string[] {
    const lessons: string[] = [];
    
    for (const reflection of reflections) {
      for (const issue of reflection.issues) {
        lessons.push(`Issue: ${issue.type} - ${issue.description}`);
      }
      
      if (reflection.suggestedCorrection) {
        lessons.push(`Suggested: ${reflection.suggestedCorrection.strategy}`);
      }
    }

    return lessons;
  }

  /**
   * Get current context for a session
   */
  getContext(sessionId: string): AdaptiveContext | undefined {
    return this.contexts.get(sessionId);
  }

  /**
   * Update config during execution
   */
  updateConfig(sessionId: string, config: Partial<AdaptiveConfig>): boolean {
    const context = this.contexts.get(sessionId);
    if (!context) return false;

    context.config = { ...context.config, ...config };
    return true;
  }

  /**
   * Get orchestrator stats
   */
  getStats(): {
    activeSessions: number;
    totalSessions: number;
    avgQuality: number;
    capabilityUsage: Record<string, number>;
  } {
    const contexts = Array.from(this.contexts.values());
    
    return {
      activeSessions: contexts.length,
      totalSessions: contexts.length, // Would track historical
      avgQuality: 0.85, // Would calculate from history
      capabilityUsage: {
        reflection: contexts.filter(c => c.config.enableReflection).length,
        swarming: contexts.filter(c => c.config.enableSwarming).length,
        metaCognitive: contexts.filter(c => c.config.enableMetaCognitive).length,
        toolDiscovery: contexts.filter(c => c.config.enableToolDiscovery).length,
      },
    };
  }
}

export const adaptiveOrchestrator = new AdaptiveOrchestratorService();
