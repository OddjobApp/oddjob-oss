/**
 * CausalGraphVisualizer — Interactive node-and-edge diagram showing
 * EventPrimitives as source nodes connected by directed edges to affected
 * Cycles, Missions, Workstreams, and supplier dependency nodes.
 *
 * Requirements:
 * - 18.5: Interactive node-and-edge diagram of causal relationships
 * - 18.6: Click event node → show downstream entities with impact details
 * - 18.7: Click entity node → show linked events ordered by impact urgency
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph2D from "react-force-graph-2d";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CausalGraphVisualizerProps {
  organizationId: number;
  selectedEventId?: string; // Optional: focus on specific event
}

/** Severity color palette matching StreamLiveHUD */
const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ef4444", // red
  High: "#f97316", // orange
  Medium: "#eab308", // yellow
  Low: "#3b82f6", // blue
};

/** Entity type color palette */
const ENTITY_TYPE_COLORS: Record<string, string> = {
  cycle: "#8b5cf6", // violet
  mission: "#06b6d4", // cyan
  workstream: "#10b981", // emerald
  supplier: "#f59e0b", // amber
  geo_region: "#ec4899", // pink
};

interface EventNode {
  id: string;
  eventType: string;
  severity: string;
  jurisdiction: string;
  confidenceScore: number;
  targetSector: string;
}

interface GraphLink {
  eventPrimitiveId: string;
  targetEntityType: string;
  targetEntityId: string;
  impactHorizonMinDays: number;
  impactHorizonMaxDays: number;
  impactConfidence: number;
  blastRadius: number;
}

interface GraphNode {
  id: string;
  nodeType: "event" | "entity";
  label: string;
  color: string;
  // Event-specific fields
  eventType?: string;
  severity?: string;
  jurisdiction?: string;
  confidenceScore?: number;
  targetSector?: string;
  // Entity-specific fields
  entityType?: string;
  entityId?: string;
  // Force graph position fields
  x?: number;
  y?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  impactConfidence: number;
  impactHorizonMinDays: number;
  impactHorizonMaxDays: number;
}

interface EventDetailItem {
  entityType: string;
  entityId: string;
  impactHorizonMin: number;
  impactHorizonMax: number;
  confidence: number;
}

interface EntityDetailItem {
  eventId: string;
  eventType: string;
  severity: string;
  jurisdiction: string;
  impactHorizonMinDays: number;
  impactHorizonMaxDays: number;
  confidence: number;
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CausalGraphVisualizer({
  organizationId,
  selectedEventId,
}: CausalGraphVisualizerProps) {
  const graphRef = useRef<any>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

  // Selection state
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(
    new Set()
  );

  // Resize observer for responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Auto-fit zoom whenever graph data or dimensions change
  useEffect(() => {
    if (graphRef.current) {
      const timer = setTimeout(() => {
        graphRef.current?.zoomToFit(400, 60);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [dimensions.width, dimensions.height]);

  // Fetch event primitives
  const eventsQuery = useQuery<EventNode[]>({
    queryKey: [
      "/api/event-primitives",
      "causal-graph",
      organizationId,
      selectedEventId,
    ],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "200" });
      if (selectedEventId) {
        // For specific event, just fetch that one is enough — but the API
        // fetches by filter. We'll fetch recent and filter client-side.
      }
      return fetchJson(`/api/event-primitives?${params.toString()}`);
    },
    staleTime: 30_000,
  });

  // Fetch causal graph links for a specific event or all recent
  const linksQuery = useQuery<GraphLink[]>({
    queryKey: [
      "/api/causal-graph/links",
      "causal-graph",
      organizationId,
      selectedEventId,
    ],
    queryFn: async () => {
      if (selectedEventId) {
        return fetchJson(`/api/causal-graph/links/${selectedEventId}`);
      }
      // For full graph view, fetch links for all loaded events
      const events = eventsQuery.data || [];
      if (events.length === 0) return [];

      // Fetch links for each event in parallel (batch approach)
      const linkResults = await Promise.all(
        events.slice(0, 50).map((event) =>
          fetchJson<GraphLink[]>(
            `/api/causal-graph/links/${event.id}`
          ).catch(() => [] as GraphLink[])
        )
      );
      return linkResults.flat();
    },
    enabled: selectedEventId
      ? true
      : (eventsQuery.data?.length ?? 0) > 0,
    staleTime: 30_000,
  });

  // Build graph data from API responses
  const graphData = useMemo(() => {
    const events = eventsQuery.data || [];
    const links = linksQuery.data || [];

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const entityNodeIds = new Set<string>();

    // Filter events if selectedEventId is provided
    const relevantEvents = selectedEventId
      ? events.filter((e) => e.id === selectedEventId)
      : events;

    // Create event nodes
    for (const event of relevantEvents) {
      nodes.push({
        id: `event:${event.id}`,
        nodeType: "event",
        label: `${event.eventType}\n${event.jurisdiction}`,
        color: SEVERITY_COLORS[event.severity] || "#6b7280",
        eventType: event.eventType,
        severity: event.severity,
        jurisdiction: event.jurisdiction,
        confidenceScore: event.confidenceScore,
        targetSector: event.targetSector,
      });
    }

    // Create entity nodes and edges from links
    for (const link of links) {
      const entityNodeId = `entity:${link.targetEntityType}:${link.targetEntityId}`;

      // Add entity node if not already present
      if (!entityNodeIds.has(entityNodeId)) {
        entityNodeIds.add(entityNodeId);
        nodes.push({
          id: entityNodeId,
          nodeType: "entity",
          label: `${link.targetEntityType}\n${link.targetEntityId}`,
          color:
            ENTITY_TYPE_COLORS[link.targetEntityType] || "#6b7280",
          entityType: link.targetEntityType,
          entityId: link.targetEntityId,
        });
      }

      // Only add edge if the source event node exists
      const sourceId = `event:${link.eventPrimitiveId}`;
      if (nodes.some((n) => n.id === sourceId)) {
        edges.push({
          source: sourceId,
          target: entityNodeId,
          impactConfidence: link.impactConfidence,
          impactHorizonMinDays: link.impactHorizonMinDays,
          impactHorizonMaxDays: link.impactHorizonMaxDays,
        });
      }
    }

    return { nodes, links: edges };
  }, [eventsQuery.data, linksQuery.data, selectedEventId]);

  // Compute detail panel content based on selection
  const detailContent = useMemo(() => {
    if (!selectedNode) return null;
    const links = linksQuery.data || [];

    if (selectedNode.nodeType === "event") {
      // Show downstream entities with Impact_Horizon + confidence
      const eventId = selectedNode.id.replace("event:", "");
      const relatedLinks = links.filter(
        (l) => l.eventPrimitiveId === eventId
      );

      const items: EventDetailItem[] = relatedLinks.map((l) => ({
        entityType: l.targetEntityType,
        entityId: l.targetEntityId,
        impactHorizonMin: l.impactHorizonMinDays,
        impactHorizonMax: l.impactHorizonMaxDays,
        confidence: l.impactConfidence,
      }));

      return {
        type: "event" as const,
        title: selectedNode.eventType || "Event",
        subtitle: `${selectedNode.jurisdiction} · ${selectedNode.severity}`,
        items,
      };
    } else {
      // Show linked EventPrimitives ordered by impact_horizon_min_days ascending
      const entityType = selectedNode.entityType;
      const entityId = selectedNode.entityId;
      const events = eventsQuery.data || [];

      const relatedLinks = links
        .filter(
          (l) =>
            l.targetEntityType === entityType &&
            l.targetEntityId === entityId
        )
        .sort((a, b) => a.impactHorizonMinDays - b.impactHorizonMinDays);

      const items: EntityDetailItem[] = relatedLinks.map((l) => {
        const event = events.find((e) => e.id === l.eventPrimitiveId);
        return {
          eventId: l.eventPrimitiveId,
          eventType: event?.eventType || "Unknown",
          severity: event?.severity || "Unknown",
          jurisdiction: event?.jurisdiction || "Unknown",
          impactHorizonMinDays: l.impactHorizonMinDays,
          impactHorizonMaxDays: l.impactHorizonMaxDays,
          confidence: l.impactConfidence,
        };
      });

      return {
        type: "entity" as const,
        title: `${entityType}`,
        subtitle: entityId || "",
        items,
      };
    }
  }, [selectedNode, linksQuery.data, eventsQuery.data]);

  // Handle node click
  const handleNodeClick = useCallback(
    (node: any) => {
      const graphNode = node as GraphNode;
      setSelectedNode(graphNode);

      // Compute highlighted nodes
      const highlighted = new Set<string>();
      highlighted.add(graphNode.id);

      const links = linksQuery.data || [];

      if (graphNode.nodeType === "event") {
        // Highlight downstream entities
        const eventId = graphNode.id.replace("event:", "");
        for (const link of links) {
          if (link.eventPrimitiveId === eventId) {
            highlighted.add(
              `entity:${link.targetEntityType}:${link.targetEntityId}`
            );
          }
        }
      } else {
        // Highlight upstream events
        const entityType = graphNode.entityType;
        const entityId = graphNode.entityId;
        for (const link of links) {
          if (
            link.targetEntityType === entityType &&
            link.targetEntityId === entityId
          ) {
            highlighted.add(`event:${link.eventPrimitiveId}`);
          }
        }
      }

      setHighlightedNodes(highlighted);
    },
    [linksQuery.data]
  );

  // Handle background click to deselect
  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
    setHighlightedNodes(new Set());
  }, []);

  // Custom node rendering
  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const graphNode = node as GraphNode;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const size = graphNode.nodeType === "event" ? 8 : 6;
      const isHighlighted =
        highlightedNodes.size === 0 || highlightedNodes.has(graphNode.id);
      const alpha = isHighlighted ? 1.0 : 0.3;

      ctx.globalAlpha = alpha;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = graphNode.color;
      ctx.fill();

      // Draw border for selected node
      if (selectedNode?.id === graphNode.id) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw label
      const fontSize = Math.max(10 / globalScale, 3);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isHighlighted ? "#e5e7eb" : "#6b7280";

      const labelLines = (graphNode.label || "").split("\n");
      for (let i = 0; i < labelLines.length; i++) {
        ctx.fillText(labelLines[i], x, y + size + 2 + i * (fontSize + 1));
      }

      ctx.globalAlpha = 1.0;
    },
    [highlightedNodes, selectedNode]
  );

  // Custom link rendering with variable width and opacity
  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, _globalScale: number) => {
      const edge = link as GraphEdge;
      const source = link.source as any;
      const target = link.target as any;

      if (!source?.x || !target?.x) return;

      const confidence = edge.impactConfidence || 50;
      const thickness = Math.max(1, (confidence / 100) * 4);
      const opacity = Math.max(0.2, confidence / 100);

      // Check if this edge connects highlighted nodes
      const sourceId =
        typeof edge.source === "string"
          ? edge.source
          : (edge.source as any)?.id;
      const targetId =
        typeof edge.target === "string"
          ? edge.target
          : (edge.target as any)?.id;
      const isHighlighted =
        highlightedNodes.size === 0 ||
        (highlightedNodes.has(sourceId) && highlightedNodes.has(targetId));

      ctx.globalAlpha = isHighlighted ? opacity : 0.1;
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = thickness;

      // Draw line
      ctx.beginPath();
      ctx.moveTo(source.x, source.y!);
      ctx.lineTo(target.x, target.y!);
      ctx.stroke();

      // Draw arrowhead
      const angle = Math.atan2(
        target.y! - source.y!,
        target.x - source.x
      );
      const arrowLen = 6;
      ctx.beginPath();
      ctx.moveTo(target.x, target.y!);
      ctx.lineTo(
        target.x - arrowLen * Math.cos(angle - Math.PI / 6),
        target.y! - arrowLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        target.x - arrowLen * Math.cos(angle + Math.PI / 6),
        target.y! - arrowLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = "#94a3b8";
      ctx.fill();

      ctx.globalAlpha = 1.0;
    },
    [highlightedNodes]
  );

  // Link hover tooltip
  const linkLabel = useCallback((link: any) => {
    const edge = link as GraphEdge;
    return `Confidence: ${edge.impactConfidence}% · Impact: ${edge.impactHorizonMinDays}-${edge.impactHorizonMaxDays} days`;
  }, []);

  const isLoading = eventsQuery.isLoading || linksQuery.isLoading;
  const hasError = eventsQuery.isError || linksQuery.isError;
  const isEmpty = graphData.nodes.length === 0 && !isLoading;

  return (
    <div
      className="flex h-full flex-col"
      data-testid="causal-graph-visualizer"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div>
          <h3 className="text-sm font-semibold">Causal Graph</h3>
          <p className="text-xs text-muted-foreground">
            {graphData.nodes.length} nodes · {graphData.links.length} edges
          </p>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: SEVERITY_COLORS.Critical }}
            />
            Critical
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: SEVERITY_COLORS.High }}
            />
            High
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: SEVERITY_COLORS.Medium }}
            />
            Medium
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: SEVERITY_COLORS.Low }}
            />
            Low
          </span>
        </div>
      </div>

      {/* Main content: graph + detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="relative flex-1"
          data-testid="causal-graph-canvas"
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
              <p className="text-sm text-muted-foreground">
                Loading causal graph…
              </p>
            </div>
          )}
          {hasError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-destructive">
                Failed to load graph data. Please try again.
              </p>
            </div>
          )}
          {isEmpty && !hasError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">
                No causal relationships found.
              </p>
            </div>
          )}
          {!isEmpty && !hasError && (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={nodeCanvasObject}
              linkCanvasObject={linkCanvasObject}
              linkLabel={linkLabel}
              onNodeClick={handleNodeClick}
              onBackgroundClick={handleBackgroundClick}
              linkDirectionalArrowLength={0}
              cooldownTicks={100}
              nodeRelSize={6}
              backgroundColor="transparent"
            />
          )}
        </div>

        {/* Detail panel — shown when a node is selected */}
        {detailContent && (
          <div
            className="w-72 shrink-0 overflow-y-auto border-l bg-card p-3"
            data-testid="causal-graph-detail-panel"
          >
            <div className="mb-3">
              <h4 className="text-sm font-semibold">{detailContent.title}</h4>
              <p className="text-xs text-muted-foreground">
                {detailContent.subtitle}
              </p>
            </div>

            {detailContent.type === "event" && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Affected Entities ({detailContent.items.length})
                </p>
                {(detailContent.items as EventDetailItem[]).map((item) => (
                  <div
                    key={`${item.entityType}:${item.entityId}`}
                    className="rounded border p-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            ENTITY_TYPE_COLORS[item.entityType] || "#6b7280",
                        }}
                      />
                      <span className="font-medium capitalize">
                        {item.entityType}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-muted-foreground">
                      {item.entityId}
                    </p>
                    <div className="mt-1 flex justify-between text-muted-foreground">
                      <span>
                        Impact: {item.impactHorizonMin}–{item.impactHorizonMax}d
                      </span>
                      <span>{item.confidence}%</span>
                    </div>
                  </div>
                ))}
                {detailContent.items.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No linked entities found.
                  </p>
                )}
              </div>
            )}

            {detailContent.type === "entity" && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Linked Events — by urgency ({detailContent.items.length})
                </p>
                {(detailContent.items as EntityDetailItem[]).map((item) => (
                  <div
                    key={item.eventId}
                    className="rounded border p-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            SEVERITY_COLORS[item.severity] || "#6b7280",
                        }}
                      />
                      <span className="font-medium">{item.eventType}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {item.jurisdiction} · {item.severity}
                    </p>
                    <div className="mt-1 flex justify-between text-muted-foreground">
                      <span>
                        Horizon: {item.impactHorizonMinDays}–
                        {item.impactHorizonMaxDays}d
                      </span>
                      <span>{item.confidence}%</span>
                    </div>
                  </div>
                ))}
                {detailContent.items.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No linked events found.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CausalGraphVisualizer;
