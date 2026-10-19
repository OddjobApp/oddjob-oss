import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@domain-ui/core/ui/components/ui/sheet';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Play, MoveUp, MoveDown, Trash2, Zap, Info, FlaskConical } from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { DecisionNodeBuilder } from './DecisionNodeBuilder.js';
import TransformationJobConfig from '@domain-ui/jobs/ui/modules/jobs/components/TransformationJobConfig';
import IteratorJobConfig from '@domain-ui/jobs/ui/modules/jobs/components/IteratorJobConfig';
import DecisionJobConfig from '@domain-ui/jobs/ui/modules/jobs/components/DecisionJobConfig';
import VariablePicker from '@domain-ui/core/ui/components/shared/VariablePicker';
import OpenAPIJobConfig from '@domain-ui/jobs/ui/modules/jobs/components/OpenAPIJobConfig';
import { buildPipelineContextSchema, getAvailableVariables, getJobOutputSchema } from '@/utils/pipeline-utils';
import type { FormStep } from '@domain-ui/pipeline/ui/modules/pipelines/hooks/use-pipeline-editor';
import type { Job } from "@shared/schema/jobs/table";
import type { JobOutputSchema } from "@shared/schema/jobs/types";

interface StepConfigurationSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedStepIndex: number | null;
    editedSteps: FormStep[];
    jobs: Job[];
    isEditing: boolean;
    pipelineId: number;
    onUpdateStep: (stepTempId: string, updates: Partial<FormStep>) => void;
    onRemoveStep: (stepTempId: string) => void;
    onMoveStep: (index: number, direction: 'up' | 'down') => void;
    onJobChange: (stepTempId: string, jobId: string) => void;
    onOpenInlineTool: (stepTempId: string) => void;
    onCreateSpecialJob: (type: 'iterator' | 'decision', stepTempId: string) => void;
    isTypeAllowed: (type: string) => boolean;
    onSave?: () => void;
    onOpenHarness?: (rules: any[], jobName?: string) => void;
}

export function StepConfigurationSheet({
    open,
    onOpenChange,
    selectedStepIndex,
    editedSteps,
    jobs,
    isEditing,
    pipelineId,
    onUpdateStep,
    onRemoveStep,
    onMoveStep,
    onJobChange,
    onOpenInlineTool,
    onCreateSpecialJob,
    isTypeAllowed,
    onSave,
    onOpenHarness,
}: StepConfigurationSheetProps) {
    const { toast } = useToast();

    const step = selectedStepIndex !== null ? editedSteps[selectedStepIndex] : null;
    const index = selectedStepIndex ?? 0;
    const job = step ? jobs.find(j => j.id === step.jobId) : null;
    const appBackedConfig = (job?.config as any)?.appDeploymentId ? (job?.config as any) : null;
    const isAppBackedJob = Boolean(appBackedConfig || job?.name?.startsWith('App:'));

    // Is this a transformer step? Check if it has transformer rules
    const transformerRules = step?.transformerConfig?.rules || (job?.config as any)?.rules || [];
    const isTransformerStep = transformerRules.length > 0 || job?.type === 'transformer';

    const availableVars = getAvailableVariables(editedSteps, jobs, index);

    // Helper for schema — handles all job types (form_agent, transformer, outputSchema)
    const getPreviousStepSchema = (currentIndex: number): JobOutputSchema | null => {
        if (currentIndex === 0) return null;
        const prevStep = editedSteps[currentIndex - 1];
        const prevJob = jobs.find(j => j.id === prevStep.jobId);
        if (!prevJob) return null;
        return getJobOutputSchema(prevJob, prevStep);
    };

    if (!step) return null;

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent className="w-[90%] sm:w-[800px] sm:max-w-[90%] overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Configure Step {index + 1}</SheetTitle>
                        <SheetDescription>
                            Edit the configuration for this pipeline step.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="py-6 space-y-6">

                        <div className="space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline">Order: {index + 1}</Badge>
                                    {isAppBackedJob && (
                                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                            App{appBackedConfig?.appName ? `: ${appBackedConfig.appName}` : ''}
                                        </Badge>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    {/* Test button — opens Test Harness for transformer steps, standard test otherwise */}
                                    {isTransformerStep ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-400"
                                            onClick={() => {
                                                // Save current config before opening the harness so rules are up-to-date
                                                onSave?.();
                                                onOpenHarness?.(transformerRules, job?.name);
                                            }}
                                        >
                                            <FlaskConical className="h-3 w-3" /> Test Rules
                                        </Button>
                                    ) : (
                                        <Button size="sm" variant="outline" className="gap-2" onClick={async () => {
                                            try {
                                                const input = prompt("Enter input JSON (optional):", "{}");
                                                if (input === null) return;

                                                toast({ title: "Running Test", description: "Executing step..." });

                                                const res = await apiRequest('POST', `/api/pipelines/${pipelineId}/test-step`, {
                                                    jobId: step.jobId,
                                                    input: input,
                                                    config: {
                                                        ...step.transformerConfig,
                                                        ...step.iteratorConfig,
                                                        ...step.decisionConfig
                                                    }
                                                });

                                                const result = await res.json();
                                                if (result.status === "success") {
                                                    toast({
                                                        title: "Test Passed",
                                                        description: typeof result.output === 'string' && result.output.length > 50
                                                            ? "Output generated successfully (check console)"
                                                            : `Output: ${typeof result.output === 'object' ? JSON.stringify(result.output).substring(0, 50) + "..." : result.output}`
                                                    });
                                                    console.log("Test Output:", result.output);
                                                } else {
                                                    toast({ title: "Test Failed", description: result.error, variant: "destructive" });
                                                }

                                            } catch (e: any) {
                                                toast({ title: "Error", description: e.message, variant: "destructive" });
                                            }
                                        }}>
                                            <Play className="h-3 w-3" /> Test
                                        </Button>
                                    )}
                                    <Button size="icon" variant="outline" onClick={() => onMoveStep(index, 'up')} disabled={index === 0}>
                                        <MoveUp className="h-4 w-4" />
                                    </Button>
                                    <Button size="icon" variant="outline" onClick={() => onMoveStep(index, 'down')} disabled={index === editedSteps.length - 1}>
                                        <MoveDown className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                        onClick={() => {
                                            onRemoveStep(step.tempId);
                                            onOpenChange(false);
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {/* Step Type */}
                            {isEditing && (
                                <div>
                                    <Label className="text-xs text-muted-foreground">Step Type</Label>
                                    <Select
                                        value={step.moduleType || "regular"}
                                        onValueChange={(value) => {
                                            if (value === "logic_gatekeeper") {
                                                onUpdateStep(step.tempId, {
                                                    moduleType: "logic_gatekeeper",
                                                    jobId: null,
                                                    decisionNodeConfig: step.decisionNodeConfig || {
                                                        evaluationMode: "AND",
                                                        conditions: [{ source: "", operator: "EQ", target: "" }],
                                                        routes: { onMatch: { destinationStepId: undefined } },
                                                    },
                                                });
                                            } else {
                                                onUpdateStep(step.tempId, {
                                                    moduleType: null,
                                                    decisionNodeConfig: null,
                                                    destinationStepId: null,
                                                });
                                            }
                                        }}
                                    >
                                        <SelectTrigger className="mt-1">
                                            <SelectValue placeholder="Select step type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="regular">Regular Step</SelectItem>
                                            <SelectItem value="logic_gatekeeper">Decision Node</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* Job Selection */}
                            {(!isEditing || (step.moduleType !== "logic_gatekeeper" && step.moduleType !== "transformer" && job?.type !== "transformer")) && (
                                <div>
                                    <Label className="text-xs text-muted-foreground">Job</Label>
                                    {isEditing ? (
                                        <Select
                                            value={step.jobId ? step.jobId.toString() : undefined}
                                            onValueChange={(value) => {
                                                if (value === 'create-inline-tool') {
                                                    onOpenInlineTool(step.tempId);
                                                } else if (value === 'create-iterator-job') {
                                                    onCreateSpecialJob('iterator', step.tempId);
                                                } else if (value === 'create-decision-job') {
                                                    onCreateSpecialJob('decision', step.tempId);
                                                } else {
                                                    onJobChange(step.tempId, value);
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="mt-1">
                                                <SelectValue placeholder="Select a job" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {isTypeAllowed('openapi') && (
                                                    <SelectItem value="create-inline-tool" className="font-semibold text-primary">
                                                        + Define Inline Tool
                                                    </SelectItem>
                                                )}
                                                {isTypeAllowed('iterator') && (
                                                    <SelectItem value="create-iterator-job" className="font-semibold text-orange-600">
                                                        + Create Iterator (Loop)
                                                    </SelectItem>
                                                )}
                                                {isTypeAllowed('decision') && (
                                                    <SelectItem value="create-decision-job" className="font-semibold text-blue-600">
                                                        + Create Decision (Simple)
                                                    </SelectItem>
                                                )}
                                                <Separator className="my-1" />
                                                {jobs
                                                    .filter((job) => (job.id != null) && (!job.isHidden || job.id === step.jobId))
                                                    .map((job) => (
                                                        <SelectItem key={job.id} value={String(job.id)}>
                                                            {job.name} ({job.type})
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <div className="mt-1 font-medium">{job?.name || 'Unknown Job'}</div>
                                    )}
                                </div>
                            )}

                            {/* Decision Node Config */}
                            {step.moduleType === "logic_gatekeeper" && (
                                <div className="mt-4 p-4 border border-primary/20 rounded-lg bg-primary/5">
                                    <DecisionNodeBuilder
                                        value={step.decisionNodeConfig}
                                        onChange={(config) => onUpdateStep(step.tempId, { decisionNodeConfig: config })}
                                        availableSteps={editedSteps
                                            .filter((s) => s.tempId !== step.tempId)
                                            .map((s, idx) => ({ id: s.id || -idx - 1, name: `Step ${idx + 1}`, order: s.order }))}
                                        currentStepOrder={step.order}
                                        contextSchema={buildPipelineContextSchema(
                                            editedSteps.map((s) => ({
                                                jobId: s.jobId,
                                                outputName: s.outputName,
                                                moduleType: s.moduleType
                                            })),
                                            jobs || [],
                                            index
                                        )}
                                    />
                                </div>
                            )}

                            {/* Transformer Config */}
                            {(step.moduleType === 'transformer' || job?.type === 'transformer') && (
                                <div className="mt-4 p-4 border-2 border-indigo-300 rounded-lg bg-indigo-5">
                                    <div className="mb-2 flex items-center gap-2">
                                        <Zap className="h-4 w-4 text-indigo-600" />
                                        <span className="text-sm font-semibold text-indigo-900">Transformer Configuration</span>
                                    </div>
                                    <TransformationJobConfig
                                        config={step.transformerConfig || job?.config || { rules: [], inputSource: 'previous_step', entityExtraction: { enabled: false, autoCreate: true } }}
                                        onChange={(config: any) => onUpdateStep(step.tempId, { transformerConfig: config })}
                                        outputSchema={getPreviousStepSchema(index)}
                                        availableVariables={availableVars}
                                    />
                                </div>
                            )}

                            {/* Iterator Config */}
                            {step.iteratorConfig && (
                                <div className="mt-4 p-4 border-2 border-orange-300 rounded-lg bg-orange-50">
                                    <div className="mb-2 flex items-center gap-2">
                                        <div className="p-1 bg-orange-200 rounded"><Zap className="h-4 w-4 text-orange-700" /></div>
                                        <span className="text-sm font-semibold text-orange-900">Iterator Configuration</span>
                                    </div>
                                    <IteratorJobConfig
                                        config={step.iteratorConfig}
                                        onChange={(c: any) => onUpdateStep(step.tempId, { iteratorConfig: c })}
                                        availableVariables={availableVars}
                                        availableJobs={jobs.filter(j => !j.isHidden && j.id !== step.jobId)}
                                        pipelines={[]} // Pass empty pipelines for now or fetch list if needed
                                    />
                                </div>
                            )}

                            {/* Decision Config */}
                            {(step.decisionConfig || job?.type === 'decision') && (
                                <div className="mt-4 p-4 border-2 border-blue-300 rounded-lg bg-blue-50">
                                    <div className="mb-2 flex items-center gap-2">
                                        <div className="p-1 bg-blue-200 rounded"><Zap className="h-4 w-4 text-blue-700" /></div>
                                        <span className="text-sm font-semibold text-blue-900">Decision Logic</span>
                                    </div>
                                    <DecisionJobConfig
                                        config={step.decisionConfig || (job?.config as any)}
                                        onChange={(c: any) => onUpdateStep(step.tempId, {
                                            decisionConfig: c,
                                            // Persist routing in decisionNodeConfig for pipeline executor
                                            decisionNodeConfig: {
                                                ...(step.decisionNodeConfig as object || {}),
                                                trueStepId: c.trueStepId,
                                                falseStepId: c.falseStepId,
                                            },
                                        })}
                                        availableVariables={availableVars}
                                        availableSteps={editedSteps
                                            .filter((s) => s.tempId !== step.tempId)
                                            .map((s, idx) => ({
                                                id: s.id ?? -idx - 1,
                                                name: `Step ${idx + 1}`,
                                                order: s.order ?? idx,
                                            }))}
                                        currentStepOrder={step.order ?? index}
                                    />
                                </div>
                            )}

                            {/* Output Name */}
                            <div>
                                <Label className="text-xs text-muted-foreground">Output Name (optional)</Label>
                                <Input
                                    value={step.outputName ?? ''}
                                    onChange={(e) => onUpdateStep(step.tempId, { outputName: e.target.value })}
                                    placeholder="e.g., description, pricing"
                                    className="mt-1"
                                />
                            </div>

                            {/* Output Parameters Display */}
                            {(() => {
                                const outputs = (() => {
                                    if (!job) return [];
                                    const jobConfig = job.config as any;
                                    if (job.type === 'form_agent' && jobConfig?.formSchema?.fields) {
                                        return jobConfig.formSchema.fields.map((f: any) => ({
                                            name: f.key,
                                            label: f.label || f.key,
                                            type: f.type,
                                            description: f.description
                                        }));
                                    }
                                    if (job.outputSchema) {
                                        let schema = job.outputSchema as any;
                                        if (typeof schema === 'string') {
                                            try { schema = JSON.parse(schema); } catch (e) { return []; }
                                        }
                                        const fields = (schema?.schemaDef || schema?.fields || {}) as Record<string, any>;
                                        return Object.entries(fields).map(([key, info]: [string, any]) => ({
                                            name: key,
                                            label: info.label || key,
                                            type: info.type || 'string',
                                            description: info.description
                                        }));
                                    }
                                    return [];
                                })();

                                if (outputs.length === 0) return null;

                                return (
                                    <div className="space-y-2 pt-2">
                                        <Label className="text-xs text-muted-foreground">Discovered Output Parameters</Label>
                                        <div className="grid grid-cols-1 gap-2">
                                            {outputs.map((out: any) => (
                                                <div key={out.name} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-border/40 text-xs">
                                                    <div className="flex flex-col">
                                                        <span className="font-semibold">{out.label}</span>
                                                        <code className="text-[10px] text-muted-foreground">{out.name}</code>
                                                    </div>
                                                    <Badge variant="outline" className="text-[10px] bg-background">
                                                        {out.type}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground italic">
                                            These values will be available as variables in subsequent steps.
                                        </p>
                                    </div>
                                );
                            })()}

                            {/* Retry Configuration */}
                            <div className="pt-2 border-t">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Label className="text-xs text-muted-foreground">Retry Policy</Label>
                                        <Switch
                                            checked={!!step.retryConfig}
                                            onCheckedChange={(checked) => onUpdateStep(step.tempId, {
                                                retryConfig: checked ? { maxRetries: 3, backoffMs: 5000, backoffMultiplier: 2, retryOnCategories: ['rate_limit', 'server_error', 'timeout'] } : null
                                            })}
                                            className="scale-75 origin-left"
                                        />
                                    </div>
                                </div>
                                {step.retryConfig && (
                                    <div className="grid grid-cols-3 gap-2 p-3 bg-muted/30 rounded-md border text-xs">
                                        <div>
                                            <Label className="text-[10px]">Max Retries</Label>
                                            <Input
                                                type="number"
                                                value={step.retryConfig.maxRetries}
                                                onChange={(e) => onUpdateStep(step.tempId, { retryConfig: { ...step.retryConfig, maxRetries: parseInt(e.target.value) } })}
                                                className="h-7 text-xs mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-[10px]">Backoff (ms)</Label>
                                            <Input
                                                type="number"
                                                value={step.retryConfig.backoffMs}
                                                onChange={(e) => onUpdateStep(step.tempId, { retryConfig: { ...step.retryConfig, backoffMs: parseInt(e.target.value) } })}
                                                className="h-7 text-xs mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-[10px]">Multiplier</Label>
                                            <Input
                                                type="number"
                                                value={step.retryConfig.backoffMultiplier}
                                                onChange={(e) => onUpdateStep(step.tempId, { retryConfig: { ...step.retryConfig, backoffMultiplier: parseFloat(e.target.value) } })}
                                                className="h-7 text-xs mt-1"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Available Variables */}
                            {availableVars.length > 0 && (
                                <div className="flex items-center justify-between p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                                    <div className="flex items-center gap-2">
                                        <Info className="w-4 h-4 text-blue-500" />
                                        <span className="text-xs font-medium text-blue-900">Variables available from previous steps</span>
                                    </div>
                                    <VariablePicker variables={availableVars} />
                                </div>
                            )}

                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}


