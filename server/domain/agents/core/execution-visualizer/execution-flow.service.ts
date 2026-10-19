/**
 * Execution Flow Visualizer Service
 * 
 * Captures and generates visual flow diagrams of agent execution,
 * showing steps, decisions, branches, and outcomes.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("ExecutionFlowVisualizer");

// Types
export type NodeType = 
  | "start" 
  | "step" 
  | "decision" 
  | "action" 
  | "reflection" 
  | "correction"
  | "tool_call"
  | "swarm_vote"
  | "consensus"
  | "adaptation"
  | "error"
  | "end";

export interface FlowNode {
  id: string;
  type: NodeType;
  label: string;
  description?: string;
  timestamp: Date;
  durationMs?: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  
  // Position for visualization (auto-calculated)
  position?: { x: number; y: number };
  
  // Metadata
  metadata: {
    agentId?: string;
    strategy?: string;
    toolName?: string;
    reflectionId?: string;
    proposalId?: string;
    confidence?: number;
    quality?: number;
    [key: string]: any;
  };
  
  // Visual styling
  style?: {
    color?: string;
    icon?: string;
    size?: "small" | "medium" | "large";
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type: "success" | "failure" | "decision_yes" | "decision_no" | "default";
  animated?: boolean;
}

export interface ExecutionFlow {
  id: string;
  sessionId: string;
  agentId: string;
  organizationId: number;
  
  // Flow structure
  nodes: FlowNode[];
  edges: FlowEdge[];
  
  // Metadata
  createdAt: Date;
  completedAt?: Date;
  status: "running" | "completed" | "failed";
  
  // Statistics
  stats: {
    totalSteps: number;
    totalDurationMs: number;
    reflections: number;
    corrections: number;
    toolCalls: number;
    adaptations: number;
    errors: number;
  };
  
  // Configuration
  layout: "horizontal" | "vertical" | "auto";
  showDetails: boolean;
}

export interface FlowFilter {
  nodeTypes?: NodeType[];
  status?: FlowNode["status"][];
  timeRange?: { start: Date; end: Date };
  minDurationMs?: number;
}

/**
 * Execution Flow Service
 * 
 * Captures execution events and builds visualizable flow diagrams.
 */
export class ExecutionFlowService {
  private activeFlows: Map<string, ExecutionFlow> = new Map();
  private flowHistory: Map<string, ExecutionFlow[]> = new Map(); // agentId -> flows

  /**
   * Start a new execution flow
   */
  startFlow(
    sessionId: string,
    agentId: string,
    organizationId: number,
    options: {
      layout?: ExecutionFlow["layout"];
      showDetails?: boolean;
    } = {}
  ): ExecutionFlow {
    const flow: ExecutionFlow = {
      id: uuidv4(),
      sessionId,
      agentId,
      organizationId,
      nodes: [],
      edges: [],
      createdAt: new Date(),
      status: "running",
      stats: {
        totalSteps: 0,
        totalDurationMs: 0,
        reflections: 0,
        corrections: 0,
        toolCalls: 0,
        adaptations: 0,
        errors: 0,
      },
      layout: options.layout || "vertical",
      showDetails: options.showDetails ?? true,
    };

    // Add start node
    this.addNode(flow, {
      type: "start",
      label: "Start",
      status: "completed",
      metadata: {},
    });

    this.activeFlows.set(sessionId, flow);

    logger.info(`[ExecutionFlow] Started flow ${flow.id} for session ${sessionId}`);

    eventStream.publish(
      "execution.flow_started",
      { flowId: flow.id, sessionId, agentId },
      { organizationId, agentId, sessionId },
      "execution_visualizer"
    );

    return flow;
  }

  /**
   * Add a node to the flow
   */
  addNode(
    flowOrSessionId: ExecutionFlow | string,
    nodeData: Omit<FlowNode, "id" | "timestamp" | "position">
  ): FlowNode {
    const flow = typeof flowOrSessionId === "string" 
      ? this.activeFlows.get(flowOrSessionId)
      : flowOrSessionId;

    if (!flow) {
      throw new Error(`Flow not found: ${flowOrSessionId}`);
    }

    const node: FlowNode = {
      id: `node-${flow.nodes.length}`,
      timestamp: new Date(),
      position: this.calculatePosition(flow, nodeData.type),
      ...nodeData,
    };

    flow.nodes.push(node);

    // Create edge from previous node
    if (flow.nodes.length > 1) {
      const prevNode = flow.nodes[flow.nodes.length - 2];
      this.addEdge(flow, {
        source: prevNode.id,
        target: node.id,
        type: "default",
      });
    }

    // Update stats
    this.updateStats(flow, node);

    logger.debug(`[ExecutionFlow] Added ${node.type} node to flow ${flow.id}`);

    return node;
  }

  /**
   * Add an edge between nodes
   */
  addEdge(
    flowOrSessionId: ExecutionFlow | string,
    edgeData: Omit<FlowEdge, "id">
  ): FlowEdge {
    const flow = typeof flowOrSessionId === "string"
      ? this.activeFlows.get(flowOrSessionId)
      : flowOrSessionId;

    if (!flow) {
      throw new Error(`Flow not found: ${flowOrSessionId}`);
    }

    const edge: FlowEdge = {
      id: `edge-${flow.edges.length}`,
      ...edgeData,
    };

    flow.edges.push(edge);
    return edge;
  }

  /**
   * Record a step execution
   */
  recordStep(
    sessionId: string,
    stepData: {
      label: string;
      description?: string;
      strategy?: string;
      agentId?: string;
    }
  ): FlowNode | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    return this.addNode(flow, {
      type: "step",
      label: stepData.label,
      description: stepData.description,
      status: "completed",
      metadata: {
        strategy: stepData.strategy,
        agentId: stepData.agentId,
      },
    });
  }

  /**
   * Record a decision point
   */
  recordDecision(
    sessionId: string,
    decisionData: {
      label: string;
      description?: string;
      choice: "yes" | "no";
      confidence?: number;
    }
  ): { yesNode: FlowNode; noNode: FlowNode } | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    const decisionNode = this.addNode(flow, {
      type: "decision",
      label: decisionData.label,
      description: decisionData.description,
      status: "completed",
      metadata: {
        confidence: decisionData.confidence,
      },
    });

    // Create yes/no branches
    const yesNode = this.addNode(flow, {
      type: "step",
      label: "Yes",
      status: decisionData.choice === "yes" ? "completed" : "skipped",
      metadata: { branch: "yes" },
    });

    const noNode = this.addNode(flow, {
      type: "step",
      label: "No",
      status: decisionData.choice === "no" ? "completed" : "skipped",
      metadata: { branch: "no" },
    });

    // Update edges to show branches
    const decisionEdge = flow.edges[flow.edges.length - 3];
    if (decisionEdge) {
      decisionEdge.label = "decision";
    }

    return { yesNode, noNode };
  }

  /**
   * Record a reflection event
   */
  recordReflection(
    sessionId: string,
    reflectionData: {
      issuesFound: number;
      confidence: number;
      passed: boolean;
    }
  ): FlowNode | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    return this.addNode(flow, {
      type: "reflection",
      label: `Reflection${reflectionData.issuesFound > 0 ? ` (${reflectionData.issuesFound} issues)` : ""}`,
      status: reflectionData.passed ? "completed" : "failed",
      metadata: {
        issues: reflectionData.issuesFound,
        confidence: reflectionData.confidence,
      },
      style: {
        color: reflectionData.passed ? "#22c55e" : "#f59e0b",
        icon: "brain",
      },
    });
  }

  /**
   * Record a correction event
   */
  recordCorrection(
    sessionId: string,
    correctionData: {
      success: boolean;
      strategy: string;
    }
  ): FlowNode | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    return this.addNode(flow, {
      type: "correction",
      label: "Self-Correction",
      status: correctionData.success ? "completed" : "failed",
      metadata: {
        correctionStrategy: correctionData.strategy,
      },
      style: {
        color: correctionData.success ? "#3b82f6" : "#ef4444",
        icon: "refresh",
      },
    });
  }

  /**
   * Record a tool call
   */
  recordToolCall(
    sessionId: string,
    toolData: {
      toolName: string;
      success: boolean;
      durationMs: number;
    }
  ): FlowNode | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    return this.addNode(flow, {
      type: "tool_call",
      label: toolData.toolName,
      status: toolData.success ? "completed" : "failed",
      durationMs: toolData.durationMs,
      metadata: {
        toolName: toolData.toolName,
      },
      style: {
        color: toolData.success ? "#8b5cf6" : "#ef4444",
        icon: "wrench",
        size: "small",
      },
    });
  }

  /**
   * Record a swarm vote
   */
  recordSwarmVote(
    sessionId: string,
    voteData: {
      proposalId: string;
      agentId: string;
      vote: string;
      confidence: number;
    }
  ): FlowNode | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    return this.addNode(flow, {
      type: "swarm_vote",
      label: `Vote: ${voteData.vote}`,
      status: "completed",
      metadata: {
        proposalId: voteData.proposalId,
        agentId: voteData.agentId,
        confidence: voteData.confidence,
      },
      style: {
        color: "#06b6d4",
        icon: "users",
        size: "small",
      },
    });
  }

  /**
   * Record a consensus event
   */
  recordConsensus(
    sessionId: string,
    consensusData: {
      accepted: boolean;
      votesFor: number;
      votesAgainst: number;
    }
  ): FlowNode | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    return this.addNode(flow, {
      type: "consensus",
      label: `Consensus ${consensusData.accepted ? "✓" : "✗"}`,
      description: `${consensusData.votesFor} for, ${consensusData.votesAgainst} against`,
      status: consensusData.accepted ? "completed" : "failed",
      metadata: {
        votesFor: consensusData.votesFor,
        votesAgainst: consensusData.votesAgainst,
      },
      style: {
        color: consensusData.accepted ? "#22c55e" : "#f59e0b",
        icon: "check-circle",
        size: "large",
      },
    });
  }

  /**
   * Record a strategy adaptation
   */
  recordAdaptation(
    sessionId: string,
    adaptationData: {
      fromStrategy: string;
      toStrategy: string;
      reason: string;
    }
  ): FlowNode | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    return this.addNode(flow, {
      type: "adaptation",
      label: "Strategy Change",
      description: `${adaptationData.fromStrategy} → ${adaptationData.toStrategy}`,
      status: "completed",
      metadata: {
        fromStrategy: adaptationData.fromStrategy,
        toStrategy: adaptationData.toStrategy,
        reason: adaptationData.reason,
      },
      style: {
        color: "#f97316",
        icon: "refresh-cw",
      },
    });
  }

  /**
   * Record an error
   */
  recordError(
    sessionId: string,
    errorData: {
      message: string;
      recoverable: boolean;
    }
  ): FlowNode | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    return this.addNode(flow, {
      type: "error",
      label: "Error",
      description: errorData.message,
      status: errorData.recoverable ? "completed" : "failed",
      metadata: {
        error: errorData.message,
        recoverable: errorData.recoverable,
      },
      style: {
        color: "#ef4444",
        icon: "alert-triangle",
      },
    });
  }

  /**
   * Complete the flow
   */
  completeFlow(
    sessionId: string,
    outcome: {
      success: boolean;
      output?: any;
    }
  ): ExecutionFlow | undefined {
    const flow = this.activeFlows.get(sessionId);
    if (!flow) return undefined;

    // Add end node
    this.addNode(flow, {
      type: "end",
      label: outcome.success ? "Success" : "Failed",
      status: outcome.success ? "completed" : "failed",
      metadata: {
        output: outcome.output,
      },
      style: {
        color: outcome.success ? "#22c55e" : "#ef4444",
      },
    });

    flow.status = outcome.success ? "completed" : "failed";
    flow.completedAt = new Date();
    flow.stats.totalDurationMs = flow.completedAt.getTime() - flow.createdAt.getTime();

    // Move to history
    this.activeFlows.delete(sessionId);
    const history = this.flowHistory.get(flow.agentId) || [];
    history.push(flow);
    this.flowHistory.set(flow.agentId, history);

    logger.info(`[ExecutionFlow] Completed flow ${flow.id}: ${outcome.success ? "success" : "failed"}`);

    eventStream.publish(
      "execution.flow_completed",
      {
        flowId: flow.id,
        sessionId,
        success: outcome.success,
        stats: flow.stats,
      },
      { organizationId: flow.organizationId, agentId: flow.agentId, sessionId },
      "execution_visualizer"
    );

    return flow;
  }

  /**
   * Get active flow
   */
  getFlow(sessionId: string): ExecutionFlow | undefined {
    return this.activeFlows.get(sessionId);
  }

  /**
   * Get flow history for agent
   */
  getFlowHistory(agentId: string, limit: number = 10): ExecutionFlow[] {
    const history = this.flowHistory.get(agentId) || [];
    return history.slice(-limit);
  }

  /**
   * Export flow to various formats
   */
  exportFlow(flowId: string, format: "json" | "mermaid" | "dot"): string | object | null {
    const flow = 
      this.activeFlows.get(flowId) || 
      Array.from(this.flowHistory.values())
        .flat()
        .find(f => f.id === flowId);

    if (!flow) return null;

    switch (format) {
      case "json":
        return this.toJSON(flow);
      case "mermaid":
        return this.toMermaid(flow);
      case "dot":
        return this.toDOT(flow);
      default:
        return null;
    }
  }

  /**
   * Convert to JSON format
   */
  private toJSON(flow: ExecutionFlow): object {
    return {
      id: flow.id,
      sessionId: flow.sessionId,
      agentId: flow.agentId,
      status: flow.status,
      createdAt: flow.createdAt,
      completedAt: flow.completedAt,
      nodes: flow.nodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.label,
        status: n.status,
        position: n.position,
        metadata: n.metadata,
      })),
      edges: flow.edges,
      stats: flow.stats,
    };
  }

  /**
   * Convert to Mermaid flowchart format
   */
  private toMermaid(flow: ExecutionFlow): string {
    const lines: string[] = ["flowchart TD"];

    // Add nodes
    for (const node of flow.nodes) {
      const shape = this.getMermaidShape(node.type);
      const style = node.style?.color ? `:::${node.type}` : "";
      lines.push(`    ${node.id}${shape.start}"${node.label}"${shape.end}${style}`);
    }

    // Add edges
    for (const edge of flow.edges) {
      const arrow = edge.type === "failure" ? "-.->" : "-->";
      const label = edge.label ? `|${edge.label}|` : "";
      lines.push(`    ${edge.source} ${arrow}${label} ${edge.target}`);
    }

    // Add styles
    lines.push("    classDef start fill:#22c55e");
    lines.push("    classDef end fill:#ef4444");
    lines.push("    classDef error fill:#f59e0b");
    lines.push("    classDef decision fill:#8b5cf6");

    return lines.join("\n");
  }

  /**
   * Get Mermaid shape for node type
   */
  private getMermaidShape(type: NodeType): { start: string; end: string } {
    switch (type) {
      case "start":
      case "end":
        return { start: "([", end: "])" };
      case "decision":
        return { start: "{", end: "}" };
      case "error":
        return { start: "[", end: "]" };
      default:
        return { start: "[", end: "]" };
    }
  }

  /**
   * Convert to Graphviz DOT format
   */
  private toDOT(flow: ExecutionFlow): string {
    const lines: string[] = [
      "digraph ExecutionFlow {",
      "    rankdir=TB;",
      "    node [shape=box, style=filled];",
    ];

    for (const node of flow.nodes) {
      const color = this.getDOTColor(node.type, node.status);
      const shape = this.getDOTShape(node.type);
      lines.push(`    ${node.id} [label="${node.label}", fillcolor="${color}", shape=${shape}];`);
    }

    for (const edge of flow.edges) {
      const style = edge.type === "failure" ? " [style=dashed, color=red]" : "";
      lines.push(`    ${edge.source} -> ${edge.target}${style};`);
    }

    lines.push("}");
    return lines.join("\n");
  }

  /**
   * Get DOT color for node
   */
  private getDOTColor(type: NodeType, status: FlowNode["status"]): string {
    if (status === "failed") return "#ef4444";
    if (status === "skipped") return "#9ca3af";
    
    const colors: Record<NodeType, string> = {
      start: "#22c55e",
      step: "#3b82f6",
      decision: "#8b5cf6",
      action: "#06b6d4",
      reflection: "#f59e0b",
      correction: "#3b82f6",
      tool_call: "#8b5cf6",
      swarm_vote: "#06b6d4",
      consensus: "#22c55e",
      adaptation: "#f97316",
      error: "#ef4444",
      end: "#22c55e",
    };
    return colors[type] || "#6b7280";
  }

  /**
   * Get DOT shape for node type
   */
  private getDOTShape(type: NodeType): string {
    switch (type) {
      case "start":
      case "end":
        return "ellipse";
      case "decision":
        return "diamond";
      default:
        return "box";
    }
  }

  /**
   * Calculate node position based on layout
   */
  private calculatePosition(flow: ExecutionFlow, nodeType: NodeType): { x: number; y: number } {
    const index = flow.nodes.length;
    const spacing = { x: 200, y: 100 };

    switch (flow.layout) {
      case "horizontal":
        return { x: index * spacing.x, y: 0 };
      case "vertical":
        return { x: 0, y: index * spacing.y };
      case "auto":
      default:
        // Simple grid layout
        return {
          x: (index % 3) * spacing.x,
          y: Math.floor(index / 3) * spacing.y,
        };
    }
  }

  /**
   * Update flow statistics
   */
  private updateStats(flow: ExecutionFlow, node: FlowNode): void {
    flow.stats.totalSteps++;

    switch (node.type) {
      case "reflection":
        flow.stats.reflections++;
        break;
      case "correction":
        flow.stats.corrections++;
        break;
      case "tool_call":
        flow.stats.toolCalls++;
        break;
      case "adaptation":
        flow.stats.adaptations++;
        break;
      case "error":
        flow.stats.errors++;
        break;
    }
  }

  /**
   * Filter nodes in a flow
   */
  filterFlow(flow: ExecutionFlow, filter: FlowFilter): FlowNode[] {
    return flow.nodes.filter(node => {
      if (filter.nodeTypes && !filter.nodeTypes.includes(node.type)) {
        return false;
      }
      if (filter.status && !filter.status.includes(node.status)) {
        return false;
      }
      if (filter.timeRange) {
        if (node.timestamp < filter.timeRange.start || node.timestamp > filter.timeRange.end) {
          return false;
        }
      }
      if (filter.minDurationMs && (!node.durationMs || node.durationMs < filter.minDurationMs)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get service statistics
   */
  getStats(): {
    activeFlows: number;
    totalFlows: number;
    agentsWithHistory: number;
  } {
    let totalFlows = 0;
    for (const history of this.flowHistory.values()) {
      totalFlows += history.length;
    }

    return {
      activeFlows: this.activeFlows.size,
      totalFlows,
      agentsWithHistory: this.flowHistory.size,
    };
  }
}

export const executionFlowService = new ExecutionFlowService();
