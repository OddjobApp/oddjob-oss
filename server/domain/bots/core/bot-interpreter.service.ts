/**
 * BotInterpreterService
 *
 * Converts a free-text prompt ("Monitor my Jira board daily and post a Slack summary")
 * into a structured BotBlueprint that BotFactoryService can assemble into real resources.
 *
 * Primary path  : LLMClient.generateStructured → JSON schema → BotBlueprint
 * Fallback path : keyword-match heuristic (runs when GEMINI_API_KEY is absent or the call fails)
 */

import { z } from "zod";
import { createLogger } from "@server/utils/logger.js";
import { ValidationError } from "@server/utils/errors.js";
import { isValidRecurrence } from "@shared/contracts/project-event-recurrence.js";
import { LLMClient } from "@server/domain/ai/core/llm-client.js";
import { ORG_AI_KEY_MISSING, resolveOrgTextAiKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("BotInterpreterService");

// ============================================================================
// TYPES
// ============================================================================

export type BotPersona =
    | "copilot"
    | "analyst"
    | "coder"
    | "researcher"
    | "general"
    | "art-director"
    | "ghostwriter"
    | "devops";

export type BotIntegration = "jira" | "slack" | "github" | "gmail";

export interface BotBlueprint {
    /** Human-readable name, e.g. "Jira Summary Bot" */
    name: string;
    /** One-sentence description shown in the agent card */
    description: string;
    /** Maps to agentCards.personaType */
    persona: BotPersona;
    /** Cron string if the bot should run on a schedule, otherwise null */
    schedule: string | null;
    /** Integrations the bot needs access to */
    integrations: BotIntegration[];
    /** Capability strings that map to existing job types */
    capabilities: string[];
    /** true when the LLM produced this; false when keyword-match was used */
    isAiGenerated: boolean;
}

const FIVE_FIELD_CRON = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;
const uniqueStrings = (values: string[]) => new Set(values).size === values.length;

export const botBlueprintSchema: z.ZodType<BotBlueprint> = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(200),
    persona: z.enum(["copilot", "analyst", "coder", "researcher", "general", "art-director", "ghostwriter", "devops"]),
    schedule: z.string().trim().max(100)
        .refine(
            (value) => FIVE_FIELD_CRON.test(value) && isValidRecurrence(value),
            "schedule must be a valid 5-field cron expression",
        )
        .nullable(),
    integrations: z.array(z.enum(["jira", "slack", "github", "gmail"])).max(4)
        .refine(uniqueStrings, "integrations must not contain duplicates"),
    capabilities: z.array(z.string().trim().min(1).max(80)).min(1).max(10)
        .refine(uniqueStrings, "capabilities must not contain duplicates"),
    isAiGenerated: z.boolean(),
}).strict();

/** Validates a blueprint the client sends back; never trusts interpreter output a second time. */
export function parseBotBlueprint(value: unknown): BotBlueprint {
    const result = botBlueprintSchema.safeParse(value);
    if (!result.success) {
        throw new ValidationError("Invalid bot blueprint", {
            fields: result.error.flatten().fieldErrors,
        });
    }
    return result.data;
}

// ============================================================================
// JSON SCHEMA for structured LLM output
// ============================================================================

const BOT_BLUEPRINT_SCHEMA = {
    type: "object",
    required: ["name", "description", "persona", "schedule", "integrations", "capabilities"],
    properties: {
        name: { type: "string", maxLength: 80 },
        description: { type: "string", maxLength: 200 },
        persona: {
            type: "string",
            enum: ["copilot", "analyst", "coder", "researcher", "general", "art-director", "ghostwriter", "devops"],
        },
        schedule: {
            oneOf: [{ type: "string" }, { type: "null" }],
            description: "A 5-field cron expression (e.g. '0 9 * * 1-5') or null for conversational bots",
        },
        integrations: {
            type: "array",
            items: { type: "string", enum: ["jira", "slack", "github", "gmail"] },
        },
        capabilities: {
            type: "array",
            items: { type: "string" },
            maxItems: 10,
        },
    },
    additionalProperties: false,
} as const;

// ============================================================================
// KEYWORD HEURISTICS (fallback when no API key)
// ============================================================================

const SCHEDULE_PATTERNS: [RegExp, string][] = [
    [/\b(every\s+minute|minutely)\b/i, "* * * * *"],
    [/\b(every\s+hour|hourly)\b/i, "0 * * * *"],
    [/\b(every\s+morning|daily|each\s+day|every\s+day)\b/i, "0 9 * * *"],
    [/\bevery\s+weekday\b/i, "0 9 * * 1-5"],
    [/\b(every\s+week|weekly)\b/i, "0 9 * * 1"],
    [/\b(every\s+month|monthly)\b/i, "0 9 1 * *"],
];

const INTEGRATION_KEYWORDS: Record<BotIntegration, RegExp> = {
    jira: /\b(jira|ticket|issue|sprint|backlog|story\s+point)\b/i,
    slack: /\b(slack|channel|message|notify|dm|post)\b/i,
    github: /\b(github|pull\s+request|pr|commit|repo|branch|merge)\b/i,
    gmail: /\b(gmail|email|inbox|send\s+mail|email\s+report)\b/i,
};

const PERSONA_KEYWORDS: [RegExp, BotPersona][] = [
    [/\b(code|debug|implement|refactor|test|deploy)\b/i, "coder"],
    [/\b(analyze|report|insight|metric|dashboard|summarize)\b/i, "analyst"],
    [/\b(research|find|discover|gather|collect|search)\b/i, "researcher"],
    [/\b(design|creative|art|image|visual)\b/i, "art-director"],
    [/\b(write|draft|compose|content|copywrite)\b/i, "ghostwriter"],
    [/\b(devops|deploy|pipeline|ci\s*\/?\s*cd|infrastructure|monitor)\b/i, "devops"],
];

function keywordFallback(prompt: string): BotBlueprint {
    const trimmed = prompt.trim();

    // Schedule
    let schedule: string | null = null;
    for (const [re, cron] of SCHEDULE_PATTERNS) {
        if (re.test(trimmed)) { schedule = cron; break; }
    }

    // Integrations
    const integrations: BotIntegration[] = (Object.keys(INTEGRATION_KEYWORDS) as BotIntegration[])
        .filter(k => INTEGRATION_KEYWORDS[k].test(trimmed));

    // Persona
    let persona: BotPersona = "general";
    for (const [re, p] of PERSONA_KEYWORDS) {
        if (re.test(trimmed)) { persona = p; break; }
    }

    // Name: first 6 words, title-cased, + "Bot"
    const words = trimmed.replace(/[^\w\s]/g, "").split(/\s+/).slice(0, 6);
    const nameBase = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const name = `${nameBase} Bot`.slice(0, 80);

    // Description
    const description = trimmed.slice(0, 200);

    // Capabilities
    const capabilities: string[] = [];
    if (schedule) capabilities.push("scheduled-task");
    if (integrations.includes("jira")) capabilities.push("jira-integration");
    if (integrations.includes("slack")) capabilities.push("slack-notification");
    if (integrations.includes("github")) capabilities.push("github-integration");
    if (integrations.includes("gmail")) capabilities.push("email-report");
    if (capabilities.length === 0) capabilities.push("general-assistant");

    return { name, description, persona, schedule, integrations, capabilities, isAiGenerated: false };
}

// ============================================================================
// SERVICE
// ============================================================================

export class BotInterpreterService {
    private readonly systemPrompt = `
You are an AI assistant that converts a user's natural-language description of a bot
into a structured JSON object matching the provided schema.

Rules:
- "name" should be a concise, memorable name (≤ 80 chars), e.g. "Daily Jira Digest Bot".
- "description" should be ≤ 200 chars and read like a product tagline.
- "persona" must be one of the allowed enum values. Choose the best match.
- "schedule" should be a 5-field cron if the user mentions a recurring cadence, otherwise null.
- "integrations" should only include tools explicitly or strongly implied by the prompt.
- "capabilities" should list the functional capabilities (2–6 items), e.g. ["jira-integration", "scheduled-task", "slack-notification"].
- Reply with ONLY the JSON object matching the schema. No prose, no code fences.
`.trim();

    async interpret(prompt: string): Promise<BotBlueprint> {
        const apiKey = await resolveOrgTextAiKey(null);

        if (!apiKey) {
            logger.warn(`${ORG_AI_KEY_MISSING} — falling back to keyword matching`);
            return keywordFallback(prompt);
        }

        try {
            const client = new LLMClient({ provider: "google", apiKey });
            const result = await client.generateStructured<Omit<BotBlueprint, "isAiGenerated">>({
                prompt: `${this.systemPrompt}\n\nUser prompt: "${prompt}"`,
                schema: BOT_BLUEPRINT_SCHEMA,
                temperature: 0.1,
                maxTokens: 512,
            });

            // Validate the result shape minimally before trusting it
            if (!result.name || !result.description || !result.persona) {
                throw new Error("LLM returned incomplete blueprint");
            }

            const blueprint = parseBotBlueprint({
                name: result.name,
                description: result.description,
                persona: result.persona,
                schedule: result.schedule ?? null,
                integrations: result.integrations,
                capabilities: result.capabilities,
                isAiGenerated: true,
            });

            logger.info("BotInterpreterService: AI-generated blueprint", { name: blueprint.name });
            return blueprint;
        } catch (err) {
            logger.warn("BotInterpreterService: LLM call failed, falling back to keyword match", { err });
            return keywordFallback(prompt);
        }
    }
}

export const botInterpreterService = new BotInterpreterService();
