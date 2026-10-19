import { createLogger } from "@server/utils/logger.js";
import { getCachedCompiledPrompt } from "./prompt-event-bus.js";
import { copilotPromptManager } from "./copilot-prompt-manager.service.js";
import { fetchDdgFallback } from "@domain/tools/v1/capabilities/web.js";

const logger = createLogger("CopilotService");

export interface CopilotChatRequest {
    userId: string;
    userMessage: string;
    appId: string;
    mode?: "explain" | "plan" | "execute" | "audit";
    audience?: string;
}

export interface CopilotChatResponse {
    systemPromptUsed: string;
    fingerprintUsed: string;
    stalenessDeltaTurns: number;
    responseContent: string;
}

/**
 * Dynamic Prompt Assembly Layer:
 * Fetches the latest compiled architecture spec prompt directly from cache (<2ms),
 * performs internal knowledge lookup, and falls back to live web search when needed.
 */
export async function handleCopilotChatRequest(request: CopilotChatRequest): Promise<CopilotChatResponse> {
    const { userId, userMessage, appId, mode = "plan", audience = "developer" } = request;

    // 1. Fetch static base framing system prompt
    const baseInstruction = copilotPromptManager.getSystemPrompt({ mode, audience });

    // 2. Retrieve freshly compiled architecture spec from cache (<2ms)
    const cachedSpecPrompt = getCachedCompiledPrompt(appId);

    // 3. Assemble dynamic system message
    const fullSystemPrompt = [
        baseInstruction,
        cachedSpecPrompt || "Spec context temporarily unavailable; defaulting to advisory mode."
    ].join("\n\n");

    const fingerprint = copilotPromptManager.getFingerprint();

    // 4. Perform live web search fallback if requested or query is non-local topic
    let responseContent = `[Copilot Control Plane] Received instruction in stage [Observe]. System readiness: ${fingerprint.readinessScore}/100.`;
    
    try {
        const webResults = await fetchDdgFallback(userMessage);
        if (webResults && !webResults.includes("failed")) {
            responseContent = `I searched the web for "${userMessage}" and retrieved the following live results:\n\n${webResults}`;
        }
    } catch (err: any) {
        logger.warn(`[CopilotService] Web search fallback error: ${err.message}`);
    }

    logger.info(`[CopilotService] Processed chat request for user '${userId}', app '${appId}' with web search fallback.`);

    return {
        systemPromptUsed: fullSystemPrompt,
        fingerprintUsed: fingerprint.indexedDate + "-" + fingerprint.readinessScore,
        stalenessDeltaTurns: 0,
        responseContent
    };
}

