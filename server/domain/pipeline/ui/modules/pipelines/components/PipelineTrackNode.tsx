import React, { memo } from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { cn } from '@/lib/utils';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { MoreHorizontal, GripVertical } from 'lucide-react';

const PipelineTrackNode = ({ data, selected }: NodeProps) => {
    return (
        <div
            className={cn(
                "group relative h-full w-full rounded-xl border-2 transition-all duration-200 flex flex-col overflow-hidden",
                selected
                    ? "border-primary/50 bg-muted/80 shadow-md ring-2 ring-primary/20"
                    : "border-border/60 bg-muted/40 hover:border-border hover:bg-muted/60",
                "min-w-[300px] min-h-[200px]"
            )}
        >
            {/* Track Header / Handle */}
            <div
                className={cn(
                    "flex items-center justify-between px-4 py-3 border-b transition-colors bg-foreground/50 backdrop-blur-sm",
                    selected ? "border-primary/20 bg-primary/5" : "border-border"
                )}
            >
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-muted text-muted-foreground cursor-grab active:cursor-grabbing hover:bg-muted hover:text-muted-foreground transition-colors">
                        <GripVertical className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                        <span className={cn(
                            "font-semibold text-sm tracking-tight",
                            selected ? "text-primary" : "text-muted-foreground"
                        )}>
                            {data.label || "Untitled Job"}
                        </span>
                        {data.description && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                                {data.description}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {data.status && (
                        <Badge variant="outline" className={cn(
                            "text-[10px] h-5 px-2 capitalize",
                            data.status === 'active' ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "text-muted-foreground"
                        )}>
                            {data.status}
                        </Badge>
                    )}
                </div>
            </div>

            {/* Track Content Area (Swimlane) */}
            <div className="flex-1 relative bg-muted/30 p-4">
                {/* Drag Target Area Indicator (Only visible when dragging over?) 
                     For now just a clean background */}
                <div className="absolute inset-0 pattern-grid-lg opacity-[0.02] pointer-events-none" />
            </div>

            {/* Hidden handles for potential connections, though usually Steps connect, not Tracks */}
            <Handle type="target" position={Position.Left} className=" !opacity-0" />
            <Handle type="source" position={Position.Right} className=" !opacity-0" />
        </div>
    );
};

export default memo(PipelineTrackNode);
