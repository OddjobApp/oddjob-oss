import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

export class MockAIClient implements AIClient {
    async execute(
        config: AIApiCallConfig,
        _input: string | undefined,
        apiKey: string,
        _fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): Promise<AIResponse> {
        console.log(`[MockClient] Executing request (Model: ${config.model})...`);

        const promptText = (config.userPrompt || config.messages?.map((m: any) => m.content).join(" ") || "").toLowerCase();
        const systemText = (config.systemPrompt || "").toLowerCase();

        // Return JSON if requested
        if (config.requestType === "json") {
            // Return dummy plan if prompt looks like planner
            if (systemText.includes("planner") || promptText.includes("plan")) {
                return {
                    success: true,
                    output: JSON.stringify({
                        plan: {
                            steps: [
                                { name: "Step 1", type: "task", description: "Initialize security assessment" },
                                { name: "Step 2", type: "task", description: "Execute governance verification" }
                            ]
                        },
                        reasoning: "Mocked plan for testing."
                    }),
                    metadata: { model: "mock", provider: "mock", latencyMs: 10 }
                };
            }

            // Return dummy analysis
            return {
                success: true,
                output: JSON.stringify({
                    analysis: "Mocked analysis result.",
                    confidence: 0.99
                }),
                metadata: { model: "mock", provider: "mock", latencyMs: 10 }
            };
        }

        // Return dummy ranking if prompt looks like reranker
        if (promptText.includes("re-rank the following document chunks")) {
            return {
                success: true,
                output: JSON.stringify({
                    rankings: [
                        { index: 1, score: 0.95 },
                        { index: 2, score: 0.90 }
                    ]
                }),
                metadata: { model: "mock", provider: "mock", latencyMs: 10 }
            };
        }

        // Return dummy entities for Auto-Linking
        if (systemText.includes("knowledge graph entity extractor")) {
            return {
                success: true,
                output: JSON.stringify({
                    entities: [
                        { name: "Dr. Eleanor Arroway", label: "Person", description: "Scientist at SETI", confidenceScore: 0.95 },
                        { name: "SETI Institute", label: "Organization", description: "Research institute", confidenceScore: 0.9 },
                        { name: "VLA", label: "Location", description: "Radio astronomy observatory", confidenceScore: 0.85 }
                    ],
                    relationships: [
                        { source: "Dr. Eleanor Arroway", target: "SETI Institute", relation: "works_at" },
                        { source: "VLA", target: "New Mexico", relation: "located_in" }
                    ]
                }),
                metadata: { model: "mock", provider: "mock", latencyMs: 10 }
            };
        }

        // Dynamic contextual responses for general chat
        const lastUserMsg = config.messages?.filter((m: any) => m.role === "user").pop()?.content || "";
        // A message's content is either text or an array of content parts, so it
        // cannot be lower-cased directly.
        const lastUserText = Array.isArray(lastUserMsg) ? lastUserMsg.map((p: any) => p?.text ?? "").join(" ") : lastUserMsg;
        const directUserText = String(config.userPrompt || lastUserText || "").toLowerCase().trim();

        // TODO: Re-enable zero-trust HIL PIN verification gate when PIN security flow is enabled for persona graph access.
        let responseText = "";

        if (directUserText.includes("hi") || directUserText.includes("hello") || directUserText === "hi") {
            responseText = "Hello! I am the Oddjob Copilot. How can I assist you with platform architecture, governance, or autonomous cycles today?";
        } else if (promptText.includes("mature") || promptText.includes("security controls") || promptText.includes("governance")) {
            responseText = "To mature platform governance and security controls, we recommend: 1) Enforcing Human-in-the-Loop (HIL) approval gates on high-risk execution actions, 2) Activating continuous W3C distributed tracing and audit logs across all subagent calls, and 3) Utilizing session-scoped access consent for Theory of Mind and persona profile queries.";
        } else {
            responseText = `Regarding your query ("${(config.userPrompt || lastUserMsg).slice(0, 80) || "your request"}"): The system has processed your request within the governed AI control plane. Let me know if you would like to generate a mission, inspect project resources, or configure synthetic persona settings.`;
        }

        return {
            success: true,
            output: responseText,
            metadata: { model: "mock", provider: "mock", latencyMs: 10 }
        };
    }
}
