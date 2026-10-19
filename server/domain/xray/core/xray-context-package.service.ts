import type {
  CompositionEdge,
  CompositionGraph,
  CompositionNode,
} from "../types/composition.js";
import type {
  XrayCopilotContextPackage,
  XrayEventEvaluation,
  XrayOperationalGuide,
} from "../types/operational-guide.js";

export interface ContextPackageRequest {
  task: string;
  nodeIds?: string[];
  maxGraphHops?: number;
  maxNodes?: number;
}

export interface EventEvaluationRequest {
  eventType: string;
  subjectNodeId?: string;
  evidence?: Record<string, unknown>;
  task?: string;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9/_:-]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3);
}

function searchableNodeText(node: CompositionNode): string {
  return [
    node.id,
    node.type,
    node.label,
    node.description,
    node.filePath,
    node.group,
    node.metadata ? JSON.stringify(node.metadata) : "",
  ].filter(Boolean).join(" ").toLowerCase();
}

function nodeOwner(node: CompositionNode): string | undefined {
  const metadata = node.metadata ?? {};
  const owner = metadata.operationalOwner ?? metadata.ownerRole ?? metadata.owner ?? metadata.ownerId;
  return owner === undefined || owner === null ? undefined : String(owner);
}

function compactNode(node: CompositionNode) {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    ...(node.description ? { description: node.description.slice(0, 320) } : {}),
    ...(node.filePath ? { filePath: node.filePath } : {}),
    ...(nodeOwner(node) ? { owner: nodeOwner(node) } : {}),
  };
}

function compactEdge(edge: CompositionEdge) {
  return {
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    label: edge.label,
  };
}

function relevantGuardrailText(guide: XrayOperationalGuide, selectedNodes: CompositionNode[]): Set<string> {
  const nodeTypes = new Set(selectedNodes.map(node => node.type));
  const relevant = new Set<string>(["graph"]);
  for (const type of nodeTypes) relevant.add(type);
  for (const edge of guide.guardrails.flatMap(rule => rule.appliesTo)) {
    if (typeof edge === "string" && nodeTypes.has(edge as CompositionNode["type"])) relevant.add(edge);
  }
  return relevant;
}

export class XrayContextPackageService {
  buildContext(
    graph: CompositionGraph,
    guide: XrayOperationalGuide,
    request: ContextPackageRequest,
  ): XrayCopilotContextPackage {
    const task = String(request.task || "").trim();
    if (!task) throw new Error("task is required");

    const maxGraphHops = Math.min(2, Math.max(0, request.maxGraphHops ?? 1));
    const maxNodes = Math.min(50, Math.max(1, request.maxNodes ?? 20));
    const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
    const requestedIds = (request.nodeIds ?? []).filter(id => nodeMap.has(id));
    const taskTokens = tokens(task);

    const ranked = graph.nodes
      .map(node => {
        const text = searchableNodeText(node);
        const score = taskTokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0);
        return { node, score };
      })
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label));

    const seedNodeIds = Array.from(new Set([
      ...requestedIds,
      ...ranked.slice(0, requestedIds.length > 0 ? 5 : 8).map(candidate => candidate.node.id),
    ])).slice(0, maxNodes);

    const selectedIds = new Set(seedNodeIds);
    let frontier = new Set(seedNodeIds);
    for (let hop = 0; hop < maxGraphHops && frontier.size > 0 && selectedIds.size < maxNodes; hop += 1) {
      const next = new Set<string>();
      for (const edge of graph.edges) {
        if (frontier.has(edge.source) && nodeMap.has(edge.target) && !selectedIds.has(edge.target)) {
          next.add(edge.target);
        }
        if (frontier.has(edge.target) && nodeMap.has(edge.source) && !selectedIds.has(edge.source)) {
          next.add(edge.source);
        }
      }
      for (const id of next) {
        if (selectedIds.size >= maxNodes) break;
        selectedIds.add(id);
      }
      frontier = next;
    }

    const selectedNodes = graph.nodes.filter(node => selectedIds.has(node.id));
    const selectedEdges = graph.edges.filter(edge => selectedIds.has(edge.source) && selectedIds.has(edge.target));
    const relevantTypes = relevantGuardrailText(guide, selectedNodes);
    const selectedGuardrails = guide.guardrails.filter(rule =>
      rule.appliesTo.some(subject => relevantTypes.has(subject)),
    );
    const selectedGaps = guide.gaps.filter(gap =>
      gap.affectedNodeIds.length === 0 ||
      gap.affectedNodeIds.some(id => selectedIds.has(id)),
    );
    const unknowns = selectedGaps.map(gap => gap.message);
    const selectedNodeTypes = new Set(selectedNodes.map(node => node.type));
    const questions = [];
    if (seedNodeIds.length === 0) {
      unknowns.unshift("No X-Ray nodes matched the task. Clarify the component, route, agent, mission, or pipeline.");
      questions.push({
        id: "clarify-target-component",
        reason: "No X-Ray component could be resolved from the request.",
        prompt: "Which application, route, agent, mission, or pipeline should I operate on?",
        source: "unresolved_node" as const,
        blocks: ["impact analysis", "operational action"],
      });
    }
    if (selectedGaps.some(gap => gap.id === "production-ownership-missing")) {
      questions.push({
        id: "resolve-operation-owner",
        reason: "A consequential action cannot be routed or approved without an accountable owner.",
        prompt: "Who should own and approve this operation?",
        source: "authority" as const,
        blocks: ["approval", "deployment", "exception"],
      });
    }
    const suggestedPrompts = guide.userPrompts.filter(prompt => {
      if (prompt.id === "prompt-collect-structured-input") {
        return selectedGaps.some(gap => gap.category === "evidence" || gap.category === "coverage");
      }
      if (prompt.id === "prompt-request-approval") {
        return selectedNodeTypes.has("agent") || selectedNodeTypes.has("supervisor");
      }
      return taskTokens.some(token => prompt.condition.toLowerCase().includes(token) || prompt.message.toLowerCase().includes(token));
    });

    return {
      schemaVersion: guide.schemaVersion,
      scope: guide.scope,
      task,
      generatedAt: new Date().toISOString(),
      selection: {
        seedNodeIds,
        maxGraphHops,
        truncated: selectedIds.size >= maxNodes || ranked.length > seedNodeIds.length,
      },
      nodes: selectedNodes.map(compactNode),
      edges: selectedEdges.map(compactEdge),
      guardrails: selectedGuardrails,
      gaps: selectedGaps,
      operatingInstructions: guide.copilot.workflow,
      suggestedPrompts,
      questions,
      unknowns,
    };
  }

  evaluateEvent(
    graph: CompositionGraph,
    guide: XrayOperationalGuide,
    request: EventEvaluationRequest,
  ): XrayEventEvaluation {
    const event = guide.events.find(candidate => candidate.id === request.eventType);
    if (!event) throw new Error(`Unknown operational event: ${request.eventType}`);
    if (request.subjectNodeId && !graph.nodes.some(node => node.id === request.subjectNodeId)) {
      throw new Error(`Unknown subject node: ${request.subjectNodeId}`);
    }

    const notification = guide.notifications.find(rule => rule.event === event.id);
    const task = request.task?.trim() ||
      `${event.description}${request.subjectNodeId ? ` Subject: ${request.subjectNodeId}` : ""}`;
    const context = this.buildContext(graph, guide, {
      task,
      nodeIds: request.subjectNodeId ? [request.subjectNodeId] : undefined,
      maxGraphHops: 2,
      maxNodes: 20,
    });
    const action = event.severity === "critical"
      ? "escalate"
      : notification
        ? "notify"
        : "observe";

    return {
      schemaVersion: guide.schemaVersion,
      scope: guide.scope,
      evaluatedAt: new Date().toISOString(),
      event,
      subjectNodeId: request.subjectNodeId,
      evidence: request.evidence ?? {},
      notification,
      context,
      disposition: {
        mode: "advisory",
        action,
        requiresHumanReview: event.severity === "high" || event.severity === "critical",
        rationale: notification
          ? `Matched ${notification.id}; delivery remains advisory until ownership and routing are configured.`
          : "No notification rule matched; retain the event for observation.",
      },
    };
  }
}

export const xrayContextPackageService = new XrayContextPackageService();
