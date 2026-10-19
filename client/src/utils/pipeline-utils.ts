import type { Job } from "@shared/schema/jobs/table";
import type { FieldDefinition, JobOutputSchema } from "@shared/schema/jobs/types";
import type { TransformationRule } from "@shared/schema/jobs/config-data";
import type { VariableInfo } from '@shared/utils/variableDiscovery';
import { validateJsonSchema, type JsonSchema, type SchemaValidationResult } from '@shared/utils/jsonUtils';

// We use the full Job type now, but note outputSchema might be untyped in Drizzle schema
// So we'll cast it when needed.

interface PipelineStep {
    jobId: number | null;
    outputName?: string | null;
    moduleType?: string | null;
    transformerConfig?: any;
}

/**
 * Build a composite schema representing the available data context for a specific step.
 * Merges output schemas of all previous steps using their indices and output names.
 */
export function buildPipelineContextSchema(
    steps: PipelineStep[],
    jobs: Job[],
    currentStepIndex: number,
    pipelineInputSchema?: JobOutputSchema
): JobOutputSchema {
    const compositeSchemaDef: Record<string, FieldDefinition> = {};

    // 1. Add Pipeline Input
    if (pipelineInputSchema && pipelineInputSchema.schemaDef) {
        // Map the input schema to 'pipeline.input' prefix
        compositeSchemaDef['pipeline.input'] = {
            type: 'object',
            required: true,
            description: 'Input data provided to the pipeline'
        };

        Object.entries(pipelineInputSchema.schemaDef).forEach(([path, fieldDef]) => {
            const compositePath = `pipeline.input.${path}`;
            compositeSchemaDef[compositePath] = fieldDef;
        });
    } else {
        // Fallback placeholder
        compositeSchemaDef['pipeline.input'] = {
            type: 'object',
            required: true,
            description: 'Input data provided to the pipeline (Schema not available)'
        };
    }

    // 2. Add outputs from previous steps
    for (let i = 0; i < currentStepIndex; i++) {
        const step = steps[i];

        // Skip if no job associated (e.g. unconfigured step)
        if (!step.jobId) continue;

        const job = jobs.find(j => j.id === step.jobId);
        if (!job) continue;

        const outputSchema = getJobOutputSchema(job, step);

        if (!outputSchema || !outputSchema.schemaDef) continue;

        // Determine the prefix for this step
        // Standard: step.{index}.output
        const stepPrefix = `step.${i}.output`;

        // Add step root
        compositeSchemaDef[stepPrefix] = {
            type: 'object',
            required: true,
            description: `Output from Step ${i + 1}`
        };

        // Flatten step schema into composite schema with prefix
        Object.entries(outputSchema.schemaDef).forEach(([path, fieldDef]) => {
            const compositePath = `${stepPrefix}.${path}`;
            compositeSchemaDef[compositePath] = fieldDef;
        });
    }

    return {
        capturedAt: new Date().toISOString(),
        schemaDef: compositeSchemaDef,
        sampleOutput: {}
    };
}


/**
 * Generate a JobOutputSchema based on transformation rules.
 */
export function generateTransformerOutputSchema(rules: TransformationRule[]): JobOutputSchema {
    const schemaDef: Record<string, FieldDefinition> = {};

    rules.forEach(rule => {
        if (rule.targetPath) {
            schemaDef[rule.targetPath] = {
                type: (rule as any).targetType || 'string',
                required: true,
                description: `Transformed from ${rule.sourcePath}`
            };
        }
    });

    return {
        capturedAt: new Date().toISOString(),
        schemaDef,
        sampleOutput: {}
    };
}

/**
 * Derive a JobOutputSchema for any job type, regardless of how its schema is stored.
 * Handles: transformer (from rules), form_agent (from formSchema.fields), regular (from outputSchema).
 */
export function getJobOutputSchema(job: Job, step: PipelineStep): JobOutputSchema | null {
    // Transformer: derive schema from rules on the step
    if (job.type === 'transformer' && (step.transformerConfig as any)?.rules) {
        return generateTransformerOutputSchema((step.transformerConfig as any).rules);
    }

    // form_agent: derive from job.config.formSchema.fields
    const jobConfig = job.config as any;
    if (job.type === 'form_agent' && jobConfig?.formSchema?.fields) {
        const schemaDef: Record<string, FieldDefinition> = {};
        (jobConfig.formSchema.fields as any[]).forEach((f: any) => {
            schemaDef[f.key] = {
                type: f.type || 'string',
                required: f.required ?? false,
                description: f.description || f.label || f.key
            };
        });
        return { capturedAt: new Date().toISOString(), schemaDef, sampleOutput: {} };
    }

    // All others: use job.outputSchema if present (may be a string or object)
    let schema = job.outputSchema as any;
    if (!schema) return null;
    if (typeof schema === 'string') {
        try { schema = JSON.parse(schema); } catch { return null; }
    }
    // Handle both {schemaDef: {...}} and {fields: {...}} formats
    const rawDef = schema?.schemaDef || schema?.fields;
    if (!rawDef || typeof rawDef !== 'object') return null;
    return { ...schema, schemaDef: rawDef };
}

/**
 * Get available variables from previous steps for variable picker.
 * Returns both top-level step output references AND individual field paths from each step's schema.
 */
export function getAvailableVariables(
    steps: (PipelineStep & { order: number })[],
    jobs: Job[],
    currentIndex: number
): VariableInfo[] {
    const vars: VariableInfo[] = [];

    // Iterate steps up to current index
    for (let i = 0; i < currentIndex; i++) {
        const step = steps[i];
        if (!step.jobId) continue;

        const job = jobs.find(j => j.id === step.jobId);
        const jobName = job?.name || 'Unknown';
        const stepPrefix = `step.${i}.output`;

        // 1. Top-level step output variable
        vars.push({
            name: `{{${stepPrefix}}}`,
            shortName: stepPrefix,
            category: 'step',
            description: `Full output from Step ${i + 1}: ${jobName}`
        });

        // 2. Explicit output alias (if configured)
        if (step.outputName) {
            vars.push({
                name: `{{${step.outputName}}}`,
                shortName: step.outputName,
                category: 'step',
                description: `Output alias from Step ${i + 1}: ${jobName}`
            });
        }

        // 3. Enumerate individual field paths from the schema
        const outputSchema = job ? getJobOutputSchema(job, step) : null;

        if (outputSchema?.schemaDef) {
            Object.entries(outputSchema.schemaDef).forEach(([fieldPath, fieldDef]) => {
                const fullPath = `${stepPrefix}.${fieldPath}`;
                vars.push({
                    name: `{{${fullPath}}}`,
                    shortName: fullPath,
                    category: 'custom',
                    description: `${fieldDef.description || fieldPath} (${fieldDef.type}) — Step ${i + 1}: ${jobName}`
                });
            });
        }
    }

    return vars;
}

// ============================================================================
// PIPELINE VALIDATION UTILITIES
// ============================================================================

export interface PipelineValidationResult {
    isValid: boolean;
    errors: PipelineValidationError[];
    warnings: PipelineValidationWarning[];
}

export interface PipelineValidationError {
    type: 'error';
    code: string;
    message: string;
    stepIndex?: number;
    field?: string;
}

export interface PipelineValidationWarning {
    type: 'warning';
    code: string;
    message: string;
    stepIndex?: number;
    field?: string;
}

/**
 * Validate a complete pipeline configuration
 */
export function validatePipeline(pipeline: any, jobs: Job[]): PipelineValidationResult {
    const errors: PipelineValidationError[] = [];
    const warnings: PipelineValidationWarning[] = [];

    // Basic pipeline validation
    if (!pipeline.name?.trim()) {
        errors.push({
            type: 'error',
            code: 'MISSING_NAME',
            message: 'Pipeline name is required'
        });
    }

    if (!pipeline.triggerType) {
        errors.push({
            type: 'error',
            code: 'MISSING_TRIGGER_TYPE',
            message: 'Trigger type is required'
        });
    }

    // Step validation
    if (!pipeline.steps || pipeline.steps.length === 0) {
        errors.push({
            type: 'error',
            code: 'NO_STEPS',
            message: 'Pipeline must have at least one execution step'
        });
    } else {
        validatePipelineSteps(pipeline.steps, jobs, errors, warnings);
    }

    // Trigger-specific validation
    validateTriggerConfiguration(pipeline, errors, warnings);

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate pipeline steps
 */
function validatePipelineSteps(steps: any[], jobs: Job[], errors: PipelineValidationError[], warnings: PipelineValidationWarning[]): void {
    const jobIds = new Set<number>();
    const outputNames = new Set<string>();

    steps.forEach((step, index) => {
        // Check for duplicate job IDs
        if (step.jobId && jobIds.has(step.jobId)) {
            warnings.push({
                type: 'warning',
                code: 'DUPLICATE_JOB',
                message: `Job ${step.jobId} is used multiple times`,
                stepIndex: index
            });
        }
        if (step.jobId) jobIds.add(step.jobId);

        // Check for duplicate output names
        if (step.outputName && outputNames.has(step.outputName)) {
            errors.push({
                type: 'error',
                code: 'DUPLICATE_OUTPUT_NAME',
                message: `Output name '${step.outputName}' is already used`,
                stepIndex: index,
                field: 'outputName'
            });
        }
        if (step.outputName) outputNames.add(step.outputName);

        // Validate job exists
        if (step.jobId) {
            const job = jobs.find(j => j.id === step.jobId);
            if (!job) {
                errors.push({
                    type: 'error',
                    code: 'JOB_NOT_FOUND',
                    message: `Job with ID ${step.jobId} does not exist`,
                    stepIndex: index,
                    field: 'jobId'
                });
            }
        } else if (step.moduleType !== 'logic_gatekeeper') {
            // Regular steps need a job ID unless it's a decision node
            errors.push({
                type: 'error',
                code: 'MISSING_JOB_ID',
                message: 'Step must have a job selected',
                stepIndex: index,
                field: 'jobId'
            });
        }

        // Validate condition expressions
        if (step.conditionExpression) {
            const validation = validateConditionExpression(step.conditionExpression, steps, index);
            if (!validation.isValid && validation.error) {
                errors.push({
                    type: 'error',
                    code: 'INVALID_CONDITION',
                    message: validation.error,
                    stepIndex: index,
                    field: 'conditionExpression'
                });
            }
        }

        // Validate retry configuration
        if (step.retryConfig) {
            const retryValidation = validateRetryConfig(step.retryConfig);
            if (!retryValidation.isValid) {
                errors.push(...retryValidation.errors.map(err => ({
                    type: 'error' as const,
                    code: err.code,
                    message: err.message,
                    stepIndex: index,
                    field: 'retryConfig'
                })));
            }
        }
    });
}

/**
 * Validate trigger configuration
 */
function validateTriggerConfiguration(pipeline: any, errors: PipelineValidationError[], warnings: PipelineValidationWarning[]): void {
    const { triggerType, eventConfig, webhookConfig } = pipeline;

    if (triggerType === 'event') {
        if (!eventConfig?.eventType?.trim()) {
            errors.push({
                type: 'error',
                code: 'MISSING_EVENT_TYPE',
                message: 'Event type is required for event triggers',
                field: 'eventConfig.eventType'
            });
        }
    }

    if (triggerType === 'webhook') {
        if (webhookConfig?.verificationMode === 'hmac' && !webhookConfig.verificationConfig) {
            errors.push({
                type: 'error',
                code: 'MISSING_WEBHOOK_SECRET',
                message: 'HMAC verification requires a secret key',
                field: 'webhookConfig.verificationConfig'
            });
        }

        if (webhookConfig?.mapPayload) {
            try {
                if (webhookConfig.payloadMapping) {
                    JSON.parse(webhookConfig.payloadMapping);
                }
            } catch {
                errors.push({
                    type: 'error',
                    code: 'INVALID_PAYLOAD_MAPPING',
                    message: 'Payload mapping must be valid JSON',
                    field: 'webhookConfig.payloadMapping'
                });
            }
        }
    }
}

/**
 * Validate condition expression syntax
 */
function validateConditionExpression(expression: string, steps: any[], currentIndex: number): { isValid: boolean; error?: string } {
    try {
        // Basic syntax check - look for balanced brackets and valid variable references
        const bracketCount = (expression.match(/\(/g) || []).length - (expression.match(/\)/g) || []).length;
        if (bracketCount !== 0) {
            return { isValid: false, error: 'Unbalanced parentheses' };
        }

        // Check for valid variable patterns
        const variablePattern = /\{\{([^}]+)\}\}/g;
        let match;
        while ((match = variablePattern.exec(expression)) !== null) {
            const variable = match[1];
            if (!isValidVariableReference(variable, steps, currentIndex)) {
                return { isValid: false, error: `Invalid variable reference: ${variable}` };
            }
        }

        return { isValid: true };
    } catch {
        return { isValid: false, error: 'Invalid expression syntax' };
    }
}

/**
 * Check if a variable reference is valid
 */
function isValidVariableReference(variable: string, steps: any[], currentIndex: number): boolean {
    // Check step.X.output pattern
    const stepOutputMatch = variable.match(/^step\.(\d+)\.output(?:\.(.+))?$/);
    if (stepOutputMatch) {
        const stepIndex = parseInt(stepOutputMatch[1]);
        return stepIndex < currentIndex && stepIndex >= 0;
    }

    // Check custom output names
    for (let i = 0; i < currentIndex; i++) {
        if (steps[i].outputName === variable) {
            return true;
        }
    }

    return false;
}

/**
 * Validate retry configuration
 */
function validateRetryConfig(config: any): { isValid: boolean; errors: Array<{ code: string; message: string }> } {
    const errors: Array<{ code: string; message: string }> = [];

    if (config.maxRetries < 1 || config.maxRetries > 10) {
        errors.push({
            code: 'INVALID_MAX_RETRIES',
            message: 'Max retries must be between 1 and 10'
        });
    }

    if (config.backoffMs < 100 || config.backoffMs > 300000) {
        errors.push({
            code: 'INVALID_BACKOFF_MS',
            message: 'Backoff delay must be between 100ms and 5 minutes'
        });
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

// ============================================================================
// PIPELINE PERFORMANCE UTILITIES
// ============================================================================

export interface PipelinePerformanceEstimate {
    estimatedDuration: number; // in seconds
    estimatedCost: number; // in USD
    bottleneckStep?: number;
    recommendations: string[];
}

/**
 * Estimate pipeline performance metrics
 */
export function estimatePipelinePerformance(pipeline: any, jobs: Job[]): PipelinePerformanceEstimate {
    let totalDuration = 0;
    let totalCost = 0;
    let maxDurationStep = -1;
    let maxDuration = 0;
    const recommendations: string[] = [];

    pipeline.steps?.forEach((step: any, index: number) => {
        if (!step.jobId) return;

        const job = jobs.find(j => j.id === step.jobId);
        if (!job) return;

        // Estimate duration based on job type and configuration
        const stepDuration = estimateStepDuration(step, job);
        totalDuration += stepDuration;

        // Estimate cost based on job type
        const stepCost = estimateStepCost(step, job);
        totalCost += stepCost;

        // Add wait duration
        totalDuration += step.waitDurationSeconds || 0;

        // Track bottleneck
        if (stepDuration > maxDuration) {
            maxDuration = stepDuration;
            maxDurationStep = index;
        }

        // Generate recommendations
        if (stepDuration > 300) { // More than 5 minutes
            recommendations.push(`Step ${index + 1} (${job.name}) may be a performance bottleneck`);
        }

        if (step.retryConfig && step.retryConfig.maxRetries > 3) {
            recommendations.push(`Step ${index + 1} has high retry count - consider improving reliability`);
        }
    });

    // Add parallel execution benefits (simplified)
    const parallelSteps = pipeline.steps?.filter((step: any) => step.parallelGroup) || [];
    if (parallelSteps.length > 1) {
        const parallelGroups = new Set(parallelSteps.map((s: any) => s.parallelGroup));
        parallelGroups.forEach(() => {
            totalDuration *= 0.7; // Rough estimate of parallel benefit
        });
    }

    // Budget check
    if (pipeline.monthlyBudgetUsd && totalCost > pipeline.monthlyBudgetUsd * 0.8) {
        recommendations.push('Estimated cost approaches monthly budget limit');
    }

    return {
        estimatedDuration: Math.ceil(totalDuration),
        estimatedCost: Math.round(totalCost * 100) / 100,
        bottleneckStep: maxDurationStep >= 0 ? maxDurationStep : undefined,
        recommendations
    };
}

/**
 * Estimate duration for a single step
 */
function estimateStepDuration(step: any, job: Job): number {
    // Base duration by job type
    const baseDurations: Record<string, number> = {
        'ai_api_call': 30, // AI calls typically 10-60 seconds
        'api': 10,
        'curl': 15,
        'shell': 20,
        'python': 25,
        'sql_query': 8,
        'transformer': 5,
        'email_send': 3,
        'slack_post': 2,
        'file_ops': 5,
        'selenium': 45,
        'node_script': 15,
        'git_op': 10,
        'file_writer': 3,
        'confluence_sync': 60,
        'google_drive_sync': 45,
    };

    let duration = baseDurations[job.type] || 10;

    // Adjust for retry configuration
    if (step.retryConfig) {
        const retries = Math.min(step.retryConfig.maxRetries, 3); // Cap at 3 for estimation
        const backoffMultiplier = step.retryConfig.backoffMultiplier || 2;
        duration *= (1 + retries * backoffMultiplier * 0.5); // Rough failure probability estimate
    }

    return duration;
}

/**
 * Estimate cost for a single step
 */
function estimateStepCost(step: any, job: Job): number {
    // Base costs (rough estimates in USD per execution)
    const baseCosts: Record<string, number> = {
        'ai_api_call': 0.02, // GPT-4 calls are expensive
        'api': 0.001,
        'curl': 0.001,
        'shell': 0.005,
        'python': 0.01,
        'sql_query': 0.002,
        'transformer': 0.001,
        'email_send': 0.001,
        'slack_post': 0.001,
        'file_ops': 0.001,
        'selenium': 0.01,
        'node_script': 0.005,
        'git_op': 0.002,
        'file_writer': 0.001,
        'confluence_sync': 0.01,
        'google_drive_sync': 0.01,
    };

    return baseCosts[job.type] || 0.001;
}

// ============================================================================
// PIPELINE DEPENDENCY ANALYSIS
// ============================================================================

export interface PipelineDependencyGraph {
    nodes: PipelineDependencyNode[];
    edges: PipelineDependencyEdge[];
    cycles: number[][];
}

export interface PipelineDependencyNode {
    stepIndex: number;
    jobId: number | null;
    dependencies: number[];
    dependents: number[];
}

export interface PipelineDependencyEdge {
    from: number;
    to: number;
    type: 'data' | 'control' | 'parallel';
}

/**
 * Analyze pipeline dependencies and data flow
 */
export function analyzePipelineDependencies(pipeline: any): PipelineDependencyGraph {
    const nodes: PipelineDependencyNode[] = [];
    const edges: PipelineDependencyEdge[] = [];
    const cycles: number[][] = [];

    pipeline.steps?.forEach((step: any, index: number) => {
        const node: PipelineDependencyNode = {
            stepIndex: index,
            jobId: step.jobId,
            dependencies: [],
            dependents: []
        };

        // Analyze condition expressions for dependencies
        if (step.conditionExpression) {
            const deps = extractDependenciesFromExpression(step.conditionExpression);
            node.dependencies.push(...deps);
        }

        // Decision nodes create control dependencies
        if (step.moduleType === 'logic_gatekeeper' && step.decisionNodeConfig?.routes) {
            Object.values(step.decisionNodeConfig.routes).forEach((route: any) => {
                if (route.destinationStepId !== undefined) {
                    edges.push({
                        from: index,
                        to: route.destinationStepId,
                        type: 'control'
                    });
                }
            });
        }

        // Parallel groups create parallel dependencies
        if (step.parallelGroup) {
            const parallelSteps = pipeline.steps
                .map((s: any, i: number) => ({ ...s, index: i }))
                .filter((s: any) => s.parallelGroup === step.parallelGroup && s.index !== index);

            parallelSteps.forEach((parallelStep: any) => {
                edges.push({
                    from: Math.min(index, parallelStep.index),
                    to: Math.max(index, parallelStep.index),
                    type: 'parallel'
                });
            });
        }

        nodes.push(node);
    });

    // Build reverse dependencies
    nodes.forEach(node => {
        node.dependencies.forEach(dep => {
            const depNode = nodes[dep];
            if (depNode) {
                depNode.dependents.push(node.stepIndex);
            }
        });
    });

    // Detect cycles (simplified - only direct cycles)
    for (let i = 0; i < nodes.length; i++) {
        for (const dep of nodes[i].dependencies) {
            if (nodes[dep]?.dependencies.includes(i)) {
                cycles.push([i, dep]);
            }
        }
    }

    return { nodes, edges, cycles };
}

/**
 * Extract step dependencies from condition expression
 */
function extractDependenciesFromExpression(expression: string): number[] {
    const dependencies: number[] = [];
    const variablePattern = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = variablePattern.exec(expression)) !== null) {
        const variable = match[1];
        const stepMatch = variable.match(/^step\.(\d+)\.output/);
        if (stepMatch) {
            const stepIndex = parseInt(stepMatch[1]);
            if (!dependencies.includes(stepIndex)) {
                dependencies.push(stepIndex);
            }
        }
    }

    return dependencies;
}
