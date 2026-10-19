import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    Edge,
    Node,
    MarkerType,
    Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { GitBranch, AlertCircle, Loader2 } from "lucide-react";
import { useQuery } from '@tanstack/react-query';

// Custom node styles could go here
const nodeDefaults = {
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: {
        background: '#1e1e1e',
        color: '#fff',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '10px',
        width: 180,
        fontSize: '12px'
    },
};

export default function OverrideVisualizer() {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    const { data, isLoading } = useQuery({
        queryKey: ["/api/governor/hierarchy"],
    });

    useEffect(() => {
        if (!data) return;

        const { missions, pipelines, jobs, members } = data as {
            missions: any[],
            pipelines: any[],
            jobs: any[],
            members: any[]
        };

        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];

        // 1. Root Node: Global
        newNodes.push({
            id: 'global',
            type: 'input',
            data: { label: 'Global Policy' },
            position: { x: 50, y: 300 }, // Centered roughly
            ...nodeDefaults,
            style: { ...nodeDefaults.style, border: '2px solid #3b82f6', background: '#0f172a' }
        });

        const COL_WG = 300;
        const COL_PIPE = 600;
        const COL_JOB = 900;
        let yWg = 50;

        // Helper to track y positions
        let yMap = { wg: 50, pipe: 50, job: 50 };

        // 2. Workgroups (Level 1)
        missions.forEach((wg: any, index: number) => {
            const nodeId = `wg-${wg.id}`;
            newNodes.push({
                id: nodeId,
                data: { label: wg.name },
                position: { x: COL_WG, y: yMap.wg },
                ...nodeDefaults
            });

            // Edge: Global -> Workgroup
            newEdges.push({
                id: `e-global-${nodeId}`,
                source: 'global',
                target: nodeId,
                animated: true,
                markerEnd: { type: MarkerType.ArrowClosed }
            });

            yMap.wg += 100;
        });

        // 3. Pipelines (Level 2)
        // Find which pipelines belong to which mission
        pipelines.forEach((p: any) => {
            const nodeId = `pipe-${p.id}`;
            // Check membership
            const membership = members.find((m: any) => m.entityType === 'pipeline' && m.entityId === p.id);

            const parentId = membership ? `wg-${membership.missionId}` : 'global';

            // If connected to global, maybe place it differently, but for now stack in column 2
            newNodes.push({
                id: nodeId,
                data: { label: `Pipe: ${p.name}` },
                position: { x: COL_PIPE, y: yMap.pipe },
                ...nodeDefaults
            });

            newEdges.push({
                id: `e-${parentId}-${nodeId}`,
                source: parentId,
                target: nodeId,
                animated: true,
                label: membership ? undefined : 'Orphan',
                style: { stroke: membership ? '#777' : '#eab308' }, // Yellow for orphan/direct global
                markerEnd: { type: MarkerType.ArrowClosed }
            });

            yMap.pipe += 100;
        });

        // 4. Jobs (Level 3)
        jobs.forEach((j: any) => {
            const nodeId = `job-${j.id}`;
            // Check membership
            const membership = members.find((m: any) => m.entityType === 'job' && m.entityId === j.id);
            // OR check if job belongs to a pipeline (not directly in members table usually, implicit via logic)
            // For now, only visualize explicit mission membership or Global fallback

            const parentId = membership ? `wg-${membership.missionId}` : 'global';

            newNodes.push({
                id: nodeId,
                type: 'output',
                data: { label: `Job: ${j.name}` },
                position: { x: COL_JOB, y: yMap.job },
                ...nodeDefaults,
                style: { ...nodeDefaults.style, border: '1px solid #22c55e' } // Green for execution units
            });

            newEdges.push({
                id: `e-${parentId}-${nodeId}`,
                source: parentId,
                target: nodeId,
                animated: true,
                style: { stroke: membership ? '#777' : '#eab308' },
                markerEnd: { type: MarkerType.ArrowClosed }
            });

            yMap.job += 80;
        });

        setNodes(newNodes);
        setEdges(newEdges);
    }, [data, setNodes, setEdges]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges],
    );

    if (isLoading) {
        return <div className="flex h-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;
    }

    return (
        <div className="h-[calc(100vh-100px)] p-4 flex flex-col gap-4">
            <Card className="p-4 bg-muted/10 border-none shadow-none">
                <div className="flex items-center gap-3 mb-2">
                    <GitBranch className="w-6 h-6 text-primary" />
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Policy Resolution Visualizer</h1>
                        <p className="text-muted-foreground text-sm">
                            Visualizing how governance rules cascade and override from Global to Job level.
                        </p>
                    </div>
                </div>
            </Card>

            <div className="flex-1 border rounded-xl overflow-hidden shadow-soft bg-background/50 backdrop-blur-sm">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    fitView
                    attributionPosition="bottom-right"
                >
                    <MiniMap
                        nodeStrokeColor={(n) => {
                            if (n.style?.background) return n.style.background as string;
                            if (n.type === 'input') return '#0041d0';
                            if (n.type === 'output') return '#ff0072';
                            if (n.type === 'default') return '#1a192b';
                            return '#eee';
                        }}
                        nodeColor={(n) => {
                            if (n.style?.background) return n.style.background as string;
                            return '#fff';
                        }}
                        nodeBorderRadius={2}
                    />
                    <Controls />
                    <Background color="#aaa" gap={16} />
                </ReactFlow>
            </div>

            <Card className="p-4 bg-yellow-500/10 border-yellow-500/20">
                <div className="flex gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-500" />
                    <div className="text-sm">
                        <span className="font-semibold text-yellow-500">Note:</span> The edges represent inheritance flow. A yellow edge indicates a direct Global fallback (Orphan).
                    </div>
                </div>
            </Card>
        </div>
    );
}
