import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Search } from 'lucide-react';

interface ValueNodeData {
    label: string;
    count?: number;
}

export const ValueNode = memo(({ data, isConnectable }: { data: ValueNodeData; isConnectable: boolean }) => {
    return (
        <div className="w-24 h-24 rounded-full bg-indigo-600 border-4 border-white shadow-xl flex flex-col items-center justify-center p-2 text-center transition-transform hover:scale-105 z-50">
            <Handle type="target" position={Position.Left} isConnectable={isConnectable} className="!bg-indigo-400 !w-3 !h-3 opacity-0" />

            <Search className="w-5 h-5 text-indigo-100 mb-1" />
            <span className="text-xs font-bold text-foreground leading-tight line-clamp-2 break-all">{data.label}</span>
            {data.count && <span className="text-[9px] text-indigo-200 mt-0.5">{data.count} found</span>}

            <Handle type="source" position={Position.Right} isConnectable={isConnectable} className="!bg-indigo-400 !w-3 !h-3 opacity-0" />
            <Handle type="source" position={Position.Top} isConnectable={isConnectable} className="!bg-indigo-400 !w-3 !h-3 opacity-0" />
            <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="!bg-indigo-400 !w-3 !h-3 opacity-0" />
        </div>
    );
});

ValueNode.displayName = 'ValueNode';
