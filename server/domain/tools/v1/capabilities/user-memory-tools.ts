import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";

/**
 * Per-user memory tool. Lets the assistant persist durable facts/preferences about
 * the current user so it can recall them in future sessions (retrieved + injected
 * into the system prompt by prompt-service). Hermes MEMORY.md analogue.
 */
export const USER_MEMORY_TOOLS: Record<string, ToolDefinition> = {
    remember: {
        name: "remember",

        idempotency: "idempotent",
        label: "Remember About User",
        group: "Memory",
        description:
            "Persist a DURABLE fact or preference about the CURRENT user for future conversations " +
            "(e.g. 'prefers concise, bullet-point answers', 'is working on the Q3 launch', 'timezone is PST'). " +
            "Use when the user states a lasting preference or shares context worth recalling later. " +
            "Do NOT use for transient, one-off task details.",
        parameters: z.object({
            content: z
                .string()
                .describe("The durable fact/preference, phrased concisely in the third person (e.g. 'Prefers bullet-point answers')."),
            kind: z.enum(["preference", "fact", "context"]).optional(),
        }),
        execute: async ({ content, kind }: any, context: ToolContext) => {
            try {
                const userId = context.userId;
                if (!userId) return "No user in context; cannot remember.";
                const { userMemoryService } = await import("../../../agents/core/user-memory.service.js");
                const id = await userMemoryService.remember(userId, context.organizationId ?? null, content, kind || "fact");
                return id ? `Got it — I'll remember that: "${content}"` : "Nothing durable to remember there.";
            } catch (e: any) {
                return `Failed to remember: ${e.message}`;
            }
        },
    },
};
