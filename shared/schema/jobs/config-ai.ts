/**
 * AI/ML Job Configuration Schemas
 * 
 * Contains schemas for AI-powered job types:
 * - AI API Call
 * - AI Agent
 * - Reranker
 * - Retrieval Settings
 * - Supervisor
 */

import { z } from "zod";
import { agentPersonas } from './types.js';

// ============================================================================
// PRECISION CONTEXT ENGINE SCHEMAS
// ============================================================================

export const retrievalSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    k: z.number().int().positive().default(50),
    recencyBias: z.number().min(0).max(1).default(0.5),
    authorityBias: z.number().min(0).max(1).default(0.5),
    enableReranking: z.boolean().default(false),
});

export type RetrievalSettings = z.infer<typeof retrievalSettingsSchema>;

export const rerankerConfigSchema = z.object({
    credentialId: z.number().int().positive(),
    model: z.string().default("BAAI/bge-reranker-v2-m3"),
    topK: z.number().int().positive().default(5),
    query: z.string(),
    documents: z.string(), // Usually a variable like {{step.0.output}}
});

export type RerankerConfig = z.infer<typeof rerankerConfigSchema>;

// ============================================================================
// AI API CALL CONFIGURATION
// ============================================================================

export const multiTokenPredictionConfigSchema = z.object({
    enabled: z.boolean().default(false),
    preferred: z.boolean().optional(),
    required: z.boolean().optional(),
    backend: z.enum(["vllm", "sglang", "custom"]).optional(),
    numSpeculativeTokens: z.number().int().min(1).max(16).optional(),
    requestPassthrough: z.boolean().default(false),
    extraRequestBody: z.record(z.any()).optional(),
});

export type MultiTokenPredictionConfig = z.infer<typeof multiTokenPredictionConfigSchema>;

export const aiApiCallConfigSchema = z.object({
    credentialId: z.number().int().positive().optional(),
    provider: z.string().optional(), // NEW: AI Provider (e.g., "openai", "anthropic")
    baseUrl: z.string().url().optional(), // Optional endpoint override for local providers
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).optional().default(0.7),
    maxTokens: z.number().int().positive().optional(),
    systemPrompt: z.string().optional(),
    systemIdentity: z.string().optional(), // For defining the agent's core persona/identity
    systemPromptAddition: z.string().optional(), // For internal injection of context/schema
    userPrompt: z.string().min(1), // Supports {{input}} variable substitution
    requestType: z.enum(["json", "text", "custom"]).optional(), // For requesting JSON mode from AI provider
    responseType: z.enum(["json", "text", "auto"]).optional(), // For parsing/formatting AI response
    useCache: z.boolean().optional().default(false),
    enableQueryExpansion: z.boolean().default(false).optional(), // NEW: Enhanced RAG
    retrievalSettings: retrievalSettingsSchema.optional(),
    // Local Optimization & Sampling Parameters
    maxContextTokens: z.number().int().positive().optional(),
    topK: z.number().int().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
    repeatPenalty: z.number().min(0).optional(),
    multiTokenPrediction: multiTokenPredictionConfigSchema.optional(),
    attachments: z.array(z.object({
        type: z.enum(['image_url', 'file_url']),
        url: z.string().url(),
        detail: z.enum(['low', 'high', 'auto']).optional(),
    })).optional(),
    saveOutputToFile: z.boolean().optional().default(false),
    screenshotDirectory: z.string().optional(),
    isPriority: z.boolean().optional(), // Priority throttling; defaults to true when absent
    tools: z.array(z.any()).optional(), // For tool-calling support
    messages: z.array(z.object({
        role: z.enum(["user", "model", "system", "tool"]),
        content: z.union([z.string(), z.array(z.any())])
    })).optional(),
    // Financial Guardrails (Phase 1)
    organizationId: z.number().int().optional().nullable(),
    missionId: z.number().int().optional().nullable(),
    cachedContentName: z.string().optional(), // NEW: For Gemini Context Caching
    adapterPath: z.string().optional(), // dynamic LoRA adapter path
    /**
     * Gemini thinking-token budget. gemini-2.5-* / *-latest are thinking models:
     * left unbounded, the reasoning trace is charged against maxOutputTokens and
     * the visible answer is truncated mid-sentence. Set 0 to spend the whole
     * budget on the answer. Opt-in — omitted leaves provider defaults alone.
     */
    thinkingBudget: z.number().int().min(0).optional(),
    /**
     * Per-call fetch timeout in milliseconds; falls back to AI_FETCH_TIMEOUT_MS,
     * then 30s. The client has always honoured this (see the FETCH_TIMEOUT_MS
     * read in ai-client.service), but it was undeclared here, so every caller
     * that set it failed to type-check and the client had to reach for it
     * through a cast. Declared so the two agree.
     */
    timeoutMs: z.number().int().positive().optional(),
});


export type AIApiCallConfig = z.infer<typeof aiApiCallConfigSchema>;

// ============================================================================
// AI AGENT CONFIGURATION
// ============================================================================

export const aiAgentConfigSchema = z.object({
    credentialId: z.number().int().positive(),
    provider: z.string().optional(), // NEW: AI Provider (e.g., "openai", "anthropic")
    model: z.string().min(1),
    goal: z.string().min(1),
    persona: z.enum(agentPersonas).default("generic"),
    specialties: z.array(z.string()).optional(),
    maxIterations: z.number().int().positive().default(10),
    tokenBudget: z.number().int().positive().optional(), // Per-agent token budget (overrides global)
    allowedTools: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
    temperature: z.number().min(0).max(2).default(0.7), // Response Variation Control
    // Knowledge Configuration
    knowledgeTypes: z.array(z.enum(['docs', 'graph', 'datas.js'])).optional(),
    topicIds: z.array(z.number().int()).optional(), // Limit to specific topics
    datasetIds: z.array(z.number().int()).optional(), // Limit to specific datasets
    pipelineIds: z.array(z.number().int()).optional(), // Limit to specific pipelines
    templateIds: z.array(z.number().int()).optional(), // Reference selection templates
    dryRun: z.boolean().default(false), // Simulator Mode: Don't execute side-effect tools
    saveOutputToFile: z.boolean().default(false),
    screenshotDirectory: z.string().optional(),
    // Supervision & Decision Routing
    supervision: z.enum(["full", "advisory", "none"]).default("full"),
    notificationChannels: z.array(z.enum([
        "copilot",     // In-chat decision cards (default for interactive)
        "inbox",       // Decision Inbox page
        "slack",       // Slack interactive message
        "email",       // Email with approve/reject links
        "sms"          // SMS via Twilio
    ])).optional().default(["copilot"]),
    expertiseJobId: z.number().int().optional().nullable(),
    // Financial Guardrails (Phase 1)
    organizationId: z.number().int().optional().nullable(),
    missionId: z.number().int().optional().nullable(),
    // Execution Strategy (from cycle YAML agent definition)
    executionStrategy: z.object({
        pre_execution: z.array(z.object({
            action: z.string(),
            on_failure: z.string().optional(),
            output: z.string().optional(),
        })).optional(),
        iteration_strategy: z.enum(["plan_then_execute", "execute_and_verify", "iterative"]).optional(),
        max_consecutive_failures: z.number().int().positive().optional(),
        checkpoint_every_n_iterations: z.number().int().positive().optional(),
    }).optional().nullable(),
});


export type AIAgentConfig = z.infer<typeof aiAgentConfigSchema>;

// ============================================================================
// SUPERVISOR JOB CONFIGURATION
// ============================================================================

export const supervisorJobConfigSchema = z.object({
    intent: z.string().min(1).describe("The high-level goal for the supervisor"),
    credentialId: z.number().int().positive().optional().describe("Explicit AI credential to use for planning"),
    model: z.string().default("gpt-4-turbo"),
    allowedPipelines: z.array(z.number().int()).optional().describe("IDs of pipelines this supervisor can delegate to"),
    requirePlanApproval: z.boolean().default(false).describe("If true, pauses after planning for human review"),
    systemPrompt: z.string().optional(),
    maxSteps: z.number().int().default(10),
    saveOutputToFile: z.boolean().default(false),
    screenshotDirectory: z.string().optional(),
});

export type SupervisorJobConfig = z.infer<typeof supervisorJobConfigSchema>;

// ============================================================================
// PREDICTION & SPATIAL RERANKER CONFIGURATIONS (Sense-Predict-Act Triad)
// ============================================================================

export const predictionInferenceConfigSchema = z.object({
    modelId: z.string().min(1).describe("Target prediction or surrogate model ID"),
    framework: z.enum(["onnx", "pytorch", "lightgbm", "python_script", "kinematic_surrogate"]).default("onnx"),
    inputFeatures: z.string().describe("Input features JSON or variable reference e.g. {{step.0.output}}"),
    horizonSeconds: z.number().int().positive().optional().default(300),
    confidenceThreshold: z.number().min(0).max(1).optional().default(0.75),
});

export type PredictionInferenceConfig = z.infer<typeof predictionInferenceConfigSchema>;

export const spatialRerankerConfigSchema = z.object({
    h3IndexSource: z.string().describe("Target H3 index or reference e.g. {{step.0.output.h3Index}}"),
    kRing: z.number().int().min(1).max(10).default(3),
    spatialDecayFactor: z.number().min(0).max(1).default(0.85),
    topK: z.number().int().positive().default(5),
    documents: z.string().describe("Candidate items or entities to rerank e.g. {{step.0.output.entities}}"),
});

export type SpatialRerankerConfig = z.infer<typeof spatialRerankerConfigSchema>;




