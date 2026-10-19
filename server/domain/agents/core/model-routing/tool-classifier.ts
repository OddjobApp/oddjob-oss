/**
 * Tool Classifier
 * 
 * Classifies agent tools into routing categories (read/write/search/analysis)
 * based on their ToolDefinition metadata. Used by the ModelRoutingService
 * to determine which model tier should handle each tool invocation.
 */

import type { ToolDefinition } from "../../../tools/v1/capabilities/types.js";
import { ToolTypeClassification } from "./types.js";

/**
 * Classify a tool into a ToolTypeClassification.
 * Uses riskLevel, idempotency, group, name, and sideEffects.
 * 
 * Priority:
 * 1. idempotency: "read-safe" → read_tools or search_tools
 * 2. sideEffects includes "file-system" + medium risk → write_tools
 * 3. Name patterns for analysis tools (test, lint, diff)
 * 4. Default: write_tools (safe → routes to premium)
 */
export function classifyTool(tool: ToolDefinition): ToolTypeClassification {
    const name = (tool.name || "").toLowerCase();
    const group = (tool.group || "").toLowerCase();
    const riskLevel = tool.riskLevel || "medium";
    const idempotency = tool.idempotency;
    const sideEffects = tool.sideEffects || [];

    // 1. Read-safe tools are either read_tools or search_tools
    if (idempotency === "read-safe") {
        if (group.includes("search") || name.includes("search") ||
            name.includes("lookup") || name.includes("query") ||
            name.includes("find") || name.includes("grep")) {
            return "search_tools";
        }
        return "read_tools";
    }

    // 2. Analysis tools: testing, linting, diffing, checking
    if (name.includes("test") || name.includes("lint") ||
        name.includes("diff") || name.includes("check") ||
        name.includes("audit") || name.includes("health") ||
        name.includes("validate")) {
        return "analysis_tools";
    }

    // 3. Write tools: file-system side effects with medium+ risk
    if (sideEffects.includes("file-system") && riskLevel !== "low") {
        return "write_tools";
    }

    // 4. Read-like tools by name pattern (even without idempotency annotation)
    if (name.includes("read") || name.includes("list") ||
        name.includes("get") || name.includes("status") ||
        name.includes("tree") || name.includes("view")) {
        return "read_tools";
    }

    // 5. External API side effects → write_tools (can't validate easily)
    if (sideEffects.includes("external-api")) {
        return "write_tools";
    }

    // 6. Default: write_tools (safe default → routes to premium)
    return "write_tools";
}

/**
 * Get the default model tier for a tool type classification.
 */
export function getDefaultTier(classification: ToolTypeClassification): "economy" | "premium" {
    switch (classification) {
        case "read_tools":
            return "economy";
        case "search_tools":
            return "economy";
        case "analysis_tools":
            return "economy";
        case "write_tools":
            return "premium";
    }
}
