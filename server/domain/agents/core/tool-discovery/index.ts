/**
 * Dynamic Tool Discovery System
 * 
 * Enables agents to discover and create tools dynamically:
 * - Semantic tool matching based on capabilities
 * - Dynamic tool composition from existing tools
 * - Prompt template-based tool generation
 * - Tool validation and performance tracking
 * 
 * @example
 * ```typescript
 * import { toolCapabilityIndex, dynamicToolCreator } from "@domain/agents/core/tool-discovery";
 * 
 * // Register existing tools
 * await toolCapabilityIndex.registerTool({
 *   toolId: "data-query",
 *   name: "Data Query",
 *   description: "Query structured data",
 *   category: "data",
 *   capabilities: ["query", "search", "filter"],
 *   // ...
 * });
 * 
 * // Find tools for a task
 * const matches = await toolCapabilityIndex.findTools({
 *   description: "Find sales records from last month",
 *   requiredCapabilities: ["query", "filter", "date_range"]
 * }, 5);
 * 
 * // Create a new tool if needed
 * const result = await dynamicToolCreator.createTool({
 *   agentId: "agent-1",
 *   name: "Sales Trend Analyzer",
 *   description: "Analyze sales trends over time",
 *   requiredCapabilities: ["analyze", "trend", "calculate"],
 *   // ...
 * });
 * 
 * if (result.success) {
 *   console.log(`Created tool: ${result.tool!.name}`);
 * }
 * ```
 */

// Tool capability indexing
export {
  toolCapabilityIndex,
  ToolCapabilityIndex,
  type ToolCapability,
  type TaskRequirement,
  type ToolMatch,
  type ToolComposition,
} from "./tool-capability-index.js";

// Dynamic tool creation
export {
  dynamicToolCreator,
  DynamicToolCreatorService,
  type DynamicTool,
  type ToolCreationRequest,
  type ToolCreationResult,
  type CodeGenerationResult,
} from "./dynamic-tool-creator.service.js";
