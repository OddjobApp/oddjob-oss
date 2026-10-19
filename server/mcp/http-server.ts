#!/usr/bin/env node
/**
 * Oddjob MCP HTTP Server
 * 
 * HTTP/SSE transport for the Model Context Protocol server.
 * Allows remote clients like Onyx AI to connect to Oddjob's MCP capabilities.
 * 
 * Security:
 *   - Application-level gate: MCP_HTTP_ENABLED env var (default: true)
 *   - Authentication: Bearer token via Authorization header
 *   - Org-level toggle: mcpHttpEnabled in org_settings (default: false)
 *   - Per-tool permissions: All off by default until granted
 * 
 * Usage:
 *   npm run mcp:http
 *   
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   MCP_HTTP_PORT - Port to listen on (default: 3001)
 *   MCP_HTTP_ENABLED - Global kill switch (default: true, set to "false" to disable)
 *   MCP_SECRET - Secret for token hashing (required in production)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
import cors from "cors";

// Import tool definitions
import { knowledgeGraphToolDefinitions } from "./tools/knowledge-graph.js";
import { pipelineToolDefinitions } from "./tools/pipelines.js";
import { documentToolDefinitions } from "./tools/documents.js";
import { documentationToolDefinitions } from "./tools/documentation.js";
import { knowledgePackToolDefinitions } from "./tools/knowledge-packs.js";
import { jobToolDefinitions } from "./tools/jobs.js";
import { ephemeralToolDefinitions } from "./tools/ephemeral.js";
import { appForgeToolDefinitions } from "./tools/app-forge.js";
import { missionToolDefinitions } from "./tools/missions.js";
import { discoveryToolDefinitions } from "./tools/discovery.js";
import { scheduleToolDefinitions } from "./tools/schedules.js";

// Import handlers
import { handleToolCall } from "./handlers.js";
import { errorResponse, type ToolContext } from "./handlers/utils.js";

// Import authentication
import {
    mcpGlobalGate,
    mcpAuthMiddleware,
    mcpOrgGate,
    isMcpHttpGloballyEnabled,
    checkToolPermission,
    McpAuthorizationState,
} from "./auth.js";
import { McpPermission } from "@shared/schema/index.js";

// Import database
import { db } from "@server/database_service.js";
import { knowledgeNodes, pipelines, knowledgeDocuments, graphSchemaDefs, contactIntentStates } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const SERVER_NAME = "oddjob-mcp-http";
const SERVER_VERSION = "1.0.0";
const logger = createLogger("McpHttpServer");
const DEFAULT_PORT = 3001;

// Store auth context per session for use in tool handlers
const sessionAuthContexts: Map<string, McpAuthorizationState> = new Map();

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
                description: "The question to analyze about the knowledge graph",
                required: true,
            },
        ],
    },
    {
        name: "pipeline_operator",
        description: "Manage and operate automation pipelines - list, run, and monitor pipeline executions",
        arguments: [
            {
                name: "action",
                description: "The action to perform: 'list', 'run', 'status'",
                required: true,
            },
            {
                name: "pipeline_id",
                description: "Pipeline ID for 'run' or 'status' actions",
                required: false,
            },
        ],
    },
    {
        name: "document_search",
        description: "Search through knowledge documents using semantic search",
        arguments: [
            {
                name: "query",
                description: "The search query",
                required: true,
            },
        ],
    },
    {
        name: "impact_analysis",
        description: "Analyze the impact of changes to an entity in the knowledge graph",
        arguments: [
            {
                name: "entity_name",
                description: "The name of the entity to analyze",
                required: true,
            },
        ],
    },
];

// ============================================================================
// PROMPT MESSAGE GENERATORS
// ============================================================================

function getPromptMessages(promptName: string, args: Record<string, string>) {
    switch (promptName) {
        case "knowledge_analyst":
            return {
                messages: [
                    {
                        role: "user" as const,
                        content: {
                            type: "text" as const,
                            text: `You are a knowledge graph analyst. Use the available tools to answer: ${args.question}

Available tools:
- search_knowledge_graph: Search for entities by name and type
- get_entity_impact: Analyze dependencies of an entity  
- get_graph_statistics: Get summary statistics

First search for relevant entities, then explore their relationships.`,
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
                            text: `You are a pipeline operator. Action: ${args.action}${args.pipeline_id ? `, Pipeline ID: ${args.pipeline_id}` : ''}

Available tools:
- list_pipelines: List all pipelines
- get_pipeline_details: Get details of a specific pipeline
- run_pipeline: Execute a pipeline
- get_pipeline_execution_status: Check execution status`,
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
                            text: `Search the knowledge documents for: ${args.query}

Use the search_documents tool to find relevant content, then summarize findings.`,
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
                            text: `Analyze the impact of changes to: ${args.entity_name}

1. First use search_knowledge_graph to find the entity
2. Then use get_entity_impact to find all dependencies
3. Summarize what would be affected by changes`,
                        },
                    },
                ],
            };
        default:
            throw new Error(`Unknown prompt: ${promptName}`);
    }
}

// ============================================================================
// RESOURCE HANDLERS
// ============================================================================

async function handleReadResource(uri: string, orgId: number): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {

    switch (uri) {
        case "oddjob://knowledge/nodes": {
            const nodes = await db
                .select({
                    id: knowledgeNodes.id,
                    name: knowledgeNodes.name,
                    label: knowledgeNodes.label,
                    data: knowledgeNodes.data,
                })
                .from(knowledgeNodes)
                .where(eq(knowledgeNodes.organizationId, orgId))
                .limit(1000);
            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify(nodes, null, 2),
                }],
            };
        }
        case "oddjob://knowledge/schemas": {
            const schemas = await db
                .select()
                .from(graphSchemaDefs)
                .where(eq(graphSchemaDefs.organizationId, orgId));
            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify(schemas, null, 2),
                }],
            };
        }
        case "oddjob://knowledge/statistics": {
            const nodeCount = await db
                .select({ count: sql<number>`count(*)` })
                .from(knowledgeNodes)
                .where(eq(knowledgeNodes.organizationId, orgId));
            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify({
                        nodeCount: nodeCount[0]?.count || 0,
                    }, null, 2),
                }],
            };
        }
        case "oddjob://pipelines": {
            const pipelineList = await db
                .select({
                    id: pipelines.id,
                    name: pipelines.name,
                    description: pipelines.description,
                    isActive: pipelines.isActive,
                })
                .from(pipelines)
                .where(eq(pipelines.organizationId, orgId));
            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify(pipelineList, null, 2),
                }],
            };
        }
        case "oddjob://documents": {
            const docs = await db
                .select({
                    id: knowledgeDocuments.id,
                    title: knowledgeDocuments.title,
                    url: knowledgeDocuments.url,
                })
                .from(knowledgeDocuments)
                .where(eq(knowledgeDocuments.organizationId, orgId))
                .limit(100);
            return {
                contents: [{
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify(docs, null, 2),
                }],
            };
        }
        default:
            throw new Error(`Unknown resource: ${uri}`);
    }
}

// ============================================================================
// HTTP SERVER
// ============================================================================

// Store active transports for session management
const activeTransports: Map<string, SSEServerTransport> = new Map();

async function createMCPServer(sessionId: string): Promise<Server> {
    const allTools = [
        ...knowledgeGraphToolDefinitions,
        ...pipelineToolDefinitions,
        ...documentToolDefinitions,
        ...documentationToolDefinitions,
        ...knowledgePackToolDefinitions,
        ...jobToolDefinitions,
        ...ephemeralToolDefinitions,
        ...appForgeToolDefinitions,
        ...missionToolDefinitions,
        ...discoveryToolDefinitions,
        ...scheduleToolDefinitions,
    ];

    const server = new Server(
        {
            name: SERVER_NAME,
            version: SERVER_VERSION,
        },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
            },
        }
    );

    // List available tools (filtered by permissions)
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const authContext = sessionAuthContexts.get(sessionId);
        if (!authContext) {
            // Unauthenticated - return empty list
            return { tools: [] };
        }

        // Filter tools based on user permissions
        const allowedTools = allTools.filter(tool =>
            checkToolPermission(tool.name, authContext.permissions)
        );

        return { tools: allowedTools };
    });

    // List available resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return { resources: resourceDefinitions };
    });

    // Read a resource
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const authContext = sessionAuthContexts.get(sessionId);
        if (!authContext) {
            throw new Error("Authentication required");
        }
        return handleReadResource(request.params.uri, authContext.organizationId);
    });

    // List prompts
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return { prompts: promptDefinitions };
    });

    // Get a specific prompt
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        return getPromptMessages(request.params.name, request.params.arguments || {});
    });

    // Execute a tool (with permission check)
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const authContext = sessionAuthContexts.get(sessionId);

        if (!authContext) {
            return {
                content: [{ type: "text", text: "Error: Authentication required" }],
                isError: true,
            };
        }

        // Check permission for this tool
        const toolName = request.params.name;
        if (!checkToolPermission(toolName, authContext.permissions)) {
            logger.warn("MCP tool permission denied", { toolName, userId: authContext.userId });
            return {
                content: [{
                    type: "text",
                    text: `Permission denied: You do not have access to the "${toolName}" tool. Contact your administrator to request access.`
                }],
                isError: true,
            };
        }

        logger.info("Calling MCP tool", {
            toolName,
            userId: authContext.userId,
            organizationId: authContext.organizationId,
        });

        // Extract organization context for the tool handler
        const toolContext: ToolContext = {
            organizationId: authContext.organizationId,
            userId: authContext.userId,
            allowedTopicIds: authContext.allowedTopicIds,
            allowedDatasetIds: authContext.allowedDatasetIds,
            allowedPipelineIds: authContext.allowedPipelineIds,
            permissions: authContext.permissions,
            // Required (non-optional) by ToolContext, which doubles as the
            // pipeline executor's context: these two are its step-output bag,
            // keyed by outputName and step order for variable resolution. A
            // direct MCP call has no prior steps, so both are empty -- the same
            // `named: {}, positional: {}` every other non-pipeline caller uses.
            named: {},
            positional: {},
        };

        const result = await handleToolCall(toolName, request.params.arguments, toolContext);

        logger.debug("MCP tool completed", { toolName });
        return result;
    });

    return server;
}

async function main() {
    const port = parseInt(process.env.MCP_HTTP_PORT || String(DEFAULT_PORT), 10);

    const app = express();

    // Enable CORS for cross-origin requests
    app.use(cors({
        origin: true, // Allow all origins in development
        credentials: true,
    }));

    app.use(express.json());

    // Health check endpoint (public, no auth)
    app.get("/health", (req: Request, res: Response) => {
        res.json({
            status: "ok",
            server: SERVER_NAME,
            version: SERVER_VERSION,
            transport: "sse",
            authRequired: true,
            globallyEnabled: isMcpHttpGloballyEnabled(),
        });
    });

    // SSE endpoint for MCP connections (with authentication)
    app.get("/sse", mcpGlobalGate, mcpAuthMiddleware, mcpOrgGate, async (req: Request, res: Response) => {
        const authContext = req.mcpAuth!;
        logger.info("Authenticated MCP connection opened", {
            userId: authContext.userId,
            organizationId: authContext.organizationId,
        });

        // Generate session ID
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store auth context for this session
        sessionAuthContexts.set(sessionId, authContext);

        // Create a new MCP server instance for this connection
        const server = await createMCPServer(sessionId);

        // Create SSE transport
        const transport = new SSEServerTransport("/message", res);
        activeTransports.set(sessionId, transport);

        logger.debug("MCP session created", { permissionCount: authContext.permissions.length });

        // Handle connection close
        res.on("close", () => {
            logger.debug("MCP connection closed");
            activeTransports.delete(sessionId);
            sessionAuthContexts.delete(sessionId);
        });

        // Connect server to transport
        await server.connect(transport);
    });

    // Message endpoint for client-to-server messages (with authentication)
    app.post("/message", mcpGlobalGate, mcpAuthMiddleware, mcpOrgGate, async (req: Request, res: Response) => {
        logger.debug("MCP message received", { userId: req.mcpAuth?.userId });

        // Find the transport for this session (simplified - in production use session management)
        const transports = Array.from(activeTransports.values());
        if (transports.length === 0) {
            res.status(400).json({ error: "No active SSE connection" });
            return;
        }

        // Use the most recent transport
        const transport = transports[transports.length - 1];

        try {
            await transport.handlePostMessage(req, res);
        } catch (error) {
            console.error(`[${SERVER_NAME}] Error handling message:`, error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    // Start the server
    app.listen(port, () => {
        console.log(`[${SERVER_NAME}] HTTP/SSE MCP Server running on http://localhost:${port}`);
        console.log(`[${SERVER_NAME}] Health check: http://localhost:${port}/health`);
        console.log(`[${SERVER_NAME}] SSE endpoint: http://localhost:${port}/sse`);
        console.log(`[${SERVER_NAME}] Message endpoint: http://localhost:${port}/message`);
    });
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

