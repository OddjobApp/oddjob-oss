
import { createLogger } from "@server/utils/logger.js";
import { type GovernorPolicyRule, type GovernorPolicy } from "@shared/schema/governor.js";
import { ForbiddenError, NotFoundError } from "@server/utils/errors.js";
import path from "path";

import { db } from "@server/database_service.js";
import { aiUsageLogs, governorPolicies, governorPolicyRules, missions, pipelines, jobs, missionMembers, missionRuns } from "@shared/schema/index.js";
import { eq, and, gte, sql, desc, isNull } from "drizzle-orm";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { capabilityPolicyLoader, type CapabilityCheck, type CheckResult } from "./capability-policy-loader.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("GovernorService");

// ---------------------------------------------------------------------------
// Rule configuration shapes
//
// `governorPolicyRules.configuration` is a jsonb column, so Drizzle infers it
// as `unknown`. Each rule `type` implies a specific configuration shape (see
// the zod union on `insertGovernorPolicyRuleSchema` in shared/schema/governor).
// These interfaces let call sites cast `configuration` to a concrete shape
// instead of an inline `{ ... }` or `any`.
// ---------------------------------------------------------------------------
interface ToolListConfig { tools?: string[]; }
interface McpServerConfig { servers?: string[]; }
interface McpToolConfig { serverName: string; tools: string[]; }
interface PiiRedactionConfig { patterns?: Array<{ name: string; regex: string }>; }
interface BudgetConfig { maxCostUSD: number; scope: 'mission' | 'organization' | 'daily_total'; }
interface AutoApproveConfig { tools: string[]; maxCostUSD?: number; allowedTypes?: string[]; }
interface ModelCapConfig { maxModelTier?: 'local' | 'economy' | 'premium'; allowedModels?: string[]; }
interface FilePathConfig { allowedPaths?: string[]; blockedPaths?: string[]; }
interface NetworkConfig { allowedDomains?: string[]; blockedDomains?: string[]; }
/** Time-scoped tool grant created via {@link GovernorServiceInterface.createScopedAllowRule}. */
interface ScopedAllowConfig { tools: string[]; missionRunId?: number; expiresAt: string; }

// ---------------------------------------------------------------------------
// Method result shapes
// ---------------------------------------------------------------------------
export interface ValidationResult {
    allowed: boolean;
    message?: string;
    warning?: string;
    reasoning?: string;
}

export interface GovernanceStats {
    activePolicies: number;
    totalPolicies: number;
    recentViolations: number;
    pendingApprovals: number;
    systemHealth: 'Healthy' | 'Degraded';
}

export interface SystemHierarchy {
    missions: (typeof missions.$inferSelect)[];
    pipelines: (typeof pipelines.$inferSelect)[];
    jobs: (typeof jobs.$inferSelect)[];
    members: (typeof missionMembers.$inferSelect)[];
}

export interface AgentSalarySummary {
    id: number;
    agentId: number;
    agentName: string | null;
    sessionId: string;
    budgetTokens: number;
    currentSpendTokens: number;
    status: string;
    lastUpdated: Date;
}

export type PolicyWithRules = GovernorPolicy & { rules: GovernorPolicyRule[] };

export interface PolicyRuleInput {
    type: string;
    configuration?: unknown;
    isEnabled?: boolean;
}

export interface CreatePolicyInput {
    name: string;
    description?: string;
    type?: string;
    organizationId?: number;
    rules?: PolicyRuleInput[];
}

export interface UpdatePolicyInput {
    name?: string;
    description?: string;
    type?: string;
    isActive?: boolean;
    rules?: PolicyRuleInput[];
}

export interface CreateScopedAllowRuleParams {
    toolName: string;
    missionRunId?: number;
    expiresAfterMs?: number;
}

export interface GovernorServiceInterface {
    validateBudget(params: { executionId?: number, organizationId?: number }, rules: GovernorPolicyRule[]): Promise<ValidationResult>;
    validateResourceLoad(): Promise<ValidationResult>;
    validateMcpPermission(serverName: string, toolName: string, rules: GovernorPolicyRule[]): void;
    validateAutoApproval(toolName: string, requestType: string, estimatedCost: number, rules: GovernorPolicyRule[]): { allowed: boolean; reasoning?: string };
    validateToolAccess(toolName: string, rules: GovernorPolicyRule[]): void;
    redactSensitiveData(text: string, rules: GovernorPolicyRule[]): string;
    generatePolicyFromFeedback(feedbackId: number, context: string): Promise<Partial<GovernorPolicyRule>>;
    getStats(): Promise<GovernanceStats>;
    getHierarchy(): Promise<SystemHierarchy>;
    listPolicies(): Promise<GovernorPolicy[]>;
    getPolicyWithRules(id: number): Promise<PolicyWithRules>;
    createPolicy(data: CreatePolicyInput, createdBy: string): Promise<GovernorPolicy>;
    updatePolicy(id: number, data: UpdatePolicyInput): Promise<GovernorPolicy>;
    deletePolicy(id: number): Promise<void>;
    getAgentSalaries(): Promise<AgentSalarySummary[]>;
    increaseAgentBudget(agentId: number, sessionId: string, additionalTokens: number): Promise<void>;
    recommendExecutionStrategy(options: { objective: string, organizationId: number }): Promise<{ strategy: string, reason: string }>;
    validateModel(model: string, rules: GovernorPolicyRule[]): void;
    validateFilePath(filePath: string, rules: GovernorPolicyRule[]): void;
    validateNetworkDestination(url: string, rules: GovernorPolicyRule[]): void;
    /**
     * Validate a capability check against the YAML-based capability policy loaded for this org.
     * Returns a CheckResult (allowed + reason). Throws ForbiddenError if enforcement = 'strict'.
     */
    validateFromPolicy(orgId: number | string, userRole: string, capability: CapabilityCheck): CheckResult;
    /**
     * Grant a time-scoped `tool_allow` rule (e.g. from a HIL approval). The grant
     * self-expires after `expiresAfterMs` and is ignored by validateToolAccess once expired.
     */
    createScopedAllowRule(params: CreateScopedAllowRuleParams): Promise<GovernorPolicyRule>;
}

/** True when a rule carries an `expiresAt` timestamp that is now in the past. */
function isRuleExpired(rule: GovernorPolicyRule): boolean {
    const config = rule.configuration as { expiresAt?: string } | null;
    if (!config?.expiresAt) return false;
    const expiry = Date.parse(config.expiresAt);
    return Number.isFinite(expiry) && expiry <= Date.now();
}

/**
 * Find (or lazily create) the auto-managed policy that hosts runtime, time-scoped
 * tool approvals for a given organization. A `null` org resolves to the global policy.
 */
async function ensureRuntimeApprovalPolicy(organizationId: number | null): Promise<GovernorPolicy> {
    const RUNTIME_POLICY_NAME = 'Runtime Scoped Approvals';

    const nameMatch = eq(governorPolicies.name, RUNTIME_POLICY_NAME);
    const scopeMatch = organizationId === null
        ? isNull(governorPolicies.organizationId)
        : eq(governorPolicies.organizationId, organizationId);

    const [existing] = await db.select()
        .from(governorPolicies)
        .where(and(nameMatch, scopeMatch));
    if (existing) return existing;

    const [created] = await db.insert(governorPolicies).values({
        name: RUNTIME_POLICY_NAME,
        description: 'Auto-managed policy hosting time-scoped tool approvals granted via HIL.',
        type: 'system',
        organizationId: organizationId ?? undefined,
        createdBy: 'governor-service',
    }).returning();
    return created;
}

export const governorService: GovernorServiceInterface = {
    /**
     * Budget Validation
     */
    async validateBudget(params: { executionId?: number, organizationId?: number }, rules: GovernorPolicyRule[]): Promise<ValidationResult> {
        const budgetRules = rules.filter((r) => r.type === 'budget_limit' && r.isEnabled);
        if (budgetRules.length === 0) return { allowed: true };

        for (const rule of budgetRules) {
            const config = rule.configuration as BudgetConfig;
            let currentCost = 0;

            if (config.scope === 'mission' && params.executionId) {
                const result = await db.select({ total: sql<number>`sum(cost_usd)` })
                    .from(aiUsageLogs)
                    .where(eq(aiUsageLogs.executionId, params.executionId));
                currentCost = Number(result[0]?.total || 0);
            } else if (config.scope === 'organization' && params.organizationId) {
                const result = await db.select({ total: sql<number>`sum(cost_usd)` })
                    .from(aiUsageLogs)
                    .where(eq(aiUsageLogs.organizationId, params.organizationId));
                currentCost = Number(result[0]?.total || 0);
            } else if (config.scope === 'daily_total') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                // Today's spend for this org only: without the org filter one tenant's
                // budget was measured against every tenant's spend combined.
                const result = await db.select({ total: sql<number>`sum(cost_usd)` })
                    .from(aiUsageLogs)
                    .where(and(
                        gte(aiUsageLogs.createdAt, today),
                        params.organizationId != null
                            ? eq(aiUsageLogs.organizationId, params.organizationId)
                            : isNull(aiUsageLogs.organizationId),
                    ));
                currentCost = Number(result[0]?.total || 0);
            }

            // Warning at 85% of budget
            const warningThreshold = config.maxCostUSD * 0.85;

            if (currentCost >= config.maxCostUSD) {
                logger.warn(`Governance: Budget limit exceeded (${config.scope}). Current: $${currentCost}, Max: $${config.maxCostUSD}`);
                return {
                    allowed: false,
                    message: `Governance Policy: Budget limit exceeded for ${config.scope} ($${currentCost} >= $${config.maxCostUSD}).`
                };
            }

            if (currentCost >= warningThreshold) {
                const remaining = config.maxCostUSD - currentCost;
                return {
                    allowed: true,
                    warning: `BUDGET WARNING: You have utilized 85%+ of your allocated budget ($${currentCost.toFixed(2)} / $${config.maxCostUSD.toFixed(2)}). You have $${remaining.toFixed(2)} remaining. Please prioritize finishing critical tasks.`
                };
            }
        }
        return { allowed: true };
    },

    /**
     * Resource Load Validation (Scaling Guard)
     */
    async validateResourceLoad(): Promise<ValidationResult> {
        // Monitor DB Pool Utilization
        try {
            const poolStats = await db.execute(sql`SELECT sum(numbackends) FROM pg_stat_database`);
            const rows = poolStats.rows ?? [];
            const active = Number(rows[0]?.sum ?? 0);

            if (active > 45) { // 90% of 50
                return {
                    allowed: false,
                    message: "System under high database load. Throttling non-critical missions."
                };
            }
        } catch (err) {
            logger.warn(`Resource load check failed: ${err}`);
        }
        return { allowed: true };
    },

    /**
     * MCP Permission Validation
     */
    validateMcpPermission(serverName: string, toolName: string, rules: GovernorPolicyRule[]): void {
        // 1. Check for Server Deny
        const serverDenyRules = rules.filter((r) => r.type === 'mcp_server_deny' && r.isEnabled);
        for (const rule of serverDenyRules) {
            const config = rule.configuration as McpServerConfig;
            if (config.servers?.includes(serverName) || config.servers?.includes("*")) {
                logger.warn(`Governance: MCP Server '${serverName}' blocked by rule ${rule.id}`);
                throw new ForbiddenError(`Governance Policy: Usage of MCP server '${serverName}' is explicitly forbidden.`);
            }
        }

        // 2. Check for Tool Deny
        const toolDenyRules = rules.filter((r) => r.type === 'mcp_tool_deny' && r.isEnabled);
        for (const rule of toolDenyRules) {
            const config = rule.configuration as McpToolConfig;
            if ((config.serverName === serverName || config.serverName === "*") && (config.tools.includes(toolName) || config.tools.includes("*"))) {
                logger.warn(`Governance: MCP Tool '${serverName}.${toolName}' blocked by rule ${rule.id}`);
                throw new ForbiddenError(`Governance Policy: Usage of MCP tool '${serverName}.${toolName}' is explicitly forbidden.`);
            }
        }

        // 3. Check for Server Allow (Whitelist)
        const serverAllowRules = rules.filter((r) => r.type === 'mcp_server_allow' && r.isEnabled);
        if (serverAllowRules.length > 0) {
            let isAllowed = false;
            for (const rule of serverAllowRules) {
                const config = rule.configuration as McpServerConfig;
                if (config.servers?.includes(serverName)) {
                    isAllowed = true;
                    break;
                }
            }
            if (!isAllowed) {
                logger.warn(`Governance: MCP Server '${serverName}' not in allowlist.`);
                throw new ForbiddenError(`Governance Policy: Usage of MCP server '${serverName}' is not permitted.`);
            }
        }
    },

    /**
     * Permission Tiers (HIL 2.0): Check if an action is pre-approved.
     */
    validateAutoApproval(toolName: string, requestType: string, estimatedCost: number, rules: GovernorPolicyRule[]): { allowed: boolean; reasoning?: string } {
        // Systemic exemption for authorized ecosystem tools
        const canonicalTool = toolName.toLowerCase();
        if (canonicalTool.startsWith('confluence.') || canonicalTool.startsWith('jira.')) {
            return { allowed: true, reasoning: "Systemically pre-authorized tool (Confluence/Jira ecosystem)." };
        }

        const autoRules = rules.filter((r) => r.type === 'auto_approve' && r.isEnabled);
        if (autoRules.length === 0) return { allowed: false, reasoning: "No auto-approval rules found." };

        for (const rule of autoRules) {
            const config = rule.configuration as AutoApproveConfig;

            // 1. Tool Match
            if (!config.tools.includes(toolName) && !config.tools.includes("*")) continue;

            // 2. Type Match (e.g., input_request, mode_switch_request)
            if (config.allowedTypes && !config.allowedTypes.includes(requestType)) continue;

            // 3. Cost Match
            if (config.maxCostUSD !== undefined && estimatedCost > config.maxCostUSD) continue;

            return {
                allowed: true,
                reasoning: `Auto-approved by policy rule ${rule.id} (Tier 2/3 Bypass).`
            };
        }

        return { allowed: false, reasoning: "Action does not meet criteria for automated bypass." };
    },

    /**
     * URL/Tool Blocklist Validation
     */
    validateToolAccess(toolName: string, rules: GovernorPolicyRule[]): void {
        // 1. Check for Semantic Deny (Explicit Block)
        const denyRules = rules.filter((r) => r.type === 'tool_deny' && r.isEnabled);
        for (const rule of denyRules) {
            const config = rule.configuration as ToolListConfig;
            if (config.tools?.includes(toolName)) {
                logger.warn(`Governance: Tool '${toolName}' blocked by rule ${rule.id}`);
                throw new ForbiddenError(`Governance Policy: Usage of tool '${toolName}' is explicitly forbidden.`);
            }
        }

        // 2. Check for Allowonly (Whitelist)
        // If ANY (non-expired) whitelist rule exists, the tool MUST be in it.
        // Expired scoped grants (see createScopedAllowRule) are ignored so they
        // neither authorize a tool nor keep the whitelist "armed" after expiry.
        const allowRules = rules.filter((r) => r.type === 'tool_allow' && r.isEnabled && !isRuleExpired(r));
        if (allowRules.length > 0) {
            let isAllowed = false;
            for (const rule of allowRules) {
                const config = rule.configuration as ToolListConfig;
                if (config.tools?.includes(toolName)) {
                    isAllowed = true;
                    break;
                }
            }
            if (!isAllowed) {
                logger.warn(`Governance: Tool '${toolName}' not in allowlist.`);
                throw new ForbiddenError(`Governance Policy: Usage of tool '${toolName}' is not permitted by the active allowlist.`);
            }
        }
    },

    /**
     * PII Redaction
     */
    redactSensitiveData(text: string, rules: GovernorPolicyRule[]): string {
        const piiRules = rules.filter((r) => r.type === 'pii_redaction' && r.isEnabled);
        if (piiRules.length === 0) return text;

        let redacted = text;
        for (const rule of piiRules) {
            const config = rule.configuration as PiiRedactionConfig;
            if (config.patterns) {
                for (const pattern of config.patterns) {
                    try {
                        const regex = new RegExp(pattern.regex, 'gi');
                        redacted = redacted.replace(regex, `[REDACTED-${pattern.name}]`);
                    } catch (err) {
                        logger.error(`Invalid PII regex in rule ${rule.id}`, err);
                    }
                }
            }
        }
        return redacted;
    },
    /**
     * AI-Driven Self-Correction: Generate a policy rule from negative feedback.
     */
    async generatePolicyFromFeedback(feedbackId: number, context: string): Promise<Partial<GovernorPolicyRule>> {
        const config = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-1.5-flash' };

        // Circular dependency handling if necessary, but evaluationService is a singleton object
        // We'll pass the context directly or import it if no cycle.

        const apiKey = config.apiKey || developmentProviderKey();
        const { AIClientFactory } = await import("../../ai/core/ai-client.service.js");
        const aiClient = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

        const prompt = `
        A user has reported a failure in an AI Agent's execution.

        CONTEXT / FAILURE DESCRIPTION:
        "${context}"

        YOUR TASK:
        Propose a single Governance Policy Rule to prevent this in the future.

        AVAILABLE RULE TYPES:
        1. "tool_deny": Block a specific tool. Config: { tools: ["tool_name"] }
        2. "tool_allow": Allow only specific tools. Config: { tools: ["tool_a", "tool_b"] }
        3. "pii_redaction": Redact sensitive patterns. Config: { patterns: [{ name: "SSN", regex: "\\d{3}-\\d{2}-\\d{4}" }] }
        4. "budget_limit": Limit cost. Config: { maxCostUSD: 1.0, scope: "mission" }

        OUTPUT FORMAT (JSON ONLY):
        {
            "name": "Short descriptive name",
            "description": "Why this rule is needed",
            "type": "tool_deny" | "tool_allow" | "pii_redaction" | "budget_limit",
            "configuration": { ... }
        }
        `;

        const result = await aiClient.execute({
            model: config.model,
            userPrompt: prompt,
            temperature: 0.2,
            requestType: "json" // Correct way to trigger JSON mode in GoogleClient
        } as any, undefined, apiKey);

        if (!result.success || !result.output) {
            throw new Error("Failed to generate policy from feedback.");
        }

        try {
            // Clean code blocks just in case
            const cleanOutput = result.output.replace(/```json/g, '').replace(/```/g, '').trim();
            const policy = JSON.parse(cleanOutput);
            return policy;
        } catch (e) {
            console.error("Failed to parse AI output:", result.output);
            throw new Error("AI returned invalid JSON for policy generation.");
        }
    },

    /**
     * Get Governance Stats
     */
    async getStats(): Promise<GovernanceStats> {
        const [activeCount] = await db.select({ value: sql<number>`count(*)` }).from(governorPolicies).where(eq(governorPolicies.isActive, true));
        const [totalCount] = await db.select({ value: sql<number>`count(*)` }).from(governorPolicies);

        // Check Redis Health for System Status
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();
        let redisHealthy = false;
        try {
            if (redis.status === 'ready') {
                const pingPromise = redis.ping();
                const timeoutPromise = new Promise<string>((_, reject) =>
                    setTimeout(() => reject(new Error('Redis ping timeout')), 500)
                );
                await Promise.race([pingPromise, timeoutPromise]);
                redisHealthy = true;
            }
        } catch (e) { }

        return {
            activePolicies: Number(activeCount?.value ?? 0),
            totalPolicies: Number(totalCount?.value ?? 0),
            recentViolations: 0,
            pendingApprovals: 0,
            systemHealth: redisHealthy ? 'Healthy' : 'Degraded'
        };
    },

    /**
     * Get System Hierarchy
     */
    async getHierarchy(): Promise<SystemHierarchy> {
        const allMissions = await db.select().from(missions);
        const allPipelines = await db.select().from(pipelines);
        const allJobs = await db.select().from(jobs);
        const members = await db.select().from(missionMembers);

        return {
            missions: allMissions,
            pipelines: allPipelines,
            jobs: allJobs,
            members: members
        };
    },

    /**
     * List Policies
     */
    async listPolicies(): Promise<GovernorPolicy[]> {
        return await db.select()
            .from(governorPolicies)
            .orderBy(desc(governorPolicies.createdAt));
    },

    /**
     * Get Policy with Rules
     */
    async getPolicyWithRules(id: number): Promise<PolicyWithRules> {
        const [policy] = await db.select().from(governorPolicies).where(eq(governorPolicies.id, id));
        if (!policy) throw new NotFoundError("Policy not found");

        const rules = await db.select().from(governorPolicyRules).where(eq(governorPolicyRules.policyId, id));
        return { ...policy, rules };
    },

    /**
     * Create Policy
     */
    async createPolicy(data: CreatePolicyInput, createdBy: string): Promise<GovernorPolicy> {
        const { name, description, type, organizationId, rules } = data;
        const [policy] = await db.insert(governorPolicies).values({
            name,
            description,
            type: type || 'custom',
            organizationId,
            createdBy
        }).returning();

        if (rules && Array.isArray(rules)) {
            const ruleValues = rules.map((r) => ({
                policyId: policy.id,
                type: r.type,
                configuration: r.configuration ?? {},
                isEnabled: r.isEnabled !== undefined ? !!r.isEnabled : true
            }));
            await db.insert(governorPolicyRules).values(ruleValues);
        }

        return policy;
    },

    /**
     * Update Policy
     */
    async updatePolicy(id: number, data: UpdatePolicyInput): Promise<GovernorPolicy> {
        const { name, description, type, isActive, rules } = data;

        const [policy] = await db.update(governorPolicies)
            .set({ name, description, type, isActive, updatedAt: new Date() })
            .where(eq(governorPolicies.id, id))
            .returning();

        if (!policy) throw new NotFoundError("Policy not found");

        if (rules && Array.isArray(rules)) {
            // Simple replace strategy for rules
            await db.delete(governorPolicyRules).where(eq(governorPolicyRules.policyId, id));
            const ruleValues = rules.map((r) => ({
                policyId: id,
                type: r.type,
                configuration: r.configuration ?? {},
                isEnabled: r.isEnabled !== undefined ? !!r.isEnabled : true
            }));
            await db.insert(governorPolicyRules).values(ruleValues);
        }

        return policy;
    },

    async deletePolicy(id: number): Promise<void> {
        await db.delete(governorPolicies).where(eq(governorPolicies.id, id));
    },

    /**
     * Get all active agent salaries for the Board Room.
     */
    async getAgentSalaries(): Promise<AgentSalarySummary[]> {
        const { agentSalaries } = await import("@shared/schema/governor.js");
        const { jobs } = await import("@shared/schema/index.js");

        return await db.select({
            id: agentSalaries.id,
            agentId: agentSalaries.agentId,
            agentName: jobs.name,
            sessionId: agentSalaries.sessionId,
            budgetTokens: agentSalaries.budgetTokens,
            currentSpendTokens: agentSalaries.currentSpendTokens,
            status: agentSalaries.status,
            lastUpdated: agentSalaries.lastUpdated
        })
        .from(agentSalaries)
        .leftJoin(jobs, eq(agentSalaries.agentId, jobs.id))
        .where(eq(agentSalaries.status, 'active'))
        .orderBy(desc(agentSalaries.lastUpdated));
    },

    /**
     * Increase an agent's budget (HIL Approval).
     */
    async increaseAgentBudget(agentId: number, sessionId: string, additionalTokens: number): Promise<void> {
        const { BudgetGovernanceService } = await import("./budget-governance.service.js");
        await BudgetGovernanceService.increaseBudget(agentId, sessionId, additionalTokens);
    },

    /**
     * Recommends the best execution strategy for a mission based on objective complexity and governance rules.
     */
    async recommendExecutionStrategy(options: { objective: string, organizationId: number }): Promise<{ strategy: string, reason: string }> {
        const { objective } = options;
        const lowercaseObj = objective.toLowerCase();

        // 1. Linear / Development / Specific Task / App Forge -> Rolling Wave (Vibecoding)
        if (
            lowercaseObj.includes("build") ||
            lowercaseObj.includes("implement") ||
            lowercaseObj.includes("create app") ||
            lowercaseObj.includes("forge") ||
            lowercaseObj.includes("mini app") ||
            lowercaseObj.includes("fix") ||
            lowercaseObj.includes("refactor")
        ) {
            return {
                strategy: "rolling_wave",
                reason: "Objective is implementation or app-forging focused. Rolling Wave (Vibecoding) provides high-velocity execution with continuous feedback loops."
            };
        }

        // 2. High Complexity / Research / Open-ended -> Dynamic Autonomous
        if (
            lowercaseObj.includes("research") ||
            lowercaseObj.includes("analyze") ||
            lowercaseObj.includes("explore") ||
            lowercaseObj.includes("discovery") ||
            lowercaseObj.includes("complex") ||
            lowercaseObj.includes("scrape") ||
            lowercaseObj.includes("search") ||
            lowercaseObj.includes("python") ||
            lowercaseObj.includes("shell") ||
            lowercaseObj.includes("script") ||
            lowercaseObj.includes("diagnose")
        ) {
            return {
                strategy: "dynamic_autonomous",
                reason: "Objective requires multi-step reasoning and autonomous discovery. Dynamic Autonomous allows the agent to self-correct and branch."
            };
        }

        // 3. Low Stakes / Monitoring / Reactive -> Reactive
        if (
            lowercaseObj.includes("monitor") ||
            lowercaseObj.includes("watch") ||
            lowercaseObj.includes("alert")
        ) {
            return {
                strategy: "reactive",
                reason: "Objective is event-driven. Reactive strategy minimizes resource usage by only executing on triggers."
            };
        }

        // 4. Baseline Default (Governance Policy)
        return {
            strategy: "dynamic_autonomous",
            reason: "Defaulting to Dynamic Autonomous for maximum flexibility under standard organizational governance."
        };
    },

    /**
     * Model Cap Validation
     */
    validateModel(model: string, rules: GovernorPolicyRule[]): void {
        const modelRules = rules.filter((r) => r.type === 'model_cap' && r.isEnabled);
        if (modelRules.length === 0) return;

        for (const rule of modelRules) {
            const config = rule.configuration as ModelCapConfig;

            if (config.allowedModels && config.allowedModels.length > 0) {
                if (!config.allowedModels.includes(model)) {
                    logger.warn(`Governance: Model '${model}' not permitted by active whitelist.`);
                    throw new ForbiddenError(`Governance Policy: Model '${model}' is not permitted by active whitelist.`);
                }
            }

            if (config.maxModelTier) {
                const isLocal = model.includes('llama') || model.includes('mistral') || model.includes('deepseek') || model.includes('phi') || model.includes('qwen') || model.startsWith('local:');
                const isEconomy = isLocal || model.includes('flash') || model.includes('haiku') || model.includes('gpt-3.5-turbo');

                if (config.maxModelTier === 'local' && !isLocal) {
                    logger.warn(`Governance: Non-local model '${model}' blocked by local-only model cap.`);
                    throw new ForbiddenError(`Governance Policy: Non-local model '${model}' is blocked by local-only model cap.`);
                }

                if (config.maxModelTier === 'economy' && !isEconomy) {
                    logger.warn(`Governance: Premium model '${model}' blocked by economy model cap.`);
                    throw new ForbiddenError(`Governance Policy: Premium model '${model}' is blocked by economy model cap.`);
                }
            }
        }
    },

    /**
     * File Path Restriction Validation
     */
    validateFilePath(filePath: string, rules: GovernorPolicyRule[]): void {
        const pathRules = rules.filter((r) => r.type === 'file_path_restriction' && r.isEnabled);
        if (pathRules.length === 0) return;

        // Resolve relative paths to absolute and normalize separators
        const absolutePath = path.resolve(filePath).replace(/\\/g, '/');

        const matchPattern = (targetPath: string, pattern: string): boolean => {
            const normalizedPattern = path.resolve(pattern).replace(/\\/g, '/');
            if (normalizedPattern.endsWith('/**')) {
                const prefix = normalizedPattern.slice(0, -3);
                return targetPath.startsWith(prefix);
            }
            if (normalizedPattern.endsWith('/*')) {
                const prefix = normalizedPattern.slice(0, -2);
                if (targetPath.startsWith(prefix)) {
                    const remaining = targetPath.slice(prefix.length);
                    return !remaining.includes('/');
                }
                return false;
            }
            return targetPath === normalizedPattern;
        };

        for (const rule of pathRules) {
            const config = rule.configuration as FilePathConfig;

            // 1. Blocked paths (blacklist)
            if (config.blockedPaths && config.blockedPaths.length > 0) {
                for (const pattern of config.blockedPaths) {
                    if (matchPattern(absolutePath, pattern)) {
                        logger.warn(`Governance: File path '${filePath}' blocked by rule ${rule.id}`);
                        throw new ForbiddenError(`Governance Policy: Access to file path '${filePath}' is explicitly forbidden.`);
                    }
                }
            }

            // 2. Allowed paths (whitelist)
            if (config.allowedPaths && config.allowedPaths.length > 0) {
                let isAllowed = false;
                for (const pattern of config.allowedPaths) {
                    if (matchPattern(absolutePath, pattern)) {
                        isAllowed = true;
                        break;
                    }
                }
                if (!isAllowed) {
                    logger.warn(`Governance: File path '${filePath}' not permitted by active allowlist.`);
                    throw new ForbiddenError(`Governance Policy: Access to file path '${filePath}' is not permitted by active allowlist.`);
                }
            }
        }
    },

    /**
     * Network Destination Restriction Validation
     */
    validateNetworkDestination(url: string, rules: GovernorPolicyRule[]): void {
        const netRules = rules.filter((r) => r.type === 'network_destination_restriction' && r.isEnabled);
        if (netRules.length === 0) return;

        let hostname: string;
        try {
            const parsed = new URL(url);
            hostname = parsed.hostname.toLowerCase();
        } catch {
            hostname = url.toLowerCase();
        }

        for (const rule of netRules) {
            const config = rule.configuration as NetworkConfig;

            // 1. Blocked domains (blacklist)
            if (config.blockedDomains && config.blockedDomains.length > 0) {
                for (const domain of config.blockedDomains) {
                    if (domain === '*' || hostname === domain || hostname.endsWith('.' + domain)) {
                        logger.warn(`Governance: Network destination '${url}' blocked by rule ${rule.id}`);
                        throw new ForbiddenError(`Governance Policy: Access to network destination '${url}' is explicitly forbidden.`);
                    }
                }
            }

            // 2. Allowed domains (whitelist)
            if (config.allowedDomains && config.allowedDomains.length > 0) {
                let isAllowed = false;
                for (const domain of config.allowedDomains) {
                    if (domain === '*' || hostname === domain || hostname.endsWith('.' + domain)) {
                        isAllowed = true;
                        break;
                    }
                }
                if (!isAllowed) {
                    logger.warn(`Governance: Network destination '${url}' not permitted by active allowlist.`);
                    throw new ForbiddenError(`Governance Policy: Access to network destination '${url}' is not permitted.`);
                }
            }
        }
    },

    /**
     * Validate a capability check against the YAML-based capability policy.
     *
     * @param orgId    Organization identifier (number from DB or string slug)
     * @param userRole Role of the agent/user making the request
     * @param capability The capability to check (type + value)
     */
    validateFromPolicy(orgId: number | string, userRole: string, capability: CapabilityCheck): CheckResult {
        if (!capabilityPolicyLoader.has(orgId)) {
            logger.debug(`[Governor] No YAML capability policy loaded for org ${orgId} — allowing.`);
            return { allowed: true, reason: 'No capability policy loaded for this org.' };
        }
        return capabilityPolicyLoader.check(orgId, userRole, capability);
    },

    /**
     * Grant a time-scoped `tool_allow` rule, e.g. when a human approves a tool via HIL
     * (see the `approve_tool` action in suggestion-apply.service). The rule is stored
     * under an auto-managed "Runtime Scoped Approvals" policy for the mission run's org
     * and self-expires after `expiresAfterMs` (default 1h). validateToolAccess ignores
     * the grant once expired.
     *
     * NOTE: enforcement is currently org-wide until expiry. Restricting the grant to a
     * single mission run (`missionRunId` is persisted for this) requires passing run
     * context into validateToolAccess and is tracked as a follow-up.
     */
    async createScopedAllowRule(params: CreateScopedAllowRuleParams): Promise<GovernorPolicyRule> {
        const { toolName, missionRunId, expiresAfterMs = 3600000 } = params;

        // Resolve the organization from the mission run so the grant is scoped to the right org.
        let organizationId: number | null = null;
        if (missionRunId !== undefined) {
            const [run] = await db.select({ organizationId: missionRuns.organizationId })
                .from(missionRuns)
                .where(eq(missionRuns.id, missionRunId));
            organizationId = run?.organizationId ?? null;
        }

        const policy = await ensureRuntimeApprovalPolicy(organizationId);
        const expiresAt = new Date(Date.now() + expiresAfterMs).toISOString();

        const configuration: ScopedAllowConfig = { tools: [toolName], missionRunId, expiresAt };
        const [rule] = await db.insert(governorPolicyRules).values({
            policyId: policy.id,
            type: 'tool_allow',
            configuration,
            isEnabled: true,
        }).returning();

        logger.info(`[Governor] Scoped allow rule ${rule.id} created for tool '${toolName}' (run ${missionRunId ?? 'n/a'}); expires ${expiresAt}`);
        return rule;
    },

};
