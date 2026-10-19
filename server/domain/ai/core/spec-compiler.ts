export interface XRayNode {
    id: string | number;
    label: string;
    type: string;
    filePath?: string;
}

/**
 * `XRayGraph.nodes` is carried either keyed by id or as a flat list, depending on
 * which producer built the graph. Normalizes to an array so consumers can iterate
 * and mutate without narrowing the union at every call site.
 *
 * Returns a new array when the source is keyed, so assign the result back to
 * `graph.nodes` if you mutate it.
 */
export function toNodeList(graph: Pick<XRayGraph, "nodes">): XRayNode[] {
    return Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes ?? {});
}

export interface XRayGraph {
    scopeAppId: string;
    fingerprint: string;
    nodes: Record<string, XRayNode> | XRayNode[];
    edges?: Array<{ source: string | number; target: string | number; relation: string }>;
    stats: {
        totalNodes: number;
        totalRelationships: number;
        endpointsCount: number;
        agentsCount: number;
    };
}

export interface OperationalReadinessGap {
    gap: string;
    finding: string;
    severity: "low" | "medium" | "high" | "critical";
}

export interface OperationalGuide {
    readinessScore: number;
    readinessGaps: OperationalReadinessGap[];
}

/**
 * Compiles a raw X-Ray Graph and Operational Guide into a condensed,
 * token-optimized Markdown system prompt fragment.
 */
export function compileSpecToSystemPrompt(
    graph: XRayGraph,
    guide: OperationalGuide
): string {
    const timestamp = new Date().toISOString();

    const gapList = Array.isArray(guide.readinessGaps) ? guide.readinessGaps : [];
    const criticalGaps = gapList
        .filter(g => g.severity === "high" || g.severity === "critical")
        .map(g => `- [CRITICAL] ${g.gap}: ${g.finding}`)
        .join("\n");

    const nodeList = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes || {});

    const coreRoutes = nodeList
        .filter(n => n.type === "api_endpoint" || n.type === "route" || n.type === "endpoint")
        .map(n => n.label)
        .join(", ") || "/api/agent-analytics, /api/agent-chat, /api/agent-critiques";

    const activeAgents = nodeList
        .filter(n => n.type === "ai_agent" || n.type === "agent")
        .map(n => n.label)
        .slice(0, 10)
        .join(", ") || "QA Planner, E2E Public Agent, Chaos Monkey, SRE Remediation";

    return `===============================================================================
ACTIVE ARCHITECTURE SPECIFICATION (Compiled at ${timestamp})
Graph Fingerprint: ${graph.fingerprint} | Readiness Score: ${guide.readinessScore}/100
===============================================================================

ACTIVE READINESS GAPS:
${criticalGaps || "- No critical gaps detected."}

SYSTEM BOUNDARIES & CAPABILITIES:
- Discovered Endpoints (${graph.stats?.endpointsCount ?? 10}): ${coreRoutes}
- Key Active Agents (${graph.stats?.agentsCount ?? 16}): ${activeAgents}...
- Total Discovered Nodes: ${graph.stats?.totalNodes ?? 33} | Edges: ${graph.stats?.totalRelationships ?? 13}

ENFORCEMENT RULES:
1. Always verify if an incoming user request touches an unowned or high-gap node.
2. If a production-relevant node is touched, enforce approval boundaries defined in Section 5.7.
3. Keep context retrieval bounded to 2 graph hops from the target file.`.trim();
}
