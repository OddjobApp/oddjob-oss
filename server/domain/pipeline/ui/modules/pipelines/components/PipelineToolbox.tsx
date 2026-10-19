import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import {
    GitBranch,
    Repeat,
    Split,
    ArrowRightLeft,
    Zap,
    Database,
    Globe,
    Terminal,
    Bot,
    FileText,
    GripVertical
} from "lucide-react";
import { Job } from './types.js';

interface PipelineToolboxProps {
    jobs: Job[];
}

export const PipelineToolbox: React.FC<PipelineToolboxProps> = ({ jobs }) => {
    const onDragStart = (event: React.DragEvent, nodeType: string, data?: any) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        if (data) {
            event.dataTransfer.setData('application/reactflow/data', JSON.stringify(data));
        }
        event.dataTransfer.effectAllowed = 'move';
    };

    const getJobIcon = (type: string) => {
        switch (type) {
            case 'ai_api_call': return <Bot className="w-4 h-4" />;
            case 'sql_query': return <Database className="w-4 h-4" />;
            case 'selenium': return <Globe className="w-4 h-4" />;
            case 'python':
            case 'node_script': return <Terminal className="w-4 h-4" />;
            case 'transformer': return <Zap className="w-4 h-4" />;
            default: return <FileText className="w-4 h-4" />;
        }
    };

    return (
        <div className="h-full flex flex-col bg-muted/10 border-r">
            <div className="p-4 border-b bg-background/50">
                <h3 className="font-semibold text-sm">Toolbox</h3>
                <p className="text-xs text-muted-foreground">Drag items to the canvas</p>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                    {/* Logic Components */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Control Flow</h4>
                        <div className="grid gap-2">
                            <div
                                className="w-full flex items-center gap-2 p-3 bg-background border rounded-md cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors shadow-sm"
                                draggable
                                onDragStart={(event) => onDragStart(event, 'logic_gatekeeper', { label: 'Decision Node' })}
                            >
                                <GitBranch className="w-4 h-4 text-orange-500" />
                                <div className="flex-1 text-sm font-medium">Decision</div>
                                <GripVertical className="w-3 h-3 text-muted-foreground" />
                            </div>

                            <div
                                className="w-full flex items-center gap-2 p-3 bg-background border rounded-md cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors shadow-sm"
                                draggable
                                onDragStart={(event) => onDragStart(event, 'iterator', { label: 'Iterator' })}
                            >
                                <Repeat className="w-4 h-4 text-blue-500" />
                                <div className="flex-1 text-sm font-medium">Iterator</div>
                                <GripVertical className="w-3 h-3 text-muted-foreground" />
                            </div>

                            <div
                                className="w-full flex items-center gap-2 p-3 bg-background border rounded-md cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors shadow-sm"
                                draggable
                                onDragStart={(event) => onDragStart(event, 'router', { label: 'Router' })}
                            >
                                <Split className="w-4 h-4 text-purple-500" />
                                <div className="flex-1 text-sm font-medium">Router</div>
                                <GripVertical className="w-3 h-3 text-muted-foreground" />
                            </div>
                        </div>
                    </div>

                    {/* Jobs List */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available Activities</h4>
                        {jobs.length === 0 ? (
                            <div className="p-4 text-center border-2 border-dashed rounded-md">
                                <p className="text-xs text-muted-foreground">No activities found</p>
                            </div>
                        ) : (
                            <div className="grid gap-2">
                                {jobs.map(job => (
                                    <div
                                        key={job.id}
                                        className="w-full flex items-center gap-2 p-3 bg-background border rounded-md cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors shadow-sm group"
                                        draggable
                                        onDragStart={(event) => onDragStart(event, 'job', { jobId: job.id, label: job.name, jobType: job.type })}
                                    >
                                        <div className={`p-1.5 rounded-md bg-opacity-10 ${job.type === 'ai_api_call' ? 'bg-green-500 text-green-600' :
                                            job.type === 'sql_query' ? 'bg-blue-500 text-blue-600' :
                                                'bg-gray-500 text-muted-foreground'
                                            }`}>
                                            {getJobIcon(job.type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium truncate">{job.name}</div>
                                            <div className="text-[10px] text-muted-foreground truncate capitalize">{job.type.replace(/_/g, ' ')}</div>
                                        </div>
                                        <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
};
