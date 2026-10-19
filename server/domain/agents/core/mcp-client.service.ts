/**
 * MCP Client Service
 * 
 * Service for connecting to external MCP (Model Context Protocol) servers
 * and executing tools on behalf of agents.
 */

import { createLogger } from '../../../utils/logger.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsResult,
  CallToolResult,
  CompatibilityCallToolResult,
  ListResourcesResult,
  ListPromptsResult,
  GetPromptResult,
  EmptyResult
} from '@modelcontextprotocol/sdk/types.js';

const logger = createLogger('MCPClientService');

/**
 * Validates MCP commands against shell injection and privilege escalation patterns
 */
function validateMcpCommand(command: string, args: string[]): void {
    const dangerousPatterns = [
        /\b(sudo|su|runas)\b/i,
        /[;&|`$]/, // Command shell metacharacters
        /\b(rm\s+-rf|format|mkfs|dd)\b/i,
        /\b(chmod|chown)\b/i
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(command) || args.some(arg => pattern.test(arg))) {
            throw new Error(`Security validation failed: Executable command or arguments contains forbidden shell patterns.`);
        }
    }
}

/**
 * Wraps stdio command with Docker container sandbox if sandboxing is enabled
 */
function sandboxMcpCommand(command: string, args: string[], env: Record<string, string>): { command: string; args: string[] } {
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

export interface MCPConnectionConfig {
  /** MCP server URL or command */
  serverUrl?: string;
  /** Command to spawn stdio server */
  command?: string;
  /** Arguments for command */
  args?: string[];
  /** Transport type */
  transport: 'stdio' | 'sse' | 'http';
  /** Connection timeout in ms */
  timeout?: number;
  /** Headers for HTTP/SSE connections */
  headers?: Record<string, string>;
}

export interface MCPToolCall {
  /** Tool name */
  name: string;
  /** Tool arguments */
  arguments: Record<string, any>;
}

export interface MCPClientSession {
  /** Session ID */
  id: string;
  /** Connected client */
  client: Client;
  /** Connection config */
  config: MCPConnectionConfig;
  /** Available tools */
  tools: ListToolsResult['tools'];
  /** Connection timestamp */
  connectedAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
}

/**
 * MCP Client Service
 * 
 * Manages connections to external MCP servers and executes tools.
 */
export class MCPClientService {
  private sessions: Map<string, MCPClientSession> = new Map();
  private defaultTimeout = 30000; // 30 seconds

  constructor() {
    logger.info('MCP Client Service initialized');
  }

  /**
   * Connect to an MCP server
   */
  async connect(config: MCPConnectionConfig): Promise<MCPClientSession> {
    const sessionId = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timeout = config.timeout || this.defaultTimeout;

    logger.info(`Connecting to MCP server`, {
      sessionId,
      transport: config.transport,
      serverUrl: config.serverUrl
    });

    try {
      // Create transport based on type
      let transport;
      
      if (config.transport === 'stdio') {
        if (!config.command) {
          throw new Error('Command required for stdio transport');
        }
        const args = config.args || [];
        
        // 1. Run security validation guard
        validateMcpCommand(config.command, args);
        
        // 2. Sandbox command inside a container if configured
        const sandboxed = sandboxMcpCommand(config.command, args, process.env as Record<string, string>);
        
        transport = new StdioClientTransport({
          command: sandboxed.command,
          args: sandboxed.args
        });
      } else if (config.transport === 'sse') {
        if (!config.serverUrl) {
          throw new Error('Server URL required for SSE transport');
        }
        const url = new URL(config.serverUrl);
        transport = new SSEClientTransport(url);
      } else {
        if (!config.serverUrl) {
          throw new Error('Server URL required for HTTP transport');
        }
        const url = new URL(config.serverUrl);
        transport = new StreamableHTTPClientTransport(url);
      }

      // Create client
      const client = new Client({
        name: 'oddjob-mcp-client',
        version: '1.0.0'
      });

      // Connect with timeout
      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      await Promise.race([connectPromise, timeoutPromise]);

      // List available tools
      const toolsResult = await client.listTools();

      // Create session
      const session: MCPClientSession = {
        id: sessionId,
        client,
        config,
        tools: toolsResult.tools,
        connectedAt: new Date(),
        lastActivity: new Date()
      };

      this.sessions.set(sessionId, session);

      logger.info(`MCP connection established`, {
        sessionId,
        toolCount: toolsResult.tools.length
      });

      return session;
    } catch (error) {
      logger.error(`Failed to connect to MCP server`, { sessionId, error });
      throw error;
    }
  }

  /**
   * Execute a tool on an MCP server
   */
  async executeTool(
    sessionId: string,
    toolCall: MCPToolCall
  ): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`MCP session not found: ${sessionId}`);
    }

    const timeout = session.config.timeout || this.defaultTimeout;

    logger.info(`Executing MCP tool`, {
      sessionId,
      tool: toolCall.name
    });

    try {
      const executePromise = session.client.callTool({
        name: toolCall.name,
        arguments: toolCall.arguments
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
      );

      const result = await Promise.race([executePromise, timeoutPromise]);

      session.lastActivity = new Date();

      logger.info(`MCP tool executed successfully`, {
        sessionId,
        tool: toolCall.name
      });

      return result;
    } catch (error) {
      logger.error(`MCP tool execution failed`, {
        sessionId,
        tool: toolCall.name,
        error
      });
      throw error;
    }
  }

  /**
   * List available tools for a session
   */
  async listTools(sessionId: string): Promise<ListToolsResult['tools']> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`MCP session not found: ${sessionId}`);
    }

    try {
      const result = await session.client.listTools();
      session.tools = result.tools;
      session.lastActivity = new Date();
      return result.tools;
    } catch (error) {
      logger.error(`Failed to list MCP tools`, { sessionId, error });
      throw error;
    }
  }

  /**
   * List available resources for a session
   */
  async listResources(sessionId: string): Promise<ListResourcesResult['resources']> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`MCP session not found: ${sessionId}`);
    }

    try {
      const result = await session.client.listResources();
      session.lastActivity = new Date();
      return result.resources;
    } catch (error) {
      logger.error(`Failed to list MCP resources`, { sessionId, error });
      throw error;
    }
  }

  /**
   * List available prompts for a session
   */
  async listPrompts(sessionId: string): Promise<ListPromptsResult['prompts']> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`MCP session not found: ${sessionId}`);
    }

    try {
      const result = await session.client.listPrompts();
      session.lastActivity = new Date();
      return result.prompts;
    } catch (error) {
      logger.error(`Failed to list MCP prompts`, { sessionId, error });
      throw error;
    }
  }

  /**
   * Get a prompt from MCP server
   */
  async getPrompt(
    sessionId: string,
    name: string,
    arguments_?: Record<string, string>
  ): Promise<GetPromptResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`MCP session not found: ${sessionId}`);
    }

    try {
      const result = await session.client.getPrompt({ name, arguments: arguments_ });
      session.lastActivity = new Date();
      return result;
    } catch (error) {
      logger.error(`Failed to get MCP prompt`, { sessionId, name, error });
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      await session.client.close();
      this.sessions.delete(sessionId);
      logger.info(`MCP session disconnected`, { sessionId });
    } catch (error) {
      logger.error(`Error disconnecting MCP session`, { sessionId, error });
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get all active sessions
   */
  getSessions(): MCPClientSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): MCPClientSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Clean up inactive sessions
   */
  async cleanupInactiveSessions(maxInactiveMs: number = 300000): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > maxInactiveMs) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      await this.disconnect(id);
    }

    if (toRemove.length > 0) {
      logger.info(`Cleaned up ${toRemove.length} inactive MCP sessions`);
    }
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    
    for (const id of sessionIds) {
      await this.disconnect(id);
    }

    logger.info('MCP Client Service closed');
  }
}

// Singleton instance
export const mcpClientService = new MCPClientService();

export default MCPClientService;
