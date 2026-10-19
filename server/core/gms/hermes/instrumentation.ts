/**
 * Hermes Protocol Instrumentation
 * 
 * Integrates the HermesTraceCollector with the existing hermes-protocol.service.ts
 * without modifying the original service (non-invasive integration).
 * 
 * Usage:
 * ```typescript
 * // Instead of calling hermesProtocolService directly:
 * const instrumented = new InstrumentedHermesService(traceCollector);
 * const result = await instrumented.reason(prompt, context);
 * // Trace is automatically collected
 * ```
 */

import { createLogger } from "../../../utils/logger.js";
import { 
  HermesProtocolService, 
  HermesParsedResponse, 
  HermesResponse,
  HermesToolCall 
} from "@domain/agents/core/hermes-protocol.service.js";
import { AIClientFactory } from "../../../domain/ai/core/ai-client.service.js";
import type { AIApiCallConfig } from "../../../../shared/schema/index.js";
import type { AgentContext } from "../../../domain/agents/core/types.js";
import type { HermesTraceCollector, DatabaseTraceStorage } from "./trace-collector.js";
import type { EnrichedHermesTrace, HermesTraceFeatures, HermesInstrumentationConfig } from "../common/types.js";

const logger = createLogger("HermesInstrumentation");

/**
 * Instrumented wrapper for HermesProtocolService
 * 
 * Automatically collects traces for GMS verifier training
 */
export class InstrumentedHermesService {
  private baseService: HermesProtocolService;
  private collector: HermesTraceCollector;
  
  constructor(collector: HermesTraceCollector) {
    this.baseService = new HermesProtocolService();
    this.collector = collector;
  }

  /**
   * Instrumented version of reason() method
   * 
   * Captures full Hermes trace including:
   * - Raw LLM output
   * - Parsed thinking/actions
   * - Token usage
   * - Agent context
   */
  async reason(
    prompt: string,
    options: {
      model?: string;
      agentContext?: AgentContext;
      systemPrompt?: string;
      temperature?: number;
    } = {}
  ): Promise<HermesResponse & { traceId?: string }> {
    const startTime = new Date();
    const toolResults = new Map<string, any>();
    
    try {
      // Call base service
      const result = await this.baseService.reason(
        prompt, 
        options.model || "gemini-2.0-flash"
      );
      
      const endTime = new Date();
      
      // Re-parse the raw output to get structured data
      const parsed = HermesProtocolService.parseResponse(result.raw || "");
      
      // Extract token usage from raw response if available
      const tokenUsage = this.extractTokenUsage(result.raw);
      
      // Collect the trace
      const traceId = await this.collector.collectTrace(parsed, {
        agentContext: options.agentContext,
        rawResponse: result.raw,
        tokenUsage,
        toolResults,
        startTime,
        endTime
      });
      
      logger.debug("Hermes trace collected", { traceId, promptLength: prompt.length });
      
      return {
        ...result,
        traceId: traceId || undefined
      };
    } catch (error) {
      // Still try to collect trace even on error
      const endTime = new Date();
      
      logger.error("Hermes reasoning failed:", error);
      
      // Re-throw to maintain original behavior
      throw error;
    }
  }

  /**
   * Parse and instrument any Hermes-formatted response
   * 
   * Use this when receiving Hermes output from other sources
   */
  async instrumentParse(
    text: string,
    context: {
      agentContext?: AgentContext;
      tokenUsage?: { total: number; prompt: number; completion: number };
      startTime?: Date;
      toolResults?: Map<string, any>;
    } = {}
  ): Promise<HermesParsedResponse & { traceId?: string }> {
    const startTime = context.startTime || new Date();
    const parsed = HermesProtocolService.parseResponse(text);
    const endTime = new Date();
    
    const traceId = await this.collector.collectTrace(parsed, {
      agentContext: context.agentContext,
      rawResponse: text,
      tokenUsage: context.tokenUsage 
        ? { ...context.tokenUsage, costUsd: undefined } 
        : undefined,
      toolResults: context.toolResults || new Map(),
      startTime,
      endTime
    });
    
    return {
      ...parsed,
      traceId: traceId || undefined
    };
  }

  /**
   * Instrument an agent loop that uses Hermes protocol
   * 
   * This wraps a full multi-step agent execution
   */
  async instrumentAgentLoop<T>(
    loopFn: () => Promise<T>,
    context: AgentContext,
    options: {
      onStep?: (step: number, traceId: string) => void;
    } = {}
  ): Promise<T> {
    const traceIds: string[] = [];
    
    // Wrap the agent's tool execution to capture results
    const originalExecute = this.patchToolExecution(context, (tool, result) => {
      // Tool results are captured via the patched executor
    });
    
    try {
      const result = await loopFn();
      
      // Update all traces with final outcome
      for (const traceId of traceIds) {
        await this.collector.updateOutcome(traceId, { success: true });
      }
      
      return result;
    } catch (error) {
      // Mark traces as failed
      for (const traceId of traceIds) {
        await this.collector.updateOutcome(traceId, { 
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      throw error;
    }
  }

  /**
   * Update outcome for a previously collected trace
   */
  async updateOutcome(
    traceId: string,
    outcome: { success: boolean; executionTime?: number; error?: string }
  ): Promise<void> {
    await this.collector.updateOutcome(traceId, outcome);
  }

  /**
   * Get collected trace by ID
   */
  async getTrace(traceId: string): Promise<EnrichedHermesTrace | null> {
    return this.collector.getEnrichedTrace(traceId);
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Extract token usage from response metadata if available
   */
  private extractTokenUsage(raw: string | undefined): { 
    total: number; 
    prompt: number; 
    completion: number;
    costUsd?: number;
  } | undefined {
    // This would parse metadata from the AI client's response
    // For now, return undefined to let caller provide it
    return undefined;
  }

  /**
   * Patch tool execution to capture results for trace
   */
  private patchToolExecution(
    context: AgentContext,
    onResult: (tool: string, result: any) => void
  ): () => void {
    // This would integrate with the tool execution system
    // to capture tool results for the trace
    // For now, this is a placeholder for future integration
    
    return () => {
      // Cleanup patch
    };
  }
}

/**
 * Factory for creating instrumented Hermes services
 * 
 * Usage pattern:
 * ```typescript
 * // In your service initialization
 * const instrumentedHermes = createInstrumentedHermes(db);
 * 
 * // Use throughout your services
 * const result = await instrumentedHermes.reason(prompt, { agentContext });
 * ```
 */
export async function createInstrumentedHermes(
  db: any,
  options: {
    embeddingEnabled?: boolean;
    sampleRate?: number;
  } = {}
): Promise<InstrumentedHermesService> {
  const { HermesTraceCollector, DatabaseTraceStorage } = await import("./trace-collector.js");
  const { TraceEmbeddingEngine } = await import("../embeddings/trace-embedder.js");
  
  // Create embedding engine
  const embedder = new TraceEmbeddingEngine();
  
  // Create storage
  const storage = new DatabaseTraceStorage(db);
  
  // Create collector
  const collector = new HermesTraceCollector(storage, async (text) => {
    return await embedder.embedText(text);
  }, {
    enabled: true,
    captureThinking: true,
    captureToolCalls: true,
    generateEmbeddings: options.embeddingEnabled ?? true,
    sampleRate: options.sampleRate ?? 1.0
  });
  
  return new InstrumentedHermesService(collector);
}

/**
 * Drop-in replacement for parseResponse that includes instrumentation
 * 
 * For existing code using HermesProtocolService.parseResponse() directly,
 * use this wrapper to enable trace collection.
 */
export function createInstrumentedParser(
  collector: HermesTraceCollector
) {
  return {
    parseResponse(
      text: string,
      context?: { agentContext?: AgentContext; startTime?: Date }
    ): HermesParsedResponse & { traceId?: string } {
      const startTime = context?.startTime || new Date();
      const parsed = HermesProtocolService.parseResponse(text);
      
      // Fire-and-forget trace collection
      collector.collectTrace(parsed, {
        agentContext: context?.agentContext,
        rawResponse: text,
        startTime,
        endTime: new Date()
      }).then(traceId => {
        logger.debug("Trace collected from parser", { traceId });
      }).catch(err => {
        logger.warn("Failed to collect trace from parser:", err);
      });
      
      return parsed;
    }
  };
}
