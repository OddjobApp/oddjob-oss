import { z } from "zod";

export const DEFAULT_BUDGET_LIMIT = 50.00;

/**
 * Mission Context Schema
 * Defines the strict state structure for autonomous missions.
 */
export const MissionContextSchema = z.object({
    phase: z.enum(['PLANNING', 'DEBATING', 'AUDITING', 'EXECUTING', 'CRITIQUING', 'WAITING_FOR_ORDERS', 'REFLECTING', 'PAUSED', 'EXECUTING_LEGACY']),
    appSlug: z.string().optional(),
    latest_wave_output: z.string().optional(),
    vibe_intent: z.string().optional(),
    blueprint: z.any().optional(),
    current_wave: z.number().default(1),
    max_waves: z.number().default(10),
    crew: z.array(z.any()).optional(),
    intent: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
    executionStrategy: z.string().optional(),
    maxDurationMinutes: z.number().optional(),
    // Steering / bookkeeping fields written by the rolling-wave orchestrator between
    // waves. Declared (not just passed through) so they are type-checked at read/write —
    // the untyped `(run as any).audit_critique` read is what silently broke convergence.
    last_criticism: z.string().optional(),
    pendingAttachments: z.array(z.any()).optional(),
    lastUserCommand: z.any().nullable().optional(),
}).passthrough();

export type MissionContext = z.infer<typeof MissionContextSchema>;

/**
 * Mission Wave Blueprint Schema
 * Defines the structure of the AI-generated plan for a single wave.
 */
export const MissionWaveBlueprintSchema = z.object({
    thought_process: z.string().describe("The reasoning behind the current wave strategy"),
    objective: z.string().describe("The specific goal for this wave"),
    vibe_intent: z.string().optional().describe("The aesthetic or qualitative goal"),
    workflow: z.object({
        steps: z.array(z.object({
            tool: z.string().describe("The name of the tool to invoke"),
            arguments: z.any().describe("The arguments for the tool call"),
            note: z.string().optional().describe("Internal note about this step")
        }))
    })
});

export type MissionWaveBlueprint = z.infer<typeof MissionWaveBlueprintSchema>;
