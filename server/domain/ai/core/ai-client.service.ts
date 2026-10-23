import type { AIProviderMetadata, AIApiCallConfig } from "@shared/schema/index.js";
import { OllamaClient } from "./providers/ollama-client.js";
import { nodeRedisClient as redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { integrationTelemetryService } from "@domain/governance/core/integration-telemetry.service.js";
import { systemConfigService } from "@domain/system/system-config.service.js";
import { calculateAiCost, providerForModel } from "./cost-registry.js";
import { createLogger } from "@server/utils/logger.js";
import { withSpan } from "@server/utils/tracing.js";
import { EgressFirewall } from "@server/utils/egress-firewall.js";
import { OrganizationAIClient } from "./organization-ai-client.js";

const logger = createLogger("AIClient");


export interface AIResponse {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: {
    model: string;
    provider: string;
    tokensUsed?: number;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs: number;
    fallbackUsed?: boolean;
    toolCalls?: any[];
    inferenceAcceleration?: {
      multiTokenPrediction?: {
        enabled: boolean;
        backend?: string;
        numSpeculativeTokens?: number;
        requestPassthrough?: boolean;
      };
    };
    [key: string]: any;
  };
}

/** Check if an AI error is retriable (429, 5xx, timeout, network). */
export function isRetriableAIError(response: AIResponse): boolean {
  if (response.success) return false;
  const err = (response.error || "").toLowerCase();
  
  if (
    err.includes("429") || 
    err.includes("too many requests") || 
    err.includes("resource_exhausted") || 
    err.includes("quota exceeded") ||
    err.includes("resource exhausted") ||
    err.includes("spending cap") || 
    err.includes("monthly budget") || 
    err.includes("project spend")
  ) return true; // These are retriable in the sense that we can try a DIFFERENT provider/model
  
  if (/\b5\d{2}\b/.test(err) || err.includes("internal server") || err.includes("bad gateway") || err.includes("service unavailable")) return true;
  if (err.includes("timed out") || err.includes("timeout") || err.includes("econnrefused") || err.includes("econnreset") || err.includes("network")) return true;
  return false;
}

const GLOBAL_AI_QUOTA_KEY = "global:ai:last_call_timestamp";
const GLOBAL_AI_GAP_KEY = "global:ai:current_gap_ms";
const GLOBAL_AI_BLOCK_KEY = "global:ai:block_until";
const BASE_GAP_MS = 1000; // 1s safety floor (60 RPM)
const BACKGROUND_GAP_MS = 5000; // 5s gap for background tasks
const MAX_GAP_MS = 60000; // 60s max penalty gap (was 300s)
const BURST_LIMIT = 5; // Allow 5 requests to burst before enforcing gap
// Per-call ceiling on how long the throttler will make a SINGLE caller wait for
// its reserved slot. The slot-reservation model stacks `last_call + gap` across
// every queued caller, so under a provider outage (gap pinned at MAX_GAP_MS) a
// burst of concurrent callers produces per-call waits of many minutes (observed
// up to ~1000s). That is fatal for an interactive request: the user would rather
// we slightly exceed the provider's rate — or fail over — than block for minutes.
// Background tasks can absorb the full penalty gap; interactive (priority) calls
// are capped tight so the copilot stays responsive even while a provider degrades.
const MAX_PRIORITY_WAIT_MS = 10000; // interactive calls never block > 10s on the throttler
const MAX_BACKGROUND_WAIT_MS = MAX_GAP_MS; // background calls tolerate up to one full penalty gap

/**
 * Manages the platform-wide AI quota using an adaptive safety gap.
 * When 429s are detected, the gap doubles to allow the provider to recover.
 */
export const AiQuotaManager = {
  async reportFailure() {
    try {
      const currentGap = await redis.get(GLOBAL_AI_GAP_KEY);
      const newGap = Math.min(MAX_GAP_MS, (currentGap ? parseInt(currentGap, 10) : BASE_GAP_MS) * 2);
      await redis.set(GLOBAL_AI_GAP_KEY, newGap.toString());
      
      // NEW: Set a 2-minute "Cool-down" block for non-priority (background) calls
      await redis.set(GLOBAL_AI_BLOCK_KEY, (Date.now() + 120000).toString(), 'EX', 300);
      
      logger.warn(`[AiQuotaManager] 429 Detected. Increasing global safety gap to ${Math.round(newGap/1000)}s and blocking background tasks for 2m.`);
    } catch {}
  },

  async reportSuccess() {
    try {
      const currentGapStr = await redis.get(GLOBAL_AI_GAP_KEY);
      if (!currentGapStr) return;
      const currentGap = parseInt(currentGapStr, 10);
      if (currentGap <= BASE_GAP_MS) return;
      
      // Decay the gap by 10% on each success until we hit base
      const newGap = Math.max(BASE_GAP_MS, Math.floor(currentGap * 0.9));
      await redis.set(GLOBAL_AI_GAP_KEY, newGap.toString());
    } catch {}
  },

  /**
   * Clears the AI quota state immediately.
   */
  async forceReset() {
    try {
      await redis.del(GLOBAL_AI_QUOTA_KEY);
      await redis.set(GLOBAL_AI_GAP_KEY, BASE_GAP_MS.toString());
      logger.info("[AiQuotaManager] AI Quota has been manually RESET to baseline.");
    } catch {}
  },

  async throttle(isPriority: boolean = true, provider: string = "global") {
    try {
      const providerGapKey = `quota:gap:${provider}`;
      const providerLastCallKey = `quota:last:${provider}`;
      const burstKey = `quota:burst:${provider}`;

      // 0. Check for global block (for background tasks only)
      if (!isPriority) {
        const blockUntilStr = await redis.get(GLOBAL_AI_BLOCK_KEY);
        if (blockUntilStr) {
          const wait = Math.max(0, parseInt(blockUntilStr, 10) - Date.now());
          if (wait > 0) {
            logger.debug(`[AiQuotaManager] Background task yielding to global block (${Math.round(wait/1000)}s)...`);
            await new Promise(resolve => setTimeout(resolve, wait));
          }
        }
      }

      // 1. Get current gap for this provider
      let gapValue = await redis.get(providerGapKey);
      if (!gapValue) {
        gapValue = (await redis.get(GLOBAL_AI_GAP_KEY)) || BASE_GAP_MS.toString();
      }
      
      let gap = parseInt(gapValue, 10);
      if (!isPriority) gap = Math.max(gap, BACKGROUND_GAP_MS);

      // 2. Lua Script for Burst-aware Token Bucket
      const luaScript = `
        local last_call = tonumber(redis.call("GET", KEYS[1]) or "0")
        local burst_count = tonumber(redis.call("GET", KEYS[2]) or "0")
        local now = tonumber(ARGV[1])
        local gap = tonumber(ARGV[2])
        local burst_limit = tonumber(ARGV[3])
        
        local next_slot = now
        
        -- If we are within the burst limit and the gap hasn't passed, allow it but increment burst
        if now - last_call < gap then
            if burst_count < burst_limit then
                redis.call("INCR", KEYS[2])
                redis.call("EXPIRE", KEYS[2], math.ceil(gap/1000) * 2)
                next_slot = now
            else
                next_slot = last_call + gap
            end
        else
            -- Gap has passed, reset burst
            redis.call("SET", KEYS[2], "1")
            redis.call("EXPIRE", KEYS[2], math.ceil(gap/1000) * 2)
            next_slot = now
        end
        
        redis.call("SET", KEYS[1], tostring(next_slot))
        return tostring(next_slot - now)
      `;

      const result = await (redis as any).eval(
        luaScript, 
        2, 
        providerLastCallKey,
        burstKey,
        Date.now().toString(), 
        gap.toString(),
        BURST_LIMIT.toString()
      );
      
      const waitTime = parseInt(result, 10);
      if (waitTime > 0) {
        // Cap the actual wait per-call so a stacked reservation queue can't block
        // an interactive request for minutes. When the reserved slot is further
        // out than the cap we honour only the cap and proceed — under a genuine
        // budget/quota outage waiting longer wouldn't recover anyway (the failure
        // is not a transient rate limit), and for priority traffic responsiveness
        // beats strict rate adherence.
        const waitCap = isPriority ? MAX_PRIORITY_WAIT_MS : MAX_BACKGROUND_WAIT_MS;
        const effectiveWait = Math.min(waitTime, waitCap);
        if (waitTime > waitCap) {
          logger.debug(`[QuotaThrottler] ${provider.toUpperCase()} slot was ${Math.round(waitTime/1000)}s out; capping ${isPriority ? "priority" : "background"} wait at ${Math.round(effectiveWait/1000)}s.`);
        } else {
          logger.debug(`[QuotaThrottler] ${provider.toUpperCase()} Slot reserved. Waiting ${Math.round(effectiveWait/1000)}s...`);
        }
        await new Promise(resolve => setTimeout(resolve, effectiveWait));
      }
    } catch (err: any) {
      logger.error("[AiQuotaManager] Redis error:", err);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};

export interface GeminiFileAttachment {
  fileUri: string;
  mimeType?: string;
  fileName?: string;
}

export interface AIClient {
  execute(
    config: AIApiCallConfig,
    input: string | undefined,
    apiKey: string,
    fileAttachments?: GeminiFileAttachment[],
    traceContext?: TraceContext,
    onHeartbeat?: (metrics: { elapsedMs: number; status: string }) => void
  ): Promise<AIResponse>;

  /** Stream text chunks. Optional; clients that don't support streaming throw. */
  executeStream?(
    config: AIApiCallConfig,
    input: string | undefined,
    apiKey: string,
    fileAttachments?: GeminiFileAttachment[],
    traceContext?: TraceContext
  ): AsyncIterable<string>;

  /** Optional: Preassemble a context cache for massive prompts (e.g., Gemini Context Caching) */
  createContextCache?(
    config: AIApiCallConfig,
    input: string,
    apiKey: string,
    ttlSeconds?: number
  ): Promise<{ cacheName: string }>;
}

/** Larger than any provider accepts inline (Bedrock: 3.75 MB, Anthropic: 5 MB, Gemini: 20 MB request). */
export const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * An image attachment as base64. A URL is fetched through EgressFirewall:
 * attachment URLs come from documents and messages, so a plain fetch would let
 * one point the server at an internal address.
 */
export async function fetchImageAsBase64(url: string): Promise<{ data: string, mimeType: string }> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return { data: match[2], mimeType: match[1].toLowerCase() };
  }
  const guarded = await EgressFirewall.fetch(url);
  if (!guarded.allowed || !guarded.response) throw new Error(`Image URL refused: ${guarded.reason}`);
  const response = guarded.response;
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error('Image attachment is too large');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_ATTACHMENT_BYTES) throw new Error('Image attachment is too large');
  // "image/png; charset=binary" -> "image/png": providers match the bare type.
  const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
  return { data: buffer.toString('base64'), mimeType };
}

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
};

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config = DEFAULT_RETRY_CONFIG
): Promise<Response> {
  let attempt = 0;

  while (true) {
    let response: Response | undefined;

    try {
      const controller = new AbortController();
      // Use config.timeoutMs if provided, else default 30s (prevents 20-min stalls on network timeouts)
      const FETCH_TIMEOUT_MS = (config as any)?.timeoutMs || parseInt(process.env.AI_FETCH_TIMEOUT_MS || "30000", 10);
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (innerErr: any) {
        clearTimeout(timeoutId);
        if (innerErr.name === 'AbortError') {
          throw new Error(`Request timed out after ${Math.round(FETCH_TIMEOUT_MS / 60000)} minutes`);
        }
        // Network errors are retriable
        if (attempt >= config.maxRetries) throw innerErr;
      }
    } catch (error) {
      if (attempt >= config.maxRetries) throw error;
    }

    if (response) {
      // Success or client error (except 429 rate limit) - return immediately
      if (response.status < 500 && response.status !== 429) {
        return response;
      }
      
      // OPTIMIZATION: If we hit a 429, check if it's a permanent budget/spending cap error
      // If it is, don't wait for retries
      const errorText = await response.clone().text();
      if (errorText.toLowerCase().includes("spending cap") || errorText.toLowerCase().includes("monthly budget")) {
          logger.warn(`[AI Client] Detected permanent Budget/Spending Cap error (429). Terminating retries.`);
          return response;
      }

      // 429 rate limit errors should retry with backoff
    }

    if (attempt >= config.maxRetries) {
      if (response) {
        logger.warn(`[AI Client] Max retries reached for ${url}. Status: ${response.status}`);
        return response;
      }
    }

    attempt++;
    const delay = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
    const jitter = Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, delay + jitter));
  }
}

/** Normalize deprecated Gemini model aliases to a known-good model. */
export function normalizeGeminiModel(model: string): string {
  if (!model || typeof model !== "string") return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  // Strip "models/" prefix if present (e.g. "models/gemini-2.0-flash" → "gemini-2.0-flash")
  const cleaned = model.trim().replace(/^models\//, "");
  const aliases: Record<string, string> = {
    "gemini-pro": "gemini-2.5-flash",
    "gemini-pro-latest": "gemini-2.5-flash",
    "gemini-1.5-pro": "gemini-2.5-flash",
    "gemini-1.5-pro-latest": "gemini-2.5-flash",
    "gemini-1.5-flash-latest": "gemini-2.5-flash",
    "gemini-1.5-flash": "gemini-2.5-flash",
    "gemini-flash-latest": "gemini-2.5-flash",
    "gemini-2.0-flash-exp": "gemini-2.5-flash",
    "gemini-2.0-flash": "gemini-2.5-flash",
    "gemini-2.0-flash-lite": "gemini-2.5-flash-lite",
  };
  if (aliases[cleaned]) return aliases[cleaned];
  // Gemini-first: this normalizer only ever feeds the Google/Gemini path, so a
  // non-Gemini model name (e.g. "claude-3.5-sonnet" or "gpt-4o" — the default in
  // many agent/cycle configs) would be sent to Google's v1beta API and 404,
  // crashing the agent loop. Map anything that isn't a Gemini model to the
  // Gemini default so those agents run instead of failing every LLM call.
  if (!/^gemini[-.]/i.test(cleaned)) {
    return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }
  return cleaned;
}


import { OpenAIClient } from "@domain/ai/core/providers/openai-client.js";
import { AnthropicClient } from "@domain/ai/core/providers/anthropic-client.js";
import { GoogleClient } from "@domain/ai/core/providers/google-client.js";
import { MidjourneyClient } from "@domain/ai/core/providers/midjourney-client.js";
import { DalleClient } from "@domain/ai/core/providers/dalle-client.js";
import { MockAIClient } from "@domain/ai/core/providers/mock-client.js";
import { AzureClient } from "@domain/ai/core/providers/azure-client.js";
import { BedrockClient } from "@domain/ai/core/providers/bedrock-client.js";
function shouldAllowMockFallback(): boolean {
  if (process.env.ALLOW_AI_MOCK_FALLBACK === "true") return true;
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * How often one call is let through to the cloud while an org is failed over.
 *
 * Long enough that a genuinely exhausted quota is not hammered, short enough
 * that a restored one is picked up in minutes rather than at the hour-long TTL.
 */
const FAILOVER_PROBE_INTERVAL_SEC = 120;

class CachedAIClient implements AIClient {
  constructor(private internalClient: AIClient) { }

  async *executeStream(
    config: AIApiCallConfig,
    input: string | undefined,
    apiKey: string,
    fileAttachments?: GeminiFileAttachment[],
    traceContext?: TraceContext
  ): AsyncIterable<string> {
    if (this.internalClient.executeStream) {
      if (config.useCache) {
        // TIER 1: Exact Hash Cache (Redis)
        const payload = JSON.stringify({
          config: { ...config, useCache: undefined },
          input,
          attachments: fileAttachments?.map(a => a.fileUri).join(",")
        });
        const { createHash } = await import("crypto");
        const hash = createHash("sha256").update(payload).digest("hex");
        const cacheKey = `ai_cache:${hash}`;

        try {
          const cached = await redis.get(cacheKey);
          if (cached) {
            logger.debug(`[AI Cache] Exact stream hit for ${cacheKey}`);
            const result = JSON.parse(cached) as AIResponse;
            if (result.success && result.output) {
              yield result.output;
              return;
            }
          }
        } catch (err: any) {
          logger.debug(`[AI Cache] Exact stream hit lookup failed: ${err?.message || err}`);
        }
      }

      await AiQuotaManager.throttle(config.isPriority ?? true, (config as any).provider || "global");
      
      let acc = "";
      try {
        for await (const chunk of this.internalClient.executeStream(config, input, apiKey, fileAttachments, traceContext)) {
          if (chunk) {
            acc += chunk;
            yield chunk;
          }
        }

        if (config.useCache && acc) {
          const payload = JSON.stringify({
            config: { ...config, useCache: undefined },
            input,
            attachments: fileAttachments?.map(a => a.fileUri).join(",")
          });
          const { createHash } = await import("crypto");
          const hash = createHash("sha256").update(payload).digest("hex");
          const cacheKey = `ai_cache:${hash}`;
          await redis.setex(cacheKey, 3600, JSON.stringify({
            success: true,
            output: acc,
            metadata: { model: config.model, provider: (config as any).provider || "unknown", latencyMs: 0 }
          }));
        }
      } catch (err: any) {
        const errorText = (err?.message || String(err)).toLowerCase();
        const isLocal = (config as any).provider === "ollama" || (config as any).provider === "local_openai" || (config as any).provider === "local" ||
          ((config as any).baseUrl && ((config as any).baseUrl.includes("11434") || (config as any).baseUrl.includes("localhost") || (config as any).baseUrl.includes("127.0.0.1")));

        // Check if we should failover this stream. Capacity/quota errors from ANY
        // cloud provider trigger the fallback to local Ollama — covering Google
        // ("spending cap", "resource exhausted", 429), DashScope/Qwen ("free quota
        // has been exhausted", "AllocationQuota.FreeTierOnly"), and OpenAI-compatible
        // ("insufficient_quota", "rate limit"). Previously only the Google wording
        // matched, so a Qwen 403 free-tier error errored out instead of falling back.
        const isCapacityError =
          errorText.includes("spending cap") || errorText.includes("monthly budget") ||
          errorText.includes("resource exhausted") || errorText.includes("429") ||
          errorText.includes("quota") || errorText.includes("exhausted") ||
          errorText.includes("freetieronly") || errorText.includes("allocationquota") ||
          errorText.includes("rate limit") || errorText.includes("insufficient_quota");
        if (!isLocal && !(config as any).disableGlobalFailover && isCapacityError) {
          // On a budget/quota error drop to the local Ollama model and finally
          // the mock stub, so copilot does not silently degrade to canned mock
          // answers under a Gemini 429.
          logger.warn(`[CachedAIClient] Stream failed with budget/quota error. Attempting failover to Ollama...`);
          
          try {
            // Fetch local failover config from system settings
            const settings = await systemConfigService.getGlobalConfig();
            const ollamaConfig = (settings as any).systemAiDefaults?.ollama || { model: "qwen2.5:7b", baseUrl: "http://localhost:11434" };  /* fast on large prompts (~11s/call) + tool-capable local fallback; qwen3.6 24GB is ~57s/call on real prompts */
            
            const ollama = new OllamaClient({ baseUrl: ollamaConfig.baseUrl });
            let failoverAcc = "";
            for await (const chunk of ollama.executeStream({
              ...config,
              model: ollamaConfig.model,
              temperature: config.temperature ?? 0.7,
            }, input, "")) {
              if (chunk) {
                failoverAcc += chunk;
                yield chunk;
              }
            }

            if (config.useCache && failoverAcc) {
              const payload = JSON.stringify({
                config: { ...config, useCache: undefined },
                input,
                attachments: fileAttachments?.map(a => a.fileUri).join(",")
              });
              const { createHash } = await import("crypto");
              const hash = createHash("sha256").update(payload).digest("hex");
              const cacheKey = `ai_cache:${hash}`;
              await redis.setex(cacheKey, 3600, JSON.stringify({
                success: true,
                output: failoverAcc,
                metadata: { model: ollamaConfig.model, provider: "ollama", latencyMs: 0 }
              }));
            }
            return;
          } catch (ollamaErr) {
            logger.error(`[CachedAIClient] Global stream failover failed:`, ollamaErr);
            if (!shouldAllowMockFallback()) {
              logger.error(`[CachedAIClient] MockAIClient fallback disabled in production. Throwing upstream quota error.`);
              throw new Error("AI provider capacity exhausted and mock fallback is disabled in production (HTTP 503).");
            }
            logger.warn(`[CachedAIClient] Falling back to MockAIClient for stream failover.`);
            const mock = new MockAIClient();
            const mockResp = await mock.execute(config, input, "", fileAttachments, traceContext);
            if (mockResp.success && mockResp.output) {
              yield mockResp.output;
              return;
            }
          }
        }
        throw err;
      }
    } else {
      const resp = await this.internalClient.execute(config, input, apiKey, fileAttachments, traceContext);
      if (resp.success && resp.output) yield resp.output;
      else throw new Error(resp.error || "AI execution failed");
    }
  }

  async createContextCache(
    config: AIApiCallConfig,
    input: string,
    apiKey: string,
    ttlSeconds?: number
  ): Promise<{ cacheName: string }> {
    if (this.internalClient.createContextCache) {
      return this.internalClient.createContextCache(config, input, apiKey, ttlSeconds);
    }
    throw new Error(`Context Caching is not supported by the underlying provider.`);
  }

  async execute(
    config: AIApiCallConfig,
    input: string | undefined,
    apiKey: string,
    fileAttachments?: GeminiFileAttachment[],
    traceContext?: TraceContext,
    onHeartbeat?: (metrics: { elapsedMs: number; status: string }) => void
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const systemPrompt = input || "";
    const userPrompt = config.userPrompt || "";
    const combinedPrompt = systemPrompt + "\n" + userPrompt;

    let promptHash = "";
    try {
      const { createHash } = await import("crypto");
      promptHash = createHash("md5").update(combinedPrompt).digest("hex");
    } catch (err: any) {
      logger.debug(`[CachedAIClient] Prompt hash generation failed: ${err?.message || err}`);
    }

    // Local providers bypass cloud overhead: budget checks, quota throttling, and caching
    const isLocal = (config as any).provider === "ollama" || (config as any).provider === "local_openai" || (config as any).provider === "local" ||
      ((config as any).baseUrl && ((config as any).baseUrl.includes("11434") || (config as any).baseUrl.includes("localhost") || (config as any).baseUrl.includes("127.0.0.1")));

    if (promptHash && !isLocal) {
      try {
        const { TransferenceRouter } = await import("../../agents/core/transference-router.js");
        const localResult = await TransferenceRouter.routeCall(promptHash, { text: userPrompt, combinedPrompt });
        if (localResult) {
          logger.info(`[Transference Engine] Intercepted and routed ${promptHash} to local model`);
          return {
            success: true,
            output: localResult.output,
            metadata: {
              model: "local-transferred",
              provider: "transference-engine",
              latencyMs: Date.now() - startTime
            }
          };
        }
      } catch (e: any) {
        logger.warn(`[Transference Router Error] ${e.message}`);
      }
    }

    // Circuit Breaker: Check if we are forced to use local failover for this org.
    //
    // The flag is cleared when a cloud call succeeds, and this branch never makes
    // one -- so on its own the org stays local until the key expires an hour
    // later, even once the quota is restored. A lifted spending cap did nothing
    // for 53 minutes because of this. So every FAILOVER_PROBE_INTERVAL_SEC one
    // call is allowed through to the cloud: it either succeeds and clears the
    // flag, or fails and re-arms the failover a moment later.
    let forceLocal = false;
    if (config.organizationId && !isLocal) {
      try {
        const flag = await redis.get(`failover:org:${config.organizationId}`);
        forceLocal = flag === "true";

        if (forceLocal) {
          const probeKey = `failover:probe:org:${config.organizationId}`;
          const probedRecently = await redis.get(probeKey);
          if (!probedRecently) {
            await redis.setex(probeKey, FAILOVER_PROBE_INTERVAL_SEC, "1");
            logger.info(
              `[CachedAIClient] Probing cloud for Org ${config.organizationId}: the failover flag is set, ` +
                `but the quota may have been restored.`,
            );
            forceLocal = false;
          }
        }
      } catch (err: any) {
        logger.debug(`[CachedAIClient] Org failover flag lookup failed: ${err?.message || err}`);
      }
    }

    if (forceLocal) {
      logger.info(`[CachedAIClient] Forcing local failover for Org ${config.organizationId} due to active flag.`);
      const settings = await systemConfigService.getGlobalConfig();
      const ollamaConfig = (settings as any).systemAiDefaults?.ollama || { model: "qwen2.5:7b", baseUrl: "http://localhost:11434" };  /* fast on large prompts (~11s/call) + tool-capable local fallback; qwen3.6 24GB is ~57s/call on real prompts */
      const ollama = new OllamaClient({ baseUrl: ollamaConfig.baseUrl });
      return ollama.execute({
        ...config,
        model: ollamaConfig.model,
        temperature: config.temperature ?? 0.7,
      }, input, "");
    }

    if (!config.useCache || isLocal) {
      if (!isLocal) {
        // 1. Pre-call Budget Check (cloud only)
        const budgetCheck = await systemConfigService.trackSpend(0, config.organizationId ?? null, config.missionId ?? null);
        if (!budgetCheck.allowed) {
          return { success: false, error: `Budget Restriction: ${budgetCheck.reason}`, metadata: { latencyMs: 0, model: config.model, provider: (config as any).provider || "unknown" } };
        }
        await AiQuotaManager.throttle(config.isPriority ?? true, (config as any).provider || "global");
      }

      const res = await this.internalClient.execute(config, input, apiKey, fileAttachments, traceContext, onHeartbeat);

      if (res.success && res.output) {
        const elapsedMs = Date.now() - startTime;
        this.logTelemetry(config, input, res.output, elapsedMs, res.metadata?.tokens || null).catch((err: any) => {
          logger.debug(`[CachedAIClient] Telemetry logging failed: ${err?.message || err}`);
        });
        
        if (promptHash && !isLocal) {
          import("../../agents/core/transference-router.js")
            .then(m => m.TransferenceRouter.trackShadowAccuracyForHash(promptHash, res.output!, { text: userPrompt, combinedPrompt }))
            .catch((err: any) => {
              logger.debug(`[CachedAIClient] Transference tracking failed: ${err?.message || err}`);
            });
        }
      }

      // Clear per-org failover flag when cloud succeeds — allows recovery after quota resets
      if (res.success && !isLocal && config.organizationId) {
        redis.del(`failover:org:${config.organizationId}`).catch((err: any) => {
          logger.debug(`[CachedAIClient] Redis failover key deletion failed: ${err?.message || err}`);
        });
      }

      // --- FAILOVER TO OLLAMA (Global Counter-measure for all Cloud Providers) ---
      if (!res.success && !isLocal && !(config as any).disableGlobalFailover) {
        const err = (res.error || "").toLowerCase();
        if (err.includes("spending cap") || err.includes("monthly budget") || err.includes("resource exhausted") || err.includes("429")) {
          logger.warn(`[CachedAIClient] Detected Budget/Quota failure. Attempting global failover to Local Ollama (DeepSeek)...`);
          let ollamaRes: any;
          // Hoisted: the success log below has to name the model that actually
          // answered, and ollamaConfig is scoped to the try.
          let failoverModel = "unknown-local-model";
          if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
            logger.warn(`[CachedAIClient] Testing environment detected. Skipping Ollama failover and falling back directly to MockAIClient.`);
          } else {
            try {
              const settings = await systemConfigService.getGlobalConfig();
              const ollamaConfig = (settings as any).systemAiDefaults?.ollama || { model: "qwen2.5:7b", baseUrl: "http://localhost:11434" };  /* fast on large prompts (~11s/call) + tool-capable local fallback; qwen3.6 24GB is ~57s/call on real prompts */

              failoverModel = ollamaConfig.model;

              const ollama = new OllamaClient({ baseUrl: ollamaConfig.baseUrl });
              ollamaRes = await ollama.execute({
                ...config,
                model: ollamaConfig.model,
                temperature: config.temperature ?? 0.7,
                timeoutMs: (config as any)?.timeoutMs ?? 1500,
              }, input, "");
            } catch (ollamaErr) {
              logger.error(`[CachedAIClient] Global failover also failed:`, ollamaErr);
            }
          }

          if (ollamaRes && ollamaRes.success) {
            logger.info(
              `[CachedAIClient] Global Ollama failover answered with ${failoverModel} ` +
                `(requested ${config.model}). The reply is from the local model, not the cloud one.`,
            );
            
            // Set failover flag for the org
            if (config.organizationId) {
              try {
                await redis.setex(`failover:org:${config.organizationId}`, 3600, "true");
                logger.info(`[CachedAIClient] Set session-wide failover flag for Org ${config.organizationId}`);
              } catch (e: any) {
                logger.warn("[CachedAIClient] Failed to set failover flag (non-fatal):", e);
              }
            }
            
            // Smart Thought Stripping: Only strip if we are expecting JSON or it's a non-priority task
            const isJsonMode = (config as any).response_format?.type === 'json_object' || 
                             (config as any).response_format === 'json' ||
                             config.model.includes('json');

            if (ollamaRes.output && ollamaRes.output.includes("<thought>") && isJsonMode) {
              logger.debug(`[CachedAIClient] Stripping reasoning thoughts from JSON-mode failover response`);
              ollamaRes.output = ollamaRes.output.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
            }
            
            return ollamaRes;
          } else {
            if (!shouldAllowMockFallback()) {
              logger.error(`[CachedAIClient] MockAIClient fallback disabled in production. Returning 503 capacity error.`);
              return {
                success: false,
                error: "AI provider capacity exhausted and mock fallback is disabled in production (HTTP 503).",
                metadata: { latencyMs: 0, model: config.model, provider: "failover-exhausted" }
              };
            }
            logger.warn(`[CachedAIClient] Local Ollama failover failed or not running. Falling back to MockAIClient for local execution.`);
            const mock = new MockAIClient();
            const mockRes = await mock.execute(config, input, "", fileAttachments, traceContext);
            return mockRes;
          }
        }
      }

      // 2. Post-call Cost Tracking (cloud only — local models have zero cost)
      if (!isLocal && res.success && res.metadata) {
        const model = res.metadata.model || config.model;
        const tokensPrompt = res.metadata.promptTokens ?? 0;
        const tokensCompletion = res.metadata.completionTokens ?? 0;
        const cost = calculateAiCost(model, tokensPrompt, tokensCompletion);
        // The ledger gets the same inputs the cost was computed from. Omitting
        // them recorded every call as model "unknown" with zero tokens.
        await systemConfigService.trackSpend(cost, config.organizationId ?? null, config.missionId ?? null, {
          model,
          provider: providerForModel(model),
          tokensPrompt,
          tokensCompletion,
          sessionId: (traceContext as any)?.sessionId,
        });
        (res.metadata as any).costUsd = cost;
      }

      return res;
    }


    const payload = JSON.stringify({
      config,
      input,
      attachments: fileAttachments?.map(a => a.fileUri).join(",")
    });

    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update(payload).digest("hex");
    const cacheKey = `ai_cache:${hash}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug(`[AI Cache] Exact hit for ${cacheKey}`);
        const result = JSON.parse(cached) as AIResponse;
        if (result.metadata) {
          result.metadata.latencyMs = 0;
          (result.metadata as any).cached = true;
        }
        return result;
      }

      // 2. TIER 2: Semantic Cache (Qdrant)
      const { SemanticCacheService } = await import("./semantic-cache.service.js");
      const semanticHit = await SemanticCacheService.get(payload, config.organizationId);
      if (semanticHit) {
        return {
          success: true,
          output: semanticHit,
          metadata: {
            model: config.model,
            provider: (config as any).provider || "unknown",
            latencyMs: 0,
            cached: true,
            semanticHit: true
          } as any
        };
      }
    } catch (e) {
      logger.error("[AI Cache] Cache lookup error:", e);
    }

    await AiQuotaManager.throttle(config.isPriority ?? true, (config as any).provider || "global");
    
    let result: AIResponse = { success: false, error: "Initial attempt failed", metadata: { latencyMs: 0, model: config.model, provider: (config as any).provider || "unknown" } };
    let attempts = 0;
    const maxRetries = 3;

    while (attempts <= maxRetries) {
      if (attempts > 0) {
        const delay = Math.min(2000 * Math.pow(2, attempts) + Math.random() * 1000, 10000);
        logger.warn(`[AI Client] Retriable error detected. Retrying in ${Math.round(delay)}ms... (Attempt ${attempts}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const startTime = Date.now();
      result = await withSpan("ai.model_inference", async () => {
        return await this.internalClient.execute(config, input, apiKey, fileAttachments, traceContext, onHeartbeat);
      }, {
        "ai.model": config.model || "unknown",
        "ai.provider": (config as any).provider || "unknown"
      });
      const durationMs = Date.now() - startTime;

      // Log Telemetry for each attempt
      await integrationTelemetryService.logCall({
          platform: (config as any).provider || result.metadata?.provider || "ai-provider",
          method: "POST",
          url: "execute",
          action: config.useCache ? "execute_cache_miss" : "execute",
          responseStatus: result.success ? 200 : (isRetriableAIError(result) ? 429 : 500),
          durationMs,
          model: result.metadata?.model || config.model,
          promptTokens: result.metadata?.promptTokens,
          completionTokens: result.metadata?.completionTokens,
          totalTokens: result.metadata?.tokensUsed,
          costUsd: (result.metadata as any)?.costUsd?.toString(),
          isPriority: config.isPriority,
          traceId: traceContext?.traceId,
          missionId: (traceContext as any)?.missionId,
          error: result.error,
          metadata: {
              attempt: attempts,
              cached: false
          }
      } as any);
      
      if (result.success) {
        await AiQuotaManager.reportSuccess();
        
        // Post-call Cost Tracking (Cache Miss)
        if (result.metadata) {
          const model = result.metadata.model || config.model;
          const tokensPrompt = result.metadata.promptTokens ?? 0;
          const tokensCompletion = result.metadata.completionTokens ?? 0;
          const cost = calculateAiCost(model, tokensPrompt, tokensCompletion);
          await systemConfigService.trackSpend(cost, config.organizationId ?? null, config.missionId ?? null, {
            model,
            provider: providerForModel(model),
            tokensPrompt,
            tokensCompletion,
            sessionId: (traceContext as any)?.sessionId,
          });
          (result.metadata as any).costUsd = cost;
        }

        if (result.output) {
          const elapsedMs = Date.now() - startTime;
          this.logTelemetry(config, input, result.output, elapsedMs, result.metadata?.tokens || null).catch((err: any) => {
            logger.debug(`[CachedAIClient] Telemetry logging failed: ${err?.message || err}`);
          });
          
          if (promptHash && !isLocal) {
            import("../../agents/core/transference-router.js")
              .then(m => m.TransferenceRouter.trackShadowAccuracyForHash(promptHash, result.output!, { text: userPrompt, combinedPrompt }))
              .catch((err: any) => {
                logger.debug(`[CachedAIClient] Transference tracking failed: ${err?.message || err}`);
              });
          }
        }

        try {
          await redis.setex(cacheKey, 24 * 60 * 60, JSON.stringify(result)); // 24h
          
          // Also save to Semantic Cache
          const { SemanticCacheService } = await import("./semantic-cache.service.js");
          await SemanticCacheService.set(payload, result.output!, config.organizationId, {
            model: result.metadata?.model || config.model,
            tokens: result.metadata?.tokensUsed
          });
        } catch (e) {
          logger.error("[AI Cache] Persistence error:", e);
        }
        return result;
      }

      const errorText = (result.error || "").toLowerCase();
      if (
        errorText.includes("spending cap")
        || errorText.includes("monthly budget")
        || errorText.includes("project spend")
      ) {
        logger.warn("[AI Client] Permanent budget/spending cap error detected. Skipping same-provider retries so configured fallbacks can run.");
        break;
      }

      if (!isRetriableAIError(result)) {
        break; // Fail immediately for non-retriable errors
      }

      attempts++;
    }

    // If we're here, all retries failed
    if (isRetriableAIError(result) && (
      result.error?.includes("429")
      || result.error?.toLowerCase().includes("resource_exhausted")
      || result.error?.toLowerCase().includes("spending cap")
    )) {
      await AiQuotaManager.reportFailure();
    }

    return result;
  }

  private async logTelemetry(
    config: AIApiCallConfig,
    input: string | undefined,
    output: string,
    latencyMs: number,
    tokens: number | null
  ) {
    try {
      const systemPrompt = input || "";
      const userPrompt = config.userPrompt || "";
      const combinedPrompt = systemPrompt + "\n" + userPrompt;

      const { createHash } = await import("crypto");
      const promptHash = createHash("md5").update(combinedPrompt).digest("hex");

      const inputVariables = {
        userPrompt,
        model: config.model,
        temperature: config.temperature,
        ...((config as any).metadata || {})
      };

      const { db } = await import("../../../database_service.js");
      const { aiExecutionLogs } = await import("@shared/schema/index.js");

      await db.insert(aiExecutionLogs).values({
        promptHash,
        systemPrompt: combinedPrompt,
        inputVariables,
        rawOutput: output,
        latencyMs,
        totalTokens: tokens,
        organizationId: config.organizationId || null
      });
    } catch (e: any) {
      logger.warn(`[Telemetry Log Error] Failed to log execution: ${e.message}`);
    }
  }
}

export interface FallbackConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export class FallbackAIClient implements AIClient {
  constructor(
    private primaryClient: AIClient,
    private fallbackConfigs: FallbackConfig[],
  ) { }

  async execute(
    config: AIApiCallConfig,
    input: string | undefined,
    apiKey: string,
    fileAttachments?: GeminiFileAttachment[],
    traceContext?: TraceContext,
    onHeartbeat?: (metrics: { elapsedMs: number; status: string }) => void
  ): Promise<AIResponse> {
    const primaryConfig = { ...config, disableGlobalFailover: true } as any;
    let result = await this.primaryClient.execute(primaryConfig, input, apiKey, fileAttachments, traceContext, onHeartbeat);
    if (result.success) return result;
    if (!isRetriableAIError(result)) return result;

    for (const fb of this.fallbackConfigs) {
      const fbClient = AIClientFactory.getClient({ provider: fb.provider, baseUrl: fb.baseUrl } as any);
      const fbConfig = { ...config, provider: fb.provider, model: fb.model, baseUrl: fb.baseUrl, disableGlobalFailover: true } as AIApiCallConfig;
      result = await fbClient.execute(fbConfig, input, fb.apiKey, fileAttachments, traceContext, onHeartbeat);
      if (result.success) {
        return {
          ...result,
          metadata: result.metadata ? { ...result.metadata, fallbackUsed: true } as any : undefined,
        };
      }
      if (!isRetriableAIError(result)) return result;
    }

    // Last resort fallback to local Ollama if all configured cloud options failed
    try {
      logger.warn(`[FallbackAIClient] All cloud models in fallback chain failed. Attempting last-resort local Ollama...`);
      const { systemConfigService } = await import("@domain/system/system-config.service.js");
      const settings = await systemConfigService.getGlobalConfig();
      const ollamaConfig = (settings as any).systemAiDefaults?.ollama || { model: "qwen2.5:7b", baseUrl: "http://localhost:11434" };  /* fast on large prompts (~11s/call) + tool-capable local fallback; qwen3.6 24GB is ~57s/call on real prompts */
      const { OllamaClient } = await import("./providers/ollama-client.js");
      const ollamaClient = new OllamaClient({ baseUrl: ollamaConfig.baseUrl });
      const ollamaRes = await ollamaClient.execute({
        ...config,
        model: ollamaConfig.model,
        temperature: config.temperature ?? 0.7,
      }, input, "");
      if (ollamaRes.success) {
        return ollamaRes;
      }
    } catch (ollamaErr) {
      logger.error(`[FallbackAIClient] Last-resort local Ollama failover failed:`, ollamaErr);
    }

    return result;
  }

  async *executeStream(
    config: AIApiCallConfig,
    input: string | undefined,
    apiKey: string,
    fileAttachments?: GeminiFileAttachment[],
    traceContext?: TraceContext
  ): AsyncIterable<string> {
    if (this.primaryClient.executeStream) {
      try {
        const primaryConfig = { ...config, disableGlobalFailover: true } as any;
        yield* this.primaryClient.executeStream(primaryConfig, input, apiKey, fileAttachments, traceContext);
        return;
      } catch (err: any) {
        if (!isRetriableAIError({ success: false, error: err?.message || String(err) })) {
          throw err;
        }
      }
    }

    for (const fb of this.fallbackConfigs) {
      const fbClient = AIClientFactory.getClient({ provider: fb.provider, baseUrl: fb.baseUrl } as any);
      if (fbClient.executeStream) {
        try {
          const fbConfig = { ...config, provider: fb.provider, model: fb.model, baseUrl: fb.baseUrl, disableGlobalFailover: true } as any;
          yield* fbClient.executeStream(fbConfig, input, fb.apiKey, fileAttachments, traceContext);
          return;
        } catch (err: any) {
          if (!isRetriableAIError({ success: false, error: err?.message || String(err) })) {
            throw err;
          }
        }
      }
    }

    // Last resort local Ollama stream fallback
    try {
      logger.warn(`[FallbackAIClient] All cloud streams failed. Attempting last-resort local Ollama stream...`);
      const { systemConfigService } = await import("@domain/system/system-config.service.js");
      const settings = await systemConfigService.getGlobalConfig();
      const ollamaConfig = (settings as any).systemAiDefaults?.ollama || { model: "qwen2.5:7b", baseUrl: "http://localhost:11434" };  /* fast on large prompts (~11s/call) + tool-capable local fallback; qwen3.6 24GB is ~57s/call on real prompts */
      const { OllamaClient } = await import("./providers/ollama-client.js");
      const ollamaClient = new OllamaClient({ baseUrl: ollamaConfig.baseUrl });
      if (ollamaClient.executeStream) {
        yield* ollamaClient.executeStream({
          ...config,
          model: ollamaConfig.model,
          temperature: config.temperature ?? 0.7,
        }, input, "");
        return;
      }
    } catch (ollamaErr) {
      logger.error(`[FallbackAIClient] Last-resort local Ollama stream failed:`, ollamaErr);
    }

    throw new Error("All cloud and local stream fallbacks failed.");
  }
}

export class AIClientFactory {
  static getClient(providerMetadata: AIProviderMetadata): AIClient {
    return new OrganizationAIClient(() => this.getDevelopmentClient(providerMetadata));
  }

  private static getDevelopmentClient(providerMetadata: AIProviderMetadata): AIClient {
    let client: AIClient;
    if (!providerMetadata) {
      throw new Error('AI Provider metadata is missing');
    }
    const provider = (providerMetadata as any).provider;

    // OpenAI-compatible endpoints carry their URL on different fields depending
    // on the registration path: credentials metadata uses `baseUrl`, while an
    // llm_providers row uses `apiEndpoint` (or nests baseUrl inside its jsonb
    // `metadata`). Normalize once here or every compat provider silently posts
    // to api.openai.com.
    const compatBaseUrl = (providerMetadata as any).baseUrl
        ?? (providerMetadata as any).apiEndpoint
        ?? (providerMetadata as any).metadata?.baseUrl;

    switch (provider) {
      case "openai":
        client = new OpenAIClient({ ...(providerMetadata as any), baseUrl: compatBaseUrl });
        break;
      case "local_openai":
        client = new OpenAIClient({ ...(providerMetadata as any), baseUrl: compatBaseUrl });
        break;
      case "muse":
      case "meta":
        client = new OpenAIClient({ ...(providerMetadata as any), baseUrl: compatBaseUrl || "https://api.meta.ai/v1" });
        break;
      case "openai_dalle":
      case "dalle":
        client = new DalleClient();
        break;
      case "anthropic":
        client = new AnthropicClient();
        break;
      case "google":
        client = new GoogleClient();
        break;
      case "azure":
        client = new AzureClient(providerMetadata as any);
        break;
      case "bedrock":
        client = new BedrockClient(compatBaseUrl);
        break;
      case "midjourney":
        client = new MidjourneyClient(providerMetadata as any);
        break;
      case "mock":
        client = new MockAIClient();
        break;
      case "ollama":
        client = new OllamaClient(providerMetadata as any);
        break;
      default:
        // Default to Google/Gemini if provider is unknown or missing, as requested by user
        logger.warn(`[AIClientFactory] Unsupported AI provider "${provider}" - falling back to Google/Gemini`);
        client = new GoogleClient();
        break;
    }
    return new CachedAIClient(client);
  }
}

