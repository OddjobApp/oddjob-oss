import React, { useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import ReactFlow, {
    Background,
    Controls,
    Edge,
    MarkerType,
    Node,
    Position,
    useNodesState,
    useEdgesState,
    Handle,
    NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { GripVertical, CheckCircle2, XCircle, Clock } from 'lucide-react';

// --- Custom Node ---

const getJobTypeColor = (type: string) => {
    switch (type) {
        case 'ai_api_call': return 'bg-purple-100 text-purple-800 border-purple-200';
        case 'shell': return 'bg-muted text-foreground border-border';
        case 'api': case 'curl': return 'bg-blue-100 text-blue-800 border-blue-200';
        case 'repeater': return 'bg-orange-100 text-orange-800 border-orange-200';
        case 'transformer': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
        case 'human_approval': return 'bg-pink-100 text-pink-800 border-pink-200';
        case 'decision_node':
        case 'decision': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        case 'iterator': return 'bg-cyan-100 text-cyan-800 border-cyan-200';
        default: return 'bg-muted text-foreground border-border';
    }
};

const PipelineNode = ({ data, selected }: NodeProps) => {
    const { jobRequest, stepIndex, label, type } = data;
    const colorClass = getJobTypeColor(type);
    const isDecision = type === 'decision_node' || type === 'decision';

    const content = (
        <>
            <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-400" />
            <div className={`p-2 rounded-t-sm border-b flex items-center justify-between gap-2 ${colorClass}`}>
                <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 opacity-50 cursor-grab" />
                    <span className="font-semibold text-xs uppercase">{type?.replace('_', ' ')}</span>
                </div>
                {data.status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                {data.status === 'failed' && <XCircle className="w-4 h-4 text-red-600" />}
                {data.status === 'waiting_external_input' && <Clock className="w-4 h-4 text-yellow-600" />}
            </div>

            <div className="p-3">
                <div
                    className={`font-medium text-sm truncate ${data.jobId ? 'cursor-pointer hover:underline text-primary' : ''}`}
                    title={label}
                    onClick={(e) => {
                        if (data.onJobClick && data.jobId) {
                            e.stopPropagation();
                            data.onJobClick(data.jobId);
                        }
                    }}
                >
                    {label}
                </div>
                <div className="flex justify-between items-center mt-1">
                    <div className="text-xs text-muted-foreground">Step #{stepIndex + 1}</div>
                    {data.duration && <div className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {data.duration}
                    </div>}
                </div>
            </div>
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-gray-400" />
        </>
    );

    if (isDecision) {
        return (
            <div className={`relative w-[200px] h-[200px] flex items-center justify-center`}>
                <div className={`absolute w-[140px] h-[140px] transform rotate-45 border-2 shadow-md bg-card overflow-hidden flex flex-col items-center justify-center 
                  ${data.status === 'success' ? 'border-green-500 ring-2 ring-green-100' :
                        data.status === 'failed' ? 'border-red-500 ring-2 ring-red-100' :
                            selected ? 'border-primary' : 'border-transparent'}`}
                >
                    {/* Rotate content back */}
                    <div className="transform -rotate-45 w-[200px] flex flex-col items-center p-4">
                        <Badge variant="outline" className={`mb-2 bg-yellow-100`}>Decision</Badge>
                        <div className="text-center font-medium text-sm">{label}</div>
                        {data.status && <div className="mt-1 text-xs text-muted-foreground capitalize">{data.status}</div>}
                    </div>
                </div>
                <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-400 !top-4" />
                <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-gray-400 !bottom-4" />
            </div>
        );
    }

    return (
        <div className={`shadow-md rounded-md bg-card border-2 min-w-[200px] ${data.status === 'success' ? 'border-green-500 ring-2 ring-green-100' :
            data.status === 'failed' ? 'border-red-500 ring-2 ring-red-100' :
                data.status === 'waiting_external_input' ? 'border-yellow-500 ring-2 ring-yellow-100' :
                    selected ? 'border-primary' : 'border-transparent'
            }`}
            data-testid={`pipeline-node-${stepIndex}`}
        >
            {content}
        </div>
    );
};

const nodeTypes = {
    pipelineStep: PipelineNode,
};

// --- Layout Logic ---

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    const nodeWidth = 220;
    const nodeHeight = 100;

    dagreGraph.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
};

// --- Main Canvas ---

interface PipelineCanvasProps {
    steps: any[];
    jobs: any[]; // List of available jobs to lookup names
    executionResults?: any;
    onStepClick: (stepIndex: number) => void;
    onAddStep?: (step: any) => void;
    selectedStepIndex?: number | null;
    readOnly?: boolean;
}

export default function PipelineCanvas({ steps, jobs, executionResults, onStepClick, onAddStep, selectedStepIndex, readOnly }: PipelineCanvasProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [, setLocation] = useLocation();

    const handleJobClick = useCallback((jobId: number) => {
        setLocation(`/operations/agents/${jobId}`);
    }, [setLocation]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            if (!onAddStep) return;

            const type = event.dataTransfer.getData('application/reactflow');
            const dataStr = event.dataTransfer.getData('application/json');

            if (!dataStr) return;

            try {
                const payload = JSON.parse(dataStr);

                // Construct new step based on payload
                let newStep: any = {
                    onFailureAction: "Stop Pipeline",
                };

                if (type === 'logic_gatekeeper') {
                    newStep = {
                        ...newStep,
                        name: payload.name,
                        moduleType: payload.moduleType || 'logic_gatekeeper',
                        decisionNodeConfig: payload.moduleType === 'decision_template' || !payload.moduleType ? {
                            evaluationMode: "AND",
                            conditions: [{ source: "", operator: "EQ", target: "" }],
                            routes: { onMatch: { destinationStepId: undefined } },
                        } : null
                    };
                } else if (type === 'job') {
                    newStep = {
                        ...newStep,
                        name: payload.name,
                        jobId: payload.jobId,
                    };
                } else if (type === 'app') {
                    newStep = {
                        ...newStep,
                        name: payload.name,
                        appDeploymentId: payload.appDeploymentId,
                        outputName: payload.outputName || '',
                    };
                }

                onAddStep(newStep);

            } catch (err) {
                console.error("Failed to parse drop data", err);
            }
        },
        [onAddStep]
    );

    // Transform steps into Graph
    useEffect(() => {
        if (!steps || steps.length === 0) {
            setNodes([]);
            setEdges([]);
            return;
        }

        const newNodes: Node[] = steps.map((step, index) => {
            let jobName = "Unknown Job";
            let jobType = "generic";

            // Logic Gate / Decision Node / Templates
            if (step.moduleType === 'logic_gatekeeper' || step.moduleType === 'decision_template') {
                jobName = step.name || "Decision Gate";
                jobType = "decision";
            } else if (step.moduleType === 'transformer_template') {
                jobName = step.name || "Transformer";
                jobType = "transformer";
            } else if (step.moduleType === 'iterator_template' || step.moduleType === 'repeater_template') {
                jobName = step.name || "Iterator";
                jobType = "iterator";
            } else if (step.jobId) {
                const job = jobs.find(j => j.id === step.jobId);
                if (job) {
                    jobName = job.name;
                    jobType = job.type;
                } else if (step.name) {
                    jobName = step.name;
                    // Try to infer type from name if job object is missing
                    if (step.name.toLowerCase().includes('transformer')) jobType = 'transformer';
                    else if (step.name.toLowerCase().includes('iterator')) jobType = 'iterator';
                    else if (step.name.toLowerCase().includes('decision')) jobType = 'decision';
                }
            } else if (step.name) {
                jobName = step.name;
                // Try to infer type from name or default to generic
                if (step.name.toLowerCase().includes('transformer')) jobType = 'transformer';
                else if (step.name.toLowerCase().includes('iterator')) jobType = 'iterator';
                else if (step.name.toLowerCase().includes('decision')) jobType = 'decision';
            }

            return {
                id: `step-${index}`,
                type: 'pipelineStep',
                data: {
                    label: jobName,
                    type: jobType,
                    stepIndex: index,
                    stepConfig: step,
                    status: executionResults?.stepResults?.find((r: any) => r.pipelineStepId === step.id)?.status,
                    duration: (() => {
                        const res = executionResults?.stepResults?.find((r: any) => r.pipelineStepId === step.id);
                        if (res?.executedAt && res?.completedAt) {
                            const ms = new Date(res.completedAt).getTime() - new Date(res.executedAt).getTime();
                            return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
                        }
                        return null;
                        return null;
                    })(),
                    jobId: step.jobId,
                    onJobClick: handleJobClick
                },
                position: { x: 0, y: 0 }, // Handled by dagre
                selected: index === selectedStepIndex,
            };
        });

        const newEdges: Edge[] = [];
        const pkToId = new Map(steps.map((s, i) => [s.id, `step-${i}`]));

        steps.forEach((step, index) => {
            const sourceNodeId = `step-${index}`;
            let targets: { target: string, label?: string, style?: any }[] = [];
            let hasExplicitRouting = false;

            // 1. Decision Job Routing (step.decisionNodeConfig for step-specific IDs, else job.config)
            if (step.jobId) {
                const job = jobs.find(j => j.id === step.jobId);
                if (job?.type === 'decision') {
                    const stepRouting = step.decisionNodeConfig as { trueStepId?: number; falseStepId?: number } | undefined;
                    const jobConfig = job.config as { trueStepId?: number; falseStepId?: number } | undefined;
                    const trueStepId = stepRouting?.trueStepId ?? jobConfig?.trueStepId;
                    const falseStepId = stepRouting?.falseStepId ?? jobConfig?.falseStepId;

                    if (trueStepId && pkToId.has(trueStepId)) {
                        targets.push({
                            target: pkToId.get(trueStepId)!,
                            label: 'True',
                            style: { stroke: 'green' }
                        });
                        hasExplicitRouting = true;
                    }
                    if (falseStepId && pkToId.has(falseStepId)) {
                        targets.push({
                            target: pkToId.get(falseStepId)!,
                            label: 'False',
                            style: { stroke: 'red' }
                        });
                        hasExplicitRouting = true;
                    }
                }
            }

            // 2. Logic Gatekeeper Routing (Legacy)
            if (step.moduleType === 'logic_gatekeeper' && step.decisionNodeConfig?.routes?.onMatch?.destinationStepId) {
                const destId = step.decisionNodeConfig.routes.onMatch.destinationStepId;
                if (pkToId.has(destId)) {
                    targets.push({ target: pkToId.get(destId)!, label: 'Match' });
                    hasExplicitRouting = true;
                }
            }

            // 3. Explicit Step Destination
            if (step.destinationStepId && pkToId.has(step.destinationStepId)) {
                targets.push({ target: pkToId.get(step.destinationStepId)!, label: 'Jump' });
                hasExplicitRouting = true;
            }

            // 4. Fallback connection
            if (index < steps.length - 1) {
                if (targets.length === 0) {
                    targets.push({ target: `step-${index + 1}` });
                }
            }

            targets.forEach(t => {
                newEdges.push({
                    id: `e-${index}-${t.target}`,
                    source: sourceNodeId,
                    target: t.target,
                    label: t.label,
                    style: t.style,
                    type: 'smoothstep',
                    markerEnd: { type: MarkerType.ArrowClosed },
                    animated: false,
                });
            });
        });

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(newNodes, newEdges);
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);

    }, [steps, jobs, executionResults, setNodes, setEdges]); // Rerun when steps change

    const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        if (node.data && typeof node.data.stepIndex === 'number') {
            onStepClick(node.data.stepIndex);
        }
    }, [onStepClick]);

    return (
        <div className="w-full h-full bg-muted overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onNodeClick={handleNodeClick}
                onDrop={onDrop}
                onDragOver={onDragOver}
                fitView
                attributionPosition="bottom-right"
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable={!readOnly}
            >
                <Background color="#ccc" gap={16} />
                <Controls />
            </ReactFlow>
        </div>
    );
}
