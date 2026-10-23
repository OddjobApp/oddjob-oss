/** Map a raw agent/provider error message to a user-facing message + code. */
export function mapAgentError(errorMessage: string): { userMessage: string; errorCode: string } {
    // The organization's own key is the only way AI runs in production: say so,
    // and where to add it, instead of "Sorry, I encountered an error".
    if (errorMessage.includes("Connect your organization's AI provider key")) {
        return { userMessage: "🔑 **No AI provider connected**\n\nCopilot runs on your organization's own AI key. An organization admin can connect one (Gemini, Amazon Bedrock, Anthropic, OpenAI...) in [Platform → AI Models](/platform/ai-models).", errorCode: "ORG_AI_KEY_MISSING" };
    }
    if (errorMessage.includes("This feature runs on Gemini")) {
        return { userMessage: "🔑 **This needs a Gemini key**\n\nThis feature runs only on Google Gemini. An organization admin can add a Gemini key alongside your current provider in [Platform → AI Models](/platform/ai-models).", errorCode: "ORG_GEMINI_KEY_MISSING" };
    }
    if (errorMessage.startsWith("AI budget restriction")) {
        return { userMessage: `💳 **AI budget reached**\n\n${errorMessage.replace(/^AI budget restriction:\s*/, "")}`, errorCode: "BUDGET_EXCEEDED" };
    }
    if (errorMessage.includes("spending cap")) {
        return { userMessage: "**API quota or spend cap reached**\n\nThe configured AI provider cannot answer because quota or spending cap is exhausted. Raise the provider cap or switch Copilot to another configured provider/model.", errorCode: "QUOTA_EXCEEDED" };
    } else if (errorMessage.includes("insufficient_quota") || errorMessage.includes("exceeded your current quota")) {
        return { userMessage: "🚫 **API Quota Exceeded**\n\nThe AI service has run out of quota. Please check your API billing settings or try again later.", errorCode: "QUOTA_EXCEEDED" };
    } else if (errorMessage.includes("429") || errorMessage.includes("rate limit") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
        return { userMessage: "⏳ **Rate Limited**\n\nToo many requests. Please wait a moment and try again.", errorCode: "RATE_LIMITED" };
    } else if (errorMessage.includes("401") || errorMessage.includes("invalid_api_key") || errorMessage.includes("Incorrect API key")) {
        return { userMessage: "🔑 **Invalid API Key**\n\nThe AI service API key is invalid or missing. Please check your configuration.", errorCode: "INVALID_API_KEY" };
    } else if (errorMessage.includes("No GOOGLE_API_KEY") || errorMessage.includes("No OPENAI_API_KEY")) {
        return { userMessage: "⚙️ **Missing Configuration**\n\nNo API key is configured for the AI service. Please set up your API credentials.", errorCode: "MISSING_API_KEY" };
    } else if (errorMessage.includes("network") || errorMessage.includes("ECONNREFUSED") || errorMessage.includes("fetch failed")) {
        return { userMessage: "🔌 **Connection Error**\n\nCouldn't connect to the AI service. Please check your network connection.", errorCode: "NETWORK_ERROR" };
    } else if (errorMessage.includes("timeout")) {
        return { userMessage: "⏱️ **Request Timeout**\n\nThe request took too long. Please try a simpler question.", errorCode: "TIMEOUT" };
    }
    return { userMessage: "Sorry, I encountered an error processing your request.", errorCode: "AGENT_ERROR" };
}
