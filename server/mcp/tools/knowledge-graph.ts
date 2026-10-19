/**
 * Oddjob MCP Server - Knowledge Graph Tools
 * 
 * Exposes tools for querying and manipulating the knowledge graph
 * through the Model Context Protocol.
 */

import { z } from "zod";

// Tool definitions for MCP
export const knowledgeGraphToolDefinitions = [
    {
        name: "search_knowledge_graph",
        description: "Search the knowledge graph for entities and their relationships. Can filter by entity type (label) and search within entity names or properties. Use this to find entities, understand connections, and explore the organization's knowledge base.",
        inputSchema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "Search query to find matching entities (e.g., 'Payment Service', 'User authentication')",
                },
                entityType: {
                    type: "string",
                    description: "Optional: Filter by entity type (e.g., 'Ticket', 'User', 'Component', 'Infrastructure')",
                },
                includeRelationships: {
                    type: "boolean",
                    description: "Whether to include connected entities and their relationships. Default: true",
                },
                limit: {
                    type: "number",
                    description: "Maximum results to return. Default: 20, Max: 100",
                },
            },
            required: [],
        },
    },
    {
        name: "get_entity_impact",
        description: "Analyze what entities depend on or are affected by a given entity. Useful for impact analysis before making changes to systems, understanding dependencies, and risk assessment.",
        inputSchema: {
            type: "object" as const,
            properties: {
                entityName: {
                    type: "string",
                    description: "Name of the entity to analyze (e.g., 'Payment Service', 'Database Cluster A')",
                },
                entityType: {
                    type: "string",
                    description: "Optional: Type of the entity to help disambiguate if multiple entities have the same name",
                },
                direction: {
                    type: "string",
                    enum: ["inbound", "outbound", "both"],
                    description: "Direction of relationships to analyze. 'inbound' = what depends on this, 'outbound' = what this depends on, 'both' = all connections. Default: 'both'",
                },
            },
            required: ["entityName"],
        },
    },
    {
        name: "create_entity",
        description: "Create a new entity in the knowledge graph. Use this to add new components, services, users, or any other entity type to the organization's knowledge base.",
        inputSchema: {
            type: "object" as const,
            properties: {
                name: {
                    type: "string",
                    description: "Entity name (e.g., 'New Payment Gateway', 'User: John Doe')",
                },
                entityType: {
                    type: "string",
                    description: "Entity type/label (e.g., 'Component', 'Service', 'User', 'Infrastructure')",
                },
                properties: {
                    type: "object",
                    description: "Additional properties for the entity as key-value pairs",
                },
                externalId: {
                    type: "string",
                    description: "Optional external reference ID (e.g., JIRA ticket ID, GitHub repo name)",
                },
            },
            required: ["name", "entityType"],
        },
    },
    {
        name: "create_relationship",
        description: "Create a relationship (edge) between two entities in the knowledge graph.",
        inputSchema: {
            type: "object" as const,
            properties: {
                sourceEntityName: {
                    type: "string",
                    description: "Name of the source entity",
                },
                targetEntityName: {
                    type: "string",
                    description: "Name of the target entity",
                },
                relationType: {
                    type: "string",
                    description: "Type of relationship (e.g., 'DEPENDS_ON', 'OWNS', 'MAINTAINS', 'RELATED_TO')",
                },
            },
            required: ["sourceEntityName", "targetEntityName", "relationType"],
        },
    },
    {
        name: "suggest_schema",
        description: "Generate a knowledge graph ontology (schema) from a domain description using AI. Useful when setting up a new knowledge domain or expanding the existing graph structure.",
        inputSchema: {
            type: "object" as const,
            properties: {
                domainDescription: {
                    type: "string",
                    description: "Natural language description of the domain to model (e.g., 'E-commerce platform with products, orders, customers, and inventory management')",
                },
            },
            required: ["domainDescription"],
        },
    },
    {
        name: "explore_relationships",
        description: "Traverse the knowledge graph from a starting entity to explore its connections. Unlike get_entity_impact, this tool offers flexible depth and direction traversal to 'walk' the graph.",
        inputSchema: {
            type: "object" as const,
            properties: {
                entityName: {
                    type: "string",
                    description: "Name of the starting entity",
                },
                depth: {
                    type: "number",
                    description: "Traversal depth (1-3). Default: 1",
                },
                direction: {
                    type: "string",
                    enum: ["inbound", "outbound", "both"],
                    description: "Direction to traverse. Default: 'both'",
                },
                relations: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional: Filter by specific relationship types (e.g. ['DEPENDS_ON'])",
                }
            },
            required: ["entityName"],
        },
    },
    {
        name: "get_graph_statistics",
        description: "Get summary statistics about the knowledge graph including entity counts by type, relationship counts, and recent activity.",
        inputSchema: {
            type: "object" as const,
            properties: {},
        },
    },
    {
        name: "prune_knowledge",
        description: "Autonomously archive stale or low-utility knowledge nodes from the graph to improve retrieval precision and reduce noise. Use this when the maturity dashboard indicates high noise or low average utility.",
        inputSchema: {
            type: "object" as const,
            properties: {
                threshold: {
                    type: "number",
                    description: "Utility threshold (0-100). Nodes below this score will be pruned. Default: 10.0",
                },
            },
            required: [],
        },
    },
    {
        name: "detect_knowledge_gaps",
        description: "Analyze the current knowledge graph to identify missing domain information (intelligence gaps) and proactively propose research missions to fill them. Use this to maintain a cutting-edge knowledge base.",
        inputSchema: {
            type: "object" as const,
            properties: {
                seedNodeIds: {
                    type: "array",
                    items: { type: "number" },
                    description: "Optional: Specific node IDs to use as seeds for gap detection. If empty, uses the most active nodes.",
                },
            },
            required: [],
        },
    },
];

// Input validation schemas
export const SearchKnowledgeGraphInput = z.object({
    query: z.string().optional(),
    entityType: z.string().optional(),
    includeRelationships: z.boolean().default(true),
    limit: z.number().min(1).max(100).default(20),
});

export const GetEntityImpactInput = z.object({
    entityName: z.string().min(1),
    entityType: z.string().optional(),
    direction: z.enum(["inbound", "outbound", "both"]).default("both"),
});

export const ExploreRelationshipsInput = z.object({
    entityName: z.string().min(1),
    depth: z.number().min(1).max(3).default(1),
    direction: z.enum(["inbound", "outbound", "both"]).default("both"),
    relations: z.array(z.string()).optional(),
});

export const CreateEntityInput = z.object({
    name: z.string().min(1),
    entityType: z.string().min(1),
    properties: z.record(z.any()).optional(),
    externalId: z.string().optional(),
});

export const CreateRelationshipInput = z.object({
    sourceEntityName: z.string().min(1),
    targetEntityName: z.string().min(1),
    relationType: z.string().min(1),
});

export const SuggestSchemaInput = z.object({
    domainDescription: z.string().min(10),
});

export const PruneKnowledgeInput = z.object({
    threshold: z.number().min(0).max(100).default(10.0),
});

export const DetectKnowledgeGapsInput = z.object({
    seedNodeIds: z.array(z.number()).optional(),
});

