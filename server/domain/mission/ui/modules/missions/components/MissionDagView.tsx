import React, { useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    Edge,
    Node,
    Position,
    MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { CheckCircle2, Circle, Loader2, AlertCircle } from "lucide-react";

interface MissionDagViewProps {
    plan: any; // SupervisorPlan
}

const nodeTypes = {}; // Custom node types can be added here if needed

export function MissionDagView({ plan }: MissionDagViewProps) {
    const { nodes, edges } = useMemo(() => {
        if (!plan?.tasks) return { nodes: [], edges: [] };

        const nodes: Node[] = [];
        const edges: Edge[] = [];

        // Simple layout logic
        const xOffset = 250;
        const yOffset = 100;
        const taskLayers: Record<string, number> = {};

        // Calculate layers based on dependencies
        const calculateLayer = (taskId: string, visited = new Set<string>()): number => {
            if (taskLayers[taskId] !== undefined) return taskLayers[taskId];
            if (visited.has(taskId)) return 0; // Prevent infinite loops
            visited.add(taskId);

            const task = plan.tasks.find((t: any) => t.id === taskId);
            if (!task || !task.dependencies || task.dependencies.length === 0) {
                taskLayers[taskId] = 0;
                return 0;
            }

            const maxDepLayer = Math.max(...task.dependencies.map((d: string) => calculateLayer(d, visited)));
            taskLayers[taskId] = maxDepLayer + 1;
            return taskLayers[taskId];
        };

        plan.tasks.forEach((t: any) => calculateLayer(t.id));

        const layerCounts: Record<number, number> = {};

        plan.tasks.forEach((task: any) => {
            const layer = taskLayers[task.id] || 0;
            const indexInLayer = layerCounts[layer] || 0;
            layerCounts[layer] = indexInLayer + 1;

            const statusColor =
                task.status === 'completed' ? '#22c55e' :
                    task.status === 'in_progress' ? '#f59e0b' :
                        task.status === 'failed' ? '#ef4444' :
                            task.status === 'rejected' ? '#6366f1' : '#64748b';

            nodes.push({
                id: task.id,
                data: {
                    label: (
                        <div className="flex flex-col gap-1 p-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-[10px] truncate max-w-[120px]">{task.name}</span>
                                {task.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                                {task.status === 'in_progress' && <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />}
                                {task.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-500" />}
                                {task.status === 'pending' && <Circle className="w-3 h-3 text-muted-foreground" />}
                            </div>
                            <div className="flex gap-1 items-center">
                                <Badge variant="secondary" className="text-[7px] px-1 py-0 h-3 bg-foreground/5 border-none">
                                    {task.type}
                                </Badge>
                                <Badge variant="secondary" className="text-[7px] px-1 py-0 h-3 bg-foreground/10 border-none text-foreground">
                                    {task.assignedAgent || 'generalist'}
                                </Badge>
                            </div>
                        </div>
                    )
                },
                position: { x: layer * xOffset, y: indexInLayer * yOffset },
                style: {
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#fff',
                    border: `1px solid ${statusColor}`,
                    borderRadius: '8px',
                    width: 180,
                    fontSize: '10px'
                },
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
            });

            if (task.dependencies) {
                task.dependencies.forEach((depId: string) => {
                    const statusColorDep = '#64748b'; // Default link color
                    edges.push({
                        id: `e-${depId}-${task.id}`,
                        source: depId,
                        target: task.id,
                        animated: task.status === 'in_progress',
                        style: { stroke: statusColorLine(task.status) },
                        markerEnd: {
                            type: MarkerType.ArrowClosed,
                            color: statusColorLine(task.status),
                        },
                    });
                });
            }
        });

        function statusColorLine(status: string) {
            return status === 'completed' ? '#22c55e' : (status === 'in_progress' ? '#f59e0b' : '#334155');
        }

        return { nodes, edges };
    }, [plan]);

    return (
        <div className="w-full h-[400px] border-t border-border bg-background/20 backdrop-blur-sm overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                className="bg-background/20"
            >
                <Background color="#222" gap={20} />
                <Controls />
            </ReactFlow>
        </div>
    );
}
