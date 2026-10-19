/**
 * Crew Generation Service
 *
 * The single place where an agent card is turned into actual generated text.
 *
 * This closes requirement 9.3 — "pass the resolved model provider and model
 * identifier to the existing LLM router infrastructure for request execution".
 * Until now the intent router resolved a model binding and then returned only
 * routing metadata; nothing ever called an LLM, so every reply in the Agent Chat
 * panel was a hardcoded placeholder.
 *
 * The chain is: agent card -> ModelResolverService (binding + circuit-breaker
 * health, falling back to the org default) -> llmRouterService.complete() with
 * preferredProvider/preferredModel, which routes to the registered provider
 * adapter.
 */

import {
    modelResolverService,
    type ModelResolutionResult,
} from "@domain/intent-router/core/model-resolver.service.js";
import { llmRouterService } from "@domain/ai/core/llm-router.service.js";
import { createLogger } from "@server/utils/logger.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

const logger = createLogger("CrewGenerationService");

export interface GenerationMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface GenerationResult {
    content: string;
    providerId: number | null;
    modelId: number | null;
    modelIdentifier: string;
    isFallback: boolean;
    latencyMs: number;
    /** Function calls the model asked for, when tools were offered. */
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
    /**
     * The provider cut the response at the output-token ceiling. When the turn
     * ends in a tool call, its argument object was truncated mid-write — the
     * keys that parsed survive and the rest vanish, so required fields report
     * missing although the model tried to send them.
     */
    truncatedOutput?: boolean;
    actualModel?: string;
    actualProvider?: string;
}

export class CrewGenerationService {
    /**
     * Model resolution performs several database reads (binding, health and
     * provider details). A tool-using CREW turn can generate three or more times
     * with the same card, so resolving on every pass added avoidable latency
     * before each provider request.
     *
     * Keep this deliberately short-lived: it is long enough to cover a round,
     * while provider-health and binding changes still take effect promptly.
     * The binding ids are part of the key so editing a card bypasses an older
     * entry immediately. In-flight promises also collapse concurrent rounds.
     */
    private readonly resolutionTtlMs = 10_000;
    private readonly resolutionCache = new Map<
        string,
        { value: ModelResolutionResult; expiresAt: number }
    >();
    private readonly resolutionInFlight = new Map<string, Promise<ModelResolutionResult>>();

    private resolutionKey(card: AgentCardRecord, orgId: number): string {
        return `${orgId}:${card.id}:${card.modelBindingProviderId ?? "default"}:${card.modelBindingModelId ?? "default"}`;
    }

    private async resolveModel(card: AgentCardRecord, orgId: number): Promise<ModelResolutionResult> {
        const key = this.resolutionKey(card, orgId);
        const cached = this.resolutionCache.get(key);
        if (cached && cached.expiresAt > Date.now()) return cached.value;
        if (cached) this.resolutionCache.delete(key);

        const pending = this.resolutionInFlight.get(key);
        if (pending) return pending;

        const resolution = modelResolverService.resolve(card, orgId)
            .then((value) => {
                this.resolutionCache.set(key, {
                    value,
                    expiresAt: Date.now() + this.resolutionTtlMs,
                });
                return value;
            })
            .finally(() => this.resolutionInFlight.delete(key));
        this.resolutionInFlight.set(key, resolution);
        return resolution;
    }

    /**
     * Generates a reply as the given agent card.
     *
     * @throws Error containing "No available model provider" when neither the
     *         card's binding nor the org default can be resolved — callers map
     *         this to a 503.
     */
    async generate(
        card: AgentCardRecord,
        orgId: number,
        messages: GenerationMessage[],
        options: {
            temperature?: number;
            maxTokens?: number;
            jsonMode?: boolean;
            /** Provider function declarations the model may call this turn. */
            tools?: Array<Record<string, unknown>>;
        } = {},
    ): Promise<GenerationResult> {
        const started = Date.now();
        const resolution = await this.resolveModel(card, orgId);

        if (resolution.isFallback) {
            logger.info(
                `Agent card "${card.name}" fell back to org default (${resolution.modelIdentifier}): ${resolution.fallbackReason}`,
            );
        }

        const response = await llmRouterService.complete(
            {
                messages,
                preferredProvider: resolution.providerTechnicalName,
                preferredModel: resolution.modelIdentifier,
                routingStrategy: "specific",
                temperature: options.temperature ?? 0.7,
                maxTokens: options.maxTokens ?? 700,
                jsonMode: options.jsonMode ?? false,
                ...(options.tools?.length ? { tools: options.tools } : {}),
                // Spend the output budget on what the agent actually says. On a
                // thinking model (gemini-*-latest) an unbounded reasoning trace is
                // charged against maxOutputTokens, which truncated crew turns to
                // ~130 characters mid-sentence and cut the supervisor's JSON off
                // before its closing brace.
                thinkingBudget: 0,
                timeoutMs: 15000,
            },
            orgId,
        );

        // Providers surface function calls on metadata. When the model calls a
        // tool it returns no prose, so content is empty on that pass — the caller
        // executes the calls and asks again.
        const rawCalls = (response.metadata as { toolCalls?: unknown })?.toolCalls;
        let toolCalls = Array.isArray(rawCalls)
            ? rawCalls
                  .map((c) => {
                      const call = c as { name?: unknown; args?: unknown; arguments?: unknown };
                      return typeof call?.name === "string"
                          ? {
                                name: call.name,
                                args: this.callArgsFrom(call as Record<string, unknown>),
                            }
                          : null;
                  })
                  .filter((c): c is { name: string; args: Record<string, unknown> } => c !== null)
            : [];

        // Fallback: some providers/models (e.g. Qwen) embed tool calls in the
        // content body as JSON text rather than the structured metadata channel.
        // Detect and extract them so the orchestrator can execute them normally.
        const content = (response.content ?? "").trim();
        if (toolCalls.length === 0 && options.tools?.length && content) {
            const offered = new Set(
                options.tools
                    .map((t) => (t as { name?: unknown }).name)
                    .filter((n): n is string => typeof n === "string"),
            );
            const extracted = this.extractToolCallsFromContent(content, offered);
            if (extracted.length > 0) {
                toolCalls = extracted;
            }
        }

        let resolvedModelId = resolution.modelId;
        let resolvedProviderId = resolution.providerId;
        let isFallback = resolution.isFallback;

        if (response.model && response.model !== resolution.modelIdentifier) {
            isFallback = true;
            logger.warn(
                `Agent "${card.name}" execution failover: requested model ${resolution.modelIdentifier} ` +
                    `failed over to ${response.model} (provider: ${response.provider})`,
            );
            try {
                const { db } = await import("@server/database_service.js");
                const { llmModels } = await import("@shared/schema/ai/llm-router.js");
                const { eq } = await import("drizzle-orm");
                const [actualModelRow] = await db
                    .select({ id: llmModels.id, providerId: llmModels.providerId })
                    .from(llmModels)
                    .where(eq(llmModels.modelId, response.model))
                    .limit(1);
                if (actualModelRow) {
                    resolvedModelId = actualModelRow.id;
                    resolvedProviderId = actualModelRow.providerId;
                }
            } catch (err) {
                logger.warn(`Failed to resolve DB model record for executed fallback model ${response.model}: ${err}`);
            }
        }

        // Anthropic reports "max_tokens", Gemini "MAX_TOKENS", OpenAI "length".
        const stopReason = String(
            (response.metadata as Record<string, unknown> | undefined)?.stopReason ??
            (response.metadata as Record<string, unknown> | undefined)?.finishReason ?? "",
        ).toLowerCase();
        const truncatedOutput = stopReason === "max_tokens" || stopReason === "length";

        return {
            content: toolCalls.length > 0 ? "" : content,
            providerId: resolvedProviderId,
            modelId: resolvedModelId,
            modelIdentifier: response.model || resolution.modelIdentifier,
            isFallback,
            latencyMs: Date.now() - started,
            toolCalls,
            truncatedOutput,
            actualModel: response.model,
            actualProvider: response.provider,
        };
    }

    /**
     * Extract tool calls that were embedded as JSON text in model content.
     *
     * Handles formats like:
     * - {"toolCalls":[{"functionCall":{"name":"...","args":{...}}}]}
     * - [{"name":"...","args":{...}}]
     * - {"name":"...","arguments":{...}}
     * - tool_name({ key: "value" })   — source-code call syntax, see below
     *
     * @param offered Names of tools actually granted this turn. The call-syntax
     *        form is only honoured for a name in this set, so ordinary prose that
     *        happens to mention a function is never mistaken for a call.
     */
    /**
     * Reads a call's arguments from the envelopes models actually emit. Beyond
     * the nested `args`/`arguments`/`parameters`/`params` keys, some responses
     * put the arguments flat alongside `name` —
     * {"name": "render_intake_form", "title": "...", "fields": [...]}. Reading
     * only the known keys produced `args={}` and the executor reported every
     * required field missing while the model insisted it had sent them.
     */
    private callArgsFrom(envelope: Record<string, unknown>): Record<string, unknown> {
        const nested = envelope.args ?? envelope.arguments ?? envelope.parameters ?? envelope.params ?? envelope.input;
        if (typeof nested === 'string') {
            try {
                const parsed = JSON.parse(nested);
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch { return {}; }
        }
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            return nested as Record<string, unknown>;
        }
        const {
            name: _n, tool: _t, function: _f, action: _a,
            toolCalls: _tc, functionCall: _fc,
            args: _g, arguments: _h, parameters: _p, params: _q, input: _i,
            ...rest
        } = envelope as Record<string, unknown> & { function?: unknown };
        return rest;
    }

    private extractToolCallsFromContent(
        content: string,
        offered?: Set<string>,
    ): Array<{ name: string; args: Record<string, unknown> }> {
        try {
            const trimmed = content.trim();

            // A model that has been handed a validation error sometimes stops
            // emitting a structured call and writes the call it MEANT to make as
            // source code instead. That is not JSON, so this used to bail out and
            // the raw `generate_presentation_deck({ title: ... })` text was stored
            // as the agent's turn and shown to the user verbatim.
            if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
                return this.extractCallSyntax(trimmed, offered);
            }

            const parsed = JSON.parse(trimmed);

            // Format 1: {"toolCalls":[{"functionCall":{"name":"...","args":{...}}}]}
            if (parsed?.toolCalls && Array.isArray(parsed.toolCalls)) {
                return parsed.toolCalls
                    .map((tc: any) => {
                        const call = tc?.functionCall ?? tc;
                        if (typeof call?.name === "string") {
                            return { name: call.name, args: this.callArgsFrom(call) };
                        }
                        return null;
                    })
                    .filter((c: any): c is { name: string; args: Record<string, unknown> } => c !== null);
            }

            // Format 2: [{"name":"...","args":{...}}]
            if (Array.isArray(parsed)) {
                return parsed
                    .map((call: any) => {
                        if (typeof call?.name === "string") {
                            return { name: call.name, args: this.callArgsFrom(call) };
                        }
                        if (call?.functionCall && typeof call.functionCall.name === "string") {
                            return { name: call.functionCall.name, args: this.callArgsFrom(call.functionCall) };
                        }
                        return null;
                    })
                    .filter((c: any): c is { name: string; args: Record<string, unknown> } => c !== null);
            }

            // Format 3: {"name":"...","arguments":{...}} (single tool call)
            if (typeof parsed?.name === "string") {
                return [{ name: parsed.name, args: this.callArgsFrom(parsed) }];
            }

            // Format 4: {"functionCall":{"name":"...","args":{...}}} (single wrapped)
            if (parsed?.functionCall && typeof parsed.functionCall.name === "string") {
                return [{ name: parsed.functionCall.name, args: this.callArgsFrom(parsed.functionCall) }];
            }
        } catch {
            // Not parseable JSON — not a tool call
        }
        return [];
    }

    /**
     * Parse `tool_name({ ... })` written as source code.
     *
     * The argument bag is a JS object literal, not JSON — keys are usually
     * unquoted — so a strict parse is tried first and an unquoted-key repair
     * second. Anything that still will not parse yields [], which leaves the
     * existing behaviour untouched.
     */
    private extractCallSyntax(
        content: string,
        offered?: Set<string>,
    ): Array<{ name: string; args: Record<string, unknown> }> {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([\s\S]*?)\s*\)\s*;?$/.exec(content);
        if (!match) return [];

        const [, name, body] = match;
        // Only a tool the agent actually holds. Without this, a sentence that
        // ends in something call-shaped could be executed as a tool.
        if (offered && !offered.has(name)) return [];
        if (!body.startsWith("{")) return [];

        const parsed = this.parseLooseObject(body);
        if (!parsed) return [];
        return [{ name, args: parsed }];
    }

    /** JSON.parse, falling back to quoting bare object keys. */
    private parseLooseObject(source: string): Record<string, unknown> | null {
        const attempt = (text: string): Record<string, unknown> | null => {
            try {
                const value = JSON.parse(text);
                return value && typeof value === "object" && !Array.isArray(value)
                    ? (value as Record<string, unknown>)
                    : null;
            } catch {
                return null;
            }
        };

        const strict = attempt(source);
        if (strict) return strict;

        // Quote bare keys: `{ title: "x", a: 1 }` -> `{ "title": "x", "a": 1 }`.
        // Anchored on `{` or `,` only — never `[` — so a colon inside a string
        // value such as "[Source: Wikipedia]" is left alone. Trailing commas,
        // which models emit freely, are dropped in the same pass.
        const repaired = source
            .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":')
            .replace(/,(\s*[}\]])/g, "$1");
        return attempt(repaired);
    }
}

export const crewGenerationService = new CrewGenerationService();
