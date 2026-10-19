/**
 * Shadow Executor
 * 
 * Runs mission blueprints in isolated sandboxes to collect ground truth
 * without affecting production systems.
 * 
 * Isolation levels:
 * - process: Separate Node.js process (default)
 * - container: Docker container (recommended for production)
 * - vm: Full VM isolation (highest security, slower)
 * 
 * Key capabilities:
 * - Execute N variations of a blueprint in parallel
 * - Intercept and mock external API calls
 * - Capture full Hermes traces
 * - Measure actual latency, cost, success
 * - Collect failure modes for analysis
 */

import { createLogger } from "../../../utils/logger.js";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import type {
  BlueprintCandidate,
  ShadowRunConfig,
  ShadowResult,
  ShadowRunDetail,
  HermesTraceSummary,
  FailureMode
} from "../common/types.js";

const logger = createLogger("ShadowExecutor");

export interface ExecutorConfig {
  isolationLevel: "process" | "container" | "vm";
  maxConcurrentRuns: number;
  defaultTimeout: number;       // ms per run
  mockExternalCalls: boolean;   // Intercept HTTP/API calls
  recordTraces: boolean;
  cleanupAfterRun: boolean;
  
  // Resource limits
  maxMemoryMb: number;
  maxCpuPercent: number;
}

const DEFAULT_CONFIG: ExecutorConfig = {
  isolationLevel: "process",
  maxConcurrentRuns: 5,
  defaultTimeout: 120000,       // 2 minutes
  mockExternalCalls: true,
  recordTraces: true,
  cleanupAfterRun: true,
  maxMemoryMb: 512,
  maxCpuPercent: 50
};

/**
 * Mocked tool call result
 */
interface MockedToolResult {
  toolName: string;
  args: any;
  result: any;
  latency: number;
  success: boolean;
}

/**
 * Shadow Executor
 * 
 * Executes mission blueprints in isolated environments for validation.
 */
export class ShadowExecutor {
  private config: ExecutorConfig;
  private activeRuns: Map<string, AbortController> = new Map();
  private mockResults: Map<string, MockedToolResult[]> = new Map();

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info(`Shadow Executor initialized (${this.config.isolationLevel} isolation)`);
  }

  /**
   * Execute shadow runs for a candidate blueprint
   * 
   * Runs N variations in parallel and collects ground truth.
   */
  async execute(
    candidate: BlueprintCandidate,
    config: Partial<ShadowRunConfig> = {}
  ): Promise<ShadowResult> {
    const runConfig: ShadowRunConfig = {
      candidateId: candidate.id,
      nVariations: config.nVariations || 10,
      maxDuration: config.maxDuration || this.config.defaultTimeout,
      isolationLevel: config.isolationLevel || this.config.isolationLevel,
      recordHermesTraces: config.recordHermesTraces ?? this.config.recordTraces,
      syntheticDataConfig: config.syntheticDataConfig || {
        method: "schema_based",
        preserveCardinality: true,
        addNoise: false
      }
    };

    logger.info(`Starting shadow execution for ${candidate.id}`, {
      variations: runConfig.nVariations,
      isolation: runConfig.isolationLevel
    });

    const startTime = Date.now();
    
    // Generate scenarios
    const scenarios = this.generateScenarios(runConfig.nVariations);
    
    // Execute in batches
    const runs: ShadowRunDetail[] = [];
    const hermesTraces: HermesTraceSummary[] = [];
    
    for (let i = 0; i < scenarios.length; i += this.config.maxConcurrentRuns) {
      const batch = scenarios.slice(i, i + this.config.maxConcurrentRuns);
      
      const batchPromises = batch.map(scenario => 
        this.executeVariation(candidate, scenario, runConfig)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          runs.push(result.value.run);
          if (result.value.trace) {
            hermesTraces.push(result.value.trace);
          }
        } else {
          runs.push({
            variationId: uuidv4(),
            scenarioId: "unknown",
            success: false,
            latency: 0,
            cost: 0,
            error: result.reason?.message || "Execution failed"
          });
        }
      }
    }

    // Aggregate results
    const successCount = runs.filter(r => r.success).length;
    const latencies = runs.map(r => r.latency);
    const costs = runs.map(r => r.cost);

    // Analyze failures
    const failureModes = this.analyzeFailures(runs);

    const result: ShadowResult = {
      candidateId: candidate.id,
      completedAt: new Date(),
      successRate: runs.length > 0 ? successCount / runs.length : 0,
      avgLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
      maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
      totalCost: costs.reduce((a, b) => a + b, 0),
      runs,
      hermesTraces,
      failureModes,
      predictionDelta: 0 // Calculated by caller
    };

    const duration = Date.now() - startTime;
    logger.info(`Shadow execution complete in ${duration}ms: ` +
                `${successCount}/${runs.length} successful, ` +
                `${failureModes.length} failure modes`);

    return result;
  }

  /**
   * Abort all active shadow runs
   */
  async abortAll(): Promise<void> {
    logger.info(`Aborting ${this.activeRuns.size} active shadow runs`);
    
    for (const [runId, controller] of this.activeRuns) {
      controller.abort();
      this.activeRuns.delete(runId);
    }
  }

  /**
   * Get status of executor
   */
  getStatus(): {
    activeRuns: number;
    config: ExecutorConfig;
  } {
    return {
      activeRuns: this.activeRuns.size,
      config: this.config
    };
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Execute a single variation
   */
  private async executeVariation(
    candidate: BlueprintCandidate,
    scenario: any,
    config: ShadowRunConfig
  ): Promise<{ run: ShadowRunDetail; trace?: HermesTraceSummary }> {
    const runId = uuidv4();
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);

    const startTime = Date.now();
    
    try {
      // Choose execution strategy based on isolation level
      let result: { success: boolean; output?: any; error?: string; traces?: HermesTraceSummary };
      
      switch (config.isolationLevel) {
        case "container":
          result = await this.executeInContainer(candidate, scenario, controller.signal);
          break;
        case "vm":
          result = await this.executeInVM(candidate, scenario, controller.signal);
          break;
        case "process":
        default:
          result = await this.executeInProcess(candidate, scenario, controller.signal);
          break;
      }

      const latency = Date.now() - startTime;
      const cost = this.estimateCost(latency, result.traces);

      this.activeRuns.delete(runId);

      return {
        run: {
          variationId: runId,
          scenarioId: scenario.id,
          success: result.success,
          latency,
          cost,
          error: result.error,
          output: result.output,
          traceId: result.traces ? uuidv4() : undefined
        },
        trace: result.traces
      };

    } catch (error) {
      this.activeRuns.delete(runId);
      
      return {
        run: {
          variationId: runId,
          scenarioId: scenario.id,
          success: false,
          latency: Date.now() - startTime,
          cost: 0,
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Execute in separate Node.js process (lightweight isolation)
   */
  private async executeInProcess(
    candidate: BlueprintCandidate,
    scenario: any,
    signal: AbortSignal
  ): Promise<{ success: boolean; output?: any; error?: string; traces?: HermesTraceSummary }> {
    return new Promise((resolve, reject) => {
      // Spawn worker process
      // Resolves to shadow-worker.js — ensure TypeScript output includes this file
      const workerPath = new URL("./shadow-worker.js", import.meta.url).pathname;

      // Strip credential-bearing env vars before passing to child process
      const safeEnv: NodeJS.ProcessEnv = {};
      const allowedEnvPrefixes = ["PATH", "HOME", "USER", "NODE", "npm_", "LANG", "TZ", "TEMP", "TMP"];
      for (const [key, value] of Object.entries(process.env)) {
        if (allowedEnvPrefixes.some(prefix => key.startsWith(prefix))) {
          safeEnv[key] = value;
        }
      }
      safeEnv["NODE_ENV"] = "shadow";

      const child = spawn("node", [workerPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: safeEnv
      });

      // Pass blueprint data over stdin instead of argv to avoid argv-length limits
      // and to keep potentially sensitive blueprint contents out of process listings
      const input = JSON.stringify({
        blueprint: candidate.blueprint,
        scenario,
        options: { mockExternalCalls: this.config.mockExternalCalls }
      });
      child.stdin.write(input);
      child.stdin.end();

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Handle abort
      signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        reject(new Error("Shadow run aborted"));
      });

      child.on("close", (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (e) {
            resolve({ success: false, error: "Failed to parse result" });
          }
        } else {
          resolve({ 
            success: false, 
            error: stderr || `Process exited with code ${code}` 
          });
        }
      });

      child.on("error", (err) => {
        reject(err);
      });

      // Timeout
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ success: false, error: "Timeout" });
      }, this.config.defaultTimeout);
    });
  }

  /**
   * Execute in Docker container (medium isolation)
   * 
   * This is a placeholder - full implementation would:
   * 1. Build lightweight container with agent runtime
   * 2. Mount candidate blueprint as config
   * 3. Run with network restrictions
   * 4. Collect logs and results
   */
  private async executeInContainer(
    candidate: BlueprintCandidate,
    scenario: any,
    signal: AbortSignal
  ): Promise<{ success: boolean; output?: any; error?: string; traces?: HermesTraceSummary }> {
    logger.warn("Container isolation requested but not implemented — falling back to process isolation. Do not use in production.");
    return this.executeInProcess(candidate, scenario, signal);
  }

  /**
   * Execute in VM (highest isolation, slowest)
   *
   * Placeholder for full VM isolation.
   */
  private async executeInVM(
    candidate: BlueprintCandidate,
    scenario: any,
    signal: AbortSignal
  ): Promise<{ success: boolean; output?: any; error?: string; traces?: HermesTraceSummary }> {
    logger.warn("VM isolation requested but not implemented — falling back to process isolation. Do not use in production.");
    return this.executeInProcess(candidate, scenario, signal);
  }

  /**
   * Generate test scenarios
   */
  private generateScenarios(n: number): Array<{
    id: string;
    name: string;
    dataVariant: any;
    stressLevel: "normal" | "high" | "extreme";
    failureInjection?: string;
  }> {
    const scenarios = [];
    
    const stressLevels = ["normal", "normal", "high", "high", "extreme"];

    for (let i = 0; i < n; i++) {
      const stressLevel = stressLevels[i % stressLevels.length];
      scenarios.push({
        // Encode the stress level into the id so downstream failure analysis
        // (inferRootCause) can attribute failures to high-load scenarios — the
        // scenarioId is otherwise the only stress signal carried into ShadowRunDetail.
        id: `scenario_${i}_${stressLevel}`,
        name: `Variation ${i + 1}`,
        dataVariant: { seed: i, randomFactor: Math.random() },
        stressLevel: stressLevel as any,
        failureInjection: i === n - 1 ? "timeout" : undefined // Last one always tests failure
      });
    }
    
    return scenarios;
  }

  /**
   * Analyze failure patterns
   */
  private analyzeFailures(runs: ShadowRunDetail[]): FailureMode[] {
    const failures = runs.filter(r => !r.success && r.error);
    
    if (failures.length === 0) return [];
    
    // Group by error type
    const byType = new Map<string, ShadowRunDetail[]>();
    
    for (const failure of failures) {
      const type = this.categorizeError(failure.error!);
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(failure);
    }
    
    // Build failure modes
    const modes: FailureMode[] = [];
    
    for (const [type, typeFailures] of byType) {
      const fixable = !type.includes("timeout") && !type.includes("oom");
      
      modes.push({
        type: type as any,
        frequency: typeFailures.length,
        scenarioIds: typeFailures.map(f => f.scenarioId),
        description: this.describeFailureType(type),
        rootCause: this.inferRootCause(type, typeFailures),
        fixable,
        suggestedFix: fixable ? this.suggestFix(type) : undefined
      });
    }
    
    return modes.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Categorize error message
   */
  private categorizeError(error: string): string {
    const lower = error.toLowerCase();
    
    if (lower.includes("timeout")) return "timeout";
    if (lower.includes("rate limit") || lower.includes("too many requests")) return "rate_limit";
    if (lower.includes("auth") || lower.includes("unauthorized")) return "auth_error";
    if (lower.includes("not found") || lower.includes("404")) return "not_found";
    if (lower.includes("parse") || lower.includes("json")) return "parsing_error";
    if (lower.includes("network") || lower.includes("connection")) return "network_error";
    if (lower.includes("memory") || lower.includes("oom")) return "oom_error";
    
    return "tool_error";
  }

  /**
   * Describe failure type
   */
  private describeFailureType(type: string): string {
    const descriptions: Record<string, string> = {
      timeout: "Operation exceeded time limit",
      rate_limit: "API rate limit exceeded",
      auth_error: "Authentication or authorization failure",
      not_found: "Requested resource not found",
      parsing_error: "Failed to parse response data",
      network_error: "Network connectivity issue",
      oom_error: "Out of memory during execution",
      tool_error: "Tool execution failed"
    };
    
    return descriptions[type] || "Unknown failure";
  }

  /**
   * Infer root cause
   */
  private inferRootCause(type: string, failures: ShadowRunDetail[]): string {
    const patterns = failures.map(f => f.scenarioId);
    
    if (patterns.every(p => p.includes("extreme"))) {
      return "Resource exhaustion under high load";
    }
    
    if (type === "timeout") {
      return "Insufficient timeout configuration or slow downstream services";
    }
    
    if (type === "rate_limit") {
      return "Aggressive API calling without backoff strategy";
    }
    
    return "Implementation or configuration issue";
  }

  /**
   * Suggest fix for failure type
   */
  private suggestFix(type: string): string {
    const fixes: Record<string, string> = {
      timeout: "Increase timeout or add retry with exponential backoff",
      rate_limit: "Implement rate limiting and request batching",
      auth_error: "Check credentials and token refresh logic",
      not_found: "Add input validation and existence checks",
      parsing_error: "Add schema validation and error handling",
      network_error: "Add circuit breaker and retry logic",
      oom_error: "Optimize memory usage or increase resource limits",
      tool_error: "Review tool configuration and error handling"
    };
    
    return fixes[type] || "Review implementation and add error handling";
  }

  /**
   * Estimate cost from execution
   */
  private estimateCost(latency: number, traces?: HermesTraceSummary): number {
    const baseCost = (latency / 1000) * 0.01;

    if (traces) {
      const estimatedTokens = traces.thoughtDepth * 1000;
      const totalCost = baseCost + (estimatedTokens / 1000) * 0.001;
      return Math.round(totalCost * 1000) / 1000;
    }

    return Math.round(baseCost * 1000) / 1000;
  }
}

/**
 * Factory function
 */
export function createShadowExecutor(
  config?: Partial<ExecutorConfig>
): ShadowExecutor {
  return new ShadowExecutor(config);
}
