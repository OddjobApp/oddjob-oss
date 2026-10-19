
import { z } from "zod";

// API Response Types from Ollama
interface OllamaModel {
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
        format: string;
        family: string;
        families: string[] | null;
        parameter_size: string;
        quantization_level: string;
    };
}

interface OllamaTagResponse {
    models: OllamaModel[];
}

export type OllamaTaskType = "code" | "reason" | "chat" | "summarize" | "classify" | "extract";

export class OllamaService {
    private baseUrl: string;
    private availabilityCache: { available: boolean; timestamp: number } | null = null;
    private static readonly AVAILABILITY_TTL_MS = 10000; // 10s cache

    constructor(baseUrl: string = process.env.OLLAMA_BASE_URL || "http://localhost:11434") {
        this.baseUrl = baseUrl.replace(/\/$/, ""); // Strip trailing slash
    }

    /**
     * Check if Ollama daemon is reachable (with short-lived cache to prevent request stalls)
     */
    async isAvailable(forceFresh: boolean = false): Promise<boolean> {
        const now = Date.now();
        if (!forceFresh && this.availabilityCache && (now - this.availabilityCache.timestamp) < OllamaService.AVAILABILITY_TTL_MS) {
            return this.availabilityCache.available;
        }

        try {
            const version = await this.getVersion();
            const available = version !== null;
            this.availabilityCache = { available, timestamp: now };
            return available;
        } catch {
            this.availabilityCache = { available: false, timestamp: now };
            return false;
        }
    }

    /**
     * Check if Ollama is reachable
     */
    async getVersion(): Promise<{ version: string } | null> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1500); // 1.5s fast timeout

            const res = await fetch(`${this.baseUrl}/api/version`, {
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    /**
     * List installed models
     */
    async listModels(): Promise<OllamaModel[]> {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`);
            if (!res.ok) throw new Error(`Failed to list models: ${res.statusText}`);
            const data = await res.json() as OllamaTagResponse;
            return data.models || [];
        } catch (e) {
            console.error("Ollama listModels failed:", e);
            throw e;
        }
    }

    /**
     * Select the optimal installed model for a specific task
     */
    async selectModelForTask(task: OllamaTaskType, preferredModel?: string): Promise<string> {
        if (preferredModel) return preferredModel;

        try {
            const models = await this.listModels();
            const modelNames = models.map(m => m.name.toLowerCase());

            const taskPreferences: Record<OllamaTaskType, string[]> = {
                code: ["qwen2.5-coder", "codellama", "starcoder2", "deepseek-r1", "llama3.2", "mistral"],
                reason: ["deepseek-r1", "qwen2.5", "llama3.1", "mistral", "llama3.2", "phi3"],
                chat: ["llama3.2", "llama3.1", "gemma2", "mistral", "phi3", "qwen2.5"],
                summarize: ["llama3.2", "mistral", "gemma2", "phi3", "qwen2.5"],
                classify: ["llama3.2", "phi3", "mistral", "gemma2"],
                extract: ["llama3.2", "qwen2.5", "mistral", "phi3"]
            };

            const candidates = taskPreferences[task] || taskPreferences.chat;
            for (const candidate of candidates) {
                const match = modelNames.find(name => name.includes(candidate));
                if (match) return match;
            }

            if (models.length > 0) {
                return models[0].name;
            }
        } catch {
            // Fall through to default
        }

        return "llama3.2";
    }

    /**
     * Pull a new model
     */
    async pullModel(name: string): Promise<Response> {
        return fetch(`${this.baseUrl}/api/pull`, {
            method: "POST",
            body: JSON.stringify({ name }),
        });
    }

    /**
     * Delete a model
     */
    async deleteModel(name: string): Promise<boolean> {
        const res = await fetch(`${this.baseUrl}/api/delete`, {
            method: "DELETE",
            body: JSON.stringify({ name }),
        });
        return res.ok;
    }

    /**
     * Curated list of high-performance models available in the Ollama library.
     */
    static readonly POPULAR_MODELS = [
        { name: "deepseek-r1", description: "State-of-the-art reasoning model with CoT capability.", size: "7B - 671B", libraryUrl: "https://ollama.com/library/deepseek-r1" },
        { name: "llama3.2", description: "Meta's latest efficient general purpose model.", size: "1B - 3B", libraryUrl: "https://ollama.com/library/llama3.2" },
        { name: "llama3.1", description: "Large context general purpose powerhouse.", size: "8B - 405B", libraryUrl: "https://ollama.com/library/llama3.1" },
        { name: "mistral", description: "High-performance model known for efficiency and reasoning.", size: "7B", libraryUrl: "https://ollama.com/library/mistral" },
        { name: "mixtral", description: "High-quality Mixture-of-Experts model from Mistral AI.", size: "8x7B", libraryUrl: "https://ollama.com/library/mixtral" },
        { name: "phi3", description: "Microsoft's extremely capable small language model.", size: "3.8B", libraryUrl: "https://ollama.com/library/phi3" },
        { name: "gemma2", description: "Google's high-performance open weights model.", size: "2B - 27B", libraryUrl: "https://ollama.com/library/gemma2" },
        { name: "qwen2.5", description: "Alibaba's highly capable multilingual model.", size: "0.5B - 72B", libraryUrl: "https://ollama.com/library/qwen2.5" },
        { name: "codellama", description: "Specialized model for code generation and analysis.", size: "7B - 70B", libraryUrl: "https://ollama.com/library/codellama" },
        { name: "starcoder2", description: "Advanced model for specialized coding tasks.", size: "3B - 15B", libraryUrl: "https://ollama.com/library/starcoder2" },
        { name: "nomic-embed-text", description: "High-performance embedding model for RAG.", size: "274MB", libraryUrl: "https://ollama.com/library/nomic-embed-text" }
    ];

    /**
     * Search for remote models from our curated catalog
     */
    searchRemoteModels(query: string) {
        if (!query) return OllamaService.POPULAR_MODELS;
        const q = query.toLowerCase();
        return OllamaService.POPULAR_MODELS.filter(m => 
            m.name.toLowerCase().includes(q) || 
            m.description.toLowerCase().includes(q)
        );
    }

    /**
     * Generate completion with thinking token telemetry (<THINKING> / <PLAN> tag extraction).
     */
    async generateCompletion(model: string, prompt: string, options?: { system?: string; stream?: boolean }): Promise<{
        response: string;
        thinking?: string;
        plan?: string;
        evalCount?: number;
        evalDurationNs?: number;
    }> {
        const res = await fetch(`${this.baseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                prompt,
                system: options?.system,
                stream: false
            })
        });

        if (!res.ok) {
            throw new Error(`Ollama generation failed: ${res.statusText}`);
        }

        const data = await res.json() as any;
        const rawText: string = data.response || "";

        // Parse <THINKING>...</THINKING> or <think>...</think> CoT tags
        let thinking: string | undefined;
        let plan: string | undefined;
        let cleanResponse = rawText;

        const thinkMatch = rawText.match(/<(THINKING|think)>([\s\S]*?)<\/(THINKING|think)>/i);
        if (thinkMatch) {
            thinking = thinkMatch[2].trim();
            cleanResponse = cleanResponse.replace(thinkMatch[0], "").trim();
        }

        const planMatch = rawText.match(/<PLAN>([\s\S]*?)<\/PLAN>/i);
        if (planMatch) {
            plan = planMatch[1].trim();
            cleanResponse = cleanResponse.replace(planMatch[0], "").trim();
        }

        return {
            response: cleanResponse,
            thinking,
            plan,
            evalCount: data.eval_count,
            evalDurationNs: data.eval_duration
        };
    }

    /**
     * Generate structured JSON output with automatic parsing and schema validation
     */
    async generateStructured<T>(model: string, prompt: string, schema?: z.ZodType<T>, options?: { system?: string }): Promise<{
        data: T | null;
        raw: string;
        error?: string;
    }> {
        const res = await fetch(`${this.baseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                prompt,
                system: options?.system ? `${options.system}\nOutput strictly valid JSON.` : "Output strictly valid JSON.",
                format: "json",
                stream: false
            })
        });

        if (!res.ok) {
            throw new Error(`Ollama structured generation failed: ${res.statusText}`);
        }

        const data = await res.json() as any;
        const raw: string = data.response || "";

        try {
            const parsed = JSON.parse(raw);
            if (schema) {
                const validated = schema.safeParse(parsed);
                if (validated.success) {
                    return { data: validated.data, raw };
                } else {
                    return { data: null, raw, error: validated.error.message };
                }
            }
            return { data: parsed as T, raw };
        } catch (err: any) {
            return { data: null, raw, error: `JSON parse error: ${err.message}` };
        }
    }
}

// Singleton instance for default localhost usage if needed
export const defaultOllamaService = new OllamaService();


