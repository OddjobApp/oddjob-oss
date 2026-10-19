import { z } from "zod";
import type { ToolDefinition } from "./types.js";

/**
 * GMS (Generative Mission Synthesis) Tools
 * 
 * Native domain tool implementations for the 4-phase mission synthesis pipeline.
 */
export const GMS_TOOLS: Record<string, ToolDefinition> = {
    gms_score_blueprint: {
        name: "gms_score_blueprint",

        idempotency: "read-safe",
        label: "GMS: Score Blueprint",
        group: "GMS",
        description: "Phase 1: Score a mission blueprint using the Neural Mission Verifier to predict success probability and identify risk factors.",
        parameters: z.object({
            blueprint: z.record(z.any()).describe("The mission blueprint to score"),
        }),
        execute: async ({ blueprint }) => {
            const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
            const orchestrator = await getGMSOrchestrator();
            const score = await orchestrator.scoreMission(blueprint);
            return { success: true, score };
        }
    },

    gms_synthesize_missions: {
        name: "gms_synthesize_missions",

        idempotency: "none",
        label: "GMS: Synthesize Missions",
        group: "GMS",
        description: "Phase 2: Generate diverse mission candidates (blueprints) from a natural language request using Predictive Mission Intelligence (PMI).",
        parameters: z.object({
            request: z.string().describe("Natural language description of the mission goal"),
            nCandidates: z.number().optional().default(15).describe("Number of candidates to generate"),
            topK: z.number().optional().default(5).describe("Number of top-ranked candidates to return"),
            context: z.record(z.any()).optional().describe("Optional context for synthesis"),
        }),
        execute: async ({ request, nCandidates, topK, context }) => {
            const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
            const orchestrator = await getGMSOrchestrator();
            const response = await orchestrator.synthesizeMissions({
                request,
                options: {
                    nCandidates,
                    topK,
                    ...context
                }
            });
            return { success: true, candidates: response.candidates };
        }
    },

    gms_shadow_validate: {
        name: "gms_shadow_validate",

        idempotency: "read-safe",
        label: "GMS: Shadow Validate",
        group: "GMS",
        description: "Phase 3: Run isolated shadow validations (sandbox simulations) for mission candidates to establish ground truth.",
        parameters: z.object({
            candidates: z.array(z.record(z.any())).describe("Mission candidates to validate"),
            variationsPerCandidate: z.number().optional().default(5).describe("Number of variations to run per candidate"),
            isolationLevel: z.enum(["process", "container", "vm"]).optional().default("process").describe("Isolation level for validation"),
        }),
        execute: async ({ candidates, variationsPerCandidate, isolationLevel }) => {
            const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
            const orchestrator = await getGMSOrchestrator();
            const results = await orchestrator.shadowValidate(candidates, {
                variationsPerCandidate,
                isolationLevel
            });
            return { success: true, results };
        }
    },

    gms_find_skills: {
        name: "gms_find_skills",

        idempotency: "read-safe",
        label: "GMS: Find Skills",
        group: "GMS",
        description: "Phase 4: Search the Skill Library semantically for validated mission components and reusable skills.",
        parameters: z.object({
            query: z.string().describe("Search query for skills"),
            limit: z.number().optional().default(5).describe("Maximum skills to return"),
            requiredTags: z.array(z.string()).optional().describe("Optional tags to filter by"),
        }),
        execute: async ({ query, limit, requiredTags }) => {
            const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
            const orchestrator = await getGMSOrchestrator();
            const skills = await orchestrator.findSkills(query, { limit, requiredTags });
            return { success: true, skills };
        }
    },

    gms_evolve_skill: {
        name: "gms_evolve_skill",

        idempotency: "none",
        label: "GMS: Evolve Skill",
        group: "GMS",
        description: "Phase 4: Evolve a skill using genetic algorithms to improve its success rate or adapt it to new conditions.",
        parameters: z.object({
            skillId: z.string().describe("ID of the skill to evolve"),
        }),
        execute: async ({ skillId }) => {
            const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
            const orchestrator = await getGMSOrchestrator();
            const result = await orchestrator.evolveSkill(skillId);
            return result;
        }
    },

    gms_compose_mission: {
        name: "gms_compose_mission",

        idempotency: "none",
        label: "GMS: Compose Mission",
        group: "GMS",
        description: "Phase 4: Automatically compose a complex mission blueprint by assembling validated skills from the library.",
        parameters: z.object({
            goal: z.string().describe("Complex goal to achieve through skill composition"),
        }),
        execute: async ({ goal }) => {
            const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
            const orchestrator = await getGMSOrchestrator();
            const blueprint = await orchestrator.composeMission(goal);
            return { success: true, blueprint };
        }
    },

    gms_get_status: {
        name: "gms_get_status",

        idempotency: "read-safe",
        label: "GMS: Get Status",
        group: "GMS",
        description: "Get the current health and metrics of the GMS engine phases.",
        parameters: z.object({}),
        execute: async () => {
            const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
            const orchestrator = await getGMSOrchestrator();
            const status = await orchestrator.getStatus();
            return { success: true, status };
        }
    },
};
