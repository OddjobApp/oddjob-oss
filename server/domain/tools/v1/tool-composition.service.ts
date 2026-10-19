import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./capabilities/types.js";
import { jobExecutorRegistry } from "../../jobs/core/executors/index.js";
import { jobService } from "../../jobs/job.service.js";
import { createLogger } from "@server/utils/logger.js";
import { JobToToolMapper } from "./job-to-tool-mapper.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("ToolComposition");

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Input mapping definition - maps data from previous steps or initial input
 * to the current step's input parameters
 */
export interface InputMapping {
  /** Direct value assignment */
  value?: any;
  /** Reference to a field from initial input: {{input.fieldName}} */
  fromInput?: string;
  /** Reference to a previous step's output: {{stepN.output.fieldName}} */
  fromStep?: { stepIndex: number; field: string };
  /** Template string with variable substitution */
  template?: string;
  /** JSONPath expression to extract from source */
  jsonPath?: string;
}

/**
 * Individual step in a composite tool
 */
export interface CompositeStep {
  /** Unique identifier for this step */
  id: string;
  /** Human-readable description */
  description?: string;
  /** The job ID to execute */
  jobId: number;
  /** Input parameter mappings */
  inputMapping: Record<string, InputMapping | any>;
  /** Condition for executing this step */
  condition?: {
    /** Expression to evaluate (e.g., "{{step0.output.status}} === 'success'") */
    expression: string;
    /** Whether to skip or fail if condition is false */
    action: "skip" | "fail";
  };
  /** Error handling for this step */
  errorHandling?: {
    /** Strategy when step fails */
    strategy: "stop" | "continue" | "retry" | "fallback";
    /** Max retry attempts (for retry strategy) */
    maxRetries?: number;
    /** Delay between retries in ms */
    retryDelayMs?: number;
    /** Fallback step ID to execute instead (for fallback strategy) */
    fallbackStepId?: string;
  };
  /** Dependencies - step IDs that must complete before this one */
  dependsOn?: string[];
  /** Whether this step can run in parallel with others */
  parallel?: boolean;
  /** Timeout for this step in milliseconds */
  timeoutMs?: number;
}

/**
 * Composite Tool Definition
 */
export interface CompositeTool {
  /** Unique identifier */
  id: string;
  /** Tool name (used for invocation) */
  name: string;
  /** Human-readable label */
  label: string;
  /** Description for AI agents */
  description: string;
  /** Category/group for organization */
  group?: string;
  /** The ordered steps to execute */
  steps: CompositeStep[];
  /** Input parameter schema for the composite tool */
  inputSchema?: z.ZodSchema;
  /** Output format description */
  outputFormat?: string;
  /** Global settings */
  settings?: {
    /** Stop on first error (default: true) */
    stopOnError?: boolean;
    /** Enable parallel execution where possible (default: true) */
    enableParallelism?: boolean;
    /** Max total execution time */
    globalTimeoutMs?: number;
  };
  /** Metadata */
  metadata?: {
    createdBy?: string;
    createdAt?: Date;
    updatedAt?: Date;
    version?: string;
    tags?: string[];
  };
}

/**
 * Execution context for a composite tool run
 */
export interface CompositeExecutionContext {
  /** The composite tool being executed */
  composite: CompositeTool;
  /** Initial input parameters */
  input: any;
  /** Tool execution context */
  toolContext: ToolContext;
  /** Step results keyed by step ID */
  stepResults: Map<string, StepResult>;
  /** Execution start time */
  startTime: Date;
  /** Execution state */
  state: "running" | "paused" | "completed" | "failed" | "cancelled";
  /** Current step index */
  currentStepIndex: number;
}

/**
 * Result of executing a single step
 */
export interface StepResult {
  stepId: string;
  status: "success" | "failed" | "skipped" | "timeout";
  output?: any;
  error?: Error;
  durationMs: number;
  retryCount?: number;
  startedAt: Date;
  completedAt: Date;
}

/**
 * Result of executing a composite tool
 */
export interface CompositeExecutionResult {
  compositeId: string;
  status: "success" | "partial" | "failed";
  /** Final output (typically last step's output or aggregated) */
  output?: any;
  /** Results for each step */
  stepResults: StepResult[];
  /** Total execution time */
  totalDurationMs: number;
  /** Error details if failed */
  error?: {
    message: string;
    failedStepId?: string;
    cause?: Error;
  };
  /** Metadata about the execution */
  metadata: {
    startedAt: Date;
    completedAt: Date;
    stepsCompleted: number;
    stepsFailed: number;
    stepsSkipped: number;
  };
}

// ============================================================================
// VARIABLE RESOLUTION
// ============================================================================

/**
 * Resolves variable references in templates and mappings
 */
export class VariableResolver {
  /**
   * Resolve a template string with variable substitution
   */
  static resolveTemplate(
    template: string,
    context: {
      input: any;
      stepResults: Map<string, StepResult>;
    }
  ): any {
    // Handle {{input.field}} syntax
    const inputRegex = /\{\{\s*input\.([^\s}]+)\s*\}\}/g;
    let result = template.replace(inputRegex, (match, path) => {
      const value = this.getValueByPath(context.input, path);
      return value !== undefined ? String(value) : match;
    });

    // Handle {{stepN.output.field}} syntax
    const stepRegex = /\{\{\s*step(\d+)\.output\.([^\s}]+)\s*\}\}/g;
    result = result.replace(stepRegex, (match, stepIndex, path) => {
      const stepResult = context.stepResults.get(`step-${stepIndex}`);
      if (stepResult?.output) {
        const value = this.getValueByPath(stepResult.output, path);
        return value !== undefined ? String(value) : match;
      }
      return match;
    });

    // Handle {{stepN.output}} syntax (entire output)
    const stepOutputRegex = /\{\{\s*step(\d+)\.output\s*\}\}/g;
    result = result.replace(stepOutputRegex, (match, stepIndex) => {
      const stepResult = context.stepResults.get(`step-${stepIndex}`);
      if (stepResult?.output) {
        return JSON.stringify(stepResult.output);
      }
      return match;
    });

    return result;
  }

  /**
   * Resolve an input mapping to its actual value
   */
  static resolveMapping(
    mapping: InputMapping | any,
    context: {
      input: any;
      stepResults: Map<string, StepResult>;
    }
  ): any {
    // If it's not a proper mapping object, return as-is
    if (!mapping || typeof mapping !== "object") {
      return mapping;
    }

    // Direct value
    if (mapping.value !== undefined) {
      return mapping.value;
    }

    // Template string
    if (mapping.template) {
      return this.resolveTemplate(mapping.template, context);
    }

    // Reference from input
    if (mapping.fromInput) {
      return this.getValueByPath(context.input, mapping.fromInput);
    }

    // Reference from previous step
    if (mapping.fromStep) {
      const stepResult = context.stepResults.get(`step-${mapping.fromStep.stepIndex}`);
      if (stepResult?.output) {
        return this.getValueByPath(stepResult.output, mapping.fromStep.field);
      }
      return undefined;
    }

    // JSONPath expression
    if (mapping.jsonPath) {
      // Simple JSONPath implementation - could be enhanced
      const path = mapping.jsonPath.replace(/^\$\./, "");
      // Try input first, then step results
      let value = this.getValueByPath(context.input, path);
      if (value === undefined) {
        for (const [, stepResult] of context.stepResults) {
          value = this.getValueByPath(stepResult.output, path);
          if (value !== undefined) break;
        }
      }
      return value;
    }

    // If mapping has nested objects, resolve them recursively
    const resolved: any = {};
    for (const [key, value] of Object.entries(mapping)) {
      if (key !== "value" && key !== "template" && key !== "fromInput" && key !== "fromStep" && key !== "jsonPath") {
        resolved[key] = this.resolveMapping(value, context);
      }
    }
    return Object.keys(resolved).length > 0 ? resolved : mapping;
  }

  /**
   * Get a value from an object by dot-notation path
   */
  private static getValueByPath(obj: any, path: string): any {
    if (!obj || !path) return undefined;

    const keys = path.split(".");
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Build input parameters for a step by resolving all mappings
   */
  static buildStepInput(
    step: CompositeStep,
    context: {
      input: any;
      stepResults: Map<string, StepResult>;
    }
  ): any {
    const resolved: any = {};

    for (const [key, mapping] of Object.entries(step.inputMapping)) {
      resolved[key] = this.resolveMapping(mapping, context);
    }

    return resolved;
  }
}

// ============================================================================
// CONDITION EVALUATOR
// ============================================================================

/**
 * Evaluates conditions for step execution
 */
export class ConditionEvaluator {
  /**
   * Evaluate a condition expression
   */
  static evaluate(
    expression: string,
    context: {
      input: any;
      stepResults: Map<string, StepResult>;
    }
  ): boolean {
    try {
      // Replace variable references with actual values
      const resolvedExpression = VariableResolver.resolveTemplate(expression, context);

      // Simple expression evaluation
      // Supports: ===, !==, >, <, >=, <=, &&, ||, !
      // Note: In production, consider using a safe expression evaluator
      // like 'vm2' or 'isolated-vm' instead of eval

      // Create a safe evaluation context
      const evalContext = this.buildEvalContext(context);

      // Wrap in try-catch for safety
      const result = this.safeEvaluate(String(resolvedExpression), evalContext);
      return Boolean(result);
    } catch (error) {
      logger.warn(`Condition evaluation failed: ${expression}`, { error: String(error) });
      return false;
    }
  }

  /**
   * Build evaluation context with resolved variables
   */
  private static buildEvalContext(context: {
    input: any;
    stepResults: Map<string, StepResult>;
  }): any {
    const evalContext: any = {
      input: context.input,
      steps: {},
    };

    // Add step outputs
    for (const [stepId, result] of context.stepResults) {
      const stepIndex = stepId.replace("step-", "");
      evalContext.steps[stepIndex] = result.output;
    }

    return evalContext;
  }

  /**
   * Safely evaluate an expression
   */
  private static safeEvaluate(expression: string, context: any): any {
    // For security, we only support basic comparisons
    // This is a simplified evaluator - production should use a proper sandbox

    // Handle common patterns
    if (expression.includes("===")) {
      const [left, right] = expression.split("===").map((s) => s.trim());
      return this.getValue(left, context) === this.getValue(right, context);
    }

    if (expression.includes("!==")) {
      const [left, right] = expression.split("!==").map((s) => s.trim());
      return this.getValue(left, context) !== this.getValue(right, context);
    }

    if (expression.includes(">=")) {
      const [left, right] = expression.split(">=").map((s) => s.trim());
      return Number(this.getValue(left, context)) >= Number(this.getValue(right, context));
    }

    if (expression.includes("<=")) {
      const [left, right] = expression.split("<=").map((s) => s.trim());
      return Number(this.getValue(left, context)) <= Number(this.getValue(right, context));
    }

    if (expression.includes(">")) {
      const [left, right] = expression.split(">").map((s) => s.trim());
      return Number(this.getValue(left, context)) > Number(this.getValue(right, context));
    }

    if (expression.includes("<")) {
      const [left, right] = expression.split("<").map((s) => s.trim());
      return Number(this.getValue(left, context)) < Number(this.getValue(right, context));
    }

    // Handle presence check
    if (expression.startsWith("!")) {
      const value = this.getValue(expression.substring(1).trim(), context);
      return !value;
    }

    // Default: truthy check
    return Boolean(this.getValue(expression, context));
  }

  /**
   * Get a value from context by path or literal
   */
  private static getValue(ref: string, context: any): any {
    const trimmed = ref.trim();

    // Handle string literals
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    // Handle numbers
    if (!isNaN(Number(trimmed))) {
      return Number(trimmed);
    }

    // Handle booleans
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null") return null;
    if (trimmed === "undefined") return undefined;

    // Handle context references
    if (trimmed.startsWith("input.")) {
      return VariableResolver["getValueByPath"](context.input, trimmed.substring(6));
    }

    if (trimmed.startsWith("steps.")) {
      const path = trimmed.substring(6);
      const [stepIndex, ...rest] = path.split(".");
      const stepOutput = context.steps[stepIndex];
      if (!stepOutput) return undefined;
      if (rest.length === 0) return stepOutput;
      return VariableResolver["getValueByPath"](stepOutput, rest.join("."));
    }

    return undefined;
  }
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

/**
 * ToolCompositionService
 *
 * Core engine for executing composite tools - chains of jobs that work together
 * as a single, reusable tool for AI agents.
 */
export class ToolCompositionService {
  private activeExecutions = new Map<string, CompositeExecutionContext>();

  /**
   * Execute a composite tool
   */
  async execute(
    composite: CompositeTool,
    input: any,
    toolContext: ToolContext
  ): Promise<CompositeExecutionResult> {
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    logger.info(`Starting composite tool execution: ${composite.name} (${executionId})`);

    // Initialize execution context
    const executionContext: CompositeExecutionContext = {
      composite,
      input,
      toolContext,
      stepResults: new Map(),
      startTime: new Date(),
      state: "running",
      currentStepIndex: 0,
    };

    this.activeExecutions.set(executionId, executionContext);

    try {
      const results: StepResult[] = [];
      const steps = composite.steps;
      const settings = composite.settings || {};

      // Check for global timeout
      const globalTimeout = settings.globalTimeoutMs || 300000; // 5 minutes default
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Global timeout exceeded")), globalTimeout);
      });

      // Execute with timeout
      const executionPromise = this.executeSteps(executionContext, results);

      await Promise.race([executionPromise, timeoutPromise]);

      // Build final result
      const finalResult = this.buildFinalResult(
        composite,
        results,
        startTime,
        executionContext.state
      );

      logger.info(`Composite tool execution completed: ${composite.name}`, {
        status: finalResult.status,
        stepsCompleted: finalResult.metadata.stepsCompleted,
        duration: finalResult.totalDurationMs,
      });

      return finalResult;
    } catch (error) {
      logger.error(`Composite tool execution failed: ${composite.name}`, error);

      return {
        compositeId: composite.id,
        status: "failed",
        stepResults: Array.from(executionContext.stepResults.values()),
        totalDurationMs: Date.now() - startTime,
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
          cause: error instanceof Error ? error : undefined,
        },
        metadata: {
          startedAt: executionContext.startTime,
          completedAt: new Date(),
          stepsCompleted: executionContext.stepResults.size,
          stepsFailed: 1,
          stepsSkipped: 0,
        },
      };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Execute all steps in sequence or parallel based on dependencies
   */
  private async executeSteps(
    context: CompositeExecutionContext,
    results: StepResult[]
  ): Promise<void> {
    const { composite } = context;
    const steps = composite.steps;
    const settings = composite.settings;
    const enableParallelism = settings?.enableParallelism !== false;
    const stopOnError = settings?.stopOnError !== false;

    // Track completed steps
    const completedSteps = new Set<string>();
    const stepPromises = new Map<string, Promise<StepResult>>();

    // Process steps
    for (let i = 0; i < steps.length; i++) {
      if (context.state === "failed" || context.state === "cancelled") {
        break;
      }

      context.currentStepIndex = i;
      const step = steps[i];

      // Check dependencies
      if (step.dependsOn && step.dependsOn.length > 0) {
        const depsCompleted = step.dependsOn.every((depId) => completedSteps.has(depId));
        if (!depsCompleted) {
          // Wait for dependencies
          await Promise.all(
            step.dependsOn.map((depId) => stepPromises.get(depId))
          );
        }
      }

      // Execute step
      const stepPromise = this.executeStep(step, context);
      stepPromises.set(step.id, stepPromise);

      if (!step.parallel || !enableParallelism) {
        // Execute sequentially
        const result = await stepPromise;
        results.push(result);
        completedSteps.add(step.id);

        if (result.status === "failed" && stopOnError) {
          context.state = "failed";
          break;
        }
      } else {
        // Will be awaited later if needed
        results.push(await stepPromise);
        completedSteps.add(step.id);
      }
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: CompositeStep,
    context: CompositeExecutionContext
  ): Promise<StepResult> {
    const startTime = Date.now();
    const { input, stepResults, toolContext } = context;

    logger.debug(`Executing step: ${step.id}`, { jobId: step.jobId });

    // Check condition
    if (step.condition) {
      const conditionMet = ConditionEvaluator.evaluate(step.condition.expression, {
        input,
        stepResults,
      });

      if (!conditionMet) {
        if (step.condition.action === "skip") {
          return {
            stepId: step.id,
            status: "skipped",
            durationMs: 0,
            startedAt: new Date(),
            completedAt: new Date(),
          };
        } else {
          return {
            stepId: step.id,
            status: "failed",
            error: new Error(`Condition failed: ${step.condition.expression}`),
            durationMs: 0,
            startedAt: new Date(),
            completedAt: new Date(),
          };
        }
      }
    }

    // Build step input
    const stepInput = VariableResolver.buildStepInput(step, { input, stepResults });

    // Get job and executor
    // Note: In a real implementation, you'd fetch the job from the database
    // For now, we assume the job config is available
    const job = await this.fetchJob(step.jobId, assertOrgId(toolContext.organizationId));
    if (!job) {
      return {
        stepId: step.id,
        status: "failed",
        error: new Error(`Job not found: ${step.jobId}`),
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime),
        completedAt: new Date(),
      };
    }

    // Execute with retry logic
    const maxRetries = step.errorHandling?.maxRetries || 0;
    const retryDelay = step.errorHandling?.retryDelayMs || 1000;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const executor = jobExecutorRegistry.getExecutor(job.type);
        if (!executor) {
          throw new Error(`No executor found for job type: ${job.type}`);
        }

        // Create mock pipeline
        const mockPipeline = {
          id: 0,
          name: `Composite: ${context.composite.name}`,
          organizationId: job.organizationId,
        };

        // Execute with timeout
        const timeout = step.timeoutMs || 60000;
        const execPromise = executor.execute(job, stepInput, mockPipeline as any, {
          ...toolContext,
          data: stepInput,
        } as any);

        const result = await this.withTimeout(execPromise, timeout);
        if (!result) {
          throw new Error("Job execution returned no result");
        }

        // Store result
        const stepResult: StepResult = {
          stepId: step.id,
          status: "success",
          output: result.output || {},
          durationMs: Date.now() - startTime,
          retryCount: attempt,
          startedAt: new Date(startTime),
          completedAt: new Date(),
        };

        stepResults.set(step.id, stepResult);
        return stepResult;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          logger.warn(`Step ${step.id} failed, retrying (${attempt + 1}/${maxRetries})`, {
            error: lastError.message,
          });
          await this.delay(retryDelay);
        }
      }
    }

    // All retries exhausted or no retry configured
    const errorStrategy = step.errorHandling?.strategy || "stop";

    if (errorStrategy === "continue") {
      const stepResult: StepResult = {
        stepId: step.id,
        status: "failed",
        error: lastError,
        durationMs: Date.now() - startTime,
        retryCount: maxRetries,
        startedAt: new Date(startTime),
        completedAt: new Date(),
      };
      stepResults.set(step.id, stepResult);
      return stepResult;
    }

    // stop or fallback - return failed result
    const stepResult: StepResult = {
      stepId: step.id,
      status: "failed",
      error: lastError,
      durationMs: Date.now() - startTime,
      retryCount: maxRetries,
      startedAt: new Date(startTime),
      completedAt: new Date(),
    };

    stepResults.set(step.id, stepResult);
    return stepResult;
  }

  /**
   * Build final execution result
   */
  private buildFinalResult(
    composite: CompositeTool,
    results: StepResult[],
    startTime: number,
    finalState: string
  ): CompositeExecutionResult {
    const completedAt = new Date();
    const totalDuration = Date.now() - startTime;

    const stepsCompleted = results.filter((r) => r.status === "success").length;
    const stepsFailed = results.filter((r) => r.status === "failed").length;
    const stepsSkipped = results.filter((r) => r.status === "skipped").length;

    // Determine overall status
    let status: "success" | "partial" | "failed";
    if (stepsFailed === 0) {
      status = "success";
    } else if (stepsCompleted > 0 || stepsSkipped > 0) {
      status = "partial";
    } else {
      status = "failed";
    }

    // Build output - typically last successful step's output or aggregated
    const lastSuccess = [...results].reverse().find((r) => r.status === "success");
    const output = lastSuccess?.output;

    // Find first error for reporting
    const firstError = results.find((r) => r.status === "failed");

    return {
      compositeId: composite.id,
      status,
      output,
      stepResults: results,
      totalDurationMs: totalDuration,
      error: firstError?.error
        ? {
            message: firstError.error.message,
            failedStepId: firstError.stepId,
            cause: firstError.error,
          }
        : undefined,
      metadata: {
        startedAt: new Date(startTime),
        completedAt,
        stepsCompleted,
        stepsFailed,
        stepsSkipped,
      },
    };
  }

  /**
   * Fetch a job by ID (placeholder - implement with actual DB call)
   */
  private async fetchJob(jobId: number, organizationId: number): Promise<any> {
    try {
      return await jobService.getById(jobId, { organizationId } as any);
    } catch (error) {
      logger.error(`Failed to fetch job ${jobId}`, error);
      return null;
    }
  }

  /**
   * Execute promise with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cancel an active execution
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.state = "cancelled";
      this.activeExecutions.delete(executionId);
      logger.info(`Cancelled execution: ${executionId}`);
      return true;
    }
    return false;
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): Array<{ id: string; compositeName: string; state: string }> {
    return Array.from(this.activeExecutions.entries()).map(([id, exec]) => ({
      id,
      compositeName: exec.composite.name,
      state: exec.state,
    }));
  }
}

// ============================================================================
// BUILDER HELPER
// ============================================================================

/**
 * CompositeToolBuilder
 *
 * Fluent API for building composite tools
 */
export class CompositeToolBuilder {
  private composite: Partial<CompositeTool> = {
    steps: [],
    settings: {
      stopOnError: true,
      enableParallelism: true,
    },
    metadata: {
      createdAt: new Date(),
      version: "1.0.0",
    },
  };
  private stepIndex = 0;

  constructor(id: string, name: string) {
    this.composite.id = id;
    this.composite.name = name;
  }

  /**
   * Set the tool label
   */
  label(label: string): this {
    this.composite.label = label;
    return this;
  }

  /**
   * Set the description
   */
  description(description: string): this {
    this.composite.description = description;
    return this;
  }

  /**
   * Set the group/category
   */
  group(group: string): this {
    this.composite.group = group;
    return this;
  }

  /**
   * Add a step to the composition
   */
  addStep(config: {
    jobId: number;
    description?: string;
    inputMapping: Record<string, InputMapping | any>;
    condition?: CompositeStep["condition"];
    errorHandling?: CompositeStep["errorHandling"];
    parallel?: boolean;
    timeoutMs?: number;
    dependsOn?: string[];
  }): this {
    const step: CompositeStep = {
      id: `step-${this.stepIndex}`,
      jobId: config.jobId,
      description: config.description,
      inputMapping: config.inputMapping,
      condition: config.condition,
      errorHandling: config.errorHandling,
      parallel: config.parallel,
      timeoutMs: config.timeoutMs,
      dependsOn: config.dependsOn,
    };

    this.composite.steps!.push(step);
    this.stepIndex++;
    return this;
  }

  /**
   * Add a simple mapping step with auto-generated ID
   */
  step(jobId: number, inputMapping: Record<string, InputMapping | any>, description?: string): this {
    return this.addStep({
      jobId,
      description,
      inputMapping,
    });
  }

  /**
   * Set input schema
   */
  inputSchema(schema: z.ZodSchema): this {
    this.composite.inputSchema = schema;
    return this;
  }

  /**
   * Set output format description
   */
  outputFormat(format: string): this {
    this.composite.outputFormat = format;
    return this;
  }

  /**
   * Configure settings
   */
  settings(settings: Partial<CompositeTool["settings"]>): this {
    this.composite.settings = { ...this.composite.settings, ...settings };
    return this;
  }

  /**
   * Add tags
   */
  tags(...tags: string[]): this {
    if (!this.composite.metadata) {
      this.composite.metadata = {};
    }
    this.composite.metadata.tags = [...(this.composite.metadata.tags || []), ...tags];
    return this;
  }

  /**
   * Build the composite tool
   */
  build(): CompositeTool {
    if (!this.composite.label) {
      this.composite.label = this.composite.name;
    }
    if (!this.composite.description) {
      this.composite.description = `Composite tool: ${this.composite.name}`;
    }

    return this.composite as CompositeTool;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new composite tool builder
 */
export function createComposite(id: string, name: string): CompositeToolBuilder {
  return new CompositeToolBuilder(id, name);
}

/**
 * Predefined composition patterns
 */
export const CompositionPatterns = {
  /**
   * Fetch → Transform → Save pattern
   */
  dataPipeline: (
    name: string,
    config: {
      fetchJobId: number;
      transformJobId: number;
      saveJobId: number;
      apiUrlMapping: InputMapping;
      transformRulesMapping: InputMapping;
      targetTableMapping: InputMapping;
    }
  ): CompositeTool => {
    return createComposite(`pipeline-${Date.now()}`, name)
      .label(`${name} Pipeline`)
      .description(`Fetch data from API, transform it, and save to database`)
      .group("Data Pipeline")
      .step(config.fetchJobId, {
        url: config.apiUrlMapping,
        method: { value: "GET" },
      }, "Fetch data from API")
      .step(config.transformJobId, {
        input: { fromStep: { stepIndex: 0, field: "data" } },
        rules: config.transformRulesMapping,
      }, "Transform data structure")
      .step(config.saveJobId, {
        query: {
          template: "INSERT INTO {{targetTable}} VALUES ({{step1.output}})",
        },
      }, "Save to database")
      .build();
  },

  /**
   * Scrape → Extract → Notify pattern
   */
  webScrapeNotify: (
    name: string,
    config: {
      seleniumJobId: number;
      transformJobId: number;
      notifyJobId: number;
      urlMapping: InputMapping;
      channelMapping: InputMapping;
    }
  ): CompositeTool => {
    return createComposite(`scrape-${Date.now()}`, name)
      .label(`${name} Scraper`)
      .description(`Scrape website, extract data, and send notification`)
      .group("Web Automation")
      .step(config.seleniumJobId, {
        url: config.urlMapping,
        goal: { value: "Extract relevant data" },
      }, "Scrape website")
      .step(config.transformJobId, {
        input: { fromStep: { stepIndex: 0, field: "extractions" } },
        rules: { value: [{ sourcePath: "$.data", targetPath: "$.extracted" }] },
      }, "Format extractions")
      .step(config.notifyJobId, {
        channel: config.channelMapping,
        message: {
          template: "Scraping complete: {{step1.output.extracted}}",
        },
      }, "Send notification")
      .build();
  },
};

// ============================================================================
// SERVICE INSTANCE
// ============================================================================

export const toolCompositionService = new ToolCompositionService();
