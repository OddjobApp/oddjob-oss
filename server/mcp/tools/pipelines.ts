/**
 * Oddjob MCP Server - Pipeline Tools
 * 
 * Exposes tools for managing and executing automation pipelines
 * through the Model Context Protocol.
 */

import { z } from "zod";

// Step module types for pipeline steps
const stepModuleTypes = [
    "job",           // Execute a job
    "decision",      // Conditional branching
    "iterator",      // Loop over an array/list
    "start",         // Pipeline start node
    "end",           // Pipeline end node
] as const;

export const pipelineToolDefinitions = [
    // ========================================================================
    // READ OPERATIONS
    // ========================================================================
    {
        name: "list_pipelines",
        description: "List all automation pipelines configured in the system. Pipelines are multi-step workflows that can be triggered manually, on a schedule, or via webhooks.",
        inputSchema: {
            type: "object" as const,
            properties: {
                activeOnly: {
                    type: "boolean",
                    description: "Filter for active pipelines only. Default: false (show all)",
                },
                search: {
                    type: "string",
                    description: "Optional: Search term to filter pipelines by name or description",
                },
            },
        },
    },
    {
        name: "get_pipeline_details",
        description: "Get detailed information about a specific pipeline including its steps, configuration, and recent execution history.",
        inputSchema: {
            type: "object" as const,
            properties: {
                pipelineId: {
                    type: "number",
                    description: "ID of the pipeline",
                },
                pipelineName: {
                    type: "string",
                    description: "Alternative: Name of the pipeline (if ID not known)",
                },
                includeExecutionHistory: {
                    type: "boolean",
                    description: "Include recent execution history. Default: true",
                },
            },
        },
    },
    {
        name: "get_pipeline_execution_status",
        description: "Check the status of a pipeline execution. Returns current status, step progress, and any outputs or errors.",
        inputSchema: {
            type: "object" as const,
            properties: {
                executionId: {
                    type: "number",
                    description: "Pipeline execution ID (returned from run_pipeline)",
                },
                includeStepDetails: {
                    type: "boolean",
                    description: "Include detailed output from each step. Default: true",
                },
            },
            required: ["executionId"],
        },
    },
    {
        name: "list_recent_executions",
        description: "List recent pipeline executions across all pipelines. Useful for monitoring and debugging.",
        inputSchema: {
            type: "object" as const,
            properties: {
                limit: {
                    type: "number",
                    description: "Maximum results. Default: 10, Max: 100",
                },
                status: {
                    type: "string",
                    enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
                    description: "Filter by execution status",
                },
                pipelineId: {
                    type: "number",
                    description: "Filter by specific pipeline ID",
                },
            },
        },
    },

    // ========================================================================
    // WRITE OPERATIONS (Admin only)
    // ========================================================================
    {
        name: "create_pipeline",
        description: `Create a new automation pipeline. Requires admin permissions.

A pipeline consists of ordered steps that execute jobs in sequence or parallel.

**Step Types:**
- **job**: Execute a specific job (by jobId)
- **decision**: Conditional branching based on previous step output
- **iterator**: Loop over an array/list, running a job/pipeline for each item

**Example Pipeline Structure:**
1. CURL job fetches data from API
2. Transformer job extracts entities
3. Decision step checks data validity
4. Slack notification on completion`,
        inputSchema: {
            type: "object" as const,
            properties: {
                name: {
                    type: "string",
                    description: "Unique name for the pipeline",
                },
                description: {
                    type: "string",
                    description: "Description of what the pipeline does",
                },
                triggerType: {
                    type: "string",
                    enum: ["manual", "schedule", "webhook", "event"],
                    description: "How the pipeline is triggered. Default: manual",
                },
                isActive: {
                    type: "boolean",
                    description: "Whether pipeline is active. Default: true",
                },
                steps: {
                    type: "array",
                    description: "Array of pipeline steps in execution order",
                    items: {
                        type: "object",
                        properties: {
                            jobId: { type: "number", description: "ID of job to execute (for job steps)" },
                            moduleType: { type: "string", enum: stepModuleTypes, description: "Type of step: job, decision, iterator" },
                            order: { type: "number", description: "Execution order (1, 2, 3...)" },
                            outputName: { type: "string", description: "Name for this step's output variable" },
                            runOnCondition: { type: "string", description: "Condition expression (e.g., 'steps.1.output.success')" },
                            onFailureAction: { type: "string", enum: ["stop", "continue", "retry"], description: "What to do if step fails" },
                            decisionNodeConfig: {
                                type: "object",
                                description: "For decision steps: {condition, trueStepId, falseStepId}",
                            },
                            iteratorConfig: {
                                type: "object",
                                description: "For iterator steps: {inputArray, targetJobId, itemVarName}",
                            },
                        },
                    },
                },
            },
            required: ["name"],
        },
    },
    {
        name: "update_pipeline",
        description: "Update an existing pipeline's configuration. Requires admin permissions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                pipelineId: {
                    type: "number",
                    description: "ID of the pipeline to update",
                },
                name: {
                    type: "string",
                    description: "New name (optional)",
                },
                description: {
                    type: "string",
                    description: "New description (optional)",
                },
                isActive: {
                    type: "boolean",
                    description: "Enable or disable the pipeline",
                },
                triggerType: {
                    type: "string",
                    enum: ["manual", "schedule", "webhook", "event"],
                },
            },
            required: ["pipelineId"],
        },
    },
    {
        name: "delete_pipeline",
        description: "Delete a pipeline. Requires admin permissions. Cannot delete pipelines that are currently running.",
        inputSchema: {
            type: "object" as const,
            properties: {
                pipelineId: {
                    type: "number",
                    description: "ID of the pipeline to delete",
                },
            },
            required: ["pipelineId"],
        },
    },

    // ========================================================================
    // STEP MANAGEMENT
    // ========================================================================
    {
        name: "add_pipeline_step",
        description: `Add a step to an existing pipeline. Requires admin permissions.

**Step Configuration Examples:**

**Job Step:**
{jobId: 5, order: 1, outputName: "api_data"}

**Decision Step:**
{moduleType: "decision", order: 2, decisionNodeConfig: {condition: "steps.1.output.count > 0", trueStepId: 3, falseStepId: 4}}

**Iterator Step:**
{moduleType: "iterator", order: 3, iteratorConfig: {inputArray: "{{steps.1.output.items}}", targetJobId: 7, itemVarName: "item"}}`,
        inputSchema: {
            type: "object" as const,
            properties: {
                pipelineId: {
                    type: "number",
                    description: "Pipeline to add step to",
                },
                jobId: {
                    type: "number",
                    description: "Job ID to execute (for job steps)",
                },
                moduleType: {
                    type: "string",
                    enum: stepModuleTypes,
                    description: "Step type: job (default), decision, iterator",
                },
                order: {
                    type: "number",
                    description: "Execution order (1, 2, 3...)",
                },
                outputName: {
                    type: "string",
                    description: "Name for output variable (e.g., 'api_response')",
                },
                runOnCondition: {
                    type: "string",
                    description: "Optional condition to run this step",
                },
                onFailureAction: {
                    type: "string",
                    enum: ["stop", "continue", "retry"],
                    description: "Action if step fails. Default: stop",
                },
                waitDurationSeconds: {
                    type: "number",
                    description: "Wait time before executing step",
                },
                decisionNodeConfig: {
                    type: "object",
                    description: "For decision: {condition, trueStepId, falseStepId}",
                },
                iteratorConfig: {
                    type: "object",
                    description: "For iterator: {inputArray, targetJobId, itemVarName, concurrency}",
                },
            },
            required: ["pipelineId", "order"],
        },
    },
    {
        name: "update_pipeline_step",
        description: "Update a pipeline step's configuration. Requires admin permissions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                stepId: {
                    type: "number",
                    description: "ID of the step to update",
                },
                jobId: { type: "number" },
                order: { type: "number" },
                outputName: { type: "string" },
                runOnCondition: { type: "string" },
                onFailureAction: { type: "string", enum: ["stop", "continue", "retry"] },
                waitDurationSeconds: { type: "number" },
                decisionNodeConfig: { type: "object" },
                iteratorConfig: { type: "object" },
            },
            required: ["stepId"],
        },
    },
    {
        name: "delete_pipeline_step",
        description: "Remove a step from a pipeline. Requires admin permissions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                stepId: {
                    type: "number",
                    description: "ID of the step to delete",
                },
            },
            required: ["stepId"],
        },
    },

    // ========================================================================
    // EXECUTION
    // ========================================================================
    {
        name: "run_pipeline",
        description: "Trigger execution of a specific pipeline. Returns the execution ID for monitoring. Use with caution as this performs real actions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                pipelineId: {
                    type: "number",
                    description: "ID of the pipeline to execute",
                },
                pipelineName: {
                    type: "string",
                    description: "Alternative: Name of the pipeline (if ID not known)",
                },
                inputData: {
                    type: "object",
                    description: "Optional input data to pass to the pipeline's first step",
                },
                dryRun: {
                    type: "boolean",
                    description: "If true, validates the pipeline without actually executing. Default: false",
                },
            },
        },
    },
    {
        name: "delegate_task",
        description: "Delegate a sub-task to a specific pipeline. This creates a child execution linked to the current execution. Used by supervisor agents to orchestrate work.",
        inputSchema: {
            type: "object" as const,
            properties: {
                pipelineId: { type: "number", description: "ID of the pipeline to delegate to" },
                pipelineName: { type: "string", description: "Alternative: Name of the pipeline (to be resolved by agent registry)" },
                inputData: { type: "object", description: "Input variables for the sub-pipeline" },
                reason: { type: "string", description: "Reason/Context for this delegation" },
            },
        },
    },
];

// Input validation schemas
export const ListPipelinesInput = z.object({
    activeOnly: z.boolean().default(false),
    search: z.string().optional(),
});

export const GetPipelineDetailsInput = z.object({
    pipelineId: z.number().optional(),
    pipelineName: z.string().optional(),
    includeExecutionHistory: z.boolean().default(true),
});

export const RunPipelineInput = z.object({
    pipelineId: z.number().optional(),
    pipelineName: z.string().optional(),
    inputData: z.record(z.any()).optional(),
    dryRun: z.boolean().default(false),
});

export const GetExecutionStatusInput = z.object({
    executionId: z.number(),
    includeStepDetails: z.boolean().default(true),
});

export const ListRecentExecutionsInput = z.object({
    limit: z.number().min(1).max(100).default(10),
    status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
    pipelineId: z.number().optional(),
});

// New pipeline CRUD schemas
export const CreatePipelineInput = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    triggerType: z.enum(["manual", "schedule", "webhook", "event"]).default("manual"),
    monthlyBudgetUsd: z.number().optional(),
    isActive: z.boolean().default(true),
    steps: z.array(z.object({
        jobId: z.number().optional(),
        moduleType: z.enum(["job", "decision", "iterator", "start", "end"]).default("job"),
        order: z.number().int().positive(),
        outputName: z.string().optional(),
        runOnCondition: z.string().optional(),
        onFailureAction: z.enum(["stop", "continue", "retry"]).optional(),
        decisionNodeConfig: z.record(z.any()).optional(),
        iteratorConfig: z.record(z.any()).optional(),
    })).optional(),
});

export const UpdatePipelineInput = z.object({
    pipelineId: z.number(),
    name: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    triggerType: z.enum(["manual", "schedule", "webhook", "event"]).optional(),
});

export const DeletePipelineInput = z.object({
    pipelineId: z.number(),
});

export const AddPipelineStepInput = z.object({
    pipelineId: z.number(),
    jobId: z.number().optional(),
    moduleType: z.enum(["job", "decision", "iterator", "start", "end"]).default("job"),
    order: z.number().int().positive(),
    outputName: z.string().optional(),
    runOnCondition: z.string().optional(),
    onFailureAction: z.enum(["stop", "continue", "retry"]).optional(),
    waitDurationSeconds: z.number().optional(),
    decisionNodeConfig: z.record(z.any()).optional(),
    iteratorConfig: z.record(z.any()).optional(),
});

export const UpdatePipelineStepInput = z.object({
    stepId: z.number(),
    jobId: z.number().optional(),
    order: z.number().optional(),
    outputName: z.string().optional(),
    runOnCondition: z.string().optional(),
    onFailureAction: z.enum(["stop", "continue", "retry"]).optional(),
    waitDurationSeconds: z.number().optional(),
    decisionNodeConfig: z.record(z.any()).optional(),
    iteratorConfig: z.record(z.any()).optional(),
});

export const DeletePipelineStepInput = z.object({
    stepId: z.number(),
});

export const DelegateTaskInput = z.object({
    pipelineId: z.number().optional(),
    pipelineName: z.string().optional(),
    inputData: z.record(z.any()).optional(),
    reason: z.string().describe("Reason for delegation"),
});

