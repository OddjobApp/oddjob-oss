#!/usr/bin/env node
/**
 * Oddjob MCP Server
 * 
 * Model Context Protocol server that exposes Oddjob's capabilities
 * to AI clients like Claude Desktop, Cursor, and other MCP-compatible tools.
 * 
 * Usage:
 *   npm run mcp
 *   
 * Or with Claude Desktop:
 *   Add to ~/.claude/claude_desktop_config.json
 *   
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   ODDJOB_ORG_ID - Organization ID to use (default: 1)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import tool definitions
import { knowledgeGraphToolDefinitions } from "./tools/knowledge-graph.js";
import { pipelineToolDefinitions } from "./tools/pipelines.js";
import { documentToolDefinitions } from "./tools/documents.js";
import { documentationToolDefinitions } from "./tools/documentation.js";
import { knowledgePackToolDefinitions } from "./tools/knowledge-packs.js";
import { jobToolDefinitions } from "./tools/jobs.js";
import { ephemeralToolDefinitions } from "./tools/ephemeral.js";
import { appForgeToolDefinitions } from "./tools/app-forge.js";
import { saasToolDefinitions } from "./tools/saas.js";
import { systemToolDefinitions } from "./tools/system.js";
import { emailToolDefinitions } from "./tools/email.js";
import { queryBuilderToolDefinitions } from "./tools/query-builder.js";
import { platformStructureToolDefinitions } from "./tools/platform-structure.js";
import { governorToolDefinitions } from "./tools/governor.js";
import { messagingToolDefinitions } from "./tools/messaging.js";
import { datasetToolDefinitions } from "./tools/datasets.js";
import { scheduleToolDefinitions } from "./tools/schedules.js";
import { discoveryToolDefinitions } from "./tools/discovery.js";
import { missionToolDefinitions } from "./tools/missions.js";
import { hilFormToolDefinitions } from "./tools/hil.js";
import { agentMailToolDefinitions } from "./tools/agentmail.js";
import { templateToolDefinitions } from "./tools/templates.js";
import { antigravityToolDefinitions } from "./tools/antigravity.js";
import { gmsToolDefinitions } from "./tools/gms.js";
import { cycleToolDefinitions } from "./tools/cycles.js";
import { predictionToolDefinitions } from "./tools/prediction.js";
import { trycuaToolDefinitions } from "./tools/trycua.js";


// Import handlers
import { handleToolCall } from "./handlers.js";

// Import database
import { db } from "@server/database_service.js";
import {
    knowledgeNodes,
    pipelines,
    knowledgeDocuments,
    graphSchemaDefs,
    contactIntentStates,
    systemSettings
} from "@shared/schema/index.js";
import { and, eq, sql } from "drizzle-orm";

const SERVER_NAME = "oddjob-mcp";
const SERVER_VERSION = "1.0.0";

// Get organization ID from environment or use default
const getOrgId = (): number => {
    return parseInt(process.env.ODDJOB_ORG_ID || "1", 10);
};

// ============================================================================
// RESOURCE DEFINITIONS
// ============================================================================

const resourceDefinitions = [
    {
        uri: "oddjob://knowledge/nodes",
        name: "Knowledge Graph Nodes",
        description: "List of all entities in the knowledge graph with their types and properties",
        mimeType: "application/json",
    },
    {
        uri: "oddjob://knowledge/schemas",
        name: "Graph Schema Definitions",
        description: "Entity types and relationship definitions configured in the system",
        mimeType: "application/json",
    },
    {
        uri: "oddjob://knowledge/statistics",
        name: "Knowledge Graph Statistics",
        description: "Summary statistics about entities and relationships",
        mimeType: "application/json",
    },
    {
        uri: "oddjob://pipelines",
        name: "Automation Pipelines",
        description: "List of all configured automation pipelines",
        mimeType: "application/json",
    },
    {
        uri: "oddjob://documents",
        name: "Knowledge Documents",
        description: "Documents stored in the RAG knowledge store",
        mimeType: "application/json",
    },
    {
        uri: "oddjob://saas/connectors",
        name: "SaaS Connectors",
        description: "Live status and configuration of all SaaS integrations",
        mimeType: "application/json",
    },
    {
        uri: "oddjob://assistant/info",
        name: "Oddjob Assistant Information",
        description: "Configuration and identity of the Oddjob Assistant",
        mimeType: "application/json",
    },
];

// ============================================================================
// PROMPT DEFINITIONS
// ============================================================================

const promptDefinitions = [
    {
        name: "knowledge_analyst",
        description: "Analyze the organization's knowledge graph to find entities, relationships, and dependencies",
        arguments: [
            {
                name: "question",
                description: "Question about the knowledge graph (e.g., 'What services depend on the database?')",
                required: true,
            },
        ],
    },
    {
        name: "pipeline_operator",
        description: "Help manage and operate automation pipelines - list, run, or check status",
        arguments: [
            {
                name: "task",
                description: "What you want to do with pipelines (e.g., 'list all active pipelines', 'run the daily sync')",
                required: true,
            },
        ],
    },
    {
        name: "document_search",
        description: "Search through documentation and knowledge base to answer questions",
        arguments: [
            {
                name: "question",
                description: "Question to answer from documents",
                required: true,
            },
        ],
    },
    {
        name: "impact_analysis",
        description: "Analyze the impact of changes to a specific entity in the knowledge graph",
        arguments: [
            {
                name: "entity_name",
                description: "Name of the entity to analyze (e.g., 'Payment Service', 'User Database')",
                required: true,
            },
            {
                name: "change_type",
                description: "Type of change being considered (e.g., 'deprecation', 'upgrade', 'removal')",
                required: false,
            },
        ],
    },
    {
        name: "data_analyst",
        description: "Analyze structured data within datasets to find patterns, summaries, and specific entries",
        arguments: [
            {
                name: "task",
                description: "The data analysis task (e.g., 'Summarize the recent Jira issues in the dataset', 'Find all active subscribers')",
                required: true,
            },
        ],
    },
];

// ============================================================================
// RESOURCE HANDLERS
// ============================================================================

async function readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    const orgId = getOrgId();

    if (uri === "oddjob://ephemeral/state") {
        // Fetch latest intent states for all users in the last 5 minutes
        const recentStates = await db
            .select()
            .from(contactIntentStates)
            .where(and(
                eq(contactIntentStates.organizationId, orgId),
                sql`${contactIntentStates.createdAt} > NOW() - INTERVAL '5 minutes'`,
            ))
            .limit(50);

        return {
            contents: [{
                uri,
                mimeType: "application/json",
                text: JSON.stringify(recentStates, null, 2)
            }]
        };
    }

    if (uri === "oddjob://saas/connectors") {
        const { sidecarFetch } = await import("../integrations/sidecar-client.js");
        const response = await sidecarFetch("/api/saas/connectors", { organizationId: orgId });
        const data = await response.json();
        return {
            contents: [{
                uri,
                mimeType: "application/json",
                text: JSON.stringify(data, null, 2)
            }]
        };
    }

    if (uri === "oddjob://assistant/info") {
        const [settings] = await db
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, "global"));

        const settingsData = (settings?.settingsData || {}) as any;
        const assistantInfo = settingsData.aiDefaults?.copilot || {};

        return {
            contents: [{
                uri,
                mimeType: "application/json",
                text: JSON.stringify(assistantInfo, null, 2)
            }]
        };
    }

    switch (uri) {
        case "oddjob://knowledge/nodes": {
            const nodes = await db
                .select()
                .from(knowledgeNodes)
                .where(eq(knowledgeNodes.organizationId, orgId))
                .limit(200);

            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify(nodes.map(n => ({
                        id: n.id,
                        name: n.name,
                        type: n.label,
                        externalId: n.externalId,
                        properties: n.data,
                    })), null, 2),
                }],
            };
        }

        case "oddjob://knowledge/schemas": {
            const schemas = await db.select().from(graphSchemaDefs).limit(50);
            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify(schemas, null, 2),
                }],
            };
        }

        case "oddjob://knowledge/statistics": {
            const [{ totalNodes }] = await db
                .select({ totalNodes: sql<number>`count(*)` })
                .from(knowledgeNodes)
                .where(eq(knowledgeNodes.organizationId, orgId));

            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify({
                        totalEntities: Number(totalNodes),
                        organizationId: orgId,
                    }, null, 2),
                }],
            };
        }

        case "oddjob://pipelines": {
            const pipelineList = await db
                .select()
                .from(pipelines)
                .where(eq(pipelines.organizationId, orgId))
                .limit(50);

            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify(pipelineList.map(p => ({
                        id: p.id,
                        name: p.name,
                        description: p.description,
                        isActive: p.isActive,
                        triggerType: p.triggerType,
                    })), null, 2),
                }],
            };
        }

        case "oddjob://documents": {
            const docs = await db.select().from(knowledgeDocuments).limit(50);
            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify(docs.map(d => ({
                        id: d.id,
                        title: d.title,
                        sourceType: d.sourceType,
                        createdAt: d.createdAt,
                    })), null, 2),
                }],
            };
        }

        default:
            throw new Error(`Unknown resource: ${uri}`);
    }
}

// ============================================================================
// PROMPT HANDLERS
// ============================================================================

function getPromptMessages(name: string, args: Record<string, string>) {
    switch (name) {
        case "knowledge_analyst":
            return {
                messages: [
                    {
                        role: "user" as const,
                        content: {
                            type: "text" as const,
                            text: `You are a knowledge graph analyst for this organization. Use the search_knowledge_graph, execute_visual_query, and get_entity_impact tools to answer this question about the knowledge graph:

${args.question}

Start by searching for relevant entities with search_knowledge_graph. For complex relationship analysis, multi-hop traversals, or filtered graph queries, use the execute_visual_query tool. Provide a clear, structured answer.`,
                        },
                    },
                ],
            };

        case "pipeline_operator":
            return {
                messages: [
                    {
                        role: "user" as const,
                        content: {
                            type: "text" as const,
                            text: `You are a pipeline operator. Use the pipeline tools (list_pipelines, get_pipeline_details, run_pipeline, get_pipeline_execution_status) to help with this task:

${args.task}

First list available pipelines if needed, then perform the requested action. Always confirm before running pipelines.`,
                        },
                    },
                ],
            };

        case "document_search":
            return {
                messages: [
                    {
                        role: "user" as const,
                        content: {
                            type: "text" as const,
                            text: `Search the document knowledge base to answer this question:

${args.question}

Use the search_documents tool to find relevant information. Cite specific sources in your answer.`,
                        },
                    },
                ],
            };

        case "impact_analysis":
            return {
                messages: [
                    {
                        role: "user" as const,
                        content: {
                            type: "text" as const,
                            text: `Perform an impact analysis for a potential ${args.change_type || "change"} to "${args.entity_name}".

1. First use search_knowledge_graph to find relevant entities
2. If the relationship structure is complex, use execute_visual_query to map the dependencies
3. Use get_entity_impact to analyze specific bottleneck nodes
4. Provide a risk assessment based on what depends on these entities

Be thorough in identifying all affected systems and services.`,
                        },
                    },
                ],
            };

        case "data_analyst":
            return {
                messages: [
                    {
                        role: "user" as const,
                        content: {
                            type: "text" as const,
                            text: `You are a data analyst. Use the dataset tools (list_datasets, get_dataset_details, query_dataset) to help with this task:

${args.task}

1. Start by listing datasets to find the correct one if not specified.
2. Get details of the dataset to understand its schema and sample data.
3. Use query_dataset to retrieve the data needed for analysis.
4. Provide a clear, data-driven response.`,
                        },
                    },
                ],
            };

        default:
            throw new Error(`Unknown prompt: ${name}`);
    }
}

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

async function main() {
    console.error(`[${SERVER_NAME}] Starting MCP server v${SERVER_VERSION}...`);
    console.error(`[${SERVER_NAME}] Organization ID: ${getOrgId()}`);

    const server = new Server(
        {
            name: SERVER_NAME,
            version: SERVER_VERSION,
        },
        {
            capabilities: {
                resources: {},
                tools: {},
                prompts: {},
            },
        }
    );

    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        console.error(`[${SERVER_NAME}] Listing tools...`);
        return {
            tools: [
                ...knowledgeGraphToolDefinitions,
                ...pipelineToolDefinitions,
                ...documentToolDefinitions,
                ...documentationToolDefinitions,
                ...knowledgePackToolDefinitions,
                ...jobToolDefinitions,
                ...ephemeralToolDefinitions,
                ...appForgeToolDefinitions,
                ...saasToolDefinitions,
                ...systemToolDefinitions,
                ...emailToolDefinitions,
                ...queryBuilderToolDefinitions,
                ...platformStructureToolDefinitions,
                ...governorToolDefinitions,
                ...messagingToolDefinitions,
                ...datasetToolDefinitions,
                ...scheduleToolDefinitions,
                ...discoveryToolDefinitions,
                ...missionToolDefinitions,
                ...hilFormToolDefinitions,
                ...agentMailToolDefinitions,
                ...templateToolDefinitions,
                ...antigravityToolDefinitions,
                ...gmsToolDefinitions,
                ...cycleToolDefinitions,
                ...predictionToolDefinitions,
                ...trycuaToolDefinitions,
            ],
        };
    });

    // List available resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        console.error(`[${SERVER_NAME}] Listing resources...`);
        return {
            resources: resourceDefinitions,
        };
    });

    // Read a resource
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        console.error(`[${SERVER_NAME}] Reading resource: ${request.params.uri}`);
        return readResource(request.params.uri);
    });

    // List available prompts
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        console.error(`[${SERVER_NAME}] Listing prompts...`);
        return {
            prompts: promptDefinitions,
        };
    });

    // Get a specific prompt
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        console.error(`[${SERVER_NAME}] Getting prompt: ${request.params.name}`);
        return getPromptMessages(request.params.name, request.params.arguments || {});
    });

    // Execute a tool
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        console.error(`[${SERVER_NAME}] Calling tool: ${request.params.name}`);
        console.error(`[${SERVER_NAME}] Arguments:`, JSON.stringify(request.params.arguments));

        // Stdio has no auth context; pass default org so handlers don't destructure undefined
        const defaultContext = { 
            organizationId: getOrgId(), 
            userId: "mcp-stdio",
            named: {},
            positional: {}
        };
        const result = await handleToolCall(request.params.name, request.params.arguments, defaultContext);

        console.error(`[${SERVER_NAME}] Tool completed`);
        return result;
    });

    // Connect via stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`[${SERVER_NAME}] Server connected and ready`);
}

// Error handling
process.on("uncaughtException", (error) => {
    console.error(`[${SERVER_NAME}] Uncaught exception:`, error);
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    console.error(`[${SERVER_NAME}] Unhandled rejection:`, reason);
    process.exit(1);
});

// Run the server
main().catch((error) => {
    console.error(`[${SERVER_NAME}] Fatal error:`, error);
    process.exit(1);
});

