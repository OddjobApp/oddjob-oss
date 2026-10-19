import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CopilotContextFilter");

export interface GraphNode {
    id: string;
    label: string;
    type: string;
    properties?: Record<string, any>;
}

export interface GraphEdge {
    source: string;
    target: string;
    relation: string;
}

export interface BoundedSubgraph {
    rootNodeId: string;
    maxHops: number;
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/**
 * Enforces Rule 1 of the Copilot Operating Contract:
 * Limits graph context retrieval to a MAXIMUM of 2 hops from the active target node.
 * Prevents loading unneeded monorepo files into the LLM context window.
 */
export class CopilotContextFilter {
    public static readonly MAX_HOPS = 2;

    /**
     * Extracts a bounded 2-hop subgraph given a full graph state and root node ID.
     */
    public static extractBoundedSubgraph(
        rootNodeId: string,
        allNodes: GraphNode[],
        allEdges: GraphEdge[],
        maxHops: number = CopilotContextFilter.MAX_HOPS
    ): BoundedSubgraph {
        const hops = Math.min(maxHops, CopilotContextFilter.MAX_HOPS);
        const visitedNodeIds = new Set<string>([rootNodeId]);
        let currentBoundary = new Set<string>([rootNodeId]);

        const selectedEdgeKeys = new Set<string>();

        for (let hop = 0; hop < hops; hop++) {
            const nextBoundary = new Set<string>();

            for (const edge of allEdges) {
                let targetId: string | null = null;

                if (currentBoundary.has(edge.source)) {
                    targetId = edge.target;
                } else if (currentBoundary.has(edge.target)) {
                    targetId = edge.source;
                }

                if (targetId) {
                    const edgeKey = `${edge.source}->${edge.relation}->${edge.target}`;
                    selectedEdgeKeys.add(edgeKey);

                    if (!visitedNodeIds.has(targetId)) {
                        visitedNodeIds.add(targetId);
                        nextBoundary.add(targetId);
                    }
                }
            }

            currentBoundary = nextBoundary;
            if (currentBoundary.size === 0) break;
        }

        const filteredNodes = allNodes.filter(node => visitedNodeIds.has(node.id));
        const filteredEdges = allEdges.filter(edge => selectedEdgeKeys.has(`${edge.source}->${edge.relation}->${edge.target}`));

        logger.debug(
            `[CopilotContextFilter] Extracted ${filteredNodes.length} nodes and ${filteredEdges.length} edges ` +
            `for root '${rootNodeId}' within ${hops}-hop boundary.`
        );

        return {
            rootNodeId,
            maxHops: hops,
            nodes: filteredNodes,
            edges: filteredEdges
        };
    }
}
