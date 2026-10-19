type DiagramNode = Record<string, any>;
type DiagramEdge = Record<string, any>;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * React Flow requires every node to have a finite top-left position. Forge's
 * architecture agent is allowed to describe topology without laying it out,
 * so normalize that boundary instead of letting one incomplete node crash the
 * entire App Forge route.
 */
export function normalizeForgeDiagram(input: any) {
  const rawNodes: DiagramNode[] = Array.isArray(input?.nodes) ? input.nodes : [];
  const nodes = rawNodes.map((node, index) => {
    const supplied = node?.position;
    const x = finite(supplied?.x) ? supplied.x : finite(node?.x) ? node.x : (index % 3) * 260;
    const y = finite(supplied?.y) ? supplied.y : finite(node?.y) ? node.y : Math.floor(index / 3) * 150;
    return {
      ...node,
      id: String(node?.id ?? `forge-node-${index + 1}`),
      data: node?.data && typeof node.data === "object"
        ? node.data
        : { label: String(node?.label ?? node?.name ?? `Component ${index + 1}`) },
      position: { x, y },
    };
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawEdges: DiagramEdge[] = Array.isArray(input?.edges) ? input.edges : [];
  const edges = rawEdges
    .map((edge, index) => ({
      ...edge,
      id: String(edge?.id ?? `forge-edge-${index + 1}`),
      source: String(edge?.source ?? ""),
      target: String(edge?.target ?? ""),
    }))
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return { ...(input ?? {}), nodes, edges };
}
