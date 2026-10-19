import { z } from "zod";

/**
 * MISSION MANIFEST SCHEMA (V1)
 * Standardized "Business-as-Code" Exchange Format
 */

export const MissionManifestSchema = z.object({
  manifest_version: z.string().default("1.0.0"),
  
  metadata: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().default("1.0.0"),
    author: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),

  // Agent Archetypes (The Soul definition)
  archetypes: z.array(z.object({
    role: z.string(),
    description: z.string(),
    archetype: z.string().default("professional"), // Reference to existing archetypes
    personality: z.object({
      openness: z.number().min(0).max(1),
      conscientiousness: z.number().min(0).max(1),
      extraversion: z.number().min(0).max(1),
      agreeableness: z.number().min(0).max(1),
      neuroticism: z.number().min(0).max(1),
    }).optional(),
  })),

  // Infrastructure Requirements
  requirements: z.object({
    mcp_servers: z.array(z.string()).default([]),
    required_api_keys: z.array(z.string()).default([]),
    min_model_capability: z.enum(["flash", "pro", "ultra"]).default("flash"),
  }),

  // Mission Logic
  logic: z.object({
    objective: z.string(),
    reasoning_protocol: z.enum(["json_manifest", "collaborative_swarm", "sequential_chain"]),
    execution_strategy: z.enum(["pre_planned", "autonomous_discovery"]).default("pre_planned"),
  }),

  // Initial State Seed
  initial_blackboard: z.record(z.any()).default({}),
});

export type MissionManifest = z.infer<typeof MissionManifestSchema>;
