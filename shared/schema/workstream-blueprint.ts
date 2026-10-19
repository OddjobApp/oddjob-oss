
import { z } from "zod";

export const workstreamNodeSchema = z.discriminatedUnion("type", [
    z.object({
        id: z.string(),
        type: z.literal("agent"),
        role: z.string(),
        suggestedConfig: z.object({
            goal: z.string(),
            systemPrompt: z.string(),
            allowedTools: z.array(z.string()).optional(),
            topicIds: z.array(z.number()).optional(),
            datasetIds: z.array(z.number()).optional(),
        })
    }),
    z.object({
        id: z.string(),
        type: z.literal("modifier"),
        modifierType: z.enum(["Decision Branch", "Condition Barrier", "Iterator", "Transformer"]),
        config: z.record(z.any())
    }),
    z.object({
        id: z.string(),
        type: z.literal("dataset"),
        name: z.string(),
        description: z.string().optional()
    })
]);

export const workstreamEdgeSchema = z.object({
    from: z.string(),
    to: z.string(),
    condition: z.string().optional()
});

export const workstreamTriggerSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("Manual") }),
    z.object({
        type: z.literal("Schedule"),
        pattern: z.string(), // e.g., "Daily", "Weekly"
        cron: z.string().optional()
    }),
    z.object({
        type: z.literal("Webhook"),
        eventType: z.string()
    })
]);

export const workstreamBlueprintSchema = z.object({
    name: z.string(),
    objective: z.string(),
    workflow: z.object({
        trigger: workstreamTriggerSchema.optional(),
        nodes: z.array(workstreamNodeSchema),
        edges: z.array(workstreamEdgeSchema)
    })
});

export type WorkstreamBlueprint = z.infer<typeof workstreamBlueprintSchema>;



