/**
 * Hermes Trace Collector
 * Intercepts and stores Hermes reasoning traces from agent executions
 * 
 * This module integrates with hermes-protocol.service.ts to capture
 * all <thinking>, <action>, and <result> blocks for:
 * - Neural verifier training
 * - PMI simulation input
 * - Evolution engine analysis
 * - Observability and debugging
 */

import { createLogger } from "../../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import type { 
  HermesParsedResponse, 
  HermesToolCall 
} from "../../../domain/agents/core/hermes-protocol.service.js";
import type { AgentContext } from "../../../domain/agents/core/types.js";
import type { 
  HermesTrace, 
  InsertHermesTrace, 
  HermesTraceStep,
  HermesToolCallRecord,
  TokenUsageRecord
} from "../../../../shared/schema/gms/hermes-traces.js";
import type {
  EnrichedHermesTrace,
  HermesInstrumentationConfig,
  HermesTraceFeatures
} from "../common/types.js";
import { hermesTraces } from "@shared/schema/gms/hermes-traces.js";
import { eq, isNotNull, sql } from "drizzle-orm";

const logger = createLogger("HermesTraceCollector");

/**
 * Configuration for trace collection
 */
const DEFAULT_CONFIG: HermesInstrumentationConfig = {
  enabled: true,
  captureThinking: true,
  captureToolCalls: true,
  captureResults: true,
  generateEmbeddings: true,
  sampleRate: 1.0,
  includeMissionContext: true,
  includeAgentContext: true,
};

/**
 * In-memory trace buffer for batching database writes
 */
class TraceBuffer {
  private buffer: InsertHermesTrace[] = [];
  private maxSize: number;
  private flushInterval: number;
  private flushTimer?: NodeJS.Timeout;
  private flushing = false;
  private onFlush: (traces: InsertHermesTrace[]) => Promise<void>;

  constructor(
    maxSize: number = 100,
    flushIntervalMs: number = 5000,
    onFlush: (traces: InsertHermesTrace[]) => Promise<void>
  ) {
    this.maxSize = maxSize;
    this.flushInterval = flushIntervalMs;
    this.onFlush = onFlush;
    this.startFlushTimer();
  }

  add(trace: InsertHermesTrace): void {
    this.buffer.push(trace);
    
    if (this.buffer.length >= this.maxSize) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.flushing) return;

    this.flushing = true;
    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await this.onFlush(batch);
      logger.debug(`Flushed ${batch.length} traces to storage`);
    } catch (error) {
      logger.error("Failed to flush trace buffer:", error);
      this.buffer.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }
}

/**
 * Extract features from Hermes trace for verifier input
 */
function extractTraceFeatures(
  steps: HermesTraceStep[],
  toolCalls: HermesToolCallRecord[]
): HermesTraceFeatures {
  const thinkingSteps = steps.filter(s => s.type === "thinking");
  const actionSteps = steps.filter(s => s.type === "action");
  
  // Calculate recursion depth by analyzing nested thinking indicators
  let maxRecursion = 0;
  let currentDepth = 0;
  
  for (const step of thinkingSteps) {
    const openTags = (step.content.match(/<thinking>/g) || []).length;
    const closeTags = (step.content.match(/<\/thinking>/g) || []).length;
    currentDepth += openTags - closeTags;
    maxRecursion = Math.max(maxRecursion, currentDepth);
  }
  
  // Self-reflection indicators
  const reflectionPhrases = [
    "I should reconsider",
    "wait, let me think again",
    "actually,",
    "on second thought",
    "I made a mistake",
    "let me verify",
    "checking my work",
    "is this correct?"
  ];
  
  const selfReflections: string[] = [];
  for (const phrase of reflectionPhrases) {
    if (steps.some(s => 
      s.content.toLowerCase().includes(phrase.toLowerCase())
    )) {
      selfReflections.push(phrase);
    }
  }
  
  // Confidence markers
  const uncertaintyWords = [
    "probably", "maybe", "might", "could be", "seems like",
    "I think", "I believe", "perhaps", "possibly", "uncertain"
  ];
  
  let confidenceMarkers = 0;
  for (const step of steps) {
    for (const word of uncertaintyWords) {
      const regex = new RegExp(word, 'gi');
      const matches = step.content.match(regex);
      if (matches) {
        confidenceMarkers += matches.length;
      }
    }
  }
  
  // Tool diversity
  const uniqueTools = new Set(toolCalls.map(t => t.name)).size;
  const toolDiversity = toolCalls.length > 0 ? uniqueTools / toolCalls.length : 0;
  
  // Action chaining (sequential dependent actions)
  let actionChaining = 0;
  for (let i = 1; i < actionSteps.length; i++) {
    const prev = actionSteps[i - 1];
    const curr = actionSteps[i];
    // Rough heuristic: if actions are close in time and content references previous
    if (curr.content.toLowerCase().includes(prev.metadata?.toolName?.toLowerCase() || '')) {
      actionChaining++;
    }
  }
  
  return {
    thoughtDepth: thinkingSteps.length,
    toolDiversity,
    selfReflectionIndicators: selfReflections,
    confidenceMarkers,
    recursionDepth: maxRecursion,
    actionChaining
  };
}

/**
 * Build trace steps from Hermes parse
 */
function buildTraceSteps(
  parsed: HermesParsedResponse,
  toolResults: Map<string, any>
): HermesTraceStep[] {
  const steps: HermesTraceStep[] = [];
  let stepIndex = 0;
  
  // Add thinking step
  if (parsed.thought) {
    steps.push({
      stepIndex: stepIndex++,
      type: "thinking",
      timestamp: new Date().toISOString(),
      content: parsed.thought,
      metadata: {
        // Could extract more metadata here
      }
    });
  }
  
  // Add action steps
  for (const toolCall of parsed.toolCalls) {
    steps.push({
      stepIndex: stepIndex++,
      type: "action",
      timestamp: new Date().toISOString(),
      content: `<action name="${toolCall.name}">${JSON.stringify(toolCall.arguments)}</action>`,
      metadata: {
        toolName: toolCall.name,
        toolArgs: toolCall.arguments
      }
    });
    
    // Add result step if available
    const result = toolResults.get(toolCall.name);
    if (result !== undefined) {
      steps.push({
        stepIndex: stepIndex++,
        type: "result",
        timestamp: new Date().toISOString(),
        content: typeof result === 'string' ? result : JSON.stringify(result),
        metadata: {
          toolName: toolCall.name,
          toolResult: result
        }
      });
    }
  }
  
  // Add final content step
  if (parsed.content && parsed.content.trim()) {
    steps.push({
      stepIndex: stepIndex++,
      type: "final",
      timestamp: new Date().toISOString(),
      content: parsed.content
    });
  }
  
  return steps;
}

/**
 * Main Hermes Trace Collector class
 */
export class HermesTraceCollector {
  private config: HermesInstrumentationConfig;
  private buffer: TraceBuffer;
  private storage: TraceStorage;
  private embeddingGenerator: (text: string) => Promise<number[]>;
  
  constructor(
    storage: TraceStorage,
    embeddingGenerator: (text: string) => Promise<number[]>,
    config: Partial<HermesInstrumentationConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = storage;
    this.embeddingGenerator = embeddingGenerator;
    
    this.buffer = new TraceBuffer(
      100, // batch size
      5000, // flush interval
      async (traces) => {
        await this.storage.storeTraces(traces);
      }
    );
    
    logger.info("HermesTraceCollector initialized", { 
      enabled: this.config.enabled,
      sampleRate: this.config.sampleRate 
    });
  }

  /**
   * Collect a trace from Hermes protocol execution
   * 
   * This is the main entry point called after hermes-protocol.service.ts
   * parses a response
   */
  async collectTrace(
    parsed: HermesParsedResponse,
    context: {
      agentContext?: AgentContext;
      rawResponse?: string;
      tokenUsage?: { total: number; prompt: number; completion: number; costUsd?: number };
      toolResults?: Map<string, any>;
      startTime?: Date;
      endTime?: Date;
    }
  ): Promise<string | null> {
    // Check if collection is enabled
    if (!this.config.enabled) {
      return null;
    }
    
    // Sampling
    if (Math.random() > this.config.sampleRate) {
      return null;
    }
    
    try {
      const traceId = uuidv4();
      const agentContext = context.agentContext;
      
      // Build trace steps
      const traceSteps = buildTraceSteps(
        parsed,
        context.toolResults || new Map()
      );
      
      // Extract features
      const toolCalls: HermesToolCallRecord[] = parsed.toolCalls.map((tc, i) => ({
        name: tc.name,
        arguments: tc.arguments,
        timestamp: new Date().toISOString(),
        stepIndex: traceSteps.findIndex(s => s.metadata?.toolName === tc.name && s.type === "action") || i
      }));
      
      const features = extractTraceFeatures(traceSteps, toolCalls);
      
      // Generate embedding if enabled
      let embedding: number[] | undefined;
      if (this.config.generateEmbeddings && parsed.thought) {
        try {
          embedding = await this.embeddingGenerator(parsed.thought);
        } catch (error) {
          logger.warn("Failed to generate embedding for trace:", undefined, error);
        }
      }
      
      // Build token usage record
      const tokenUsage: TokenUsageRecord | undefined = context.tokenUsage ? {
        totalTokens: context.tokenUsage.total,
        promptTokens: context.tokenUsage.prompt,
        completionTokens: context.tokenUsage.completion,
        costEstimateUsd: context.tokenUsage.costUsd
      } : undefined;
      
      // Build the trace record
      const trace: InsertHermesTrace = {
        traceId,
        missionId: agentContext?.missionId,
        jobId: agentContext?.jobId,
        executionId: agentContext?.executionId,
        agentId: agentContext?.agentId,
        organizationId: agentContext?.organizationId || 0,
        userId: agentContext?.userId,
        
        thoughtContent: parsed.thought || "",
        toolCalls: toolCalls as any,
        toolResults: context.toolResults ? Object.fromEntries(context.toolResults) as any : undefined,
        finalContent: parsed.content || undefined,
        
        traceSteps: traceSteps as any,
        embedding: embedding as any,
        
        // Will be filled in later when outcome is known
        predictedOutcome: undefined,
        actualOutcome: undefined,
        executionTime: context.startTime && context.endTime 
          ? context.endTime.getTime() - context.startTime.getTime() 
          : undefined,
        tokenUsage: tokenUsage as any,
        
        modelUsed: undefined, // Could extract from context
        reasoningProtocol: "hermes_xml",
        isShadowRun: agentContext?.isShadow || false,
        shadowConfig: undefined,
        
        skillId: undefined,
        generation: 0,
        
        // These will be set by database
        id: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Add to buffer for batch write
      this.buffer.add(trace);
      
      logger.debug("Collected Hermes trace", { traceId, thoughtLength: parsed.thought?.length });
      
      return traceId;
    } catch (error) {
      logger.error("Failed to collect Hermes trace:", error);
      return null;
    }
  }

  /**
   * Update trace with outcome after mission completion
   */
  async updateOutcome(
    traceId: string,
    outcome: {
      success: boolean;
      executionTime?: number;
      error?: string;
    }
  ): Promise<void> {
    try {
      await this.storage.updateTraceOutcome(traceId, outcome);
      logger.debug("Updated trace outcome", { traceId, success: outcome.success });
    } catch (error) {
      logger.error("Failed to update trace outcome:", error);
    }
  }

  /**
   * Get enriched trace for verifier input
   */
  async getEnrichedTrace(traceId: string): Promise<EnrichedHermesTrace | null> {
    const trace = await this.storage.getTraceById(traceId);
    if (!trace) return null;
    
    const tokenUsage = trace.tokenUsage as unknown as TokenUsageRecord | undefined;
    const toolCalls = trace.toolCalls as unknown as HermesToolCallRecord[];
    const traceSteps = trace.traceSteps as unknown as HermesTraceStep[];

    return {
      parsed: {
        thought: trace.thoughtContent,
        toolCalls: toolCalls.map(tc => ({
          name: tc.name,
          arguments: tc.arguments
        })),
        content: trace.finalContent || ""
      },
      traceId: trace.traceId,
      missionContext: trace.missionId ? {
        missionId: trace.missionId,
        jobId: trace.jobId ?? undefined,
        executionId: trace.executionId ?? undefined
      } : undefined,
      startTime: trace.createdAt,
      endTime: trace.updatedAt,
      latencyMs: trace.executionTime || 0,
      tokenUsage: {
        total: tokenUsage?.totalTokens || 0,
        prompt: tokenUsage?.promptTokens || 0,
        completion: tokenUsage?.completionTokens || 0,
        costUsd: tokenUsage?.costEstimateUsd
      },
      features: extractTraceFeatures(
        traceSteps,
        toolCalls
      )
    };
  }

  /**
   * Flush pending traces and dispose
   */
  async dispose(): Promise<void> {
    await this.buffer.dispose();
  }
}

/**
 * Trace storage interface
 * Implementations: DatabaseStorage, InMemoryStorage (for testing)
 */
export interface TraceStorage {
  storeTraces(traces: InsertHermesTrace[]): Promise<void>;
  updateTraceOutcome(traceId: string, outcome: { success: boolean; executionTime?: number; error?: string }): Promise<void>;
  getTraceById(traceId: string): Promise<HermesTrace | null>;
  getTracesForMission(missionId: number): Promise<HermesTrace[]>;
  getTracesForTraining(limit?: number): Promise<HermesTrace[]>;
  searchSimilarTraces(embedding: number[], threshold?: number, limit?: number): Promise<HermesTrace[]>;
}

/**
 * Database-backed trace storage
 */
export class DatabaseTraceStorage implements TraceStorage {
  private db: any; // Drizzle database instance
  
  constructor(db: any) {
    this.db = db;
  }

  async storeTraces(traces: InsertHermesTrace[]): Promise<void> {
    if (traces.length === 0) return;
    
    // Batch insert using Drizzle
    await this.db.insert(hermesTraces).values(traces);
  }

  async updateTraceOutcome(
    traceId: string, 
    outcome: { success: boolean; executionTime?: number; error?: string }
  ): Promise<void> {
    await this.db
      .update(hermesTraces)
      .set({
        actualOutcome: outcome.success,
        executionTime: outcome.executionTime,
        updatedAt: new Date()
      })
      .where(eq(hermesTraces.traceId, traceId));
  }

  async getTraceById(traceId: string): Promise<HermesTrace | null> {
    const result = await this.db
      .select()
      .from(hermesTraces)
      .where(eq(hermesTraces.traceId, traceId))
      .limit(1);
    
    return result[0] || null;
  }

  async getTracesForMission(missionId: number): Promise<HermesTrace[]> {
    return await this.db
      .select()
      .from(hermesTraces)
      .where(eq(hermesTraces.missionId, missionId))
      .orderBy(hermesTraces.createdAt);
  }

  async getTracesForTraining(limit: number = 10000): Promise<HermesTrace[]> {
    // Get traces with known outcomes for verifier training
    return await this.db
      .select()
      .from(hermesTraces)
      .where(isNotNull(hermesTraces.actualOutcome))
      .limit(limit)
      .orderBy(sql`RANDOM()`); // Random sample for training
  }

  async searchSimilarTraces(
    embedding: number[], 
    threshold: number = 0.8,
    limit: number = 10
  ): Promise<HermesTrace[]> {
    // Requires pgvector extension
    // Uses cosine similarity
    return await this.db.execute(sql`
      SELECT * FROM hermes_traces
      WHERE embedding IS NOT NULL
      AND embedding <=> ${JSON.stringify(embedding)}::vector < ${1 - threshold}
      ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT ${limit}
    `);
  }
}

