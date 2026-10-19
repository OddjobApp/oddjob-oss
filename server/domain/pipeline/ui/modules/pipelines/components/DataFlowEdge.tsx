import React, { memo, useRef, useLayoutEffect } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, EdgeProps, Edge } from 'reactflow';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { cn } from '@/lib/utils';

export interface DataFlowEdgeData {
  dataType?: string;
  sampleData?: any;
  transformations?: Array<{
    operation: string;
    description: string;
  }>;
  isCritical?: boolean;
  dataSize?: {
    estimated: number;
    unit: string;
  };
  isConditional?: boolean;
  conditionValue?: boolean;
}

export type DataFlowEdge = Edge & {
  data: DataFlowEdgeData;
};

// Custom edge label renderer for data type indicators
const DataFlowEdgeLabel: React.FC<{ id: string, sourceX: number, sourceY: number, targetX: number, targetY: number, data?: DataFlowEdgeData }> = ({ id, sourceX, sourceY, targetX, targetY, data }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const midpoint = {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2
  };

  useLayoutEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.transform = `translate(-50%, -50%) translate(${midpoint.x}px,${midpoint.y}px)`;
    }
  }, [midpoint.x, midpoint.y]);

  if (!data) return null;

  return (
    <EdgeLabelRenderer>
      <div
        ref={containerRef}
        className="nodrag nopan absolute pointer-events-auto"
      >
        <div className="flex flex-col items-center gap-1 px-2 py-1 bg-background border rounded shadow-sm">
          {/* Data Type Badge */}
          {data.dataType && (
            <Badge
              variant="secondary"
              className={cn(
                "text-xs font-mono",
                data.isCritical && "border-destructive bg-destructive/10 text-destructive",
                data.isConditional && "border-blue-500 bg-blue-500/10 text-blue-700"
              )}
            >
              {data.dataType}
            </Badge>
          )}

          {/* Data Size */}
          {data.dataSize && (
            <div className="text-xs text-muted-foreground">
              ~{data.dataSize.estimated} {data.dataSize.unit}
            </div>
          )}

          {/* Conditional Indicator */}
          {data.isConditional && (
            <div className="text-xs text-blue-600 font-medium">
              {data.conditionValue ? 'TRUE' : 'FALSE'}
            </div>
          )}

          {/* Critical Path Indicator */}
          {data.isCritical && (
            <div className="text-xs text-orange-600 font-medium">
              CRITICAL
            </div>
          )}
        </div>
      </div>
    </EdgeLabelRenderer>
  );
};

// Data flow edge component
export const DataFlowEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  source,
  target,
  data,
  selected,
  animated,
  style = {},
  markerEnd,
  markerStart,
  ...props
}: EdgeProps<DataFlowEdgeData>) => {
  const pathRef = useRef<SVGPathElement>(null);

  // Calculate edge path
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: props.sourcePosition,
    targetX,
    targetY,
    targetPosition: props.targetPosition
  });

  useLayoutEffect(() => {
    if (pathRef.current && style) {
      Object.entries(style).forEach(([key, value]) => {
        (pathRef.current!.style as any)[key] = value;
      });
    }
  }, [style]);

  // Edge styling using Tailwind classes
  const edgeClassName = cn(
    "react-flow__edge-path transition-opacity duration-300",
    data?.isCritical ? "stroke-[3px]" : "stroke-2",
    selected
      ? "stroke-blue-500"
      : data?.isCritical
        ? "stroke-orange-500"
        : data?.isConditional
          ? "stroke-blue-500"
          : "stroke-slate-400",
    data?.isConditional && "[stroke-dasharray:5,5]",
    animated ? "opacity-80" : "opacity-100"
  );

  return (
    <>
      {/* Main edge path */}
      <path
        id={id}
        ref={pathRef}
        className={edgeClassName}
        d={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />

      {/* Data flow label */}
      <DataFlowEdgeLabel
        id={id}
        sourceX={sourceX}
        sourceY={sourceY}
        targetX={targetX}
        targetY={targetY}
        data={data}
      />

      {/* Animated flow indicator */}
      {animated && (
        <circle r="3" fill="#fff" className={cn("stroke-2", edgeClassName === "stroke-blue-500" ? "stroke-blue-500" : (data?.isCritical ? "stroke-orange-500" : (data?.isConditional ? "stroke-blue-500" : "stroke-slate-400")))}>
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={edgePath}
            fill="none"
          />
        </circle>
      )}
    </>
  );
});

DataFlowEdge.displayName = 'DataFlowEdge';

// Conditional branch edge (for decision nodes)
export const ConditionalEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  source,
  target,
  data,
  selected,
  style = {},
  ...props
}: EdgeProps<DataFlowEdgeData>) => {
  const pathRef = useRef<SVGPathElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: props.sourcePosition,
    targetX,
    targetY,
    targetPosition: props.targetPosition
  });

  useLayoutEffect(() => {
    if (pathRef.current && style) {
      Object.entries(style).forEach(([key, value]) => {
        (pathRef.current!.style as any)[key] = value;
      });
    }
  }, [style]);

  useLayoutEffect(() => {
    if (labelRef.current) {
      labelRef.current.style.transform = `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px,${(sourceY + targetY) / 2 - 20}px)`;
    }
  }, [sourceX, targetX, sourceY, targetY]);

  const isTrueBranch = data?.conditionValue === true;
  const branchLabel = isTrueBranch ? 'YES' : 'NO';

  return (
    <>
      {/* Main edge path */}
      <path
        id={id}
        ref={pathRef}
        className={cn(
          "react-flow__edge-path transition-opacity",
          selected ? "stroke-[3px] opacity-100" : "stroke-2 opacity-80",
          isTrueBranch ? "stroke-green-500" : "stroke-red-500"
        )}
        d={edgePath}
      />

      {/* Branch label */}
      <EdgeLabelRenderer>
        <div
          ref={labelRef}
          className="nodrag nopan absolute pointer-events-auto"
        >
          <Badge
            variant={isTrueBranch ? "default" : "secondary"}
            className={cn(
              "text-xs font-bold px-2 py-1",
              isTrueBranch && "bg-green-500 text-foreground",
              !isTrueBranch && "bg-red-500 text-foreground"
            )}
          >
            {branchLabel}
          </Badge>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

ConditionalEdge.displayName = 'ConditionalEdge';

// Error/Retry indicator edge
export const ErrorFlowEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  source,
  target,
  data,
  selected,
  style = {},
  animated = false,
  ...props
}: EdgeProps<DataFlowEdgeData>) => {
  const pathRef = useRef<SVGPathElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: props.sourcePosition,
    targetX,
    targetY,
    targetPosition: props.targetPosition
  });

  useLayoutEffect(() => {
    if (pathRef.current && style) {
      Object.entries(style).forEach(([key, value]) => {
        (pathRef.current!.style as any)[key] = value;
      });
    }
  }, [style]);

  useLayoutEffect(() => {
    if (labelRef.current) {
      labelRef.current.style.transform = `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px,${(sourceY + targetY) / 2}px)`;
    }
  }, [sourceX, targetX, sourceY, targetY]);

  return (
    <>
      {/* Main edge path with error styling */}
      <path
        id={id}
        ref={pathRef}
        className={cn(
          "react-flow__edge-path stroke-2 stroke-red-600 [stroke-dasharray:5,5]",
          selected ? "opacity-100" : "opacity-80"
        )}
        d={edgePath}
      />

      {/* Error indicator */}
      <EdgeLabelRenderer>
        <div
          ref={labelRef}
          className="nodrag nopan absolute pointer-events-auto"
        >
          <div className="flex items-center gap-1 px-2 py-1 bg-destructive text-destructive-foreground rounded text-xs font-medium">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1L6 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="6" cy="8" r="1" fill="currentColor" />
            </svg>
            ERROR
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

ErrorFlowEdge.displayName = 'ErrorFlowEdge';

export default DataFlowEdge;
