import type { AIClient, AIResponse, GeminiFileAttachment } from "./ai-client.service.js";
import type { AIApiCallConfig } from "@shared/schema/index.js";
import type { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { resolveAiOrganization } from "./ai-org-context.js";
import { orgModelService, type OrgModelConnection } from "./org-model.service.js";

/** What to tell a person whose organization has connected no AI provider. */
export const ORG_AI_KEY_MISSING =
    "Connect your organization's AI provider key in Organization Settings before running AI work";

/**
 * Run one call on an organization's own connection: its provider's client, its
 * key and model, never the platform cache. The endpoint comes from the
 * connection and overrides any `baseUrl` on the call, so a caller cannot send
 * an organization's key to another host.
 */
export async function executeOnConnection(connection: OrgModelConnection, organizationId: number,
    config: AIApiCallConfig, input: string | undefined,
    attachments?: GeminiFileAttachment[], traceContext?: TraceContext): Promise<AIResponse> {
    const call = { ...config, provider: connection.provider, model: connection.model, organizationId, useCache: false } as AIApiCallConfig;
    if (connection.provider === "google") {
        const { GoogleClient } = await import("./providers/google-client.js");
        return new GoogleClient().execute(call, input, connection.apiKey, attachments, traceContext);
    }
    if (connection.provider === "anthropic") {
        const { AnthropicClient } = await import("./providers/anthropic-client.js");
        return new AnthropicClient().execute({ ...call, baseUrl: undefined } as AIApiCallConfig, input, connection.apiKey, attachments, traceContext);
    }
    if (connection.provider === "bedrock") {
        // Converse: one request shape for every Bedrock model, on the connection's Region.
        const { BedrockClient } = await import("./providers/bedrock-client.js");
        return new BedrockClient(connection.baseUrl)
            .execute({ ...call, baseUrl: undefined } as AIApiCallConfig, input, connection.apiKey, attachments, traceContext);
    }
    const { OpenAIClient } = await import("./providers/openai-client.js");
    return new OpenAIClient({ baseUrl: connection.baseUrl })
        .execute({ ...call, baseUrl: connection.baseUrl } as AIApiCallConfig, input, connection.apiKey, attachments, traceContext);
}

/**
 * Calls for an org that connected its own provider key go to its default
 * connection and never enter the platform cache or failover chain. Everything
 * else (no org, or no org key) is served by the platform client outside
 * production, and refused in production.
 */
export class OrganizationAIClient implements AIClient {
    constructor(private readonly developmentClient: () => AIClient) {}

    private async resolve(config: AIApiCallConfig) {
        const organizationId = await resolveAiOrganization(config.organizationId);
        // No org, or an org without its own key: the platform client handles it,
        // with its failover chain and cloud-recovery probe intact.
        if (organizationId === null) {
            if (process.env.NODE_ENV === "production") throw new Error("Organization context is required for AI execution");
            return null;
        }
        const connection = await orgModelService.resolve(organizationId);
        if (!connection) {
            if (process.env.NODE_ENV === "production") throw new Error(ORG_AI_KEY_MISSING);
            return null;
        }
        const { systemConfigService } = await import("@domain/system/system-config.service.js");
        const budget = await systemConfigService.trackSpend(0, organizationId, config.missionId ?? null);
        if (!budget.allowed) throw new Error(`AI budget restriction: ${budget.reason}`);
        return { connection, organizationId, systemConfigService };
    }

    async execute(config: AIApiCallConfig, input: string | undefined, apiKey: string,
        attachments?: GeminiFileAttachment[], traceContext?: TraceContext,
        onHeartbeat?: (metrics: any) => void): Promise<AIResponse> {
        const resolved = await this.resolve(config);
        if (!resolved) return this.developmentClient().execute(config, input, apiKey, attachments, traceContext, onHeartbeat);
        const response = await executeOnConnection(resolved.connection, resolved.organizationId,
            config, input, attachments, traceContext);
        if (response.metadata) {
            const { calculateAiCost } = await import("./cost-registry.js");
            const tokensPrompt = response.metadata.promptTokens ?? 0;
            const tokensCompletion = response.metadata.completionTokens ?? 0;
            const cost = calculateAiCost(resolved.connection.model, tokensPrompt, tokensCompletion);
            await resolved.systemConfigService.trackSpend(cost, resolved.organizationId, config.missionId ?? null, {
                provider: resolved.connection.provider, model: resolved.connection.model, tokensPrompt, tokensCompletion,
            });
        }
        return response;
    }

    async *executeStream(config: AIApiCallConfig, input: string | undefined, apiKey: string,
        attachments?: GeminiFileAttachment[], traceContext?: TraceContext): AsyncIterable<string> {
        // Use the same metered execution path until streaming exposes final usage.
        // Never serve cached output after an organization disconnects its key.
        const response = await this.execute(config, input, apiKey, attachments, traceContext);
        if (!response.success) throw new Error(response.error || "AI request failed");
        if (response.output) yield response.output;
    }
}
