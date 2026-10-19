import { createLogger } from "../../../utils/logger.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";
import type { AIApiCallConfig } from "@shared/schema/index.js";
import { ORG_GEMINI_KEY_MISSING, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("HermesProtocolService");

export interface HermesToolCall {
    name: string;
    arguments: Record<string, any>;
}

export interface HermesParsedResponse {
    thought: string;
    toolCalls: HermesToolCall[];
    content: string;
}

export interface HermesResponse {
    thought_process: string;
    action_details: string;
    integration_assessment?: string;
    raw?: string;
}

/**
 * Hermes Protocol Service
 * Implements XML-based reasoning and tool calling for high-precision agent loops.
 */
export class HermesProtocolService {
    /**
     * Build the standard system instruction for Hermes XML reasoning.
     */
    static buildInstruction(): string {
        return `
### REASONING PROTOCOL: HERMES-XML
You must follow the Hermes XML protocol for all reasoning and technical interactions.

1. **Reasoning**: All complex thinking, planning, and analysis must be enclosed in <think>...</think> tags. Do not be afraid to think deeply and recursively.
2. **Technical Actions**: To execute a tool or dynamic skill, use the following format:
   <action name="tool_name">
     { "arg1": "value", "arg2": "..." }
   </action>
   You can call multiple tools in a single response if they are independent.
3. **Observations**: Results from technical actions will be returned to you in <result>...</result> tags in the next turn.
4. **Final Conclusion**: When you have completed the task, provide your final response to the user. You may still include a final <think> block to summarize your verification.

STRICT RULE: Do not invent tool names. Only use the tools explicitly listed in your AVAILABLE TOOLS section.
`.trim();
    }

    /**
     * Parse the LLM response to extract thoughts, content, and tool calls.
     */
    static parseResponse(text: string): HermesParsedResponse {
        const thoughtRegex = /<think>([\s\S]*?)<\/think>/g;
        const actionRegex = /<action\s+name=["'](.*?)["']>\s*([\s\S]*?)\s*<\/action>/g;

        let thought = "";
        const toolCalls: HermesToolCall[] = [];
        let content = text;

        // Extract thoughts
        let match;
        while ((match = thoughtRegex.exec(text)) !== null) {
            thought += match[1].trim() + "\n";
            content = content.replace(match[0], "");
        }

        // Extract actions
        while ((match = actionRegex.exec(text)) !== null) {
            const name = match[1];
            const argsStr = match[2].trim();
            try {
                // Strip markdown code blocks if present
                const cleanArgs = argsStr.replace(/```json\n?|```/g, '').trim();
                const args = JSON.parse(cleanArgs);
                toolCalls.push({ name, arguments: args });
            } catch (err) {
                logger.warn(`Failed to parse arguments for tool ${name}: ${argsStr}`);
            }
            content = content.replace(match[0], "");
        }

        return {
            thought: thought.trim(),
            toolCalls,
            content: content.trim()
        };
    }

    /**
     * Formats a tool result into the Hermes format for the next user message.
     */
    static formatResult(toolName: string, result: any): string {
        return `
<result name="${toolName}">
${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
</result>
`.trim();
    }

    /**
     * Standalone reasoning method for system orchestrators.
     * Uses the Hermes protocol (Think-Act) to generate structured proposals.
     */
    async reason(prompt: string, model: string = "gemini-2.0-flash"): Promise<HermesResponse> {
        const apiKey = await resolveOrgGeminiKey(null);
        if (!apiKey) {
            throw new Error(`${ORG_GEMINI_KEY_MISSING} to use Hermes reasoning.`);
        }

        const client = AIClientFactory.getClient({ provider: "google" } as any);
        const config: AIApiCallConfig = {
            model,
            systemPrompt: "You are the Hermes Protocol Orchestrator. You MUST follow the Hermes XML protocol exactly.\n\n" +
                         "REQUIRED FORMAT:\n" +
                         "<think>\n[Your deep reasoning and rationale here]\n</think>\n" +
                         "<action name=\"pitch\">\n[The structured proposal/JSON data here]\n</action>\n" +
                         "<integration_assessment>\n[Your assessment of how existing integrations benefit this change]\n</integration_assessment>\n\n" +
                         "If the user asks for an evolutionary pitch, use <think> for the rationale and <action name=\"pitch\"> for the implementation details.",
            userPrompt: prompt,
            temperature: 0.7,
            useCache: false,
            saveOutputToFile: false
        };

        const response = await client.execute(config, prompt, apiKey);
        if (!response.success || !response.output) {
            throw new Error(`Hermes reasoning failed: ${response.error || "No output"}`);
        }

        const parsed = HermesProtocolService.parseResponse(response.output);
        
        // Extract specific tags if present for evolutionary pitches
        const rationale = parsed.thought || "Automated rationale: Identified structural gap in TrustGraph with high connectivity.";
        let actionDetails = parsed.content;
        
        const pitchAction = parsed.toolCalls.find(a => a.name === "pitch");
        if (pitchAction) {
            actionDetails = JSON.stringify(pitchAction.arguments, null, 2);
        } else if (parsed.content.length < 50 && parsed.thought.length > 50) {
            // Fallback: If thinking was used but content is thin, use thinking as content
            actionDetails = parsed.thought;
        }

        const integrationAssessment = response.output.match(/<integration_assessment>([\s\S]*?)<\/integration_assessment>/i)?.[1]?.trim() 
            || "Automated assessment: This capability enhances the overall corporate intelligence ecosystem.";

        return {
            thought_process: rationale,
            action_details: actionDetails,
            integration_assessment: integrationAssessment,
            raw: response.output
        };
    }
}

// Export default instance for singleton usage
export const hermesProtocolService = new HermesProtocolService();
