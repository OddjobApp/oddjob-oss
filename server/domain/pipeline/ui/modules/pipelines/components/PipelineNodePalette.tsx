import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { GripVertical, Zap, GitBranch, Terminal, Mail, MessageSquare, Database, Globe, Cpu, Repeat, Shield, FolderInput, FileUp, Workflow } from 'lucide-react';

interface PipelineNodePaletteProps {
    jobs: any[]; // List of available pre-configured jobs
    pipelineApps?: any[];
    allowedJobTypes?: string[];
}

export default function PipelineNodePalette({ jobs, pipelineApps = [], allowedJobTypes }: PipelineNodePaletteProps) {
    const isTypeAllowed = (type: string) => {
        if (!allowedJobTypes) return true;
        if (allowedJobTypes.length === 0) return false;
        return allowedJobTypes.includes(type);
    };

    const onDragStart = (event: React.DragEvent, nodeType: string, payload: any) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.setData('application/json', JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div className="h-full flex flex-col bg-muted/50">
            <div className="p-4 border-b">
                <h3 className="font-semibold text-sm">Step Library</h3>
                <p className="text-xs text-muted-foreground">Drag items to the canvas</p>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                    {/* Logic Blocks */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Logic</h4>
                        <div
                            className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-grab hover:border-primary transition-colors"
                            draggable
                            onDragStart={(e) => onDragStart(e, 'logic_gatekeeper', { moduleType: 'logic_gatekeeper' })}
                        >
                            <div className="p-2 bg-yellow-100 rounded-md text-yellow-700">
                                <GitBranch className="w-4 h-4" />
                            </div>
                            <div className="flex-1">
                                <div className="text-sm font-medium">Decision / Branch</div>
                                <div className="text-xs text-muted-foreground">Branching logic</div>
                            </div>
                            <GripVertical className="w-4 h-4 text-muted-foreground" />
                        </div>

                        {/* Condition Barrier */}
                        <div
                            className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-grab hover:border-primary transition-colors"
                            draggable
                            onDragStart={(e) => onDragStart(e, 'logic_gatekeeper', {
                                moduleType: 'logic_gatekeeper',
                                name: "Condition Barrier",
                                decisionNodeConfig: {
                                    evaluationMode: "AND",
                                    conditions: [{ source: "", operator: "EQ", target: "" }],
                                    routes: {
                                        onMatch: { action: "next_step", destinationStepId: null },
                                        onMismatch: { action: "stop_failure", destinationStepId: null }
                                    }
                                }
                            })}
                        >
                            <div className="p-2 bg-red-100 rounded-md text-red-700">
                                <Shield className="w-4 h-4" />
                            </div>
                            <div className="flex-1">
                                <div className="text-sm font-medium">Condition Barrier</div>
                                <div className="text-xs text-muted-foreground">Block unless matched</div>
                            </div>
                            <GripVertical className="w-4 h-4 text-muted-foreground" />
                        </div>

                        {/* Iterator Template */}
                        {isTypeAllowed('iterator') && (
                            <div
                                className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-grab hover:border-primary transition-colors"
                                draggable
                                onDragStart={(e) => onDragStart(e, 'logic_gatekeeper', {
                                    moduleType: 'iterator_template'
                                })}
                            >
                                <div className="p-2 bg-orange-100 rounded-md text-orange-700">
                                    <Repeat className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-medium">Iterator (Loop)</div>
                                    <div className="text-xs text-muted-foreground">Loop over list/array</div>
                                </div>
                                <GripVertical className="w-4 h-4 text-muted-foreground" />
                            </div>
                        )}

                        {/* Decision Job Template */}
                        {isTypeAllowed('decision') && (
                            <div
                                className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-grab hover:border-primary transition-colors"
                                draggable
                                onDragStart={(e) => onDragStart(e, 'logic_gatekeeper', {
                                    moduleType: 'decision_template'
                                })}
                            >
                                <div className="p-2 bg-blue-100 rounded-md text-blue-700">
                                    <GitBranch className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-medium">Decision (Simple)</div>
                                    <div className="text-xs text-muted-foreground">Boolean logic check</div>
                                </div>
                                <GripVertical className="w-4 h-4 text-muted-foreground" />
                            </div>
                        )}

                        {/* Transformer Job Template */}
                        {isTypeAllowed('transformer') && (
                            <div
                                className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-grab hover:border-primary transition-colors"
                                draggable
                                onDragStart={(e) => onDragStart(e, 'logic_gatekeeper', {
                                    moduleType: 'transformer_template'
                                })}
                            >
                                <div className="p-2 bg-indigo-100 rounded-md text-indigo-700">
                                    <Zap className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-medium">Transformer</div>
                                    <div className="text-xs text-muted-foreground">Data transformation rules</div>
                                </div>
                                <GripVertical className="w-4 h-4 text-muted-foreground" />
                            </div>
                        )}
                    </div>

                    {pipelineApps.length > 0 && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Apps</h4>
                            {pipelineApps.map((item) => {
                                const ready = Boolean(item.pipeline?.ready) && isTypeAllowed(item.pipeline?.jobType);
                                const appName = item.deployment?.title || item.app?.name || item.deployment?.publicSlug || item.app?.slug || 'App';
                                const appSlug = item.deployment?.publicSlug || item.app?.slug || 'app';
                                const outputName = appSlug.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
                                const disabledReason = item.pipeline?.ready
                                    ? `${item.pipeline.jobType} jobs are disabled for this organization.`
                                    : item.pipeline?.reason;

                                return (
                                    <div
                                        key={item.deployment?.id || item.app?.id}
                                        className={`flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm transition-colors ${
                                            ready ? 'cursor-grab hover:border-primary' : 'opacity-60 cursor-not-allowed'
                                        }`}
                                        draggable={ready}
                                        onDragStart={ready ? (e) => onDragStart(e, 'app', {
                                            appDeploymentId: item.deployment.id,
                                            name: `App: ${appName}`,
                                            outputName,
                                        }) : undefined}
                                        title={ready ? undefined : disabledReason}
                                    >
                                        <div className="p-2 bg-emerald-100 rounded-md text-emerald-700">
                                            <Workflow className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium truncate">{appName}</div>
                                            <div className="text-xs text-muted-foreground truncate">{item.pipeline?.jobType || 'app trigger'}</div>
                                        </div>
                                        <Badge variant="outline" className="text-[10px] px-1.5">
                                            {ready ? 'Ready' : 'Trigger'}
                                        </Badge>
                                        {ready && <GripVertical className="w-4 h-4 text-muted-foreground" />}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Job Templates */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Activities</h4>
                        {jobs.filter(job => {
                            const isAppBacked = (job.config as any)?.appDeploymentId || job.name?.startsWith('App:');
                            return isTypeAllowed(job.type) && job.type !== 'transformer' && !isAppBacked;
                        }).map((job) => {
                            let icon = <Terminal className="w-4 h-4" />;
                            let colorClass = "bg-muted text-muted-foreground";

                            switch (job.type) {
                                case 'ai_api_call':
                                    icon = <Cpu className="w-4 h-4" />;
                                    colorClass = "bg-purple-100 text-purple-700";
                                    break;
                                case 'slack_post':
                                    icon = <MessageSquare className="w-4 h-4" />;
                                    colorClass = "bg-green-100 text-green-700";
                                    break;
                                case 'email_send':
                                    icon = <Mail className="w-4 h-4" />;
                                    colorClass = "bg-blue-100 text-blue-700";
                                    break;
                                case 'sql_query':
                                    icon = <Database className="w-4 h-4" />;
                                    colorClass = "bg-orange-100 text-orange-700";
                                    break;
                                case 'api':
                                case 'curl':
                                    icon = <Globe className="w-4 h-4" />;
                                    colorClass = "bg-cyan-100 text-cyan-700";
                                    break;
                                case 'repeater':
                                    icon = <Repeat className="w-4 h-4" />;
                                    colorClass = "bg-orange-100 text-orange-700";
                                    break;
                                case 'folder_import':
                                    icon = <FolderInput className="w-4 h-4" />;
                                    colorClass = "bg-yellow-100 text-yellow-700";
                                    break;
                                case 'file_export':
                                    icon = <FileUp className="w-4 h-4" />;
                                    colorClass = "bg-green-100 text-green-700";
                                    break;
                            }

                            return (
                                <div
                                    key={job.id}
                                    className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-grab hover:border-primary transition-colors"
                                    draggable
                                    onDragStart={(e) => onDragStart(e, 'job', { jobId: job.id, name: job.name })}
                                >
                                    <div className={`p-2 rounded-md ${colorClass}`}>
                                        {icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">{job.name}</div>
                                        <div className="text-xs text-muted-foreground capitalize">{job.type.replace('_', ' ')}</div>
                                    </div>
                                    <GripVertical className="w-4 h-4 text-muted-foreground" />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
