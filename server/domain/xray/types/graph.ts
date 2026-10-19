/**
 * Shared XRay Graph Types
 *
 * Centralized interfaces for code nodes, edges, and metrics used by the
 * CodeGraphService and the XRay API routes.
 */

export interface GraphNode {
  id: number;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine?: number;
  isExported?: boolean;
}

export interface GraphEdge {
  sourceId: number;
  targetId: number;
  relation: string;
}

export interface CodeMetrics {
  fileCount: number;
  functionCount: number;
  classCount: number;
  interfaceCount: number;
  parseErrors: number;
  exportedFunctions: number;
  callEdgeCount: number;
  importEdgeCount: number;
}

export interface GraphQueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
