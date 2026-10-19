import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Layers } from 'lucide-react';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';

interface GroupNodeData {
    label: string;
    count: number;
}

export const GroupNode = memo(({ data, isConnectable }: { data: GroupNodeData; isConnectable: boolean }) => {
    return (
        <div className="relative group">
            {/* Stack Effect Layers */}
            <div className="absolute top-2 left-2 w-full h-full bg-muted rounded-lg border border-border -z-10" />
            <div className="absolute top-1 left-1 w-full h-full bg-muted rounded-lg border border-border -z-10" />

            {/* Main Card */}
            <div className="min-w-[180px] px-4 py-3 bg-card rounded-lg border-2 border-border shadow-sm transition-all hover:border-border hover:shadow-md cursor-pointer">
                <Handle type="target" position={Position.Left} isConnectable={isConnectable} className="!bg-muted" />

                <div className="flex items-center gap-3">
                    <div className="p-2 bg-muted rounded-md">
                        <Layers className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Group</span>
                        <span className="text-sm font-bold text-foreground">{data.label}</span>
                    </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                    <Badge variant="secondary" className="bg-muted text-muted-foreground">
                        {data.count} items
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">Double-click to expand</span>
                </div>

                <Handle type="source" position={Position.Right} isConnectable={isConnectable} className="!bg-muted" />
            </div>
        </div>
    );
});

GroupNode.displayName = 'GroupNode';
