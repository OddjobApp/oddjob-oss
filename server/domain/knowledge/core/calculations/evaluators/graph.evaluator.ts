export interface SimpleGraph {
    nodes: number[];
    edges: Array<{ source: number; target: number; weight?: number }>;
}

export const graphEvaluator = {
    calculatePageRank(graph: SimpleGraph, dampingFactor: number = 0.85, maxIterations: number = 20): Map<number, number> {
        const scores = new Map<number, number>();
        const n = graph.nodes.length;
        if (n === 0) return scores;

        const initial = 1 / n;
        graph.nodes.forEach(id => scores.set(id, initial));

        const outDegrees = new Map<number, number>();
        graph.nodes.forEach(id => outDegrees.set(id, 0));
        graph.edges.forEach(e => {
            outDegrees.set(e.source, (outDegrees.get(e.source) || 0) + 1);
        });

        for (let iter = 0; iter < maxIterations; iter++) {
            const nextScores = new Map<number, number>();
            graph.nodes.forEach(id => nextScores.set(id, (1 - dampingFactor) / n));

            graph.edges.forEach(e => {
                const srcScore = scores.get(e.source) || 0;
                const outDeg = outDegrees.get(e.source) || 1;
                const currentTgtScore = nextScores.get(e.target) || 0;
                nextScores.set(e.target, currentTgtScore + dampingFactor * (srcScore / outDeg));
            });

            graph.nodes.forEach(id => scores.set(id, nextScores.get(id) || 0));
        }

        return scores;
    },
};
