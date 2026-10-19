import { AIClientFactory } from "./ai-client.service.js";
import { developmentProviderKey } from "./org-gemini-key.js";

/**
 * One JSON completion on the organization's own Gemini key.
 *
 * Forge repair, hot-reload patching and structured planning each called the
 * OpenAI REST API directly with a platform key — which strict-BYOK production
 * does not have, and which bypassed the org's budget and spend tracking. They
 * go through the org-aware client instead, like every other AI call.
 */
export async function orgJsonCompletion<T = any>(input: {
    organizationId: number | null | undefined;
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    model?: string;
}): Promise<T> {
    const model = input.model ?? "gemini-2.5-flash";
    const client = AIClientFactory.getClient({ provider: "google", model } as any);
    const response = await client.execute({
        model,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        temperature: input.temperature ?? 0.2,
        requestType: "json",
        useCache: false,
        enableQueryExpansion: false,
        saveOutputToFile: false,
        ...(input.organizationId != null ? { organizationId: input.organizationId } : {}),
    } as any, undefined, developmentProviderKey());

    if (!response.success || !response.output) {
        throw new Error(`Model call failed: ${response.error || "no output"}`);
    }
    return JSON.parse(response.output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as T;
}
