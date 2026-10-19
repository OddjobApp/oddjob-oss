import { getAgentTools, AGENT_TOOLS } from "./capabilities/index.js";
import type { ToolDefinition } from "./capabilities/index.js";
import { JOB_SCHEMAS } from "../../../config/jobs/schemas.js";
import { db } from "@server/database_service.js";
import { saasConnectors, apiSpecs } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";

export const TOOL_ALIASES: Record<string, string> = {
    "browsing": "browse_web",
    "browser": "browse_web",
    "web_browser": "browse_web",
    "browse_the_web": "browse_web",
    "web_search": "google_search",
    "search": "google_search",
    "google": "google_search",
    "search_the_web": "google_search",
    "knowledge_base": "search_unified_knowledge",
    "kb_search": "search_unified_knowledge",
    "search_knowledge_base": "search_unified_knowledge",
    "search_documents": "search_unified_knowledge",
    "perplexity_search": "google_search",
    "perplexity": "google_search",
    "python_interpreter": "python",
    "execute_python": "python",
    "terminal": "shell",
    "bash": "shell",
    "command_line": "shell",
    "shell_execute": "shell",
    "terminal_execute": "shell",
    "calculator_tool": "calculator",
    "arithmetic": "calculator",
    "reading": "file_read",
    "writing": "file_write",
    "filestore": "file_list",
    "ai.translate": "ai_translate",
    "translate": "ai_translate",
    "filesystem.writeFile": "workspace_write_file",
    "http.get": "http_request",
    "http_get": "http_request",
    "read_web_page": "browse_web",
    "read_file": "workspace_read_file",
    "write_file": "workspace_write_file",
    "run_command": "workspace_run_command",
    "search_knowledge": "search_unified_knowledge"
};

/**
 * Simple Levenshtein distance for fuzzy matching
 */
function getLevenshteinDistance(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[a.length][b.length];
}

import { mcpClientService } from "../../integrations/core/mcp-client.service.js";

/**
 * Normalize a tool name and handle common aliases or typos
 */
export function normalizeToolName(tool: string): string {
    if (!tool) return "";
    const lower = tool.toLowerCase().trim().replace(/ /g, '_').replace(/-/g, '_');

    // 1. Exact alias match
    if (TOOL_ALIASES[lower]) return TOOL_ALIASES[lower];

    // 2. Exact AGENT_TOOLS match
    if (AGENT_TOOLS[lower]) return lower;

    // 3. Exact MCP tools match
    const mcpTools = mcpClientService.getAllTools();
    const mcpMatch = mcpTools.find(t => t.name.toLowerCase() === lower);
    if (mcpMatch) return mcpMatch.name;

    // 4. Fuzzy match against aliases and tool names
    const candidates = [...Object.keys(TOOL_ALIASES), ...Object.keys(AGENT_TOOLS), ...mcpTools.map(t => t.name)];
    let bestMatch = lower;
    let minDistance = 3; // Max tolerance of 2 typos

    for (const candidate of candidates) {
        const distance = getLevenshteinDistance(lower, candidate);
        if (distance < minDistance) {
            minDistance = distance;
            bestMatch = TOOL_ALIASES[candidate] || candidate;
        }
    }

    return bestMatch;
}

/**
 * Check if a tool/dependency is available in the current organization
 */
export async function isToolAvailable(tool: string, organizationId: number): Promise<boolean> {
    const lowerTool = normalizeToolName(tool);

    // 1. Check SaaS Connectors
    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, lowerTool)
            )
        )
        .limit(1);
    if (connector && connector.status === 'connected') return true;

    // 2. Check OpenAPI Specs (matches name)
    const [spec] = await db
        .select()
        .from(apiSpecs)
        .where(eq(apiSpecs.name, tool))
        .limit(1);
    if (spec) return true;

    // 3. Check hardcoded internal tools
    const internalTools = ["google_search", "browse_web", "sql_query", "python", "file_write", "shell", "google_sheets"];
    if (internalTools.includes(lowerTool)) return true;

    // 4. Check the registered agent tools
    if (AGENT_TOOLS[lowerTool]) return true;

    // 5. Check MCP tools
    if (mcpClientService.getAllTools().some(t => t.name === lowerTool)) return true;

    return false;
}

export interface ToolMetadata {
    name: string;
    description: string;
    label?: string;
    group?: string;
    adminOnly?: boolean;
    riskLevel?: 'low' | 'medium' | 'high';
}

/**
 * Get metadata for a tool, handling normalization
 */
export function getToolMetadata(rawToolName: string): ToolMetadata {
    const tool = normalizeToolName(rawToolName);
    const mcpTools = mcpClientService.getAllTools();
    const definition = AGENT_TOOLS[tool] || mcpTools.find(t => t.name === tool);

    if (definition) {
        return {
            name: tool,
            description: definition.description,
            label: definition.label,
            group: definition.group,
            adminOnly: definition.adminOnly,
            riskLevel: definition.riskLevel || 'medium'
        };
    }

    // Virtual tool fallbacks for core capabilities
    if (tool === 'google_search') {
        return { name: tool, description: "Search the internet using Google Search.", group: "Web & Search", label: "Google Search", riskLevel: 'low' };
    }
    if (tool === 'browse_web') {
        return { name: tool, description: "Browse and extract content from websites.", group: "Web & Search", label: "Web Browser", riskLevel: 'low' };
    }
    if (tool === 'shell') {
        return { name: tool, description: "Execute terminal commands on the server.", group: "System", label: "Shell / Terminal", adminOnly: true, riskLevel: 'high' };
    }
    if (tool === 'python') {
        return { name: tool, description: "Execute Python code for data analysis and processing.", group: "Code Execution", label: "Python Interpreter", riskLevel: 'medium' };
    }

    return {
        name: tool,
        description: "External or specialized tool capability.",
        group: "External"
    };
}

/**
 * Normalize tool arguments to handle common parameter hallucinations/aliases
 */
export function normalizeToolArguments(toolName: string, args: any): any {
    if (!args || typeof args !== 'object') return args;

    const normalizedArgs = { ...args };
    const tool = normalizeToolName(toolName);

    // Global aliasing (across all tools)
    // 1. filename -> path
    if (normalizedArgs.filename && !normalizedArgs.path) {
        normalizedArgs.path = normalizedArgs.filename;
    }

    // 2. text/body -> content
    if ((normalizedArgs.text || normalizedArgs.body) && !normalizedArgs.content) {
        normalizedArgs.content = normalizedArgs.text || normalizedArgs.body;
    }

    // --- Blackboard Normalization ---
    if (tool === 'update_blackboard') {
        // If content and reason are missing but other keys exist, wrap them in content
        if (!normalizedArgs.content && !normalizedArgs.reason && Object.keys(normalizedArgs).length > 0) {
            const { ...rest } = normalizedArgs;
            normalizedArgs.content = rest;
            normalizedArgs.reason = "Autonomous status update";
        }
    }

    // Tool-specific aliasing
    if (tool === 'browse_web' || tool === 'google_search') {
        if (normalizedArgs.targetUrl && !normalizedArgs.url) {
            normalizedArgs.url = normalizedArgs.targetUrl;
        }
        if (normalizedArgs.query && !normalizedArgs.url && tool === 'browse_web' && normalizedArgs.query.startsWith('http')) {
            normalizedArgs.url = normalizedArgs.query;
        }
        if (tool === 'google_search' && normalizedArgs.queries && !normalizedArgs.query) {
            normalizedArgs.query = Array.isArray(normalizedArgs.queries) ? normalizedArgs.queries[0] : String(normalizedArgs.queries);
        }
    }

    if (tool === 'calculator' || tool === 'python') {
        if (normalizedArgs.code && !normalizedArgs.expression) {
            normalizedArgs.expression = normalizedArgs.code;
        }
    }

    if (tool === 'analyze_image') {
        if ((normalizedArgs.path || normalizedArgs.filename) && !normalizedArgs.filePath) {
            normalizedArgs.filePath = normalizedArgs.path || normalizedArgs.filename;
        }
    }

    return normalizedArgs;
}

export { getAgentTools, AGENT_TOOLS, JOB_SCHEMAS };
export type { ToolDefinition };
