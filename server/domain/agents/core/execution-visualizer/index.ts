/**
 * Execution Visualizer Module
 * 
 * Capture and visualize agent execution flows as interactive diagrams.
 * 
 * @example
 * ```typescript
 * import { executionFlowService } from "@domain/agents/core/execution-visualizer";
 * 
 * // Start a flow
 * const flow = executionFlowService.startFlow(
 *   "session-123",
 *   "agent-1",
 *   1,
 *   { layout: "vertical" }
 * );
 * 
 * // Record execution events
 * executionFlowService.recordStep(sessionId, { label: "Analyze data" });
 * executionFlowService.recordReflection(sessionId, { issuesFound: 2, passed: false });
 * executionFlowService.recordCorrection(sessionId, { success: true, strategy: "retry" });
 * executionFlowService.recordToolCall(sessionId, { toolName: "data_query", success: true, durationMs: 1500 });
 * 
 * // Complete the flow
 * executionFlowService.completeFlow(sessionId, { success: true });
 * 
 * // Export for visualization
 * const mermaid = executionFlowService.exportFlow(flow.id, "mermaid");
 * console.log(mermaid); // Mermaid diagram syntax
 * ```
 */

export {
  executionFlowService,
  ExecutionFlowService,
  type ExecutionFlow,
  type FlowNode,
  type FlowEdge,
  type NodeType,
  type FlowFilter,
} from "./execution-flow.service.js";
