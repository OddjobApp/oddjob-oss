/**
 * Oddjob MCP Server - GMS (Generative Mission Synthesis) Tools
 * 
 * Exposes the 4-phase mission synthesis, validation, and evolution pipeline
 * through the Model Context Protocol.
 */

import { z } from "zod";

export const gmsToolDefinitions = [
    {
        name: "gms_score_blueprint",
        description: "Phase 1: Score a mission blueprint using the Neural Mission Verifier to predict success probability and identify risk factors.",
        inputSchema: {
            type: "object" as const,
            properties: {
                blueprint: { 
                    type: "object", 
                    description: "The mission blueprint to score (steps, agents, tools, etc.)",
                    additionalProperties: true
                }
            },
            required: ["blueprint"]
        }
    },
    {
        name: "gms_synthesize_missions",
        description: "Phase 2: Generate diverse mission candidates (blueprints) from a natural language request using Predictive Mission Intelligence (PMI).",
        inputSchema: {
            type: "object" as const,
            properties: {
                request: { 
                    type: "string", 
                    description: "Natural language description of the mission goal" 
                },
                nCandidates: { 
                    type: "number", 
                    description: "Number of candidates to generate (default: 15)" 
                },
                topK: { 
                    type: "number", 
                    description: "Number of top-ranked candidates to return (default: 5)" 
                },
                context: {
                    type: "object",
                    description: "Optional context for synthesis",
                    additionalProperties: true
                }
            },
            required: ["request"]
        }
    },
    {
        name: "gms_shadow_validate",
        description: "Phase 3: Run isolated shadow validations (sandbox simulations) for mission candidates to establish ground truth and calibrate verifier scores.",
        inputSchema: {
            type: "object" as const,
            properties: {
                candidates: { 
                    type: "array", 
                    items: { type: "object", additionalProperties: true },
                    description: "Mission candidates to validate"
                },
                variationsPerCandidate: { 
                    type: "number", 
                    description: "Number of variations to run per candidate (default: 5)" 
                },
                isolationLevel: { 
                    type: "string", 
                    enum: ["process", "container", "vm"],
                    description: "Isolation level for validation (default: process)" 
                }
            },
            required: ["candidates"]
        }
    },
    {
        name: "gms_find_skills",
        description: "Phase 4: Search the Skill Library semantically for validated mission components and reusable skills.",
        inputSchema: {
            type: "object" as const,
            properties: {
                query: { 
                    type: "string", 
                    description: "Search query for skills (e.g. 'customer data extraction')" 
                },
                limit: { 
                    type: "number", 
                    description: "Maximum skills to return (default: 5)" 
                },
                requiredTags: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "Optional tags to filter by" 
                }
            },
            required: ["query"]
        }
    },
    {
        name: "gms_evolve_skill",
        description: "Phase 4: Evolve a skill using genetic algorithms to improve its success rate or adapt it to new conditions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                skillId: { 
                    type: "string", 
                    description: "ID of the skill to evolve" 
                }
            },
            required: ["skillId"]
        }
    },
    {
        name: "gms_compose_mission",
        description: "Phase 4: Automatically compose a complex mission blueprint by assembling validated skills from the library.",
        inputSchema: {
            type: "object" as const,
            properties: {
                goal: { 
                    type: "string", 
                    description: "Complex goal to achieve through skill composition" 
                }
            },
            required: ["goal"]
        }
    },
    {
        name: "gms_get_status",
        description: "Get the current health and metrics of the GMS engine phases.",
        inputSchema: {
            type: "object" as const,
            properties: {}
        }
    }
];

// Zod schemas for handler validation
export const GMSScoreBlueprintInput = z.object({
    blueprint: z.record(z.any()),
});

export const GMSSynthesizeMissionsInput = z.object({
    request: z.string(),
    nCandidates: z.number().int().positive().max(50).optional().default(15),
    topK: z.number().int().positive().optional().default(5),
    context: z.record(z.any()).optional(),
});

export const GMSShadowValidateInput = z.object({
    candidates: z.array(z.record(z.any())),
    variationsPerCandidate: z.number().optional().default(5),
    isolationLevel: z.enum(["process", "container", "vm"]).optional().default("process"),
});

export const GMSFindSkillsInput = z.object({
    query: z.string(),
    limit: z.number().optional().default(5),
    requiredTags: z.array(z.string()).optional(),
});

export const GMSEvolveSkillInput = z.object({
    skillId: z.string(),
});

export const GMSComposeMissionInput = z.object({
    goal: z.string(),
});

export const GMSGetStatusInput = z.object({});
