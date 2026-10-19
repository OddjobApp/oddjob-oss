/**
 * LLM Adapter Type Definitions
 */

export interface LLMMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface LLMRequest {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
    preferredProvider?: string;
    preferredModel?: string;
    routingStrategy?: "cost" | "quality" | "speed" | "balanced";
    capabilities?: string[];
    fallbackEnabled?: boolean;
}

export interface LLMResponse {
    content: string;
    model: string;
    provider: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cost: number;
    };
    latency: {
        totalMs: number;
    };
    metadata?: any;
}

export interface LLMAdapter {
    name: string;
    complete(request: LLMRequest, model: any, provider: any): Promise<LLMResponse>;
    stream?(request: LLMRequest, model: any, provider: any, onChunk: (chunk: string) => void): Promise<LLMResponse>;
}
