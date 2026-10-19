import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";
import { userInterestGraphService } from "@domain/agents/core/user-interest-graph.service.js";
import { syntheticPersonaService } from "@domain/agents/core/synthetic-persona.service.js";
import { theoryOfMindService } from "@domain/agents/core/theory-of-mind.service.js";
import { requireToolOrgId } from "./org-context.js";

const logger = createLogger("UserContextTools");

export const USER_CONTEXT_TOOLS: Record<string, ToolDefinition> = {
    get_user_context_graph: {
        name: "get_user_context_graph",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get User Context Graph",
        group: "User Profile",
        description: "Retrieves the user's top interest topics, 14-day decayed recency weights, and recent project activity history.",
        parameters: z.object({
            limit: z.number().optional().describe("Max number of topics/activities to return (default 10)"),
        }),
        execute: async ({ limit }: { limit?: number }, context: ToolContext) => {
            try {
                const userId = context.userId || "user";
                const orgId = requireToolOrgId(context);
                const maxLimit = limit || 10;
                const [interests, activities] = await Promise.all([
                    userInterestGraphService.getTopInterests(orgId, userId, maxLimit),
                    userInterestGraphService.getRecentActivities(orgId, userId, maxLimit),
                ]);

                return JSON.stringify({
                    organizationId: orgId,
                    userId,
                    topInterests: interests.map((i) => ({
                        topic: i.topic,
                        category: i.category,
                        weight: i.weight,
                        effectiveWeight: i.effectiveWeight,
                        evidence: i.evidence,
                        lastReinforcedAt: i.lastReinforcedAt,
                    })),
                    recentActivities: activities.map((a) => ({
                        actionType: a.actionType,
                        topic: a.topic,
                        details: a.details,
                        createdAt: a.createdAt,
                    })),
                });
            } catch (err: any) {
                return `Failed to fetch user context graph: ${err.message}`;
            }
        }
    },

    get_synthetic_persona: {
        name: "get_synthetic_persona",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Synthetic Persona",
        group: "User Profile",
        description: "Retrieves the synthesized user persona, including archetype, focus topics, risk posture, working style, and communication directives.",
        parameters: z.object({}),
        execute: async (_args: {}, context: ToolContext) => {
            try {
                const userId = context.userId || "user";
                const orgId = requireToolOrgId(context);
                const persona = await syntheticPersonaService.getPersona(orgId, userId);
                if (!persona) {
                    return JSON.stringify({ error: "Synthetic persona not found for user." });
                }
                return JSON.stringify(persona);
            } catch (err: any) {
                return `Failed to fetch synthetic persona: ${err.message}`;
            }
        }
    },

    get_user_ocean_profile: {
        name: "get_user_ocean_profile",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get User OCEAN Profile",
        group: "User Profile",
        description: "Retrieves the assessed Big Five (OCEAN) personality profile for the user along with behavioral adaptation hints.",
        parameters: z.object({}),
        execute: async (_args: {}, context: ToolContext) => {
            try {
                const userId = context.userId || "user";
                const orgId = requireToolOrgId(context);
                const tomRecord = await theoryOfMindService.getToMState(orgId, userId);
                if (!tomRecord) {
                    return JSON.stringify({ error: "Theory of Mind state not found for user." });
                }
                return JSON.stringify({
                    oceanProfile: tomRecord.oceanProfile,
                    accessConsent: tomRecord.accessConsent,
                });
            } catch (err: any) {
                return `Failed to fetch OCEAN profile: ${err.message}`;
            }
        }
    }
};
