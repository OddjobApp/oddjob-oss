import { ToolDefinition } from "../v1/capabilities/types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ToolRegistry");

export class ToolRegistry {
    private static instance: ToolRegistry;
    private tools: Record<string, ToolDefinition> = {};

    private constructor() {}

    public static getInstance(): ToolRegistry {
        if (!ToolRegistry.instance) {
            ToolRegistry.instance = new ToolRegistry();
        }
        return ToolRegistry.instance;
    }

    /**
     * Register a set of tools
     */
    public registerTools(toolSet: Record<string, ToolDefinition>) {
        const names = Object.keys(toolSet);
        logger.info(`Registering ${names.length} tools...`);
        this.tools = { ...this.tools, ...toolSet };
    }

    /**
     * Register a single tool
     */
    public registerTool(name: string, tool: ToolDefinition) {
        this.tools[name] = tool;
    }

    /**
     * Get all registered tools
     */
    public getAllTools(): Record<string, ToolDefinition> {
        return { ...this.tools };
    }

    /**
     * Look up a single registered tool by name (no MCP merge — use getAgentTools
     * when MCP-provided tools must also resolve).
     */
    public getTool(name: string): ToolDefinition | undefined {
        return this.tools[name];
    }
}

export const toolRegistry = ToolRegistry.getInstance();
