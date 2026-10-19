
import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';

interface OutputBrowserProps {
    data: any;
    onSelectPath?: (path: string, value: any) => void;
    height?: string;
    className?: string;
}

interface TreeNodeProps {
    data: any;
    path: string; // dot notation path
    name: string; // key or index
    onSelectPath?: (path: string, value: any) => void;
    level: number;
}

const TreeNode: React.FC<TreeNodeProps> = ({ data, path, name, onSelectPath, level }) => {
    const [expanded, setExpanded] = useState(false);
    const isObject = data !== null && typeof data === 'object';
    const isArray = Array.isArray(data);
    const type = isArray ? 'array' : isObject ? 'object' : typeof data;

    // Truncate long strings for display
    const displayValue = isObject
        ? (isArray ? `Array(${data.length})` : '{...}')
        : String(data).length > 50 ? String(data).substring(0, 50) + '...' : String(data);

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(!expanded);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isObject && onSelectPath) {
            // Allow selecting primitives
            onSelectPath(path, data);
        } else if (isObject && onSelectPath) {
            // Allow selecting objects/arrays too (e.g. for iteration root)
            onSelectPath(path, data);
        }
        // Also toggle expand if object
        if (isObject) {
            setExpanded(!expanded);
        }
    };

    return (
        <div className="text-sm font-mono">
            <div
                className={cn(
                    "flex items-center py-1 px-2 hover:bg-muted/50 rounded cursor-pointer transition-colors",
                    level > 0 && "ml-4"
                )}
                onClick={handleClick}
            >
                <span className="mr-1 w-4 h-4 flex items-center justify-center text-muted-foreground" onClick={handleToggle}>
                    {isObject && (expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                </span>

                <span className="text-blue-500 mr-2">{name}</span>

                {!expanded && (
                    <span className={cn(
                        "text-muted-foreground",
                        type === 'string' && "text-green-600",
                        type === 'number' && "text-orange-500",
                        type === 'boolean' && "text-purple-500"
                    )}>
                        : {displayValue}
                    </span>
                )}
            </div>

            {isObject && expanded && (
                <div className="border-l border-muted ml-2">
                    {Object.entries(data).map(([key, value]) => {
                        const currentPath = path ? (isArray ? `${path}[${key}]` : `${path}.${key}`) : key;
                        return (
                            <TreeNode
                                key={key}
                                data={value}
                                name={key}
                                path={currentPath}
                                onSelectPath={onSelectPath}
                                level={level + 1}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const OutputBrowser: React.FC<OutputBrowserProps> = ({ data, onSelectPath, height = "300px", className }) => {
    if (data === undefined || data === null) {
        return <div className="text-muted-foreground italic p-4">No output data available to browse.</div>;
    }

    return (
        <div className={cn("border rounded-md bg-background", className)}>
            <div className="bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground border-b flex justify-between">
                <span>Output Preview</span>
                <span>Click a value to select its path</span>
            </div>
            <ScrollArea className="w-full" style={{ height }}>
                <div className="p-2">
                    <TreeNode data={data} path="" name="root" onSelectPath={onSelectPath} level={0} />
                </div>
            </ScrollArea>
        </div>
    );
};
