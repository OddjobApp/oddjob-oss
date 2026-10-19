/**
 * Path Explainer Service
 * 
 * Generates human-readable explanations of graph traversal paths
 * for explainable AI and debugging.
 */

import { GraphPath } from './types.js';

/**
 * Path Explainer Service
 */
export class PathExplainerService {
  /**
   * Generate human-readable explanation of a graph path
   */
  generateExplanation(path: GraphPath, query?: string): string {
    if (!path.edges || path.edges.length === 0) {
      return 'Direct match from semantic search';
    }

    const segments: string[] = [];
    
    for (let i = 0; i < path.edges.length; i++) {
      const edge = path.edges[i];
      
      if (i === 0) {
        // Starting node
        const startLabel = edge.sourceLabel || edge.sourceName || `Node ${edge.sourceId}`;
        segments.push(startLabel);
      }
      
      // Relationship
      const relation = edge.relation || 'connected to';
      segments.push(`→ ${relation} →`);
      
      // Target node
      const targetLabel = edge.targetLabel || edge.targetName || `Node ${edge.targetId}`;
      segments.push(targetLabel);
    }

    // Add relevance context if query provided
    if (query) {
      const relevance = this.assessRelevance(path, query);
      if (relevance > 0.7) {
        segments.push('(highly relevant)');
      } else if (relevance > 0.4) {
        segments.push('(moderately relevant)');
      }
    }

    return segments.join(' ');
  }

  /**
   * Generate citation for attribution
   */
  generateCitation(path: GraphPath): string {
    const nodeIds = new Set<string>();
    
    // Collect all node IDs from the path
    path.edges.forEach(edge => {
      nodeIds.add(String(edge.sourceId));
      nodeIds.add(String(edge.targetId));
    });

    if (nodeIds.size === 0 && path.seedNodeId) {
      nodeIds.add(path.seedNodeId);
    }
    if (path.targetNodeId) {
      nodeIds.add(path.targetNodeId);
    }

    return `Knowledge graph sources: ${Array.from(nodeIds).join(', ')}`;
  }

  /**
   * Generate structured path breakdown
   */
  generateStructuredExplanation(path: GraphPath): {
    summary: string;
    steps: Array<{
      from: string;
      relation: string;
      to: string;
      confidence: number;
    }>;
    totalHops: number;
    pathScore: number;
  } {
    const steps = path.edges.map(edge => ({
      from: edge.sourceLabel || edge.sourceName || String(edge.sourceId),
      relation: edge.relation || 'connected',
      to: edge.targetLabel || edge.targetName || String(edge.targetId),
      confidence: edge.weight || 1.0
    }));

    return {
      summary: this.generateExplanation(path),
      steps,
      totalHops: path.hopCount || steps.length,
      pathScore: path.pathScore || 0
    };
  }

  /**
   * Compare two paths and explain differences
   */
  comparePaths(pathA: GraphPath, pathB: GraphPath): string {
    const explanationA = this.generateStructuredExplanation(pathA);
    const explanationB = this.generateStructuredExplanation(pathB);

    const differences: string[] = [];

    // Compare hop counts
    if (explanationA.totalHops !== explanationB.totalHops) {
      differences.push(
        `Path A has ${explanationA.totalHops} hops, Path B has ${explanationB.totalHops} hops`
      );
    }

    // Compare scores
    const scoreDiff = Math.abs(explanationA.pathScore - explanationB.pathScore);
    if (scoreDiff > 0.1) {
      const higher = explanationA.pathScore > explanationB.pathScore ? 'A' : 'B';
      differences.push(`Path ${higher} has higher relevance score (${scoreDiff.toFixed(2)} difference)`);
    }

    // Compare endpoints
    const lastStepA = explanationA.steps[explanationA.steps.length - 1];
    const lastStepB = explanationB.steps[explanationB.steps.length - 1];
    if (lastStepA?.to !== lastStepB?.to) {
      differences.push(`Different endpoints: "${lastStepA?.to}" vs "${lastStepB?.to}"`);
    }

    if (differences.length === 0) {
      return 'Paths are very similar in structure and relevance';
    }

    return differences.join('; ');
  }

  /**
   * Assess relevance of path to query (simple heuristic)
   */
  private assessRelevance(path: GraphPath, query: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    let matchCount = 0;

    // Check if any node labels match query terms
    for (const edge of path.edges) {
      const sourceText = (edge.sourceLabel || '').toLowerCase();
      const targetText = (edge.targetLabel || '').toLowerCase();

      for (const term of queryTerms) {
        if (sourceText.includes(term) || targetText.includes(term)) {
          matchCount++;
        }
      }
    }

    // Normalize by number of edges
    const maxPossible = queryTerms.length * path.edges.length;
    return maxPossible > 0 ? matchCount / maxPossible : 0;
  }

  /**
   * Generate explanation for multiple alternative paths
   */
  generateAlternativeExplanations(
    paths: GraphPath[],
    maxAlternatives: number = 3
  ): string[] {
    const sortedPaths = paths
      .sort((a, b) => (b.pathScore || 0) - (a.pathScore || 0))
      .slice(0, maxAlternatives);

    return sortedPaths.map((path, index) => {
      const explanation = this.generateExplanation(path);
      const score = (path.pathScore || 0).toFixed(2);
      return `${index + 1}. [Score: ${score}] ${explanation}`;
    });
  }
}
