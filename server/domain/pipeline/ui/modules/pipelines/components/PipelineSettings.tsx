import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Info } from 'lucide-react';
import EntityExtractionConfig from '@domain-ui/knowledge/ui/components/knowledge/EntityExtractionConfig';
import type { Pipeline } from "@shared/schema/pipelines/pipeline-core";
import type { Job } from "@shared/schema/jobs/table";
import type { JobOutputSchema } from "@shared/schema/jobs/types";
import type { FormStep } from '@domain-ui/pipeline/ui/modules/pipelines/hooks/use-pipeline-editor';

interface PipelineSettingsProps {
    pipeline: Pipeline;
    jobs: Job[];
    isEditing: boolean;
    editedTriggerType: 'schedule' | 'manual' | 'webhook';
    setEditedTriggerType: (val: 'schedule' | 'manual' | 'webhook') => void;
    editedIsActive: boolean;
    setEditedIsActive: (val: boolean) => void;
    editedEnableKnowledgeGraph: boolean;
    setEditedEnableKnowledgeGraph: (val: boolean) => void;
    editedKnowledgeGraphConfig: any;
    setEditedKnowledgeGraphConfig: (val: any) => void;
    editedMonthlyBudgetUsd: number | null;
    setEditedMonthlyBudgetUsd: (val: number | null) => void;
    editedLabels: string[];
    setEditedLabels: (val: string[]) => void;
    editedSteps: FormStep[];
    latestRun: any;
    editedSelfHealingEnabled: boolean;
    setEditedSelfHealingEnabled: (val: boolean) => void;
}

export function PipelineSettings({
    pipeline,
    jobs,
    isEditing,
    editedTriggerType,
    setEditedTriggerType,
    editedIsActive,
    setEditedIsActive,
    editedEnableKnowledgeGraph,
    setEditedEnableKnowledgeGraph,
    editedKnowledgeGraphConfig,
    setEditedKnowledgeGraphConfig,
    editedMonthlyBudgetUsd,
    setEditedMonthlyBudgetUsd,
    editedLabels,
    setEditedLabels,
    editedSteps,
    latestRun,
    editedSelfHealingEnabled,
    setEditedSelfHealingEnabled
}: PipelineSettingsProps) {

    const getTriggerBadge = (type: string) => {
        switch (type.toLowerCase()) {
            case 'schedule': return <Badge variant="default" className="bg-blue-100 text-blue-800">Schedule</Badge>;
            case 'manual': return <Badge variant="secondary">Manual</Badge>;
            case 'webhook': return <Badge variant="default" className="bg-purple-100 text-purple-800">Webhook</Badge>;
            default: return <Badge variant="secondary">{type}</Badge>;
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>General Information</CardTitle>
                <CardDescription>
                    Basic configuration and integration settings
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Trigger Type */}
                <div className="space-y-2">
                    <Label>Trigger Type</Label>
                    {isEditing ? (
                        <Select
                            value={editedTriggerType}
                            onValueChange={(value: any) => setEditedTriggerType(value)}
                        >
                            <SelectTrigger data-testid="select-edit-trigger-type">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="manual">Manual</SelectItem>
                                <SelectItem value="schedule">Schedule</SelectItem>
                                <SelectItem value="webhook">Webhook</SelectItem>
                            </SelectContent>
                        </Select>
                    ) : (
                        <div>{getTriggerBadge(pipeline.triggerType)}</div>
                    )}
                </div>

                {/* Status */}
                <div className="space-y-2">
                    <Label>Status</Label>
                    {isEditing ? (
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={editedIsActive}
                                onCheckedChange={setEditedIsActive}
                                data-testid="switch-edit-pipeline-active"
                            />
                            <span className="text-sm text-muted-foreground">{editedIsActive ? 'Active' : 'Inactive'}</span>
                        </div>
                    ) : (
                        <div>
                            {pipeline.isActive ? (
                                <Badge variant="default" className="bg-green-100 text-green-800">Active</Badge>
                            ) : (
                                <Badge variant="secondary">Inactive</Badge>
                            )}
                        </div>
                    )}
                </div>

                <div className="space-y-2">
                    <Label>Created By</Label>
                    <p className="text-sm text-foreground">{pipeline.createdBy}</p>
                </div>

                <div className="space-y-2">
                    <Label>Created At</Label>
                    <p className="text-sm text-foreground">{new Date(pipeline.createdAt).toLocaleString()}</p>
                </div>

                {/* Monthly Budget */}
                <div className="space-y-2">
                    <Label>Monthly Budget (USD)</Label>
                    {isEditing ? (
                        <div className="relative">
                            <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                            <Input
                                type="number"
                                className="pl-8"
                                placeholder="0.00"
                                value={editedMonthlyBudgetUsd || ''}
                                onChange={(e) => setEditedMonthlyBudgetUsd(e.target.value ? parseFloat(e.target.value) : null)}
                            />
                        </div>
                    ) : (
                        <p className="text-sm text-foreground">
                            {pipeline.monthlyBudgetUsd ? `$${Number(pipeline.monthlyBudgetUsd).toFixed(2)}` : 'No budget set'}
                        </p>
                    )}
                </div>

                {/* Labels */}
                <div className="space-y-2">
                    <Label>Labels</Label>
                    {isEditing ? (
                        <Input
                            placeholder="marketing, production, critical (comma separated)"
                            value={editedLabels.join(', ')}
                            onChange={(e) => setEditedLabels(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                        />
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {pipeline.labels && Array.isArray(pipeline.labels) && pipeline.labels.length > 0 ? (
                                (pipeline.labels as string[]).map((label, i) => (
                                    <Badge key={i} variant="outline">{label}</Badge>
                                ))
                            ) : (
                                <span className="text-sm text-muted-foreground">No labels</span>
                            )}
                        </div>
                    )}
                </div>

                <Separator />

                {/* Knowledge Graph Integration */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label>Knowledge Graph Integration</Label>
                            <p className="text-sm text-muted-foreground">
                                Extract entities and relationships from pipeline outputs to build a knowledge graph
                            </p>
                        </div>
                        {isEditing ? (
                            <Switch
                                checked={editedEnableKnowledgeGraph}
                                onCheckedChange={setEditedEnableKnowledgeGraph}
                            />
                        ) : (
                            <Badge variant={(pipeline as any).enableKnowledgeGraph ? "default" : "secondary"}>
                                {(pipeline as any).enableKnowledgeGraph ? "Enabled" : "Disabled"}
                            </Badge>
                        )}
                    </div>

                    {(isEditing ? editedEnableKnowledgeGraph : (pipeline as any).enableKnowledgeGraph) && (
                        <div className="space-y-4 border-t pt-4">
                            <div className="space-y-2">
                                <Label>Link to Knowledge Documents</Label>
                                <p className="text-sm text-muted-foreground">
                                    Link extracted entities to knowledge documents created by jobs in this pipeline
                                </p>
                                {isEditing ? (
                                    <Switch
                                        checked={editedKnowledgeGraphConfig?.linkToKnowledgeDocuments ?? true}
                                        onCheckedChange={(checked) => {
                                            setEditedKnowledgeGraphConfig({
                                                ...editedKnowledgeGraphConfig,
                                                linkToKnowledgeDocuments: checked,
                                                autoCreate: editedKnowledgeGraphConfig?.autoCreate ?? true,
                                                entityRules: editedKnowledgeGraphConfig?.entityRules || [],
                                                relationshipRules: editedKnowledgeGraphConfig?.relationshipRules || [],
                                            });
                                        }}
                                    />
                                ) : (
                                    <div className="text-sm">
                                        {(pipeline as any).knowledgeGraphConfig?.linkToKnowledgeDocuments !== false ? "Enabled" : "Disabled"}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label>Auto-create Nodes/Edges</Label>
                                <p className="text-sm text-muted-foreground">
                                    Automatically create knowledge graph nodes and edges without manual approval
                                </p>
                                {isEditing ? (
                                    <Switch
                                        checked={editedKnowledgeGraphConfig?.autoCreate ?? true}
                                        onCheckedChange={(checked) => {
                                            setEditedKnowledgeGraphConfig({
                                                ...editedKnowledgeGraphConfig,
                                                autoCreate: checked,
                                                linkToKnowledgeDocuments: editedKnowledgeGraphConfig?.linkToKnowledgeDocuments ?? true,
                                                entityRules: editedKnowledgeGraphConfig?.entityRules || [],
                                                relationshipRules: editedKnowledgeGraphConfig?.relationshipRules || [],
                                            });
                                        }}
                                    />
                                ) : (
                                    <div className="text-sm">
                                        {(pipeline as any).knowledgeGraphConfig?.autoCreate !== false ? "Enabled" : "Disabled"}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label>Extract From Steps</Label>
                                <p className="text-sm text-muted-foreground">
                                    Select which steps to extract entities from. Leave empty to extract from all steps.
                                </p>
                                {isEditing ? (
                                    <div className="flex flex-wrap gap-2">
                                        {editedSteps.map((step, idx) => {
                                            const stepNumber = idx + 1;
                                            const isSelected = editedKnowledgeGraphConfig?.extractFromSteps?.includes(stepNumber) ?? false;
                                            return (
                                                <Button
                                                    key={step.tempId}
                                                    type="button"
                                                    variant={isSelected ? "default" : "outline"}
                                                    size="sm"
                                                    onClick={() => {
                                                        const currentSteps = editedKnowledgeGraphConfig?.extractFromSteps || [];
                                                        const newSteps = isSelected
                                                            ? currentSteps.filter((s: number) => s !== stepNumber)
                                                            : [...currentSteps, stepNumber];
                                                        setEditedKnowledgeGraphConfig({
                                                            ...editedKnowledgeGraphConfig,
                                                            extractFromSteps: newSteps.length > 0 ? newSteps : undefined,
                                                            entityRules: editedKnowledgeGraphConfig?.entityRules || [],
                                                            relationshipRules: editedKnowledgeGraphConfig?.relationshipRules || [],
                                                            autoCreate: editedKnowledgeGraphConfig?.autoCreate ?? true,
                                                            linkToKnowledgeDocuments: editedKnowledgeGraphConfig?.linkToKnowledgeDocuments ?? true,
                                                        });
                                                    }}
                                                >
                                                    Step {stepNumber}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {editedSteps.map((step, idx) => {
                                            const stepNumber = idx + 1;
                                            const isSelected = (pipeline as any).knowledgeGraphConfig?.extractFromSteps?.includes(stepNumber) ?? false;
                                            return (
                                                <Badge key={step.tempId} variant={isSelected ? "default" : "secondary"}>
                                                    Step {stepNumber}
                                                </Badge>
                                            );
                                        })}
                                    </div>
                                )}
                                {editedSteps.length === 0 && (
                                    <p className="text-sm text-muted-foreground">Add pipeline steps to select extraction sources</p>
                                )}
                            </div>

                            <div className="space-y-4 border-t pt-4">
                                <Label>Entity & Relationship Extraction Rules</Label>
                                <p className="text-sm text-muted-foreground">
                                    Configure how to extract entities and relationships from pipeline step outputs
                                </p>
                                {isEditing ? (
                                    <EntityExtractionConfig
                                        entityRules={editedKnowledgeGraphConfig?.entityRules || []}
                                        relationshipRules={editedKnowledgeGraphConfig?.relationshipRules || []}
                                        outputSchema={(() => {
                                            // Determine reference schema for autocomplete
                                            const stepsToExtract = editedKnowledgeGraphConfig?.extractFromSteps;
                                            const targetStepOrder = (stepsToExtract && stepsToExtract.length > 0) ? stepsToExtract[0] : 1;

                                            const step = editedSteps.find(s => s.order === targetStepOrder - 1);
                                            if (!step?.jobId) return null;

                                            const job = jobs.find(j => j.id === step.jobId);
                                            return job?.outputSchema as JobOutputSchema | undefined;
                                        })()}
                                        stepOutputs={(() => {
                                            // Find output for the targeted step
                                            if (!latestRun?.stepResults) return undefined;
                                            const stepsToExtract = editedKnowledgeGraphConfig?.extractFromSteps;
                                            const targetStepOrder = (stepsToExtract && stepsToExtract.length > 0) ? stepsToExtract[0] : 1;

                                            const targetStep = editedSteps.find(s => s.order === targetStepOrder - 1);
                                            if (!targetStep || !targetStep.id || targetStep.id < 0) return undefined;

                                            const matchingResult = latestRun.stepResults.find((r: any) => r.pipelineStepId === targetStep.id);
                                            if (!matchingResult?.output) return undefined;

                                            try {
                                                return { [targetStep.id]: typeof matchingResult.output === 'string' ? JSON.parse(matchingResult.output) : matchingResult.output };
                                            } catch {
                                                return { [targetStep.id]: matchingResult.output };
                                            }
                                        })()}
                                        onChange={(entityRules, relationshipRules) => {
                                            setEditedKnowledgeGraphConfig({
                                                ...editedKnowledgeGraphConfig,
                                                entityRules,
                                                relationshipRules,
                                                extractFromSteps: editedKnowledgeGraphConfig?.extractFromSteps,
                                                autoCreate: editedKnowledgeGraphConfig?.autoCreate ?? true,
                                                linkToKnowledgeDocuments: editedKnowledgeGraphConfig?.linkToKnowledgeDocuments ?? true,
                                            });
                                        }}
                                    />
                                ) : (
                                    <div className="p-3 bg-muted rounded-lg">
                                        <p className="text-sm text-muted-foreground">
                                            {(pipeline as any).knowledgeGraphConfig?.entityRules?.length || 0} entity rules,{' '}
                                            {(pipeline as any).knowledgeGraphConfig?.relationshipRules?.length || 0} relationship rules configured
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="p-3 bg-muted rounded-lg">
                                <p className="text-sm text-muted-foreground">
                                    <Info className="w-4 h-4 inline mr-1" />
                                    Pipeline-level extraction will run at the end of pipeline execution on selected step outputs.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <Separator />

                {/* Autonomous Self-Healing */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-magenta-400">Autonomous Self-Healing</Label>
                            <p className="text-sm text-muted-foreground">
                                Automatically trigger evolution missions when critical drift (&gt;30%) is detected
                            </p>
                        </div>
                        {isEditing ? (
                            <Switch
                                checked={editedSelfHealingEnabled}
                                onCheckedChange={setEditedSelfHealingEnabled}
                                className="data-[state=checked]:bg-magenta-500"
                            />
                        ) : (
                            <Badge variant={pipeline.selfHealingEnabled ? "default" : "secondary"} className={pipeline.selfHealingEnabled ? "bg-magenta-500" : ""}>
                                {pipeline.selfHealingEnabled ? "Enabled" : "Disabled"}
                            </Badge>
                        )}
                    </div>
                    {pipeline.selfHealingEnabled && (
                        <div className="p-3 bg-magenta-500/5 border border-magenta-500/20 rounded-lg flex items-center gap-2">
                             <div className="w-2 h-2 rounded-full bg-magenta-500 animate-pulse" />
                             <span className="text-[10px] text-magenta-400 uppercase font-bold tracking-widest italic">Evolution Handler Active</span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

