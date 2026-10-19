import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { db } from "@server/database_service.js";
import { mcpServers, type McpServer } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { ToolDefinition, ToolContext } from "../../tools/v1/capabilities/types.js";
import { logForensicEvent, getMonotonicTimeNs } from "../../core/infrastructure/tracing/trace-logger.service.js";
import { withCircuitBreaker, createCircuitBreaker, getCircuitState } from "../../core/infrastructure/circuit-breaker.service.js";
import { integrationTelemetryService } from "../../governance/core/integration-telemetry.service.js";
import { z } from "zod";

const logger = createLogger("McpClientService");

/**
 * Validates MCP commands against shell injection, privilege escalation, and path traversal patterns.
 */
export function validateMcpCommand(command: string, args: string[] = []): void {
    const fullCommandLine = [command, ...args].join(" ");
    const dangerousPatterns = [
        /\b(sudo|su|runas|doas|pkexec)\b/i,
        /[;&|`$\r\n]/, // Command chaining, subshell, or control characters
        /\b(rm(\.exe)?\s+(-[rfRF]+|--recursive)|format|mkfs|dd)\b/i,
        /\b(chmod|chown)\b/i,
        /\b(curl|wget)\s+.*\|\s*(sh|bash)\b/i,
        /(\.\.[\/\\]|^\/etc\/|^\/root\/|^\/proc\/|^\/sys\/|^[A-Za-z]:\\(Windows|System32))/i, // Path traversal and system directories
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(fullCommandLine) || pattern.test(command) || args.some(arg => pattern.test(arg))) {
            throw new Error(`Security validation failed: Executable command or argument contains forbidden shell pattern.`);
        }
    }
}

/**
 * Validates and sanitizes dynamic tool call arguments before dispatching to an MCP client.
 */
export function validateToolCallArguments(toolName: string, args: any): void {
    if (!args || typeof args !== "object") return;

    let serialized: string;
    try {
        serialized = JSON.stringify(args);
    } catch {
        throw new Error(`Security validation failed for tool "${toolName}": Non-serializable arguments payload.`);
    }

    if (serialized.includes("\\u0000") || serialized.includes("\0")) {
        throw new Error(`Security validation failed for tool "${toolName}": Null byte detected in parameter.`);
    }

    if (/"(__proto__|constructor|prototype)"\s*:/i.test(serialized)) {
        throw new Error(`Security validation failed for tool "${toolName}": Forbidden object prototype key in payload.`);
    }
}

/**
 * Wraps stdio command with Docker container sandbox if sandboxing is enabled.
 */
export function sandboxMcpCommand(command: string, args: string[], env: Record<string, string>): { command: string; args: string[] } {
    const sandboxEnabled = process.env.MCP_SANDBOX_ENABLED === "true";
    if (!sandboxEnabled) {
        return { command, args };
    }

    logger.info(`[MCPSandbox] Wrapping command "${command}" in a secure Docker sandbox container...`);
    
    const dockerArgs = [
        "run",
        "--rm",
        "-i", // Keep STDIN open for stdio communication
        "--network", "none", // Disable network access for security
        "--memory", "512m",  // Limit memory
        "--cpus", "0.5",     // Limit CPU
        "--user", "1000:1000", // Run as non-root
    ];

    // Inject env variables to docker run
    for (const [key, value] of Object.entries(env)) {
        dockerArgs.push("-e", `${key}=${value}`);
    }

    // Determine the base image based on the command
    let image = "node:20-alpine";
    if (command.includes("python") || command.includes("pip")) {
        image = "python:3.11-alpine";
    }

    dockerArgs.push(image);
    dockerArgs.push(command);
    dockerArgs.push(...args);

    return {
        command: "docker",
        args: dockerArgs
    };
}

interface ActiveConnection {
    client: Client;
    transport: StdioClientTransport | SSEClientTransport;
    server: McpServer;
    tools: ToolDefinition[];
    lastHeartbeat: Date;
}

export const mcpClientService = {
    _connections: new Map<number, ActiveConnection>(),
    async initialize() {
        logger.info("Initializing MCP Client Service...");
        const activeServers = await db.select().from(mcpServers).where(eq(mcpServers.status, "active"));
        for (const server of activeServers) {
            try {
                await this.connect(server.id);
            } catch (error) {
                logger.error(`Failed to initialize MCP server ${server.name} (${server.id}):`, error);
                await this.updateStatus(server.id, "error", String(error));
            }
        }
    },

    async connect(serverId: number): Promise<void> {
        const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId));
        if (!server) throw new Error(`MCP Server ${serverId} not found`);
        if (this._connections.has(serverId)) await this.disconnect(serverId);
        logger.info(`Connecting to MCP server: ${server.name} (${server.transport})`);
        try {
            let transport;
            if (server.transport === "stdio") {
                if (!server.command) throw new Error("Command required for stdio transport");
                const args = server.args || [];
                
                // 1. Run security validation guard
                validateMcpCommand(server.command, args);
                
                const env = { ...process.env, ...(server.env || {}) } as Record<string, string>;
                
                // 2. Sandbox command inside a container if configured
                const sandboxed = sandboxMcpCommand(server.command, args, env);
                
                transport = new StdioClientTransport({ 
                    command: sandboxed.command, 
                    args: sandboxed.args, 
                    env 
                });
            } else if (server.transport === "sse") {
                if (!server.url) throw new Error("URL required for SSE transport");
                transport = new SSEClientTransport(new URL(server.url));
            } else {
                throw new Error(`Unsupported transport: ${server.transport}`);
            }

            const client = new Client({ name: "Oddjob MCP Client", version: "1.0.0" }, { capabilities: { sampling: {} } });
            await client.connect(transport);
            const { tools } = await client.listTools();
            const mappedTools = tools.map(t => this.mapMcpToolToOddjob(t, serverId, client));
            const connection: ActiveConnection = { client, transport, server, tools: mappedTools, lastHeartbeat: new Date() };
            this._connections.set(serverId, connection);
            await this.updateStatus(serverId, "active");
            logger.info(`Connected to ${server.name}. Discovered ${tools.length} tools.`);
        } catch (error) {
            logger.error(`Connection failed for ${server.name}:`, error);
            await this.updateStatus(serverId, "error", String(error));
            throw error;
        }
    },

    async disconnect(serverId: number) {
        const conn = this._connections.get(serverId);
        if (conn) {
            try {
                await conn.client.close();
            } catch (e) {
                logger.warn(`Error closing connection for server ${serverId}`, { error: e });
            }
            this._connections.delete(serverId);
            await this.updateStatus(serverId, "inactive");
        }
    },

    getAllTools(): ToolDefinition[] {
        const allTools: ToolDefinition[] = [];
        for (const conn of this._connections.values()) allTools.push(...conn.tools);
        return allTools;
    },

    mapMcpToolToOddjob(mcpTool: any, serverId: number, client: Client): ToolDefinition {
        return {
            name: mcpTool.name,
            label: `[MCP] ${mcpTool.name}`,
            group: "External MCP",
            description: mcpTool.description || "No description provided",
            parameters: z.object({}).catchall(z.any()),
            execute: async (params: any, context: ToolContext) => {
                validateToolCallArguments(mcpTool.name, params);
                const startTime = Date.now();
                const startTimeInNs = getMonotonicTimeNs();
                let toolStatus: "success" | "failure" | "timeout" | "cancelled" = "success";
                let errorMessage: string | undefined;

                const circuitName = `mcp:server:${serverId}:tool:${mcpTool.name}`;
                if (!getCircuitState(circuitName)) {
                    createCircuitBreaker({
                        name: circuitName,
                        failureThreshold: 5,
                        resetTimeoutMs: 30000,
                        halfOpenMaxAttempts: 3
                    });
                }

                if (context.traceId) {
                    logForensicEvent(context as any, {
                        organizationId: Number(context.organizationId) || 1,
                        missionId: (context as any).missionId,
                        jobId: (context as any).jobId,
                        jobType: `mcp_tool:${mcpTool.name}`,
                        status: 'success', 
                        startTimeNs: startTimeInNs,
                        attributes: { params }
                    });
                }

                try {
                    logger.info(`Calling MCP tool ${mcpTool.name} on server ${serverId}`);
                    const result = await withCircuitBreaker(circuitName, () => 
                        client.callTool({ 
                            name: mcpTool.name, 
                            arguments: params 
                        })
                    );

                    // Log Telemetry
                    await integrationTelemetryService.logCall({
                        platform: "mcp-server",
                        method: "POST",
                        url: mcpTool.name,
                        action: "call_tool",
                        responseStatus: 200,
                        durationMs: Date.now() - startTime,
                        traceId: context.traceId,
                        missionId: context.missionId,
                        isPriority: true,
                        metadata: { serverId, toolName: mcpTool.name }
                    } as any);

                    let output = "";
                    if (result.content && Array.isArray(result.content)) {
                        const textContent = result.content.find(c => c.type === 'text');
                        output = textContent?.text || JSON.stringify(result);
                    } else {
                        output = JSON.stringify(result);
                    }

                    return output;

                } catch (error: any) {
                    toolStatus = "failure";
                    errorMessage = error.message;
                    logger.error(`MCP tool call failed: ${mcpTool.name}`, error);
                    throw error;
                } finally {
                    const endTimeInNs = getMonotonicTimeNs();
                    if (context.traceId) {
                        logForensicEvent(context as any, {
                            organizationId: Number(context.organizationId) || 1,
                            missionId: (context as any).missionId,
                            jobId: (context as any).jobId,
                            jobType: `mcp_tool:${mcpTool.name}`,
                            status: toolStatus,
                            startTimeNs: startTimeInNs,
                            endTimeNs: endTimeInNs,
                            errorMessage,
                            attributes: { 
                                executionTimeMs: Date.now() - startTime,
                                serverId 
                            }
                        });
                    }
                }
            }
        };
    },

    async updateStatus(id: number, status: string, error?: string) {
        await db.update(mcpServers)
            .set({
                status,
                error: error || null,
                lastConnectedAt: status === 'active' ? new Date() : undefined,
                updatedAt: new Date()
            })
            .where(eq(mcpServers.id, id));
    }
};

export default mcpClientService;


