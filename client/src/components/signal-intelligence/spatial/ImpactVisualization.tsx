/**
 * ImpactVisualization — Data-driven causal impact graph replacing the static
 * IMPACT_POINTS scatter plot.
 *
 * Renders a radial layout:
 *   - Central node: selected signal (colored by severity)
 *   - Peripheral nodes: unique target entities from causal links (colored by severity)
 *   - Edges: lines connecting center to each peripheral node, width ∝ impactConfidence
 *
 * Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7
 */

import { useMemo } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { severityToColor } from './utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CausalLinkDto {
  id: string;
  targetEntityType: string;
  targetEntityId: string;
  impactConfidence: number;
  blastRadius: number;
}

export interface ImpactVisualizationProps {
  signalId: string;
  causalLinks: CausalLinkDto[];
  isLoading: boolean;
  error: Error | null;
  severity?: string;
  onNodeClick: (entityType: string, entityId: string) => void;
  onRetry?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface UniqueNode {
  key: string;
  entityType: string;
  entityId: string;
  /** Maximum impactConfidence among links targeting this entity */
  maxConfidence: number;
  /** The severity inferred from confidence (used for color) */
  severity: string;
}

function confidenceToSeverity(confidence: number): string {
  if (confidence >= 0.9) return 'Critical';
  if (confidence >= 0.7) return 'High';
  if (confidence >= 0.4) return 'Medium';
  return 'Low';
}

/** The database stores impact confidence as an integer percentage. */
function normalizeConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence > 1 ? confidence / 100 : confidence));
}

/**
 * Deduplicate causal links into unique entity nodes.
 * When multiple links target the same entity, keep the highest impactConfidence.
 */
function deriveUniqueNodes(links: CausalLinkDto[]): UniqueNode[] {
  const map = new Map<string, UniqueNode>();
  for (const link of links) {
    const confidence = normalizeConfidence(link.impactConfidence);
    const key = `${link.targetEntityType}:${link.targetEntityId}`;
    const existing = map.get(key);
    if (!existing || confidence > existing.maxConfidence) {
      map.set(key, {
        key,
        entityType: link.targetEntityType,
        entityId: link.targetEntityId,
        maxConfidence: confidence,
        severity: confidenceToSeverity(confidence),
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Calculate positions for peripheral nodes distributed evenly around a circle.
 */
function layoutNodes(count: number, cx: number, cy: number, radius: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

const SVG_WIDTH = 460;
const SVG_HEIGHT = 300;
const CENTER_X = SVG_WIDTH / 2;
const CENTER_Y = SVG_HEIGHT / 2;
const RADIUS = 110;
const CENTER_NODE_R = 28;
const PERIPHERAL_NODE_R = 18;

export function ImpactVisualization({
  signalId,
  causalLinks,
  isLoading,
  error,
  severity = 'Medium',
  onNodeClick,
  onRetry,
}: ImpactVisualizationProps) {
  const uniqueNodes = useMemo(() => deriveUniqueNodes(causalLinks), [causalLinks]);
  const positions = useMemo(
    () => layoutNodes(uniqueNodes.length, CENTER_X, CENTER_Y, RADIUS),
    [uniqueNodes.length],
  );

  // Loading state (Requirement 2.7)
  if (isLoading) {
    return (
      <div
        className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/35 px-4"
        data-testid="impact-viz-loading"
        aria-label="Loading impact visualization"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading causal data…</span>
      </div>
    );
  }

  // Error state (Requirement 2.6)
  if (error) {
    return (
      <div
        className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-center"
        data-testid="impact-viz-error"
        role="alert"
      >
        <div>
          <p className="text-sm font-medium text-destructive">Causal data could not be loaded.</p>
          <p className="mt-1 text-xs text-muted-foreground">The signal is still available. Retry the affected-entity lookup.</p>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-accent">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        )}
      </div>
    );
  }

  // Empty state (Requirement 2.2)
  if (uniqueNodes.length === 0) {
    return (
      <div
        className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/35 px-4"
        data-testid="impact-viz-empty"
      >
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">No affected entities mapped</p>
          <p className="mt-1 text-xs text-muted-foreground">The signal is valid, but its sector and jurisdiction do not currently match a business asset.</p>
        </div>
      </div>
    );
  }

  const edgeData = causalLinks.map((link) => {
    const key = `${link.targetEntityType}:${link.targetEntityId}`;
    const nodeIndex = uniqueNodes.findIndex((n) => n.key === key);
    return { link, nodeIndex };
  });

  const centralColor = severityToColor(severity);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border/70 bg-background/35 p-2"
      data-testid="impact-viz-graph"
      aria-label="Impact visualization graph"
    >
      <div className="absolute right-3 top-3 z-10">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          {uniqueNodes.length} Causal Link{uniqueNodes.length > 1 ? 's' : ''}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="h-[300px] w-full"
        role="img"
        aria-label={`Causal impact graph for signal ${signalId} with ${uniqueNodes.length} affected entities`}
      >
        <defs>
          <linearGradient id="link-gradient" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor={centralColor} stopOpacity="0.8" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.8" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Edges with gradient and directional pulse */}
        {edgeData.map(({ link, nodeIndex }) => {
          if (nodeIndex < 0) return null;
          const pos = positions[nodeIndex];
          const strokeWidth = Math.max(2, Math.min(6, normalizeConfidence(link.impactConfidence) * 4));
          return (
            <g key={link.id}>
              <line
                data-testid={`impact-edge-${link.id}`}
                x1={CENTER_X}
                y1={CENTER_Y}
                x2={pos.x}
                y2={pos.y}
                stroke="url(#link-gradient)"
                strokeWidth={strokeWidth}
                strokeDasharray="4 2"
                className="animate-[dash_10s_linear_infinite]"
              />
              <circle
                cx={(CENTER_X + pos.x) / 2}
                cy={(CENTER_Y + pos.y) / 2}
                r="3"
                fill="#10b981"
                filter="url(#glow)"
              />
            </g>
          );
        })}

        {/* Peripheral nodes */}
        {uniqueNodes.map((node, i) => {
          const pos = positions[i];
          const color = severityToColor(node.severity);
          const entityDisplayName = node.entityId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

          return (
            <g
              key={node.key}
              data-testid={`impact-node-${node.key}`}
              className="cursor-pointer group"
              onClick={() => onNodeClick(node.entityType, node.entityId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNodeClick(node.entityType, node.entityId);
                }
              }}
              aria-label={`${node.entityType}: ${node.entityId}`}
            >
              {/* Outer halo */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={PERIPHERAL_NODE_R + 6}
                fill={color}
                fillOpacity={0.1}
                className="transition-all duration-300 group-hover:r-28 group-hover:fill-opacity-20"
              />
              {/* Main Node */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={PERIPHERAL_NODE_R}
                fill="#0f172a"
                stroke={color}
                strokeWidth={2.5}
                filter="url(#glow)"
              />
              {/* Type Badge Icon Text */}
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                className="fill-foreground text-[10px] font-bold uppercase tracking-wider"
              >
                {node.entityType.substring(0, 3)}
              </text>
              {/* Rich Display Label */}
              <text
                x={pos.x}
                y={pos.y + PERIPHERAL_NODE_R + 14}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold tracking-tight"
              >
                {entityDisplayName.length > 22 ? `${entityDisplayName.substring(0, 20)}…` : entityDisplayName}
              </text>
              <text
                x={pos.x}
                y={pos.y + PERIPHERAL_NODE_R + 26}
                textAnchor="middle"
                className="fill-emerald-400 text-[9px] font-medium"
              >
                {typeof node.maxConfidence === 'number'
                  ? `${Math.round(node.maxConfidence * 100)}% Match • ${node.entityType}`
                  : node.entityType}
              </text>
            </g>
          );
        })}

        {/* Central node (selected signal) */}
        <g data-testid="impact-node-center">
          <circle
            cx={CENTER_X}
            cy={CENTER_Y}
            r={CENTER_NODE_R + 8}
            fill={centralColor}
            fillOpacity={0.12}
            className="animate-ping"
          />
          <circle
            cx={CENTER_X}
            cy={CENTER_Y}
            r={CENTER_NODE_R}
            fill="#090d16"
            stroke={centralColor}
            strokeWidth={3}
            filter="url(#glow)"
          />
          <text
            x={CENTER_X}
            y={CENTER_Y - 4}
            textAnchor="middle"
            className="fill-foreground text-[10px] font-bold tracking-wide uppercase"
          >
            Trigger
          </text>
          <text
            x={CENTER_X}
            y={CENTER_Y + 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px] font-semibold"
          >
            Signal
          </text>
        </g>
      </svg>
    </div>
  );
}
