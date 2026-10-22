import { hasAiOrganizationContext } from "@domain/ai/core/ai-org-context.js";
import { organizationEmbeddings } from "@domain/ai/core/org-embeddings.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
import { db } from "../../../../database_service.js";
import { eq } from "drizzle-orm";
import { agentChatMessages } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import type { VersionedEmbedding } from "@shared/product/embedding-contract.js";

const logger = createLogger("EmbeddingService");

interface RateLimitState {
    calls: number;
    resetTime: number;
    queue: Array<{ resolve: (value: number[] | null) => void; reject: (reason?: Error) => void; text: string }>;
}

export const embeddingService = {
    // Rate limiting state
    _rateLimit: { calls: 0, resetTime: 0, queue: [] } as RateLimitState,
    MAX_CALLS_PER_MINUTE: 100, // Increased for local/robust usage

    /**
     * Generate embedding for text using the configured provider
     */
    async generateEmbedding(text: string): Promise<number[] | null> {
        if (hasAiOrganizationContext() || process.env.NODE_ENV === "production") return organizationEmbeddings().embedQuery(text);
        // Rate limiting check with queue
        const now = Date.now();
        if (now > this._rateLimit.resetTime) {
            this._rateLimit = { calls: 0, resetTime: now + 60000, queue: this._rateLimit.queue };
        }

        // If under limit, process immediately
        if (this._rateLimit.calls < this.MAX_CALLS_PER_MINUTE) {
            this._rateLimit.calls++;
            return this._callEmbeddingApi(text);
        }

        // Otherwise, queue the request
        logger.warn("Embedding rate limit reached, queuing request", { queueSize: this._rateLimit.queue.length });
        return new Promise((resolve, reject) => {
            this._rateLimit.queue.push({ resolve, reject, text });
            setTimeout(() => this._processQueue(), 60000);
        });
    },

    async generateVersionedEmbedding(text: string): Promise<VersionedEmbedding | null> {
        const vector = await this.generateEmbedding(text);
        if (!vector) return null;
        const provider = process.env.RAG_EMBEDDING_PROVIDER || process.env.AI_PROVIDER || "google";
        const model = process.env.RAG_EMBEDDING_MODEL || (
            provider === "openai" ? "text-embedding-ada-002"
                : provider === "ollama" ? "nomic-embed-text"
                    : provider === "python" ? "all-MiniLM-L6-v2"
                        : "gemini-embedding-001"
        );
        return {
            provider,
            model,
            dimensions: vector.length,
            version: process.env.RAG_EMBEDDING_VERSION || "1",
            vector,
        };
    },

    /**
     * Generate an embedding with an EXPLICIT provider + model — no env
     * resolution and NO silent failover. Used where deterministic vector
     * dimensions matter (the capability registry versions its Qdrant collection
     * by this pinned contract, so a provider/model change never collides dims).
     */
    async generateEmbeddingWith(text: string, provider: string, model: string): Promise<number[] | null> {
        if (hasAiOrganizationContext() || process.env.NODE_ENV === "production") {
            if (!["google", "gemini"].includes(provider)) throw new Error("Organization embeddings require Gemini");
            return organizationEmbeddings(model).embedQuery(text);
        }
        const p = (provider || "google").toLowerCase();
        try {
            if (p === "ollama") return await this._callOllamaEmbedding(text, model, process.env.OLLAMA_BASE_URL);
            if (p === "google" || p === "gemini") return await this._callGoogleEmbedding(text, model);
            if (p === "python") {
                const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
                return await pythonBridge.generateEmbedding(text, model);
            }
            return await this._callOpenAIEmbedding(text, model);
        } catch (error) {
            logger.error(`Pinned embedding failed for ${p}/${model}`, { error });
            return null;
        }
    },

    /** Batch embedding generation: the organization's embeddings, else parallel single calls. */
    async generateBatchEmbeddings(texts: string[], model?: string): Promise<Array<number[] | null>> {
        if (!texts || texts.length === 0) return [];
        if (hasAiOrganizationContext() || process.env.NODE_ENV === "production") return organizationEmbeddings().embedDocuments(texts);

        // Not the sidecar: its batch route needs a user token this API never had,
        // and its local model (MiniLM, 384 dimensions) is a different vector space
        // from the organization's index, so its vectors could not be searched together.
        logger.debug(`[EmbeddingService] Embedding ${texts.length} items in parallel`);
        return Promise.all(texts.map((t) => this.generateEmbedding(t)));
    },

    /**
     * Process queued embedding requests
     */
    async _processQueue(): Promise<void> {
        const now = Date.now();
        if (now > this._rateLimit.resetTime) {
            this._rateLimit.calls = 0;
            this._rateLimit.resetTime = now + 60000;
        }

        while (this._rateLimit.queue.length > 0 && this._rateLimit.calls < this.MAX_CALLS_PER_MINUTE) {
            const request = this._rateLimit.queue.shift();
            if (!request) break;

            this._rateLimit.calls++;
            try {
                const result = await this._callEmbeddingApi(request.text);
                request.resolve(result);
            } catch (error) {
                request.reject(error instanceof Error ? error : new Error(String(error)));
            }
        }
    },

    /**
     * Internal method to call the appropriate embedding API based on configuration
     */
    async _callEmbeddingApi(text: string): Promise<number[] | null> {
        let provider = process.env.RAG_EMBEDDING_PROVIDER || process.env.AI_PROVIDER || 'google';
        let model = process.env.RAG_EMBEDDING_MODEL;
        let config: any = null;

        // Only resolve from DB if env variables aren't providing both
        if (!process.env.RAG_EMBEDDING_PROVIDER || !process.env.RAG_EMBEDDING_MODEL) {
            try {
                const { systemConfigService } = await import("@domain/system/system-config.service.js");
                config = await systemConfigService.resolveAiConfig('ragEmbeddings');
                if (!process.env.RAG_EMBEDDING_PROVIDER && config?.provider) provider = config.provider;
                if (!process.env.RAG_EMBEDDING_MODEL && config?.model) model = config.model;
            } catch (err) {
                logger.warn("Failed to resolve embedding config from DB, falling back to defaults", { err });
            }
        }

        // Apply defaults if still missing
        if (!model) {
            model = provider === 'openai' ? 'text-embedding-ada-002' :
                    provider === 'ollama' ? 'nomic-embed-text' :
                    provider === 'python' ? 'all-MiniLM-L6-v2' : 'gemini-embedding-001';
        }

        try {
            if (provider === 'ollama') {
                const baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL;
                return this._callOllamaEmbedding(text, model, baseUrl);
            } else if (provider === 'google' || provider === 'gemini') {
                const apiKey = config?.apiKey || developmentProviderKey();
                const result = await this._callGoogleEmbedding(text, model, apiKey);
                
                if (result) return result;
                
                logger.warn("[EmbeddingService] Google embedding failed. Attempting failover to Ollama...");
                return this._callOllamaEmbedding(text, 'nomic-embed-text');
            } else if (provider === 'python') {
                const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
                return pythonBridge.generateEmbedding(text, model);
            } else {
                const apiKey = config?.apiKey || developmentProviderKey("openai");
                return this._callOpenAIEmbedding(text, model, apiKey);
            }
        } catch (error) {
            logger.error(`Embedding generation failed for ${provider}`, { error });
            return null;
        }
    },

    /**
     * Ollama local embedding implementation
     */
    async _callOllamaEmbedding(text: string, model: string, customBaseUrl?: string): Promise<number[] | null> {
        const baseUrl = (customBaseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
        try {
            const response = await fetch(`${baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt: text }),
            });

            if (!response.ok) {
                const error = await response.text();
                logger.error("Ollama Embedding API failed", { status: response.status, error });
                return null;
            }

            const data = await response.json();
            return data.embedding || null;
        } catch (e) {
            logger.error("Ollama connection failed", { e });
            return null;
        }
    },

    /**
     * Google/Gemini embedding implementation
     */
    async _callGoogleEmbedding(text: string, model: string, apiKeyOverride?: string): Promise<number[] | null> {
        const apiKey = apiKeyOverride || developmentProviderKey();
        if (!apiKey) {
            logger.error("Google API key not configured");
            return null;
        }

        // The endpoint path already includes "models/", so strip any leading
        // "models/" the configured model name may carry — otherwise the request
        // hits ".../models/models/<name>" and Google returns 404.
        const modelId = model.replace(/^models\//, "");

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:embedContent`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify({
                        content: { parts: [{ text }] }
                    }),
                }
            );

            if (!response.ok) {
                const error = await response.text();
                logger.error("Google Embedding API failed", { status: response.status, error });
                return null;
            }

            const data = await response.json();
            return data.embedding?.values || null;
        } catch (e) {
            logger.error("Google Embedding call failed", { e });
            return null;
        }
    },

    /**
     * OpenAI embedding implementation (Refactored to be more robust)
     */
    async _callOpenAIEmbedding(text: string, model: string, apiKeyOverride?: string): Promise<number[] | null> {
        // Development without an organization only (see generateEmbedding). This
        // used to take the first `openai` credential row of ANY tenant.
        const apiKey = apiKeyOverride || developmentProviderKey("openai");
        if (!apiKey) {
            logger.error("OpenAI API key not configured");
            return null;
        }

        const normalizedText = text.substring(0, 32000).replace(/\s+/g, ' ').trim();

        try {
            const response = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model, input: normalizedText }),
            });

            if (!response.ok) {
                const error = await response.text();
                logger.error("OpenAI Embedding API failed", { status: response.status, error });
                return null;
            }

            const data = await response.json();
            return data.data?.[0]?.embedding || null;
        } catch (e) {
            logger.error("OpenAI Embedding call failed", { e });
            return null;
        }
    },

    /**
     * Asynchronously generate and store embedding for a message
     */
    async generateAndStoreEmbedding(messageId: number, content: string) {
        try {
            const embedding = await this.generateEmbedding(content);
            if (embedding) {
                await db.update(agentChatMessages)
                    // Column stores a JSON-encoded array (readers JSON.parse it, e.g.
                    // rag-agent.service.ts); serialize rather than passing the raw
                    // number[], which pg would write as a non-JSON array literal.
                    .set({ embedding: JSON.stringify(embedding) })
                    .where(eq(agentChatMessages.id, messageId));
            }
        } catch (e) {
            console.error('[Embedding Service] Failed to store embedding:', e);
        }
    }
};



