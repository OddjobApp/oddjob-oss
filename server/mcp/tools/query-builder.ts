
import { z } from "zod";

export const VisualQueryNodeSchema = z.object({
    id: z.string(),
    label: z.string(),
    alias: z.string().optional(),
    filters: z.array(z.object({
        property: z.string(),
        operator: z.enum(['=', '!=', '>', '<', '>=', '<=', 'contains', 'starts_with', 'ends_with']),
        value: z.any(),
        logicalOperator: z.enum(['AND', 'OR']).optional(),
    })).optional(),
});

export const VisualQueryRelationshipSchema = z.object({
    id: z.string(),
    type: z.string(),
    sourceNodeId: z.string(),
    targetNodeId: z.string(),
    direction: z.enum(['outgoing', 'incoming', 'both']),
    minHops: z.number().optional(),
    maxHops: z.number().optional(),
    filters: z.array(z.object({
        property: z.string(),
        operator: z.string(),
        value: z.any(),
    })).optional(),
});

export const VisualQuerySchema = z.object({
    nodes: z.array(VisualQueryNodeSchema),
    relationships: z.array(VisualQueryRelationshipSchema),
    returnClause: z.object({
        items: z.array(z.object({
            type: z.enum(['node', 'relationship', 'property', 'path']),
            id: z.string().optional(),
            property: z.string().optional(),
        })),
    }).optional(),
    limit: z.number().optional().default(50),
    orderBy: z.array(z.object({
        property: z.string(),
        direction: z.enum(['ASC', 'DESC']),
    })).optional(),
});

export const executeVisualQueryToolDefinition = {
    name: "execute_visual_query",
    description: "Execute a structured graph query against the knowledge graph. Allows for complex multi-hop relationship traversal, filtering on properties, and returning specific nodes or paths. Use this for deep relationship analysis that simple search cannot handle.",
    inputSchema: {
        type: "object" as const,
        properties: {
            nodes: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        label: { type: "string", description: "Label of the node to match (e.g. 'Person', 'Service')" },
                        alias: { type: "string" },
                        filters: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    property: { type: "string" },
                                    operator: { type: "string" },
                                    value: { type: "any" }
                                }
                            }
                        }
                    },
                    required: ["id", "label"]
                }
            },
            relationships: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        type: { type: "string" },
                        sourceNodeId: { type: "string" },
                        targetNodeId: { type: "string" },
                        direction: { type: "string", enum: ["outgoing", "incoming", "both"] }
                    },
                    required: ["id", "type", "sourceNodeId", "targetNodeId", "direction"]
                }
            },
            limit: { type: "number", default: 50 }
        },
        required: ["nodes", "relationships"]
    }
};

export const queryBuilderToolDefinitions = [
    executeVisualQueryToolDefinition
];

