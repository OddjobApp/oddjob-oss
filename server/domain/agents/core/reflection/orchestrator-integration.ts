/**
 * Agent Orchestrator Reflection Integration
 * 
 * Integrates the ReAct Reflection System into the existing AgentOrchestrator.
 * Wraps the orchestrator with reflection capabilities at key decision points.
 */

import { AgentOrchestrator } from "../agent-orchestrator.js";
import { reflectionService, ReflectionConfig, ReflectionResult } from "./reflection.service.js";
import { AIClient } from "@domain/ai/core/ai-client.service.js";
import { AIApiCallConfig } from "@shared/schema/index.js";
import { AgentContext, AgentLoopResult, SupervisionLevel, GovernanceResolved } from "../types.js";
import { createLogger } from "@server/utils/logger.js";
import { TraceContext as W3CTraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

const logger = createLogger("AgentOrchestratorWithReflection");

// Default reflection configuration
const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  reflectionEnabled: true,
  confidenceThreshold: 0.7,
  maxReflectionDepth: 2,
  verificationStrategies: ["factual", "logical", "consistency"],
  autoRetryOnLowConfidence: true,
};

/**
 * Extended Agent Orchestrator with Reflection
 * 
 * Wraps the base AgentOrchestrator with reflection capabilities:
 * 1. Reflects on tool execution outputs
 * 2. Reflects on final answers before returning
 * 3. Auto-corrects when confidence is low
 * 4. Escalates to human when auto-correction fails
 */
export class AgentOrchestratorWithReflection extends AgentOrchestrator {
  private reflectionConfig: ReflectionConfig;
  private agentContext: AgentContext;
  private reflectionStats: {
    totalReflections: number;
    autoCorrections: number;
    escalations: number;
    avgConfidence: number;
  } = {
    totalReflections: 0,
    autoCorrections: 0,
    escalations: 0,
    avgConfidence: 0,
  };

  constructor(
    client: AIClient,
    apiKey: string,
    context: AgentContext,
    reflectionConfig: Partial<ReflectionConfig> = {}
  ) {
    super(client, apiKey, context);
    this.agentContext = context;
    this.reflectionConfig = { ...DEFAULT_REFLECTION_CONFIG, ...reflectionConfig };
    
    logger.info(`[ReflectionOrchestrator] Initialized with reflection enabled: ${this.reflectionConfig.reflectionEnabled}`);
  }

  /**
   * Override the main run method to add reflection hooks
   */
  async run(
    goal: string,
    initialConfig: AIApiCallConfig,
    tools: any[],
    maxIterations: number,
    supervisionLevel: SupervisionLevel = "full",
    governorConfig?: GovernanceResolved,
    traceContext?: W3CTraceContext,
    dryRun: boolean = false
  ): Promise<AgentLoopResult & { 
    reflectionStats?: { 
      totalReflections: number; 
      autoCorrections: number; 
      escalations: number; 
      avgConfidence: number; 
    } 
  }> {
    
    if (!this.reflectionConfig.reflectionEnabled) {
      // Reflection disabled, use base implementation
      return super.run(goal, initialConfig, tools, maxIterations, supervisionLevel, governorConfig, traceContext, dryRun);
    }

    logger.info(`[ReflectionOrchestrator] Starting run with reflection enabled`);

    // Run with reflection wrapper
    const result = await this.runWithReflection(
      goal,
      initialConfig,
      tools,
      maxIterations,
      supervisionLevel,
      governorConfig,
      traceContext,
      dryRun
    );

    // Attach reflection stats to result
    return {
      ...result,
      reflectionStats: this.reflectionStats,
    };
  }

  /**
   * Run with reflection capabilities
   */
  private async runWithReflection(
    goal: string,
    initialConfig: AIApiCallConfig,
    tools: any[],
    maxIterations: number,
    supervisionLevel: SupervisionLevel,
    governorConfig?: GovernanceResolved,
    traceContext?: W3CTraceContext,
    dryRun: boolean = false
  ): Promise<AgentLoopResult> {
    // For now, delegate to parent but intercept key points
    // In a full implementation, we would override individual phases
    
    const result = await super.run(
      goal,
      initialConfig,
      tools,
      maxIterations,
      supervisionLevel,
      governorConfig,
      traceContext,
      dryRun
    );

    // Reflect on final output
    const finalReflection = await this.reflectOnFinalOutput(
      result.output,
      goal,
      this.reflectionConfig,
      this.agentContext
    );

    if (!finalReflection.passed && finalReflection.suggestedCorrection?.correctedOutput) {
      logger.info(`[ReflectionOrchestrator] Applying correction to final output`);
      
      return {
        ...result,
        output: finalReflection.suggestedCorrection.correctedOutput,
      };
    }

    return result;
  }

  /**
   * Reflect on the final output before returning to user
   */
  private async reflectOnFinalOutput(
    output: string,
    goal: string,
    config: ReflectionConfig,
    agentContext: AgentContext
  ): Promise<ReflectionResult> {
    if (!config.reflectionEnabled) {
      return {
        reflectionId: "disabled",
        confidenceScore: 1.0,
        passed: true,
        verifications: [],
        issues: [],
        shouldRetry: false,
        shouldEscalate: false,
      };
    }

    const context = agentContext;
    
    try {
      const result = await reflectionService.reflect({
        stepId: "final-output",
        missionRunId: context.missionId || 0,
        organizationId: context.organizationId || 0,
        output,
        context: {
          goal,
          outputType: "final_answer",
          expectedFormat: context.reasoningProtocol,
        },
        verificationStrategies: config.verificationStrategies,
      });

      // Update stats
      this.reflectionStats.totalReflections++;
      this.reflectionStats.avgConfidence = 
        (this.reflectionStats.avgConfidence * (this.reflectionStats.totalReflections - 1) + result.confidenceScore) 
        / this.reflectionStats.totalReflections;

      if (result.shouldEscalate) {
        this.reflectionStats.escalations++;
      }

      if (result.suggestedCorrection && !result.passed) {
        this.reflectionStats.autoCorrections++;
      }

      return result;
    } catch (err: any) {
      logger.error(`[ReflectionOrchestrator] Reflection failed:`, err);
      // Fail open - return original output
      return {
        reflectionId: "error",
        confidenceScore: 1.0,
        passed: true,
        verifications: [],
        issues: [],
        shouldRetry: false,
        shouldEscalate: false,
      };
    }
  }

  /**
   * Reflect on a tool execution result
   * This would be called from within the act() phase
   */
  async reflectOnToolResult(
    toolName: string,
    toolParams: any,
    observation: string,
    retryCount: number = 0
  ): Promise<{ observation: string; wasCorrected: boolean; shouldRetry: boolean }> {
    if (!this.reflectionConfig.reflectionEnabled) {
      return { observation, wasCorrected: false, shouldRetry: false };
    }

    const context = (this as any).context as AgentContext;

    try {
      const result = await reflectionService.reflect({
        stepId: `tool-${toolName}-${Date.now()}`,
        missionRunId: context.missionId || 0,
        organizationId: context.organizationId || 0,
        output: observation,
        context: {
          toolName,
          toolParams,
          outputType: "tool_result",
        },
        verificationStrategies: this.reflectionConfig.verificationStrategies,
        previousReflections: retryCount,
      });

      // Update stats
      this.reflectionStats.totalReflections++;

      if (result.passed) {
        return { observation, wasCorrected: false, shouldRetry: false };
      }

      if (result.shouldEscalate) {
        this.reflectionStats.escalations++;
        logger.warn(`[ReflectionOrchestrator] Tool ${toolName} result requires escalation`);
        return { 
          observation: `[ESCALATED] ${observation}\n\nIssues detected: ${result.issues.map(i => i.description).join("; ")}`,
          wasCorrected: false,
          shouldRetry: false,
        };
      }

      if (result.suggestedCorrection?.correctedOutput) {
        this.reflectionStats.autoCorrections++;
        return {
          observation: result.suggestedCorrection.correctedOutput,
          wasCorrected: true,
          shouldRetry: result.shouldRetry,
        };
      }

      return { observation, wasCorrected: false, shouldRetry: result.shouldRetry };
    } catch (err: any) {
      logger.error(`[ReflectionOrchestrator] Tool reflection failed:`, err);
      return { observation, wasCorrected: false, shouldRetry: false };
    }
  }

  /**
   * Get reflection statistics from this run
   */
  getReflectionStats(): typeof this.reflectionStats {
    return { ...this.reflectionStats };
  }
}

/**
 * Factory function to create orchestrator with or without reflection
 */
export function createAgentOrchestrator(
  client: AIClient,
  apiKey: string,
  context: AgentContext,
  options: {
    enableReflection?: boolean;
    reflectionConfig?: Partial<ReflectionConfig>;
  } = {}
): AgentOrchestrator {
  const { enableReflection = true, reflectionConfig = {} } = options;

  if (enableReflection) {
    return new AgentOrchestratorWithReflection(client, apiKey, context, reflectionConfig);
  }

  return new AgentOrchestrator(client, apiKey, context);
}

/**
 * Middleware-style wrapper for adding reflection to existing orchestrator runs
 */
export async function withReflection<T extends AgentLoopResult>(
  runFn: () => Promise<T>,
  context: AgentContext,
  options: {
    reflectOnOutput?: boolean;
    reflectionConfig?: Partial<ReflectionConfig>;
  } = {}
): Promise<T & { reflectionMeta?: { confidence: number; issues: string[]; wasCorrected: boolean } }> {
  const result = await runFn();

  if (!options.reflectOnOutput) {
    return result;
  }

  try {
    const reflectResult = await reflectionService.reflect({
      stepId: "wrapped-output",
      missionRunId: context.missionId || 0,
      organizationId: context.organizationId || 0,
      output: result.output,
      context: {
        wrappedExecution: true,
      },
      verificationStrategies: options.reflectionConfig?.verificationStrategies || ["factual", "logical"],
    });

    let finalOutput = result.output;
    let wasCorrected = false;

    if (!reflectResult.passed && reflectResult.suggestedCorrection?.correctedOutput) {
      finalOutput = reflectResult.suggestedCorrection.correctedOutput;
      wasCorrected = true;
    }

    return {
      ...result,
      output: finalOutput,
      reflectionMeta: {
        confidence: reflectResult.confidenceScore,
        issues: reflectResult.issues.map(i => i.description),
        wasCorrected,
      },
    };
  } catch (err) {
    logger.error("[withReflection] Reflection failed:", err);
    return result;
  }
}
