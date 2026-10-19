
import { z } from "zod";
import { VisualQueryNodeSchema, VisualQueryRelationshipSchema } from "./query-builder.js";

export const queryPlatformStructureToolDefinition = {
    name: "query_platform_structure",
    description: "Execute a structured graph query against Oddjob's INTERNAL architecture and technical structure. Use this to find paths and connections between services, pages, components, and API routes. Relationships include 'NAVIGATES_TO' (UI flow), 'USES_COMPONENT' (composition), 'calls' (API -> Service), and 'uses_schema' (Service -> DB).",
    inputSchema: {
        type: "object" as const,
        properties: {
            nodes: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        label: { type: "string", description: "Label of the node (Service, Page, Component, API_Route, Schema_Model)" },
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

export const searchPlatformNodesToolDefinition = {
    name: "search_platform_nodes",
    description: "Search for technical entities (Pages, Components, Services, API Routes) in Oddjob's internal structure by name or keyword. Use this FIRST if you don't know the exact names of the components you want to query in query_platform_structure.",
    inputSchema: {
        type: "object" as const,
        properties: {
            query: { type: "string", description: "Keyword to search for (e.g. 'Integrations', 'SaaS', 'Connector', 'Auth')" },
            label: { type: "string", description: "Optional filter by type (Page, Component, Service, API_Route)" },
            limit: { type: "number", default: 20 }
        },
        required: ["query"]
    }
};

export const platformStructureToolDefinitions = [
    queryPlatformStructureToolDefinition,
    searchPlatformNodesToolDefinition
];

