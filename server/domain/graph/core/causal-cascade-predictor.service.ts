export interface SystemNode {
    id: string;
    name: string;
    type: "service" | "db_table" | "endpoint" | "symbol";
    failureProbability: number;
}

export interface DependencyEdge {
    sourceId: string;
    targetId: string;
    causalWeight: number; // Causal effect magnitude [0.0 - 1.0]
}

export interface CascadeAnalysisResult {
    triggerNodeId: string;
    impactedNodes: Array<{ nodeId: string; cascadeRisk: number }>;
    overallSystemRisk: number;
    recommendedRerouteNodes: string[];
    isSafeToDeploy: boolean;
}

export const causalCascadePredictorService = {
    /**
     * Estimates causal effect propagation across dependency graph edges
     * Cascade Risk(Target) = P(Failure_Source) * CausalWeight
     */
    predictCascadeRisk(
        triggerNode: SystemNode,
        nodes: SystemNode[],
        edges: DependencyEdge[]
    ): CascadeAnalysisResult {
        const impactedMap = new Map<string, number>();
        impactedMap.set(triggerNode.id, triggerNode.failureProbability);

        const nodeMap = new Map<string, SystemNode>();
        nodes.forEach(n => nodeMap.set(n.id, n));

        // BFS / DFS propagation of causal weights
        const queue: Array<{ id: string; risk: number }> = [{ id: triggerNode.id, risk: triggerNode.failureProbability }];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current.id)) continue;
            visited.add(current.id);

            const outgoingEdges = edges.filter(e => e.sourceId === current.id);
            for (const edge of outgoingEdges) {
                const targetRisk = current.risk * edge.causalWeight;
                const existingRisk = impactedMap.get(edge.targetId) || 0;
                const combinedRisk = Math.max(existingRisk, targetRisk);

                impactedMap.set(edge.targetId, Number(combinedRisk.toFixed(3)));
                if (targetRisk > 0.15) {
                    queue.push({ id: edge.targetId, risk: targetRisk });
                }
            }
        }

        const impactedNodes: Array<{ nodeId: string; cascadeRisk: number }> = [];
        let totalRiskSum = 0;
        const rerouteNodes: string[] = [];

        impactedMap.forEach((cascadeRisk, nodeId) => {
            impactedNodes.push({ nodeId, cascadeRisk });
            totalRiskSum += cascadeRisk;
            if (cascadeRisk >= 0.40 && nodeId !== triggerNode.id) {
                rerouteNodes.push(nodeId);
            }
        });

        const avgSystemRisk = impactedNodes.length > 0 ? totalRiskSum / impactedNodes.length : 0;
        const isSafeToDeploy = avgSystemRisk < 0.35 && rerouteNodes.length === 0;

        return {
            triggerNodeId: triggerNode.id,
            impactedNodes,
            overallSystemRisk: Number(avgSystemRisk.toFixed(3)),
            recommendedRerouteNodes: rerouteNodes,
            isSafeToDeploy
        };
    }
};
