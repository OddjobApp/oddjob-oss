import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { RESOURCE_TYPE_ICONS } from "./ResourcePicker";
import { RESOURCE_TYPE_DEFINITIONS, type PlatformResource, type ResourceRiskLevel } from "@shared/resource-catalog";

export interface ResourceCanvasNodeData {
  resource: PlatformResource;
  isRoot?: boolean;
  isExpanding?: boolean;
  onExpand?: (key: string) => void;
}

const RISK_DOT_CLASS: Record<ResourceRiskLevel, string> = {
  low: "bg-muted-foreground/30",
  medium: "bg-amber-500",
  high: "bg-orange-600",
  critical: "bg-destructive",
};

export const ResourceCanvasNode = memo(function ResourceCanvasNode({
  data,
  selected,
}: NodeProps<ResourceCanvasNodeData>) {
  const { resource, isRoot, isExpanding, onExpand } = data;
  const Icon = RESOURCE_TYPE_ICONS[resource.type];

  return (
    <div
      className={cn(
        "w-[220px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
        isRoot && "border-primary/60",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-muted-foreground" />

      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{resource.name}</span>
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", RISK_DOT_CLASS[resource.riskLevel])} />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{RESOURCE_TYPE_DEFINITIONS[resource.type].label}</span>
            {resource.lifecycle !== "active" && (
              <Badge variant="outline" className="px-1 py-0 text-[10px]">
                {resource.lifecycle}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {onExpand && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onExpand(resource.key);
          }}
          disabled={isExpanding}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-dashed border-border py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {isExpanding ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Expand connections
        </button>
      )}
    </div>
  );
});

export const resourceCanvasNodeTypes = { resource: ResourceCanvasNode };
