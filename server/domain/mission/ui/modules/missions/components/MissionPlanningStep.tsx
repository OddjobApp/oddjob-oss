
import React, { useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    Edge,
    Node,
    Position,
    MarkerType,
    BackgroundVariant
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Brain, ArrowRight, Zap, Target, MessageSquare, Workflow } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';

interface MissionPlanningStepProps {
    plan: any;
    onRefine: () => void;
    onAccept: () => void;
    prevStep: () => void;
}

export function MissionPlanningStep({ plan, onRefine, onAccept, prevStep }: MissionPlanningStepProps) {
    const strategy = plan?.strategy || "No strategic overview provided for this plan.";

    const { nodes, edges } = useMemo(() => {
        if (!plan?.workflow?.nodes) return { nodes: [], edges: [] };

        const flowNodes: Node[] = [];
        const flowEdges: Edge[] = [];

        // Basic vertical layout
        const xCenter = 150;
        const yGap = 160; // Increased spacing for better clarity

        plan.workflow.nodes.forEach((node: any, idx: number) => {
            flowNodes.push({
                id: node.id,
                data: {
                    label: (
                        <div className="flex flex-col gap-1 p-2">
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[8px] h-3 px-1 border-border/80 bg-foreground/5 uppercase font-mono">
                                    {node.type}
                                </Badge>
                                <span className="font-bold text-[10px] whitespace-nowrap">{node.role || node.type}</span>
                            </div>
                            <div className="text-[8px] text-muted-foreground line-clamp-2 italic">
                                {node.suggestedConfig?.goal || node.id}
                            </div>
                        </div>
                    )
                },
                position: { x: xCenter, y: idx * yGap },
                style: {
                    background: 'rgba(24, 24, 27, 0.9)',
                    color: '#fff',
                    border: '1px solid rgba(217, 119, 6, 0.4)',
                    borderRadius: '8px',
                    width: 180,
                    fontSize: '10px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                },
                sourcePosition: Position.Bottom,
                targetPosition: Position.Top,
            });
        });

        if (plan.workflow.edges) {
            plan.workflow.edges.forEach((edge: any, idx: number) => {
                flowEdges.push({
                    id: `e-${idx}`,
                    source: edge.from,
                    target: edge.to,
                    animated: true,
                    style: { stroke: '#d97706', strokeWidth: 2 },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: '#d97706',
                    },
                });
            });
        }

        return { nodes: flowNodes, edges: flowEdges };
    }, [plan]);

    return (
        <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
                {/* Strategy Column */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-primary">
                        <Brain className="w-4 h-4" />
                        <h4 className="text-xs font-bold uppercase tracking-widest font-mono">Strategic Intent</h4>
                    </div>

                    <Card className="bg-card/50 border-border p-4 sm:p-6 relative overflow-hidden group flex-1 min-h-[320px] sm:min-h-[400px]">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Target className="w-24 h-24" />
                        </div>
                        <ScrollArea className="h-full pr-4">
                            <div className="prose prose-invert prose-sm max-w-none text-foreground/90 leading-relaxed font-sans">
                                <ReactMarkdown>{strategy}</ReactMarkdown>
                            </div>
                        </ScrollArea>
                    </Card>

                    <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <Zap className="w-4 h-4 text-primary animate-pulse" />
                        <div className="text-[10px] text-muted-foreground font-medium">
                            Architected using <span className="text-primary font-bold">OODA-Logic</span> for adaptive execution.
                        </div>
                    </div>
                </div>

                {/* Workstream Column */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-primary">
                        <Workflow className="w-4 h-4" />
                        <h4 className="text-xs font-bold uppercase tracking-widest font-mono">Workstream Blueprint</h4>
                    </div>

                    <div className="flex-1 min-h-[360px] sm:min-h-[400px] border rounded-2xl bg-background/40 border-border/50 overflow-hidden relative shadow-inner">
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            fitView
                            className="bg-transparent"
                        >
                            <Background color="#333" gap={20} size={1} variant={BackgroundVariant.Dots} />
                        </ReactFlow>

                        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap justify-end gap-2 sm:bottom-4 sm:left-auto sm:right-4">
                            <Badge variant="secondary" className="text-[9px] bg-background/80 backdrop-blur-md border-primary/30 text-primary px-2 py-0.5 rounded-full font-black uppercase tracking-widest">
                                {plan?.workflow?.nodes?.length || 0} Nodes
                            </Badge>
                            <Badge variant="secondary" className="text-[9px] bg-background/80 backdrop-blur-md border-primary/30 text-primary px-2 py-0.5 rounded-full font-black uppercase tracking-widest">
                                {plan?.workflow?.edges?.length || 0} Transitions
                            </Badge>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3 pt-4 border-t border-border sm:flex-row sm:items-center sm:justify-between">
                <Button variant="ghost" onClick={prevStep} className="w-full justify-center text-muted-foreground hover:text-foreground uppercase text-[10px] font-bold sm:w-auto">
                    Back to Brief
                </Button>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                        variant="outline"
                        onClick={onRefine}
                        className="w-full justify-center border-border bg-transparent text-muted-foreground hover:text-primary hover:border-primary/50 uppercase text-[10px] font-bold sm:w-auto"
                    >
                        <MessageSquare className="w-3 h-3 mr-2" />
                        Refine Plan
                    </Button>
                    <Button
                        onClick={onAccept}
                        className="w-full justify-center bg-primary hover:bg-primary/90 font-bold uppercase text-xs px-6 sm:w-auto"
                    >
                        Accept & Recruit Team
                        <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
