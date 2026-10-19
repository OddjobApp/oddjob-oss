/**
 * Control Flow and Logic Job Configuration Schemas
 * 
 * Contains schemas for execution flow control:
 * - Repeater (Looping)
 * - Iterator (Array processing)
 * - Decision (Conditional branching)
 * - Human Approval (Manual intervention)
 * - Form Agent (Interactive data collection)
 * - Static Response (Mocking/Constants)
 */

import { z } from "zod";
import { curlConfigSchema } from './config-integration.js';

// ============================================================================
// LOOP & ITERATION
// ============================================================================

export const repeaterConfigSchema = z.object({
    inputSource: z.string(), // Variable reference like "{{step.1.output}}"
    nestedJobType: z.enum(["curl", "api"]),
    nestedJobConfig: curlConfigSchema, // The CURL/API template to execute
    itemVariable: z.string().default("item"), // Variable name for array items (default: "item")
    maxIterations: z.number().int().positive().optional(), // Safety limit
    stopOnError: z.boolean().default(false), // Continue or stop on first error
    waitBetweenIterationsMs: z.number().int().nonnegative().optional().default(0), // Wait period in milliseconds between iterations
    executionMode: z.enum(["sequential", "parallel"]).default("sequential"),
    concurrency: z.number().int().positive().default(5), // Parallel concurrency limit
});

export type RepeaterConfig = z.infer<typeof repeaterConfigSchema>;

export const iteratorConfigSchema = z.object({
    mode: z.enum(["job", "pipeline"]).default("job"),
    targetId: z.number().int(), // Job ID or Pipeline ID to run
    inputArray: z.string().min(1), // Variable ref: "{{step.1.outputs.items}}"
    itemVarName: z.string().default("item"),
    concurrency: z.number().min(1).max(50).default(1),
    aggregateOutputs: z.boolean().default(true),
});

export type IteratorConfig = z.infer<typeof iteratorConfigSchema>;

// ============================================================================
// CONDITIONAL & MAPPING
// ============================================================================

export const decisionConfigSchema = z.object({
    condition: z.string().min(1), // e.g. "{{step.0.output}} == 'success'" or "{{step.0.output.count}} > 10"
    trueStepId: z.number().int().positive().optional(), // Step ID to route to when condition is true
    falseStepId: z.number().int().positive().optional(), // Step ID to route to when condition is false
});

export type DecisionConfig = z.infer<typeof decisionConfigSchema>;

export const staticResponseConfigSchema = z.object({
    content: z.string(),
    requiredVariables: z.array(z.string()).default([]),
    outputMapping: z.record(z.string(), z.string()).optional(),
});

export type StaticResponseConfig = z.infer<typeof staticResponseConfigSchema>;

// ============================================================================
// HUMAN INTERACTION
// ============================================================================

export const humanApprovalApproverSchema = z.object({
    type: z.enum(['internal', 'external']),
    id: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
});

export type HumanApprovalApprover = z.infer<typeof humanApprovalApproverSchema>;

export const humanApprovalConfigSchema = z.object({
    formId: z.number().int(),
    // A Form Studio stage: the step asks its approvers for this stage of the
    // response the cycle is filling in for formId, instead of the whole form.
    stageId: z.string().min(1).max(200).optional(),
    approvers: z.array(humanApprovalApproverSchema).optional(),
    policy: z.enum(['any', 'all']).optional().default('any'),
    assigneeEmail: z.string().email().optional().or(z.literal('')),
    timeoutHours: z.number().optional().default(24),
    themeConfig: z.object({
        logoUrl: z.string().optional(),
        primaryColor: z.string().optional(),
        companyName: z.string().optional(),
    }).optional(),
    securityConfig: z.object({
        requireOtp: z.boolean().optional(),
        tokenExpirationHours: z.number().optional(),
    }).optional(),
});

export type HumanApprovalConfig = z.infer<typeof humanApprovalConfigSchema>;

export const formAgentConfigSchema = z.object({
    documentTemplateId: z.number().int(),
    formSchema: z.object({
        fields: z.array(z.object({
            key: z.string(),
            type: z.enum(["text", "textarea", "markdown", "select", "rating", "boolean"]),
            label: z.string(),
            description: z.string().optional(),
            required: z.boolean().default(false),
            options: z.array(z.string()).optional(),
            placeholder: z.string().optional(),
            max: z.number().optional(),
            defaultValue: z.string().optional(),
            readOnly: z.boolean().default(false),
        }))
    }),
    outputDataset: z.string().optional(),
    variableMappings: z.record(z.string(), z.string()).default({}),
    timeoutMinutes: z.number().int().default(15),
    retryOnFailure: z.boolean().default(false),
});

export type FormAgentConfig = z.infer<typeof formAgentConfigSchema>;

// ============================================================================
// SERVICE DISPATCHER
// ============================================================================

export const dispatcherConfigSchema = z.object({
    missionTemplateId: z.number().int().optional(),
    missionTemplateName: z.string().optional(),
    serviceType: z.string().describe("Type of service (e.g. tow, medical, security)"),
    userLocationSource: z.enum(["variable", "gps"]).default("variable"),
    userLocationVar: z.string().optional().describe("Variable reference for user location (e.g. {{data.location}})"),
    isDemoMode: z.boolean().default(false),
});

export type DispatcherConfig = z.infer<typeof dispatcherConfigSchema>;




