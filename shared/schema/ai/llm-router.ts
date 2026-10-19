/**
 * LLM Router Schema
 * Multi-provider routing, cost tracking, and fallback management
 */

import { pgTable, serial, integer, text, timestamp, jsonb, real, boolean, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

// LLM Provider configurations
export const llmProviders = pgTable("llm_providers", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    
    // Provider identification
    name: text("name").notNull(), // openai, anthropic, google, azure, etc.
    displayName: text("display_name").notNull(),
    
    // Credentials (encrypted)
    apiKey: text("api_key").notNull(),
    apiEndpoint: text("api_endpoint"), // Custom endpoint for Azure/self-hosted
    
    // Capabilities
    supportsStreaming: boolean("supports_streaming").default(true),
    supportsVision: boolean("supports_vision").default(false),
    supportsFunctions: boolean("supports_functions").default(false),
    supportsJsonMode: boolean("supports_json_mode").default(false),
    
    // Rate limits
    maxRequestsPerMinute: integer("max_requests_per_minute").default(60),
    maxTokensPerMinute: integer("max_tokens_per_minute").default(100000),
    maxConcurrentRequests: integer("max_concurrent_requests").default(10),
    
    // Status
    isActive: boolean("is_active").default(true),
    priority: integer("priority").default(100), // Lower = higher priority for routing
    
    // Cost tracking
    defaultInputCostPer1k: real("default_input_cost_per_1k").default(0),
    defaultOutputCostPer1k: real("default_output_cost_per_1k").default(0),
    
    // Metadata
    metadata: jsonb("metadata"), // Provider-specific config
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    orgIdx: index("llm_providers_org_idx").on(t.organizationId),
    nameIdx: index("llm_providers_name_idx").on(t.name),
    activeIdx: index("llm_providers_active_idx").on(t.isActive),
}));

// Available models per provider
export const llmModels = pgTable("llm_models", {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").references(() => llmProviders.id).notNull(),
    organizationId: integer("organization_id"),
    
    // Model identification
    modelId: text("model_id").notNull(), // gpt-4, claude-3-opus, etc.
    displayName: text("display_name").notNull(),
    
    // Capabilities
    contextWindow: integer("context_window").notNull(), // Max tokens in context
    maxOutputTokens: integer("max_output_tokens"),
    supportsStreaming: boolean("supports_streaming").default(true),
    supportsVision: boolean("supports_vision").default(false),
    supportsFunctions: boolean("supports_functions").default(false),
    supportsJsonMode: boolean("supports_json_mode").default(false),
    
    // Quality/speed ratings (1-100, for intelligent routing)
    qualityScore: integer("quality_score").default(80), // Overall quality
    speedScore: integer("speed_score").default(80), // Response speed
    costScore: integer("cost_score").default(80), // Cost efficiency
    
    // Cost (override provider defaults)
    inputCostPer1k: real("input_cost_per_1k"),
    outputCostPer1k: real("output_cost_per_1k"),
    priority: integer("priority").default(100),
    
    // Status
    isActive: boolean("is_active").default(true),
    isDefault: boolean("is_default").default(false), // Default for this capability
    
    // Capabilities tags for matching
    capabilities: jsonb("capabilities").default([]), // ["code", "reasoning", "creative", "analysis"]
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    providerIdx: index("llm_models_provider_idx").on(t.providerId),
    orgIdx: index("llm_models_org_idx").on(t.organizationId),
    modelIdx: index("llm_models_model_idx").on(t.modelId),
    activeIdx: index("llm_models_active_idx").on(t.isActive),
    capabilityIdx: index("llm_models_capability_idx").on(t.capabilities),
}));

// Routing rules for intelligent model selection
export const llmRoutingRules = pgTable("llm_routing_rules", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    
    // Rule matching
    name: text("name").notNull(),
    description: text("description"),
    priority: integer("priority").default(100),
    isActive: boolean("is_active").default(true),
    
    // Match conditions
    requiredCapabilities: jsonb("required_capabilities"), // ["vision", "code"]
    minQualityScore: integer("min_quality_score"),
    maxCostPer1k: real("max_cost_per_1k"),
    preferredProviders: jsonb("preferred_providers"), // ["openai", "anthropic"]
    excludedProviders: jsonb("excluded_providers"),
    
    // Target model (null = auto-select based on conditions)
    targetModelId: integer("target_model_id").references(() => llmModels.id),
    
    // Fallback configuration
    fallbackEnabled: boolean("fallback_enabled").default(true),
    fallbackModels: jsonb("fallback_models"), // Ordered list of fallback model IDs
    maxRetries: integer("max_retries").default(3),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    orgIdx: index("llm_routing_rules_org_idx").on(t.organizationId),
    priorityIdx: index("llm_routing_rules_priority_idx").on(t.priority),
    activeIdx: index("llm_routing_rules_active_idx").on(t.isActive),
}));

// Request routing log
export const llmRouterLogs = pgTable("llm_router_logs", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    
    // Request details
    requestId: text("request_id").notNull().unique(),
    jobId: integer("job_id"),
    jobRunId: integer("job_run_id"),
    
    // Routing decision
    selectedProviderId: integer("selected_provider_id").references(() => llmProviders.id),
    selectedModelId: integer("selected_model_id").references(() => llmModels.id),
    routingRuleId: integer("routing_rule_id").references(() => llmRoutingRules.id),
    routingStrategy: text("routing_strategy").notNull(), // cost, quality, speed, specific
    
    // Request params
    requestParams: jsonb("request_params"),
    requiredCapabilities: jsonb("required_capabilities"),
    
    // Usage
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    cost: real("cost"),
    
    // Performance
    latencyMs: integer("latency_ms"),
    timeToFirstTokenMs: integer("time_to_first_token_ms"),
    
    // Result
    success: boolean("success"),
    errorMessage: text("error_message"),
    errorCode: text("error_code"),
    responseContent: text("response_content"),
    
    // Fallback tracking
    wasFallback: boolean("was_fallback").default(false),
    fallbackAttempt: integer("fallback_attempt").default(0),
    previousAttemptIds: jsonb("previous_attempt_ids"),

    // Multi-token prediction telemetry
    mtpEnabled: boolean("mtp_enabled").default(false),
    mtpSpeedupPct: doublePrecision("mtp_speedup_pct"),
    mtpAccuracyPct: doublePrecision("mtp_accuracy_pct"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    orgIdx: index("llm_router_logs_org_idx").on(t.organizationId),
    requestIdx: index("llm_router_logs_request_idx").on(t.requestId),
    jobIdx: index("llm_router_logs_job_idx").on(t.jobId),
    providerIdx: index("llm_router_logs_provider_idx").on(t.selectedProviderId),
    modelIdx: index("llm_router_logs_model_idx").on(t.selectedModelId),
    successIdx: index("llm_router_logs_success_idx").on(t.success),
    createdIdx: index("llm_router_logs_created_idx").on(t.createdAt),
}));

// Provider health status (for automatic failover)
export const llmProviderHealth = pgTable("llm_provider_health", {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").references(() => llmProviders.id).notNull(),
    
    // Health metrics (rolling window)
    successRate: real("success_rate").default(100), // 0-100
    avgLatencyMs: integer("avg_latency_ms"),
    errorRate: real("error_rate").default(0),
    
    // Status
    status: text("status").default("healthy"), // healthy, degraded, down
    lastCheckedAt: timestamp("last_checked_at").defaultNow(),
    lastErrorAt: timestamp("last_error_at"),
    lastErrorMessage: text("last_error_message"),
    
    // Circuit breaker
    consecutiveFailures: integer("consecutive_failures").default(0),
    circuitOpen: boolean("circuit_open").default(false),
    circuitOpenUntil: timestamp("circuit_open_until"),
    
    // Statistics (last hour)
    requestsCount: integer("requests_count").default(0),
    tokensCount: integer("tokens_count").default(0),
    errorsCount: integer("errors_count").default(0),
    
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    providerIdx: index("llm_provider_health_provider_idx").on(t.providerId),
    statusIdx: index("llm_provider_health_status_idx").on(t.status),
    circuitIdx: index("llm_provider_health_circuit_idx").on(t.circuitOpen),
}));

// Schemas
export const insertLlmProviderSchema = createInsertSchema(llmProviders).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertLlmModelSchema = createInsertSchema(llmModels).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertLlmRoutingRuleSchema = createInsertSchema(llmRoutingRules).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertLlmRouterLogSchema = createInsertSchema(llmRouterLogs).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertLlmProviderHealthSchema = createInsertSchema(llmProviderHealth).omit({
    id: true,
    lastCheckedAt: true,
    lastErrorAt: true,
    circuitOpenUntil: true,
    updatedAt: true,
});

// Types
export type LlmProvider = typeof llmProviders.$inferSelect;
export type InsertLlmProvider = z.infer<typeof insertLlmProviderSchema>;

export type LlmModel = typeof llmModels.$inferSelect;
export type InsertLlmModel = z.infer<typeof insertLlmModelSchema>;

export type LlmRoutingRule = typeof llmRoutingRules.$inferSelect;
export type InsertLlmRoutingRule = z.infer<typeof insertLlmRoutingRuleSchema>;

export type LlmRouterLog = typeof llmRouterLogs.$inferSelect;
export type InsertLlmRouterLog = z.infer<typeof insertLlmRouterLogSchema>;

export type LlmProviderHealth = typeof llmProviderHealth.$inferSelect;
export type InsertLlmProviderHealth = z.infer<typeof insertLlmProviderHealthSchema>;


