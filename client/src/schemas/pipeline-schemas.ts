import { z } from "zod";

// --- Constants ---

export const TRIGGER_TYPES = [
    { value: 'manual', label: 'Manual Trigger' },
    { value: 'schedule', label: 'Scheduled' },
    { value: 'webhook', label: 'Webhook' },
    { value: 'event', label: 'Event Trigger' },
] as const;

export const CONDITION_TYPES = [
    { value: 'on_success', label: 'On Success' },
    { value: 'on_failure', label: 'On Failure' },
    { value: 'always', label: 'Always' },
] as const;

export const FAILURE_ACTION_TYPES = [
    { value: 'Stop Pipeline', label: 'Stop Pipeline' },
    { value: 'Continue to Next', label: 'Continue to Next Step' },
    { value: 'Execute Fallback Job', label: 'Execute Fallback Activity (Not Implemented)' },
] as const;

// --- Zod Schemas ---

// Schema for validating steps during form editing (allows jobId 0 for incomplete steps)
export const PipelineStepFormSchema = z.object({
    jobId: z.number().int().min(0).nullable(), // Allow 0 during editing, nullable for Decision Nodes
    order: z.number().int().default(0),
    runOnCondition: z.enum(["on_success", "on_failure", "always"]).default("on_success"),
    waitDurationSeconds: z.number().int().min(0).nullable().optional(),
    outputName: z.string().nullable().optional(),
    onFailureAction: z.enum(["Stop Pipeline", "Continue to Next", "Execute Fallback Job"]).default("Stop Pipeline"),
    parallelGroup: z.string().optional(),
    conditionExpression: z.string().optional(),
    moduleType: z.string().nullable().optional(), // "logic_gatekeeper" for Decision Nodes, "transformer" for Transformation Nodes
    destinationStepId: z.number().int().nullable().optional(),
    destinationTempId: z.string().optional(),
    decisionNodeConfig: z.any().optional(),
    transformerConfig: z.any().optional(), // Transformer job configuration
    knowledgeGraphConfig: z.any().optional(), // Explicit Knowledge Graph mapping rules
    retryConfig: z.object({
        maxRetries: z.number().min(1).max(10),
        backoffMs: z.number().min(100).max(300000),
        retryOnCategories: z.array(z.string())
    }).optional().nullable(),
    name: z.string().optional(),
    type: z.string().optional(),
});

// Schema for validating steps when submitting (requires valid jobId)
export const PipelineStepSchema = z.object({
    jobId: z.number().int().min(1, "Activity selection is required"),
    order: z.number().int().default(0),
    runOnCondition: z.enum(["on_success", "on_failure", "always"]).default("on_success"),
    waitDurationSeconds: z.number().int().min(0).default(0),
    outputName: z.string().optional(),
    onFailureAction: z.enum(["Stop Pipeline", "Continue to Next", "Execute Fallback Job"]).default("Stop Pipeline"),
    parallelGroup: z.string().optional(),
    conditionExpression: z.string().optional(),
});

export const PipelineCreateSchema = z.object({
    name: z.string().min(3, 'Name is required').max(100),
    description: z.string().optional(),
    triggerType: z.enum(['manual', 'schedule', 'webhook', 'event']).default('manual'),
    triggerCredentialId: z.number().int().positive().optional().nullable(),
    eventConfig: z.object({
        eventType: z.string().optional(),
        filterCondition: z.string().optional()
    }).optional(),
    webhookConfig: z.object({
        verificationMode: z.enum(['none', 'hmac', 'header_token']).default('none'),
        verificationConfig: z.string().optional(), // JSON string for config
        mapPayload: z.boolean().default(false),
        payloadMapping: z.string().optional(), // JSON string for mapping
    }).optional(),
    isActive: z.boolean().default(true),
    monthlyBudgetUsd: z.number().min(0).optional().nullable(),
    labels: z.array(z.string()).optional(),
    steps: z.array(PipelineStepFormSchema).optional(), // Use form schema that allows jobId 0
}).superRefine((data, ctx) => {
    // Validate that at least one step with a valid jobId exists
    const validSteps = (data.steps || []).filter((step) => step.jobId && step.jobId > 0);
    if (validSteps.length === 0 && (data.steps || []).length > 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "At least one execution step must have an activity selected",
            path: ['steps'],
        });
    }

    if (data.triggerType === 'event' && !data.eventConfig?.eventType) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Event Type is required for Event triggers",
            path: ['eventConfig', 'eventType'],
        });
    }
});

export type PipelineFormValues = z.infer<typeof PipelineCreateSchema>;
