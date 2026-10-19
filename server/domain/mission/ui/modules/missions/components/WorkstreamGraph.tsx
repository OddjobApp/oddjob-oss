
import React, { useEffect, useMemo, useCallback, useRef } from 'react';
import ReactFlow, {
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    Node,
    Edge,
    Position,
    MarkerType,
    NodeProps,
    Handle,
    type ReactFlowInstance
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { Bot, Server, Play, Pause, AlertTriangle, FileText, Ban, UserPlus, Wrench, Package, ArrowRight } from 'lucide-react';
import { AddMemberDialog } from './AddMemberDialog.js';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
    ContextMenuLabel
} from "@domain-ui/core/ui/components/ui/context-menu";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface WorkstreamGraphProps {
    mission: any;
    run?: any;
    activeExecution?: any;
}

const nodeWidth = 220;
const nodeHeight = 90;

// ============================================================================
// Custom Node Component
// ============================================================================

const WorkstreamNode = ({ data }: NodeProps) => {
    const { role, entityType, entityId, status, label, missionId, onAction, nodeType } = data;
    const isPaused = status === 'paused' || status === 'waiting_on_human' || status === 'waiting_on_file';

    // Determine colors based on role and status
    let bgColor = 'bg-muted/80';
    let borderColor = 'border-border';
    let iconColor = 'text-muted-foreground';

    if (nodeType === 'tool') {
        bgColor = 'bg-blue-900/20';
        borderColor = 'border-blue-500/30';
        iconColor = 'text-blue-400';
    } else if (nodeType === 'deliverable') {
        bgColor = 'bg-teal-900/20';
        borderColor = 'border-teal-500/30';
        iconColor = 'text-teal-400';
    } else if (role === 'supervisor' || role === 'Supervisor' || role === 'primary_strategist' || role === 'Primary Strategist') {
        bgColor = 'bg-primary/20';
        borderColor = 'border-primary/50';
        iconColor = 'text-primary';
    } else if (isPaused) {
        bgColor = 'bg-card/60';
        borderColor = 'border-border';
        iconColor = 'text-muted-foreground';
    } else if (status === 'active' || status === 'running' || status === 'completed') {
        bgColor = status === 'completed' ? 'bg-card/40' : 'bg-primary/10';
        borderColor = status === 'completed' ? 'border-border' : 'border-primary/40';
        iconColor = status === 'completed' ? 'text-muted-foreground' : 'text-primary';
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger disabled={nodeType === 'tool' || nodeType === 'deliverable'}>
                <div className={`relative flex flex-col items-center justify-center p-3 rounded-xl border shadow-2xl transition-all duration-300 hover:scale-105 hover:border-primary/60 backdrop-blur-md ${bgColor} ${borderColor} w-[220px] min-h-[90px]`}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none rounded-xl" />
                    <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2 !border-none" />

                    <div className="flex flex-col items-center gap-1.5 w-full">
                        <div className={`text-[10px] uppercase tracking-widest font-bold ${iconColor}`}>
                            {nodeType === 'tool' ? 'Tool' : nodeType === 'deliverable' ? 'Deliverable' : (role === 'primary_strategist' ? 'Commander' : (role || 'Member'))}
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] text-foreground text-center">
                            {nodeType === 'tool' ? <Wrench size={13} className={iconColor} /> : 
                             nodeType === 'deliverable' ? <Package size={13} className={iconColor} /> :
                             entityType === 'job' ? <Bot size={13} /> : <Server size={13} />}
                            <span className="truncate max-w-[170px]">{label}</span>
                        </div>
                        {status === 'completed' && nodeType !== 'deliverable' && (
                            <div className="text-[9px] text-muted-foreground mt-1 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600"></span>
                                Completed
                            </div>
                        )}
                        {isPaused && (
                            <div className="absolute top-2 right-2 text-primary">
                                <Pause size={10} fill="currentColor" />
                            </div>
                        )}
                        {(status === 'active' || status === 'running') && !isPaused && (
                           <div className="absolute top-2 right-2 flex gap-0.5">
                              <span className="w-1 h-1 rounded-full bg-primary animate-pulse"></span>
                              <span className="w-1 h-1 rounded-full bg-primary animate-pulse delay-75"></span>
                           </div>
                        )}
                    </div>

                    <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2 !border-none" />
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64 bg-background border-border text-foreground">
                <ContextMenuLabel>
                    Actions for {entityType === 'job' ? 'Agent' : 'Pipeline'} #{entityId}
                </ContextMenuLabel>
                <ContextMenuSeparator className="bg-muted" />

                <ContextMenuItem
                    className="flex items-center gap-2 cursor-pointer focus:bg-muted focus:text-foreground"
                    onClick={() => onAction('toggle_status', { missionId, id: data.id, status: isPaused ? 'active' : 'paused' })}
                >
                    {isPaused ? <Play size={14} /> : <Pause size={14} />}
                    {isPaused ? "Resume Assignment" : "Pause Assignment"}
                </ContextMenuItem>

                <ContextMenuItem
                    className="flex items-center gap-2 cursor-pointer focus:bg-muted focus:text-foreground"
                    onClick={() => onAction('view_logs', { entityType, entityId })}
                >
                    <FileText size={14} />
                    View Execution Logs
                </ContextMenuItem>

                <ContextMenuSeparator className="bg-muted" />

                <ContextMenuItem
                    className="flex items-center gap-2 text-red-500 focus:text-red-400 focus:bg-red-950/20 cursor-pointer"
                    onClick={() => onAction('emergency_stop', { entityType, entityId })}
                >
                    <Ban size={14} />
                    Emergency Stop
                </ContextMenuItem>

                <ContextMenuItem
                    className="flex items-center gap-2 text-red-500 focus:text-red-400 focus:bg-red-950/20 cursor-pointer"
                    onClick={() => {
                        if (confirm(`Are you sure you want to remove this ${entityType} from the mission?`)) {
                            onAction('remove_member', { missionId, entityType, entityId });
                        }
                    }}
                >
                    <Ban size={14} className="rotate-45" />
                    Remove from Mission
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu >
    );
};

// ============================================================================
// Layout Engine
// ============================================================================

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({ rankdir: 'TB', ranksep: 100, nodesep: 80 });

    if (!nodes.length) return { nodes, edges };

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        if (!nodeWithPosition) return node;

        // Dagre returns center point, reactflow needs top left
        node.position = {
            x: nodeWithPosition.x - nodeWidth / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
        };

        return node;
    });

    return { nodes: layoutedNodes, edges };
};

// ============================================================================
// Main Component
// ============================================================================

export function WorkstreamGraph({ mission, run, activeExecution }: WorkstreamGraphProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const reactFlowRef = useRef<ReactFlowInstance | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Node Types definition (memoized)
    const nodeTypes = useMemo(() => ({ workstreamNode: WorkstreamNode }), []);

    const onInit = useCallback((instance: ReactFlowInstance) => {
        reactFlowRef.current = instance;
        // Delay fitView for forceMount tabs that render hidden initially
        setTimeout(() => instance.fitView({ duration: 400, padding: 0.3 }), 100);
    }, []);

    // Re-fit when container becomes visible (forceMount tabs)
    useEffect(() => {
        const el = containerRef.current;
        if (!el || !reactFlowRef.current) return;

        let lastWidth = el.offsetWidth;
        let lastHeight = el.offsetHeight;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 20 && height > 20) {
                    // Only fit check if size actually changed materially or became visible
                    if (Math.abs(width - lastWidth) > 5 || Math.abs(height - lastHeight) > 5 || (lastWidth === 0 && width > 0)) {
                        lastWidth = width;
                        lastHeight = height;
                        // Small delay to ensure styles are applied
                        setTimeout(() => {
                            reactFlowRef.current?.fitView({ duration: 400, padding: 0.3 });
                        }, 100);
                    }
                }
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [nodes.length]); // Use nodes.length to trigger re-fit when nodes arrive

    // Action Handlers
    const toggleStatusMutation = useMutation({
        mutationFn: async ({ missionId, id, status }: any) => {
            await apiRequest('POST', `/api/missions/${missionId}/members/${id}/status`, { status });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}`] });
            toast({ title: "Status Updated", description: "Member status changed successfully." });
        }
    });

    const emergencyStopMutation = useMutation({
        mutationFn: async ({ entityId }: any) => {
            const latestRun = await apiRequest('GET', `/api/pipelines/${entityId}/latest-run`);
            const runData = await latestRun.json();

            if (runData && (runData.status === 'running' || runData.status === 'pending')) {
                await apiRequest('POST', `/api/pipeline-executions/${runData.id}/cancel`);
                return "Stopped execution " + runData.id;
            } else {
                throw new Error("No active execution found to stop.");
            }
        },
        onSuccess: (msg) => {
            toast({ title: "Emergency Stop Triggered", description: msg });
        },
        onError: (err: any) => {
            toast({ title: "Failed to Stop", description: err.message, variant: "destructive" });
        }
    });

    const removeMemberMutation = useMutation({
        mutationFn: async ({ missionId, entityType, entityId }: any) => {
            await apiRequest('DELETE', `/api/missions/${missionId}/members/${entityType}/${entityId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}`] });
            toast({ title: "Member Removed", description: "The node has been removed from the mission." });
        },
        onError: (err: any) => {
            toast({ title: "Failed to Remove", description: err.message, variant: "destructive" });
        }
    });

    const handleAction = useCallback((action: string, payload: any) => {
        if (action === 'toggle_status') {
            toggleStatusMutation.mutate(payload);
        } else if (action === 'remove_member') {
            removeMemberMutation.mutate(payload);
        } else if (action === 'emergency_stop') {
            if (confirm("Are you sure you want to trigger an EMERGENCY STOP? This will kill the active process.")) {
                emergencyStopMutation.mutate(payload);
            }
        } else if (action === 'view_logs') {
            window.open(`/operations/workstreams/${payload.entityId}/executions`, '_blank');
        }
    }, [toggleStatusMutation, emergencyStopMutation, removeMemberMutation]);

    const lastDataRef = useRef<string>('');

    useEffect(() => {
        if (mission && mission.members && mission.members.length > 0) {
            // Check if data actually changed to prevent flickering/loops
            const dataFingerprint = JSON.stringify({
                members: mission.members.map((m: any) => ({ id: m.id, status: m.status, label: (m.label || m.name) })),
                runStatus: run?.status,
                execId: activeExecution?.id,
                tools: mission.tools?.length,
                deliverables: mission.deliverables?.length,
                executions: mission.executions?.length
            });
            
            if (dataFingerprint === lastDataRef.current) return;
            lastDataRef.current = dataFingerprint;

            const flowNodes: Node[] = [];
            const flowEdges: Edge[] = [];

            const supervisors = mission.members.filter((m: any) =>
                m.role === 'supervisor' || m.role === 'Supervisor' || m.role === 'primary_strategist' || m.role === 'Primary Strategist'
            );
            
            // Build a map for easy lookup
            const memberMap = new Map();
            mission.members.forEach((m: any) => memberMap.set(`${m.entityType}:${m.entityId}`, m));

            // 1. Create Base Member Nodes
            mission.members.forEach((member: any) => {
                const isSupervisor = member.role === 'supervisor' || member.role === 'Supervisor' || member.role === 'primary_strategist' || member.role === 'Primary Strategist';
                
                let liveStatus = member.status || 'active';
                if (isSupervisor && run && run.status) {
                   liveStatus = run.status;
                }
                
                // Track execution status
                const latestExec = mission.executions?.find((ex: any) => 
                    ex.pipelineId === member.entityId && member.entityType === 'pipeline'
                );
                if (latestExec) {
                    liveStatus = latestExec.status;
                }

                if (member.entityType === 'pipeline' && activeExecution && activeExecution.pipelineId === member.entityId) {
                   liveStatus = 'running';
                }

                flowNodes.push({
                    id: `${member.id}`,
                    type: 'workstreamNode', 
                    data: {
                        id: member.id,
                        missionId: mission.id,
                        label: member.label || member.name || (member.entityType === 'job' ? `Agent #${member.entityId}` : `Pipeline #${member.entityId}`),
                        role: member.role,
                        status: liveStatus,
                        entityType: member.entityType,
                        entityId: member.entityId,
                        onAction: handleAction
                    },
                    position: { x: 0, y: 0 },
                });
            });

            // 2. Create Tool Nodes
            if (mission.tools) {
                mission.tools.forEach((tool: any, idx: number) => {
                    const toolId = `tool-${tool.name}`;
                    flowNodes.push({
                        id: toolId,
                        type: 'workstreamNode',
                        data: {
                            label: tool.name,
                            nodeType: 'tool',
                        },
                        position: { x: 0, y: 0 },
                    });

                    // Link tool to commander or agents (heuristic)
                    if (supervisors.length > 0) {
                        flowEdges.push({
                            id: `e-tool-${idx}`,
                            source: toolId,
                            target: `${supervisors[0].id}`,
                            type: 'smoothstep',
                            className: 'opacity-50',
                            style: { stroke: '#60a5fa', strokeDasharray: '5,5' },
                            markerEnd: { type: MarkerType.ArrowClosed, color: '#60a5fa' }
                        });
                    }
                });
            }

            // 3. Create Deliverable Nodes
            if (mission.deliverables) {
                mission.deliverables.forEach((del: any, idx: number) => {
                    const delId = `del-${del.id}`;
                    flowNodes.push({
                        id: delId,
                        type: 'workstreamNode',
                        data: {
                            label: del.jobType || 'Artifact',
                            nodeType: 'deliverable',
                            status: del.status || 'completed'
                        },
                        position: { x: 0, y: 0 },
                    });

                    // Link deliverable to producer
                    const producer = mission.members.find((m: any) => 
                        m.entityType === 'pipeline' && m.entityId === del.pipelineId
                    ) || supervisors[0];

                    if (producer) {
                        flowEdges.push({
                            id: `e-del-${idx}`,
                            source: `${producer.id}`,
                            target: delId,
                            type: 'smoothstep',
                            style: { 
                                stroke: del.status === 'planned' ? '#94a3b8' : '#2dd4bf', 
                                strokeWidth: 2,
                                strokeDasharray: del.status === 'planned' ? '5,5' : undefined 
                            },
                            markerEnd: { type: MarkerType.ArrowClosed, color: del.status === 'planned' ? '#94a3b8' : '#2dd4bf' }
                        });
                    }
                });
            }

            // 4. Create Edges
            // A. Commander -> Workers (Delegation)
            if (supervisors.length > 0) {
                const mainSupervisor = supervisors[0];
                const supervisorId = `${mainSupervisor.id}`;

                mission.members.forEach((member: any) => {
                    if (supervisors.includes(member)) return;
                    
                    const workerId = `${member.id}`;
                    const isWorkerActive = member.status === 'active' || member.status === 'running';
                    
                    flowEdges.push({
                        id: `e-delegation-${supervisorId}-${workerId}`,
                        source: supervisorId,
                        target: workerId,
                        type: 'smoothstep',
                        animated: isWorkerActive,
                        className: isWorkerActive ? 'animate-pip-flow' : '',
                        style: {
                            stroke: !isWorkerActive ? '#71717a' : '#3b82f6',
                            strokeWidth: 3,
                            opacity: !isWorkerActive ? 0.3 : 0.8,
                        },
                        markerEnd: {
                            type: MarkerType.ArrowClosed,
                            color: !isWorkerActive ? '#71717a' : '#3b82f6',
                        },
                    });
                });
            }

            // B. Pipeline Dependencies (Sequential)
            if (mission.pipelineSequence && mission.pipelineSequence.length > 1) {
                for (let i = 0; i < mission.pipelineSequence.length - 1; i++) {
                    const currentId = mission.pipelineSequence[i];
                    const nextId = mission.pipelineSequence[i+1];
                    
                    const currentMember = mission.members.find((m: any) => m.entityType === 'pipeline' && m.entityId === currentId);
                    const nextMember = mission.members.find((m: any) => m.entityType === 'pipeline' && m.entityId === nextId);
                    
                    if (currentMember && nextMember) {
                        flowEdges.push({
                            id: `e-seq-${currentMember.id}-${nextMember.id}`,
                            source: `${currentMember.id}`,
                            target: `${nextMember.id}`,
                            label: 'Next Step',
                            type: 'smoothstep',
                            style: { stroke: '#3b82f6', strokeWidth: 4, strokeDasharray: '10,5' },
                            labelStyle: { fill: '#3b82f6', fontWeight: 700, fontSize: 10 },
                            markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' }
                        });
                    }
                }
            }

            // C. Execution Hierarchy (Sub-pipelines)
            if (mission.executions) {
                mission.executions.forEach((exec: any) => {
                    if (exec.parentExecutionId) {
                        const parentExec = mission.executions.find((e: any) => e.id === exec.parentExecutionId);
                        if (parentExec) {
                            const parentMember = mission.members.find((m: any) => m.entityType === 'pipeline' && m.entityId === parentExec.pipelineId);
                            const childMember = mission.members.find((m: any) => m.entityType === 'pipeline' && m.entityId === exec.pipelineId);
                            
                            if (parentMember && childMember) {
                                flowEdges.push({
                                    id: `e-sub-${parentMember.id}-${childMember.id}`,
                                    source: `${parentMember.id}`,
                                    target: `${childMember.id}`,
                                    label: 'Invokes',
                                    type: 'smoothstep',
                                    style: { stroke: '#8b5cf6', strokeWidth: 2 },
                                    labelStyle: { fill: '#8b5cf6', fontSize: 9 },
                                    markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' }
                                });
                            }
                        }
                    }
                });
            }

            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(flowNodes, flowEdges);
            setNodes(layoutedNodes);
            setEdges(layoutedEdges);
        }
    }, [mission, run?.status, activeExecution?.id, setNodes, setEdges, handleAction]);

    if (!mission || !mission.members) {
        return <div className="text-center p-20 text-muted-foreground italic">Initializing Workstream Graph...</div>;
    }

    return (
        <div ref={containerRef} className="h-full w-full min-h-[600px] flex flex-col bg-background/20 backdrop-blur-xl relative overflow-hidden">
            {/* Legend/Controls Overlay */}
            <div className="absolute top-6 left-6 z-10 flex flex-col gap-4">
                <div className="bg-card/85 backdrop-blur-lg border border-primary/20 p-5 rounded-3xl text-[11px] text-muted-foreground space-y-3 shadow-2xl">
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-primary/70 shadow-[0_0_12px_rgba(var(--primary),0.6)]"></div>
                        <span className="font-bold tracking-tighter uppercase text-foreground/90">Commander</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full border border-primary/40 animate-pulse bg-primary/30"></div>
                        <span className="font-bold tracking-tighter uppercase text-foreground/80">Active Agent</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-blue-500/50 border border-blue-400/50"></div>
                        <span className="font-bold tracking-tighter uppercase text-blue-500">Tool / Resource</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-teal-500/50 border border-teal-400/50"></div>
                        <span className="font-bold tracking-tighter uppercase text-teal-500">Deliverable</span>
                    </div>
                    <div className="mt-4 pt-4 border-t border-primary/10 text-[10px] opacity-70">
                        <p className="mb-1 leading-tight"><span className="text-blue-500">Solid Blue:</span> Active Delegation</p>
                        <p className="mb-1 leading-tight"><span className="text-blue-500 underline">Dashed Blue:</span> Pipeline Sequence</p>
                        <p className="leading-tight"><span className="text-blue-500">Dotted:</span> Tool Usage</p>
                    </div>
                </div>

                <AddMemberDialog missionId={mission.id} />
            </div>

            <div className="flex-1 w-full h-full min-h-0">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onInit={onInit}
                    fitView
                    fitViewOptions={{ duration: 400, padding: 0.3 }}
                    minZoom={0.1}
                    maxZoom={1.5}
                    className="bg-transparent"
                >
                    <Controls className="!bg-background/80 !border-border !rounded-lg" />
                    <Background color="#94a3b8" gap={25} size={1} />
                </ReactFlow>
            </div>
        </div>
    );
}

