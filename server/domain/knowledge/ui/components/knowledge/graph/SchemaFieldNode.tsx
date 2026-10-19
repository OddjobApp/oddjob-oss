import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Tag } from 'lucide-react';

interface SchemaFieldNodeData {
    label: string;
    dataType?: string;
}

export const SchemaFieldNode = memo(({ data, isConnectable }: { data: SchemaFieldNodeData; isConnectable: boolean }) => {
    return (
        <div className="px-3 py-1.5 bg-pink-50 rounded-full border border-pink-200 shadow-sm flex items-center gap-2 min-w-[120px] transition-colors hover:border-pink-400">
            <Handle type="target" position={Position.Left} isConnectable={isConnectable} className="!bg-pink-300 opacity-0" />
            <Tag className="w-3 h-3 text-pink-500" />
            <span className="text-xs font-medium text-pink-900">{data.label}</span>
            {data.dataType && <span className="text-[10px] text-pink-400 font-mono text-opacity-75">({data.dataType})</span>}
            <Handle type="source" position={Position.Right} isConnectable={isConnectable} className="!bg-pink-300 opacity-0" />
        </div>
    );
});

SchemaFieldNode.displayName = 'SchemaFieldNode';
