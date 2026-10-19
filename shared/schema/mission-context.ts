
import { z } from "zod";

/**
 * Mach 2: Specialized Rolling Wave Context
 */
export const RollingWaveContextSchema = z.object({
    vibe_intent: z.string().optional(),
    latest_wave_output: z.string().optional(),
    wave_number: z.number().default(0),
    phase: z.enum(["PLANNING", "EXECUTING", "CRITIQUING", "REFLECTING"]).optional(),
    audit_history: z.array(z.object({
        score: z.number(),
        critique: z.string(),
        timestamp: z.string()
    })).default([])
});

/**
 * Schema for the `mission_context` JSONB column in the `missions` table.
 * Tracks high-level objectives, user guidance, and shared state.
 */
export const MissionContextSchema = z.object({
    parent_intent: z.string().optional(),
    
    // Mach 2: Discriminator for specialized orchestration
    strategy_context: RollingWaveContextSchema.optional(),

    // Structured guidance from the user
    lastUserGuidance: z.object({
        content: z.string(),
        timestamp: z.string().datetime(), // ISO 8601
        processed: z.boolean().optional() // Flag to indicate if the supervisor has "seen" this
    }).optional(),

    // High-level summary of previous results
    previous_results: z.record(z.string(), z.any()).optional(),

    // Dynamic context fields
    task_description: z.string().optional(),

    // Shared scratchpad for agents
    scratchpad: z.record(z.string(), z.any()).optional(),

    // System-level error tracking
    last_error: z.object({
        message: z.string(),
        timestamp: z.string().datetime()
    }).optional()
}).catchall(z.any());

export type MissionContext = z.infer<typeof MissionContextSchema>;

/**
 * Schema for the `content` JSONB column in `workgroup_blackboard_history`.
 * Ensures consistent structure for agent updates.
 */
export const BlackboardEntrySchema = z.object({
    // The latest response from an agent to the user/group
    lastAgentResponse: z.object({
        content: z.string(),
        timestamp: z.string().datetime()
    }).optional(),

    // Current objective state
    currentObjective: z.object({
        intent: z.string(),
        status: z.enum(["planning", "active", "waiting", "completed", "failed"]),
        activeAgents: z.array(z.string()).optional()
    }).optional(),

    // Shared knowledge references (IDs of knowledge nodes)
    relevantKnowledge: z.array(z.number()).optional(),

    // Any other dynamic keys
}).catchall(z.any());

export type BlackboardEntry = z.infer<typeof BlackboardEntrySchema>;



